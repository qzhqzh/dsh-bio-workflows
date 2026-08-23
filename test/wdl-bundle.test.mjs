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
  const bam = await loadWdlBundle(new URL('../workflows/bam-qc/1.0.0/', import.meta.url))
  const validation = describeWdlBundleValidation(fastq)

  assert.equal(fastq.descriptor.bundleVersion, WDL_BUNDLE_SCHEMA_VERSION)
  assert.equal(fastq.descriptor.manifest.id, 'fastq-qc')
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
