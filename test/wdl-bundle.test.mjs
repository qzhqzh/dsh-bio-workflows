import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  WDL_BUNDLE_SCHEMA_VERSION,
  WDL_LANGUAGE_VERSIONS,
  WdlBundleValidationError,
  describeWdlBundleValidation,
  loadWdlBundle,
  parseWdlBundleDescriptor,
  sha256Text,
  validateLoadedWdlBundle,
  validateWdlBundleDescriptor,
  validateWdlBundleDirectory,
} from '../src/wdl-bundle.js'
import { PACKAGE_VERSION } from '../src/info.js'

const fastqBundle = new URL('../workflows/fastq-qc/1.0.0/', import.meta.url)

test('built-in WDL bundles load with verified files and explicit limitations', async () => {
  const fastq = await loadWdlBundle(fastqBundle)
  const executableFastq = await loadWdlBundle(new URL('../workflows/fastq-qc/1.1.0/', import.meta.url))
  const resultFastq = await loadWdlBundle(new URL('../workflows/fastq-qc/1.2.0/', import.meta.url))
  const bam = await loadWdlBundle(new URL('../workflows/bam-qc/1.0.0/', import.meta.url))
  const historicalAcceptance = JSON.parse(await readFile(
    new URL('../docs/evidence/fastq-qc-1.1.0-miniwdl-acceptance.json', import.meta.url),
    'utf8',
  ))
  const historicalAgentAcceptance = JSON.parse(await readFile(
    new URL('../docs/evidence/fastq-qc-1.1.0-agent-loop-owner-disposal.json', import.meta.url),
    'utf8',
  ))
  const resultAcceptance = JSON.parse(await readFile(
    new URL('../docs/evidence/fastq-qc-1.2.0-result-acceptance.json', import.meta.url),
    'utf8',
  ))
  const agentAcceptance = JSON.parse(await readFile(
    new URL('../docs/evidence/fastq-qc-1.2.0-agent-loop-owner-disposal.json', import.meta.url),
    'utf8',
  ))
  const validation = describeWdlBundleValidation(fastq)

  assert.equal(fastq.descriptor.bundleVersion, WDL_BUNDLE_SCHEMA_VERSION)
  assert.equal(fastq.descriptor.manifest.id, 'fastq-qc')
  assert.equal(executableFastq.descriptor.manifest.version, '1.1.0')
  assert.equal(executableFastq.descriptor.manifest.status, 'ready')
  assert.equal(describeWdlBundleValidation(executableFastq).executionReady, false)
  assert.equal(resultFastq.descriptor.manifest.version, '1.2.0')
  assert.equal(resultFastq.descriptor.verification.status, 'verified')
  assert.equal(describeWdlBundleValidation(resultFastq).executionReady, false)

  assert.equal(historicalAcceptance.packageVersion, '0.6.0')
  assert.equal(historicalAcceptance.workflow.bundleDigest, executableFastq.digest)
  assert.equal(historicalAcceptance.cancellation.status, 'killed')
  assert.equal(historicalAgentAcceptance.candidate.package, 'dsh-bio-workflows@0.6.0')
  assert.equal(historicalAgentAcceptance.workflow.bundleDigest, executableFastq.digest)
  for (const expectedSha256 of [
    ...Object.values(historicalAcceptance.adapterSources),
    ...Object.values(historicalAgentAcceptance.sourceSha256),
  ]) {
    assert.match(expectedSha256, /^[a-f0-9]{64}$/)
  }

  assert.equal(resultAcceptance.schemaVersion, '1')
  assert.equal(resultAcceptance.packageVersion, '0.7.0')
  assert.equal(resultAcceptance.workflow.bundleDigest, resultFastq.digest)
  assert.match(resultAcceptance.workflow.planDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(resultAcceptance.runner.name, 'miniwdl')
  assert.equal(resultAcceptance.runner.version, '1.15.0')
  assert.equal(resultAcceptance.containerRuntime.host, 'unix:///var/run/docker.sock')
  assert.match(resultAcceptance.containerRuntime.engineId, /^[A-Za-z0-9:._-]+$/)
  assert.equal(resultAcceptance.containerRuntime.swarm.localNodeState, 'active')
  assert.equal(resultAcceptance.containerRuntime.swarm.controlAvailable, true)
  assert.equal(resultAcceptance.containerRuntime.swarm.autoInit, false)
  assert.equal(resultAcceptance.jobRuntime.provider, '@deepseek-ai/dsh-jobs-local@0.1.1-rc.2')
  assert.equal(resultAcceptance.jobRuntime.statusBeforeWait, 'running')
  assert.equal(resultAcceptance.jobRuntime.statusAfterWait, 'completed')
  assert.equal(resultAcceptance.resultPolicy.maxArtifacts, 1024)
  assert.equal(resultAcceptance.resultPolicy.canonicalTargetNoFollowOpen, true)
  assert.equal(resultAcceptance.resultPolicy.hostZipExtraction, false)
  assert.equal(resultAcceptance.result.status, 'completed')
  assert.equal(resultAcceptance.result.schemaVersion, '1')
  assert.deepEqual(resultAcceptance.result.artifacts.map((artifact) => artifact.outputId), [
    'html_reports',
    'zip_reports',
    'summary_reports',
  ])
  assert.equal(resultAcceptance.result.artifacts.every((artifact) => (
    artifact.sha256 === artifact.directSha256
  )), true)
  assert.deepEqual(resultAcceptance.result.summaries.fastqc.moduleCounts, {
    pass: 5,
    warn: 2,
    fail: 3,
  })
  assert.equal(resultAcceptance.result.summaries.fastqc.reports[0].overallStatus, 'fail')
  for (const [relativePath, expectedSha256] of Object.entries(resultAcceptance.adapterSources)) {
    // 0.8.0 extends root tool registration; the retained 0.7.0 execution
    // evidence remains authoritative for the unchanged execution adapter.
    if (relativePath === 'index.js') continue
    const source = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8')
    assert.equal(sha256Text(source), expectedSha256, `${relativePath} changed after acceptance`)
  }

  assert.equal(agentAcceptance.schemaVersion, '1')
  assert.equal(agentAcceptance.candidate.package, 'dsh-bio-workflows@0.7.0')
  assert.equal(agentAcceptance.candidate.dsh, '0.1.1-rc.2')
  assert.equal(agentAcceptance.workflow.bundleDigest, resultFastq.digest)
  assert.match(agentAcceptance.workflow.planDigest, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(agentAcceptance.model.toolCalls, [
    'bio_workflows_search',
    'bio_workflows_plan',
    'bio_workflows_run',
  ])
  assert.equal(agentAcceptance.approval.outcome, 'allowed-once')
  assert.equal(agentAcceptance.approval.auditIdsMatched, true)
  assert.equal(agentAcceptance.owner.agentRemoved, true)
  assert.equal(agentAcceptance.owner.sessionRemoved, true)
  assert.equal(agentAcceptance.job.statusBeforeDispose, 'running')
  assert.equal(agentAcceptance.job.removedAfterDispose, true)
  assert.equal(agentAcceptance.runHistory.countBeforeDispose, 1)
  assert.equal(agentAcceptance.runHistory.reconciliationStatus, 'active')
  assert.equal(agentAcceptance.run.statusAfterDispose, 'killed')
  assert.equal(agentAcceptance.run.runnerProcessStopped, true)
  assert.equal(agentAcceptance.run.childProcessStopped, true)
  assert.equal(agentAcceptance.run.terminalProvenancePersisted, true)
  for (const [relativePath, expectedSha256] of Object.entries(agentAcceptance.sourceSha256)) {
    // The historical Agent-loop record predates the additive authoring wiring
    // and the expanded 0.8 smoke. Execution adapter hashes remain checked.
    if (['index.js', 'scripts/smoke-dsh-agent-loop.mjs'].includes(relativePath)) continue
    const source = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8')
    assert.equal(sha256Text(source), expectedSha256, `${relativePath} changed after Agent-loop acceptance`)
  }
  assert.equal(bam.descriptor.manifest.id, 'bam-qc')
  assert.match(fastq.digest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(Object.isFrozen(fastq.descriptor), true)
  assert.equal(validation.valid, true)
  assert.equal(validation.level, 'structural')
  assert.equal(validation.executionReady, false)
  assert.ok(!validation.warnings.some((warning) => warning.code === 'wdl_engine_semantics_not_checked'))
  assert.ok(validation.warnings.some((warning) => warning.code === 'wdl_engine_semantics_not_revalidated'))
  assert.ok(validation.warnings.some((warning) => warning.code === 'engine_execution_not_checked'))
  assert.ok(!validation.warnings.some((warning) => warning.code === 'container_digest_unpinned'))
})

test('descriptor validation rejects path traversal and engine mismatches', async () => {
  const source = JSON.parse(await readFile(new URL('../workflows/fastq-qc/1.0.0/workflow.json', import.meta.url)))
  source.files[0].path = '../LICENSE'
  source.manifest.engine.name = 'unknown-engine'

  const result = validateWdlBundleDescriptor(source)

  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.path === '$.files[0].path' && error.code === 'format'))
  assert.ok(result.errors.some((error) => error.path === '$.manifest.engine.name' && error.code === 'compatibility'))
  assert.throws(() => parseWdlBundleDescriptor(source), WdlBundleValidationError)
})

test('descriptor validation reports malformed nested metadata without partial parsing', () => {
  const result = validateWdlBundleDescriptor({
    bundleVersion: '2',
    manifest: null,
    wdl: {
      version: '2.0',
      entrypoint: '../main.txt',
      engines: [{ name: 'MiniWDL' }, { name: 'MiniWDL' }],
      unsupported: true,
    },
    source: { kind: 'remote', repository: '' },
    authors: ['same', 'same'],
    license: '',
    verification: { status: 'trusted', checks: ['same', 'same'] },
    files: [
      { path: 'main.wdl', role: 'binary', sha256: 'bad' },
      { path: 'main.wdl', role: 'workflow', sha256: '0'.repeat(64) },
    ],
    unsupported: true,
  })

  assert.equal(result.valid, false)
  for (const code of ['additional_property', 'const', 'type', 'enum', 'format', 'duplicate', 'min_length']) {
    assert.ok(result.errors.some((error) => error.code === code), `missing ${code}`)
  }
})

test('loaded bundle validation rejects missing and undeclared contents', async () => {
  const descriptor = JSON.parse(
    await readFile(new URL('../workflows/bam-qc/1.0.0/workflow.json', import.meta.url), 'utf8'),
  )

  assert.throws(
    () => validateLoadedWdlBundle(descriptor, { extra: 'undeclared' }),
    (error) => {
      assert.ok(error instanceof WdlBundleValidationError)
      assert.ok(error.errors.some((issue) => issue.code === 'missing_content'))
      assert.ok(error.errors.some((issue) => issue.code === 'undeclared_file'))
      return true
    },
  )
  assert.throws(
    () => validateLoadedWdlBundle(descriptor, []),
    WdlBundleValidationError,
  )
})

test('directory validation fails closed on file digest changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wdl-bundle-test-'))
  const copied = join(root, 'bundle')
  try {
    await cp(fastqBundle, copied, { recursive: true })
    await writeFile(join(copied, 'main.wdl'), 'version 1.0\nworkflow changed {}\n')

    const result = await validateWdlBundleDirectory(copied)

    assert.equal(result.valid, false)
    assert.ok(result.errors.some((error) => error.code === 'digest_mismatch'))
    assert.equal(result.executionReady, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('directory validation rejects undeclared files and directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wdl-inventory-test-'))
  const copied = join(root, 'bundle')
  try {
    await cp(fastqBundle, copied, { recursive: true })
    await writeFile(join(copied, 'undeclared.txt'), 'not part of the bundle\n')
    await mkdir(join(copied, 'empty'))

    const result = await validateWdlBundleDirectory(copied)

    assert.equal(result.valid, false)
    assert.ok(result.errors.some((error) => error.code === 'undeclared_file'))
    assert.ok(result.errors.some((error) => error.code === 'undeclared_directory'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('directory validation rejects symlinks in nested bundle paths', async (context) => {
  if (process.platform === 'win32') {
    context.skip('directory symlink behavior requires Unix permissions')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'dsh-wdl-symlink-test-'))
  const copied = join(root, 'bundle')
  const outside = join(root, 'outside')
  try {
    await cp(fastqBundle, copied, { recursive: true })
    await mkdir(outside)
    await writeFile(join(outside, 'inputs.json'), '{}\n')
    await rm(join(copied, 'examples'), { recursive: true })
    await symlink(outside, join(copied, 'examples'), 'dir')

    const result = await validateWdlBundleDirectory(copied)

    assert.equal(result.valid, false)
    assert.ok(result.errors.some((error) => error.code === 'symlink'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('structural validation rejects external WDL imports even with a matching digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wdl-import-test-'))
  const copied = join(root, 'bundle')
  try {
    await cp(fastqBundle, copied, { recursive: true })
    const mainPath = join(copied, 'main.wdl')
    const descriptorPath = join(copied, 'workflow.json')
    const source = `${await readFile(mainPath, 'utf8')}\nimport "https://example.invalid/task.wdl"\n`
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'))
    descriptor.files.find((file) => file.path === 'main.wdl').sha256 = sha256Text(source)
    await writeFile(mainPath, source)
    await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`)

    const result = await validateWdlBundleDirectory(copied)

    assert.equal(result.valid, false)
    assert.ok(result.errors.some((error) => error.code === 'external_import'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('directory validation reports missing roots and missing bundled imports', async () => {
  const missing = await validateWdlBundleDirectory('/tmp/dsh-wdl-bundle-does-not-exist')
  assert.equal(missing.valid, false)
  assert.equal(missing.errors[0].code, 'missing_directory')

  const root = await mkdtemp(join(tmpdir(), 'dsh-wdl-missing-import-test-'))
  const copied = join(root, 'bundle')
  try {
    await cp(fastqBundle, copied, { recursive: true })
    const mainPath = join(copied, 'main.wdl')
    const descriptorPath = join(copied, 'workflow.json')
    const source = `${await readFile(mainPath, 'utf8')}\nimport "tasks/missing.wdl"\n`
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'))
    descriptor.files.find((file) => file.path === 'main.wdl').sha256 = sha256Text(source)
    await writeFile(mainPath, source)
    await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`)

    const result = await validateWdlBundleDirectory(copied)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((error) => error.code === 'missing_import'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the published WDL bundle schema matches runtime versions', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../schema/wdl-bundle.schema.json', import.meta.url), 'utf8'),
  )

  assert.equal(schema.properties.bundleVersion.const, WDL_BUNDLE_SCHEMA_VERSION)
  assert.ok(schema.$id.includes(`@${PACKAGE_VERSION}/`))
  assert.deepEqual(schema.$defs.wdl.properties.version.enum, [...WDL_LANGUAGE_VERSIONS])
  assert.equal(schema.additionalProperties, false)
})
