import assert from 'node:assert/strict'
import { access, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  WorkflowStoreConfigValidationError,
  createWorkflowStore,
  parseWorkflowStoreConfig,
} from '../src/workflow-store.js'

test('the workflow store searches and structurally validates built-in starters', async () => {
  const store = createWorkflowStore()
  const all = await store.search()
  const qc = await store.search({ query: 'FASTQ', language: 'wdl', tag: 'qc' })
  const validation = await store.validate({ id: 'fastq-qc' })
  const resolved = await store.resolve({ id: 'fastq-qc', version: '1.2.0' })

  assert.deepEqual(all.workflows.map((workflow) => workflow.id), [
    'bam-qc',
    'fastq-qc',
    'fastq-qc',
    'fastq-qc',
  ])
  assert.equal(all.count, 4)
  assert.deepEqual(all.diagnostics, [])
  assert.equal(qc.count, 3)
  assert.equal(qc.workflows[0].source, 'builtin')
  assert.equal(qc.workflows[0].trust, 'builtin')
  assert.equal(qc.workflows[0].installed, false)
  assert.equal(validation.ok, true)
  assert.equal(validation.validation.valid, true)
  assert.equal(validation.validation.executionReady, false)
  assert.equal(resolved.ok, true)
  assert.equal(resolved.source, 'builtin')
  assert.equal(resolved.bundle.digest, qc.workflows[0].digest)
  assert.equal(Object.isFrozen(resolved.bundle), true)
})

test('store config is strict and writes remain disabled by default', async () => {
  assert.deepEqual(parseWorkflowStoreConfig(), {
    root: null,
    writeEnabled: false,
    providers: [],
  })
  assert.throws(
    () => parseWorkflowStoreConfig({ writeEnabled: true }),
    WorkflowStoreConfigValidationError,
  )
  assert.throws(
    () => parseWorkflowStoreConfig({ root: 'relative/store' }),
    WorkflowStoreConfigValidationError,
  )
  assert.throws(
    () => parseWorkflowStoreConfig({ root: 42 }),
    WorkflowStoreConfigValidationError,
  )
  assert.throws(
    () => parseWorkflowStoreConfig({ root: '/tmp/store', extra: true }),
    WorkflowStoreConfigValidationError,
  )
  assert.throws(
    () => parseWorkflowStoreConfig({ root: `/${'a'.repeat(4096)}` }),
    WorkflowStoreConfigValidationError,
  )
  assert.throws(
    () => parseWorkflowStoreConfig({
      providers: [{ id: 'git-main', kind: 'git', root: '/srv/provider', revision: 'short' }],
    }),
    /40-character Git commit id/,
  )

  const store = createWorkflowStore()
  const install = await store.install({ id: 'fastq-qc' })
  const scaffold = await store.scaffold({ id: 'custom-qc', name: 'Custom QC', summary: 'Custom.' })

  assert.equal(install.error.code, 'store_writes_disabled')
  assert.equal(scaffold.error.code, 'store_writes_disabled')
})

test('revision-pinned Git and TRS snapshots are read-only discovery sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workflow-provider-store-'))
  const gitRoot = await mkdtemp(join(tmpdir(), 'dsh-workflow-provider-git-'))
  const trsRoot = await mkdtemp(join(tmpdir(), 'dsh-workflow-provider-trs-'))
  const gitRevision = 'a'.repeat(40)
  try {
    await mkdir(join(gitRoot, 'fastq-qc'), { recursive: true })
    await cp(
      new URL('../workflows/fastq-qc/1.2.0/', import.meta.url),
      join(gitRoot, 'fastq-qc', '1.2.0'),
      { recursive: true },
    )
    await writeFile(join(gitRoot, '.dsh-provider.json'), `${JSON.stringify({
      schemaVersion: '1',
      id: 'git-main',
      kind: 'git',
      revision: gitRevision,
      readOnly: true,
    })}\n`)
    await mkdir(join(trsRoot, 'bam-qc'), { recursive: true })
    await cp(
      new URL('../workflows/bam-qc/1.0.0/', import.meta.url),
      join(trsRoot, 'bam-qc', '1.0.0'),
      { recursive: true },
    )
    await writeFile(join(trsRoot, '.dsh-provider.json'), `${JSON.stringify({
      schemaVersion: '1',
      id: 'dockstore',
      kind: 'trs',
      revision: 'bam-qc-1.0.0',
      readOnly: true,
    })}\n`)
    const store = createWorkflowStore({
      root,
      writeEnabled: true,
      providers: [
        { id: 'git-main', kind: 'git', root: gitRoot, revision: gitRevision },
        { id: 'dockstore', kind: 'trs', root: trsRoot, revision: 'bam-qc-1.0.0' },
      ],
    })

    const git = await store.search({ source: 'git', provider: 'git-main' })
    const trs = await store.search({ source: 'trs', provider: 'dockstore' })
    assert.equal(git.count, 1)
    assert.equal(git.workflows[0].trust, 'revision_pinned_read_only')
    assert.deepEqual(git.workflows[0].provider, {
      id: 'git-main',
      kind: 'git',
      revision: gitRevision,
      readOnly: true,
    })
    assert.equal(trs.count, 1)
    assert.equal(trs.workflows[0].id, 'bam-qc')
    await assert.rejects(
      store.resolve({ id: 'fastq-qc', version: '1.2.0', source: 'git' }),
      /provider is required/,
    )
    const validated = await store.validate({
      id: 'fastq-qc',
      version: '1.2.0',
      source: 'git',
      provider: 'git-main',
    })
    assert.equal(validated.ok, true)
    assert.equal(validated.provider.revision, gitRevision)
    const installed = await store.install({
      id: 'fastq-qc',
      version: '1.2.0',
      source: 'git',
      provider: 'git-main',
      expectedDigest: git.workflows[0].digest,
    })
    assert.equal(installed.ok, true)
    assert.equal(installed.executionAuthorized, false)
    await access(join(root, 'installed', 'fastq-qc', '1.2.0', 'main.wdl'))

    await writeFile(join(trsRoot, '.dsh-provider.json'), `${JSON.stringify({
      schemaVersion: '1',
      id: 'dockstore',
      kind: 'trs',
      revision: 'changed',
      readOnly: true,
    })}\n`)
    const rejected = await store.search({ source: 'trs', provider: 'dockstore' })
    assert.equal(rejected.count, 0)
    assert.equal(rejected.diagnostics.some((item) => item.code === 'provider_marker_invalid'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(gitRoot, { recursive: true, force: true })
    await rm(trsRoot, { recursive: true, force: true })
  }
})

test('opt-in stores install immutable bundles and scaffold local WDL drafts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workflow-store-test-'))
  try {
    const store = createWorkflowStore({ root, writeEnabled: true })
    const fastq = (await store.search({ query: 'fastq', source: 'builtin' })).workflows[0]
    const installOptions = {
      id: fastq.id,
      version: fastq.version,
      expectedDigest: fastq.digest,
    }
    const installed = await store.install(installOptions)
    const repeated = await store.install(installOptions)
    const alreadyInstalled = await store.install({
      id: 'fastq-qc',
      version: fastq.version,
      expectedDigest: fastq.digest,
      source: 'installed',
    })
    const scaffolded = await store.scaffold({
      id: 'custom-qc',
      version: '0.1.0',
      name: 'Custom QC',
      summary: 'A local WDL starter draft.',
    })
    const repeatedScaffold = await store.scaffold({
      id: 'custom-qc',
      version: '0.1.0',
      name: 'Custom QC',
      summary: 'A local WDL starter draft.',
    })

    assert.equal(installed.ok, true)
    assert.equal(installed.status, 'created')
    assert.equal(installed.executionAuthorized, false)
    assert.equal(repeated.ok, true)
    assert.equal(repeated.status, 'already_present')
    assert.equal(alreadyInstalled.status, 'already_present')
    assert.equal(scaffolded.ok, true)
    assert.equal(scaffolded.status, 'created')
    assert.equal(scaffolded.source, 'draft')
    assert.equal(repeatedScaffold.ok, false)
    assert.equal(repeatedScaffold.status, 'already_present')

    await access(join(root, 'installed', 'fastq-qc', fastq.version, 'main.wdl'))
    if (process.platform !== 'win32') {
      assert.equal(
        (await stat(join(root, 'installed', 'fastq-qc', fastq.version, 'main.wdl'))).mode & 0o777,
        0o600,
      )
    }
    const draftDescriptor = JSON.parse(await readFile(
      join(root, 'drafts', 'custom-qc', '0.1.0', 'workflow.json'),
      'utf8',
    ))
    assert.equal(draftDescriptor.source.kind, 'local')
    assert.equal(draftDescriptor.verification.status, 'unverified')

    const installedSearch = await store.search({ source: 'installed' })
    const draftSearch = await store.search({ source: 'draft' })
    const combinedSearch = await store.search()
    const draftValidation = await store.validate({
      id: 'custom-qc',
      version: '0.1.0',
      source: 'draft',
    })
    assert.equal(installedSearch.count, 1)
    assert.equal(installedSearch.workflows[0].installed, true)
    assert.equal(draftSearch.count, 1)
    assert.equal(draftSearch.workflows[0].id, 'custom-qc')
    assert.equal(draftSearch.workflows[0].trust, 'local')
    assert.equal(combinedSearch.count, 5)
    assert.equal(
      combinedSearch.workflows.filter((workflow) => workflow.id === 'fastq-qc').length,
      3,
    )
    assert.equal(
      combinedSearch.workflows.find((workflow) => workflow.id === 'fastq-qc').installed,
      true,
    )
    assert.equal(draftValidation.ok, true)
    assert.equal(draftValidation.validation.level, 'structural')
    assert.ok(draftValidation.validation.warnings.some(
      (warning) => warning.code === 'wdl_engine_semantics_not_checked',
    ))

    await writeFile(join(root, 'installed', 'fastq-qc', fastq.version, 'workflow.json'), '{}\n')
    const conflict = await store.install(installOptions)
    assert.equal(conflict.ok, false)
    assert.equal(conflict.status, 'conflict')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store lookups reject malformed identifiers, versions, sources, and filters', async () => {
  const store = createWorkflowStore()

  await assert.rejects(store.validate({ id: '../escape' }), /lowercase workflow identifier/)
  await assert.rejects(store.validate({ id: 'fastq-qc', version: 'latest' }), /semantic version/)
  await assert.rejects(store.validate({ id: 'fastq-qc', source: 'remote' }), /source must be one of/)
  await assert.rejects(store.search({ unknown: 'value' }), /unsupported workflow store filter/)
  assert.equal((await store.validate({ id: 'missing' })).error.code, 'workflow_not_found')

  const root = await mkdtemp(join(tmpdir(), 'dsh-workflow-scaffold-validation-'))
  try {
    const writable = createWorkflowStore({ root, writeEnabled: true })
    const fastq = (await writable.search({ query: 'fastq', source: 'builtin' })).workflows[0]
    await assert.rejects(
      writable.install({ id: 'fastq-qc', expectedDigest: fastq.digest }),
      /exact semantic version/,
    )
    await assert.rejects(
      writable.install({ id: 'fastq-qc', version: '1.0.0' }),
      /SHA-256 bundle digest/,
    )
    const mismatch = await writable.install({
      id: 'fastq-qc',
      version: '1.0.0',
      expectedDigest: `sha256:${'0'.repeat(64)}`,
    })
    assert.equal(mismatch.error.code, 'digest_mismatch')
    await assert.rejects(access(join(root, 'installed', 'fastq-qc')), /ENOENT/)
    await assert.rejects(
      writable.scaffold({ id: '../bad', name: 'Bad', summary: 'Bad.' }),
      /lowercase workflow identifier/,
    )
    await assert.rejects(
      writable.scaffold({ id: 'bad-version', version: 'latest', name: 'Bad', summary: 'Bad.' }),
      /semantic version/,
    )
    await assert.rejects(
      writable.scaffold({ id: 'bad-name', name: '', summary: 'Bad.' }),
      /name must contain/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store operations observe caller cancellation before reading or writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workflow-store-cancel-'))
  try {
    const store = createWorkflowStore({ root, writeEnabled: true })
    const controller = new AbortController()
    controller.abort(new Error('cancelled by caller'))

    await assert.rejects(
      store.search({}, { signal: controller.signal }),
      /cancelled by caller/,
    )
    await assert.rejects(
      store.scaffold(
        { id: 'cancelled', name: 'Cancelled', summary: 'Must not be written.' },
        { signal: controller.signal },
      ),
      /cancelled by caller/,
    )
    await assert.rejects(access(join(root, 'drafts', 'cancelled')), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('invalid local bundles are diagnostic and symlinked write paths fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workflow-store-safety-'))
  const outside = await mkdtemp(join(tmpdir(), 'dsh-workflow-store-outside-'))
  try {
    const broken = join(root, 'drafts', 'broken', '1.0.0')
    await mkdir(broken, { recursive: true })
    await writeFile(join(broken, 'workflow.json'), '{}\n')
    const store = createWorkflowStore({ root, writeEnabled: true })
    const drafts = await store.search({ source: 'draft' })
    assert.equal(drafts.count, 0)
    assert.equal(drafts.diagnostics.length, 1)
    assert.equal(drafts.diagnostics[0].code, 'invalid_bundle')

    if (process.platform !== 'win32') {
      const fastq = (await store.search({ query: 'fastq', source: 'builtin' })).workflows[0]
      await mkdir(join(root, 'installed'), { recursive: true })
      await symlink(outside, join(root, 'installed', 'fastq-qc'), 'dir')
      await assert.rejects(
        store.install({
          id: fastq.id,
          version: fastq.version,
          expectedDigest: fastq.digest,
        }),
        /unsafe workflow store path component/,
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('store discovery rejects a symlinked source area outside the configured root', async (context) => {
  if (process.platform === 'win32') {
    context.skip('directory symlink behavior requires Unix permissions')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'dsh-workflow-store-read-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'dsh-workflow-store-read-outside-'))
  try {
    await mkdir(join(outside, 'fastq-qc'), { recursive: true })
    await cp(
      new URL('../workflows/fastq-qc/1.0.0/', import.meta.url),
      join(outside, 'fastq-qc', '1.0.0'),
      { recursive: true },
    )
    await symlink(outside, join(root, 'drafts'), 'dir')
    const store = createWorkflowStore({ root })

    const result = await store.search({ source: 'draft' })

    assert.equal(result.count, 0)
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'store_path_unsafe'))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('store diagnostics are globally capped and truncate bundle errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workflow-store-diagnostics-'))
  try {
    for (let index = 0; index < 70; index += 1) {
      const directory = join(root, 'drafts', `broken-${String(index).padStart(2, '0')}`, '1.0.0')
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'workflow.json'), '{}\n')
    }
    const store = createWorkflowStore({ root })

    const result = await store.search({ source: 'draft' })

    assert.equal(result.count, 0)
    assert.equal(result.diagnostics.length, 64)
    assert.equal(result.diagnostics.at(-1).code, 'diagnostics_limit')
    assert.ok(result.diagnostics.slice(0, -1).every(
      (diagnostic) => diagnostic.errors.length <= 8,
    ))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
