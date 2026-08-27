import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  FIXTURE_BUNDLE_LIMITS,
  FIXTURE_BUNDLE_SCHEMA_VERSION,
  computeFixtureBundleDigest,
  loadFixtureBundle,
  normalizeFixtureDescriptor,
  resolveFixtureBundle,
} from '../src/fixture-bundle.js'

function digest(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function descriptor(content = Buffer.from('fixture input\n')) {
  return {
    schemaVersion: FIXTURE_BUNDLE_SCHEMA_VERSION,
    id: 'text-roundtrip',
    version: '1.0.0',
    name: 'Text round trip',
    summary: 'Copies one deterministic input into one output.',
    files: [{
      path: 'inputs/message.txt',
      sizeBytes: content.length,
      sha256: digest(content),
      mediaType: 'text/plain',
    }],
    inputs: {
      'roundtrip.source': { $fixture: 'inputs/message.txt' },
      'roundtrip.label': 'fixture',
    },
    assertions: [
      {
        id: 'copied-file',
        kind: 'file_digest',
        output: 'roundtrip.copy',
        sizeBytes: content.length,
        sha256: digest(content),
      },
      {
        id: 'label-value',
        kind: 'value_equals',
        output: 'roundtrip.label',
        expected: 'fixture',
      },
    ],
  }
}

async function writeBundle(root, value = descriptor(), content = Buffer.from('fixture input\n')) {
  const directory = join(root, value.id, value.version)
  await mkdir(join(directory, 'inputs'), { recursive: true })
  await writeFile(join(directory, 'fixture.json'), `${JSON.stringify(value, null, 2)}\n`)
  await writeFile(join(directory, 'inputs/message.txt'), content)
  return directory
}

test('Fixture Bundle v1 normalization freezes canonical declarative inputs and assertions', () => {
  const value = descriptor()
  const normalized = normalizeFixtureDescriptor({
    ...value,
    files: [...value.files].reverse(),
    assertions: [...value.assertions].reverse(),
    inputs: Object.fromEntries(Object.entries(value.inputs).reverse()),
  })

  assert.equal(normalized.totalFileBytes, Buffer.byteLength('fixture input\n'))
  assert.deepEqual(normalized.descriptor.assertions.map((item) => item.id), [
    'copied-file',
    'label-value',
  ])
  assert.equal(Object.isFrozen(normalized.descriptor.inputs), true)
  assert.equal(
    computeFixtureBundleDigest(normalized.descriptor),
    computeFixtureBundleDigest(value),
  )
  assert.throws(
    () => normalizeFixtureDescriptor({
      ...value,
      inputs: { source: { $fixture: 'inputs/message.txt', hostPath: '/etc/passwd' } },
    }),
    /fixture references must contain only \$fixture/,
  )
  assert.throws(
    () => normalizeFixtureDescriptor({
      ...value,
      inputs: { source: { $fixture: 'inputs/missing.txt' } },
    }),
    /undeclared file/,
  )
  assert.throws(
    () => normalizeFixtureDescriptor({
      ...value,
      inputs: { source: 'https://example.invalid/ambient-input.txt' },
    }),
    /\$fixture reference/,
  )
  assert.throws(
    () => normalizeFixtureDescriptor({
      ...value,
      assertions: [{
        id: 'shell-hook',
        kind: 'command',
        output: 'roundtrip.copy',
        expected: 'true',
      }],
    }),
    /kind must be value_equals or file_digest/,
  )
  assert.equal(FIXTURE_BUNDLE_LIMITS.maxTotalFileBytes, 64 * 1024 * 1024)
})

test('Fixture Bundle v1 rejects malformed metadata, paths, digests, and JSON values', () => {
  const value = descriptor()
  const withArray = normalizeFixtureDescriptor({
    ...value,
    inputs: {
      ...value.inputs,
      'roundtrip.values': [1, true, null],
    },
  })
  assert.deepEqual(withArray.descriptor.inputs['roundtrip.values'], [1, true, null])

  assert.throws(
    () => normalizeFixtureDescriptor({ ...value, name: '' }),
    /name must contain/,
  )
  assert.throws(
    () => normalizeFixtureDescriptor({
      ...value,
      files: [{ ...value.files[0], path: 'fixture.json' }],
    }),
    /safe relative POSIX path/,
  )
  assert.throws(
    () => normalizeFixtureDescriptor({
      ...value,
      files: [{ ...value.files[0], sha256: 'not-a-digest' }],
    }),
    /SHA-256 digest/,
  )
  assert.throws(
    () => normalizeFixtureDescriptor({
      ...value,
      inputs: { 'roundtrip.value': Number.POSITIVE_INFINITY },
    }),
    /finite JSON numbers/,
  )
  assert.throws(
    () => normalizeFixtureDescriptor({
      ...value,
      inputs: { 'roundtrip.value': '界'.repeat(30_000) },
    }),
    /UTF-8 byte limit/,
  )
})

test('fixture loader binds descriptor, exact bytes, and file identity into one digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-fixture-bundle-'))
  try {
    const directory = await writeBundle(root)
    const loaded = await loadFixtureBundle(directory)
    assert.equal(loaded.fixtureDigest, computeFixtureBundleDigest(descriptor()))
    assert.equal(loaded.files.length, 1)
    assert.equal(loaded.files[0].sourcePath, join(directory, 'inputs/message.txt'))
    assert.equal(loaded.files[0].identity.size, String(Buffer.byteLength('fixture input\n')))

    await writeFile(join(directory, 'inputs/message.txt'), 'changed\n')
    await assert.rejects(loadFixtureBundle(directory), /does not match its declared size and digest/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bundled text-roundtrip fixture has the frozen Fixture Bundle v1 digest', async () => {
  const directory = fileURLToPath(new URL('../fixtures/text-roundtrip/1.0.0', import.meta.url))
  const loaded = await loadFixtureBundle(directory)
  assert.equal(
    loaded.fixtureDigest,
    'sha256:66f7db98d4ca72101b659fc8c39210e2590440d48c1fc97002daca55187e7d95',
  )
})

test('fixture loader rejects symlinks and resolver fails closed on duplicate identities', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-bio-fixture-resolve-'))
  const firstRoot = join(parent, 'first')
  const secondRoot = join(parent, 'second')
  try {
    const first = await writeBundle(firstRoot)
    await writeBundle(secondRoot)
    const ambiguous = await resolveFixtureBundle(
      [firstRoot, secondRoot],
      { id: 'text-roundtrip', version: '1.0.0' },
    )
    assert.equal(ambiguous.ok, false)
    assert.equal(ambiguous.error.code, 'fixture_ambiguous')

    const outside = join(parent, 'outside.txt')
    await writeFile(outside, 'fixture input\n')
    await rm(join(first, 'inputs/message.txt'))
    await symlink(outside, join(first, 'inputs/message.txt'))
    await assert.rejects(loadFixtureBundle(first), /ELOOP|symbolic link|regular/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('fixture resolver returns a silent bounded miss without creating directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-fixture-miss-'))
  try {
    const missing = await resolveFixtureBundle(
      [root],
      { id: 'not-present', version: '1.0.0' },
    )
    assert.deepEqual(missing, {
      ok: false,
      error: { code: 'fixture_not_found', message: 'fixture not found: not-present@1.0.0' },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
