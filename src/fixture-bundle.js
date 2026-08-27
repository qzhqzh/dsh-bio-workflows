import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { isSafeBundlePath } from './wdl-bundle.js'

export const FIXTURE_BUNDLE_SCHEMA_VERSION = '1'
export const FIXTURE_BUNDLE_LIMITS = Object.freeze({
  maxFiles: 128,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalFileBytes: 64 * 1024 * 1024,
  maxInputs: 128,
  maxAssertions: 64,
  maxDescriptorBytes: 1024 * 1024,
  maxJsonBytes: 1024 * 1024,
  maxJsonDepth: 16,
  maxJsonNodes: 4096,
  maxStringBytes: 64 * 1024,
})

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const PORT_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/
const MAX_PATH_LENGTH = 240
const MAX_ID_LENGTH = 64
const MAX_VERSION_LENGTH = 128
const MAX_NAME_LENGTH = 160
const MAX_SUMMARY_LENGTH = 1000
const MAX_ASSERTION_ID_LENGTH = 128

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function digestValue(value) {
  const hash = createHash('sha256')
  hash.update(`dsh-bio-fixture-bundle-v${FIXTURE_BUNDLE_SCHEMA_VERSION}\n`, 'utf8')
  hash.update(stableStringify(value), 'utf8')
  return `sha256:${hash.digest('hex')}`
}

function isContainedPath(root, target) {
  const remainder = relative(root, target)
  return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`))
}

function assertString(value, label, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new TypeError(`${label} must contain ${minimum} to ${maximum} characters`)
  }
  if (Buffer.byteLength(value, 'utf8') > FIXTURE_BUNDLE_LIMITS.maxStringBytes) {
    throw new TypeError(`${label} exceeds the UTF-8 byte limit`)
  }
  return value
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object`)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`unsupported ${label} property: ${key}`)
  }
}

function validateSafePath(value, label) {
  assertString(value, label, 1, MAX_PATH_LENGTH)
  if (!isSafeBundlePath(value) || value === 'fixture.json') {
    throw new TypeError(`${label} must be a safe relative POSIX path other than fixture.json`)
  }
  return value
}

function validateDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a SHA-256 digest`)
  }
  return value
}

function validatePort(value, label) {
  assertString(value, label, 1, MAX_PATH_LENGTH)
  if (!PORT_PATTERN.test(value)) throw new TypeError(`${label} must be a WDL input or output name`)
  return value
}

function validateJsonValue(value, state, label, depth = 0, allowFixture = false) {
  state.nodes += 1
  if (state.nodes > FIXTURE_BUNDLE_LIMITS.maxJsonNodes) {
    throw new TypeError(`${label} exceeds the JSON node limit`)
  }
  if (depth > FIXTURE_BUNDLE_LIMITS.maxJsonDepth) {
    throw new TypeError(`${label} exceeds the JSON depth limit`)
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must contain finite JSON numbers`)
    return value
  }
  if (typeof value === 'string') {
    assertString(value, label, 0, FIXTURE_BUNDLE_LIMITS.maxStringBytes)
    if (
      allowFixture
      && (
        value.startsWith('/')
        || value.startsWith('\\')
        || value === '..'
        || value.startsWith('../')
        || value.includes('/../')
        || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)
        || /^(?:s3|gs|ftp):/i.test(value)
      )
    ) {
      throw new TypeError(`${label} must use a $fixture reference instead of a path or URI string`)
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => validateJsonValue(
      item,
      state,
      `${label}[${index}]`,
      depth + 1,
      allowFixture,
    ))
  }
  if (!isPlainObject(value)) throw new TypeError(`${label} must contain JSON values only`)
  const keys = Object.keys(value)
  if (allowFixture && keys.length === 1 && keys[0] === '$fixture') {
    return Object.freeze({ $fixture: validateSafePath(value.$fixture, `${label}.$fixture`) })
  }
  if (Object.hasOwn(value, '$fixture')) {
    throw new TypeError(`${label} fixture references must contain only $fixture`)
  }
  const normalized = {}
  for (const key of keys.sort(compareUtf8)) {
    assertString(key, `${label} key`, 1, MAX_PATH_LENGTH)
    normalized[key] = validateJsonValue(value[key], state, `${label}.${key}`, depth + 1, allowFixture)
  }
  return normalized
}

function normalizeFiles(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > FIXTURE_BUNDLE_LIMITS.maxFiles) {
    throw new TypeError(`files must contain 1 to ${FIXTURE_BUNDLE_LIMITS.maxFiles} items`)
  }
  const paths = new Set()
  let totalBytes = 0
  const files = value.map((file, index) => {
    assertExactKeys(file, new Set(['path', 'sizeBytes', 'sha256', 'mediaType']), `files[${index}]`)
    const path = validateSafePath(file.path, `files[${index}].path`)
    if (paths.has(path)) throw new TypeError(`duplicate fixture file path: ${path}`)
    paths.add(path)
    if (
      !Number.isSafeInteger(file.sizeBytes)
      || file.sizeBytes < 0
      || file.sizeBytes > FIXTURE_BUNDLE_LIMITS.maxFileBytes
    ) {
      throw new TypeError(`files[${index}].sizeBytes must be an integer from 0 to ${FIXTURE_BUNDLE_LIMITS.maxFileBytes}`)
    }
    totalBytes += file.sizeBytes
    if (totalBytes > FIXTURE_BUNDLE_LIMITS.maxTotalFileBytes) {
      throw new TypeError(`fixture files exceed ${FIXTURE_BUNDLE_LIMITS.maxTotalFileBytes} total bytes`)
    }
    const normalized = {
      path,
      sizeBytes: file.sizeBytes,
      sha256: validateDigest(file.sha256, `files[${index}].sha256`),
    }
    if (file.mediaType !== undefined) {
      normalized.mediaType = assertString(file.mediaType, `files[${index}].mediaType`, 1, 160)
    }
    return Object.freeze(normalized)
  }).sort((left, right) => compareUtf8(left.path, right.path))
  return { files: Object.freeze(files), paths, totalBytes }
}

function collectFixtureReferences(value, references) {
  if (Array.isArray(value)) {
    for (const item of value) collectFixtureReferences(item, references)
  } else if (isPlainObject(value)) {
    if (Object.keys(value).length === 1 && typeof value.$fixture === 'string') {
      references.add(value.$fixture)
    } else {
      for (const item of Object.values(value)) collectFixtureReferences(item, references)
    }
  }
}

function normalizeInputs(value, filePaths) {
  if (!isPlainObject(value)) throw new TypeError('inputs must be an object')
  const keys = Object.keys(value)
  if (keys.length > FIXTURE_BUNDLE_LIMITS.maxInputs) {
    throw new TypeError(`inputs must contain at most ${FIXTURE_BUNDLE_LIMITS.maxInputs} entries`)
  }
  const normalized = {}
  const state = { nodes: 0 }
  for (const key of keys.sort(compareUtf8)) {
    validatePort(key, `inputs.${key}`)
    normalized[key] = validateJsonValue(value[key], state, `inputs.${key}`, 0, true)
  }
  const references = new Set()
  collectFixtureReferences(normalized, references)
  for (const path of references) {
    if (!filePaths.has(path)) throw new TypeError(`fixture input references undeclared file: ${path}`)
  }
  return Object.freeze(normalized)
}

function normalizeAssertions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > FIXTURE_BUNDLE_LIMITS.maxAssertions) {
    throw new TypeError(`assertions must contain 1 to ${FIXTURE_BUNDLE_LIMITS.maxAssertions} items`)
  }
  const ids = new Set()
  return Object.freeze(value.map((assertion, index) => {
    assertExactKeys(
      assertion,
      new Set(['id', 'kind', 'output', 'expected', 'index', 'sha256', 'sizeBytes']),
      `assertions[${index}]`,
    )
    const id = assertString(assertion.id, `assertions[${index}].id`, 1, MAX_ASSERTION_ID_LENGTH)
    if (!IDENTIFIER_PATTERN.test(id)) throw new TypeError(`assertions[${index}].id must be a lowercase identifier`)
    if (ids.has(id)) throw new TypeError(`duplicate assertion id: ${id}`)
    ids.add(id)
    const output = validatePort(assertion.output, `assertions[${index}].output`)
    if (assertion.kind === 'value_equals') {
      if (assertion.expected === undefined) throw new TypeError(`assertions[${index}].expected is required`)
      if (assertion.index !== undefined || assertion.sha256 !== undefined || assertion.sizeBytes !== undefined) {
        throw new TypeError(`assertions[${index}] has properties not valid for value_equals`)
      }
      const expected = validateJsonValue(
        assertion.expected,
        { nodes: 0 },
        `assertions[${index}].expected`,
      )
      return deepFreeze({ id, kind: 'value_equals', output, expected })
    }
    if (assertion.kind === 'file_digest') {
      if (assertion.expected !== undefined) {
        throw new TypeError(`assertions[${index}].expected is not valid for file_digest`)
      }
      const normalized = {
        id,
        kind: 'file_digest',
        output,
        sha256: validateDigest(assertion.sha256, `assertions[${index}].sha256`),
        sizeBytes: assertion.sizeBytes,
      }
      if (
        !Number.isSafeInteger(normalized.sizeBytes)
        || normalized.sizeBytes < 0
        || normalized.sizeBytes > FIXTURE_BUNDLE_LIMITS.maxFileBytes
      ) {
        throw new TypeError(`assertions[${index}].sizeBytes must be a bounded non-negative integer`)
      }
      if (assertion.index !== undefined) {
        if (!Number.isSafeInteger(assertion.index) || assertion.index < 0 || assertion.index > 1023) {
          throw new TypeError(`assertions[${index}].index must be an integer from 0 to 1023`)
        }
        normalized.index = assertion.index
      }
      return Object.freeze(normalized)
    }
    throw new TypeError(`assertions[${index}].kind must be value_equals or file_digest`)
  }).sort((left, right) => compareUtf8(left.id, right.id)))
}

export function normalizeFixtureDescriptor(value) {
  assertExactKeys(
    value,
    new Set(['schemaVersion', 'id', 'version', 'name', 'summary', 'files', 'inputs', 'assertions']),
    'fixture descriptor',
  )
  if (value.schemaVersion !== FIXTURE_BUNDLE_SCHEMA_VERSION) {
    throw new TypeError(`schemaVersion must equal ${FIXTURE_BUNDLE_SCHEMA_VERSION}`)
  }
  const id = assertString(value.id, 'id', 1, MAX_ID_LENGTH)
  if (!IDENTIFIER_PATTERN.test(id)) throw new TypeError('id must be a lowercase identifier')
  const version = assertString(value.version, 'version', 1, MAX_VERSION_LENGTH)
  if (!SEMVER_PATTERN.test(version)) throw new TypeError('version must be semantic')
  const name = assertString(value.name, 'name', 1, MAX_NAME_LENGTH)
  const summary = assertString(value.summary, 'summary', 1, MAX_SUMMARY_LENGTH)
  const normalizedFiles = normalizeFiles(value.files)
  const descriptor = {
    schemaVersion: FIXTURE_BUNDLE_SCHEMA_VERSION,
    id,
    version,
    name,
    summary,
    files: normalizedFiles.files,
    inputs: normalizeInputs(value.inputs, normalizedFiles.paths),
    assertions: normalizeAssertions(value.assertions),
  }
  if (Buffer.byteLength(stableStringify(descriptor), 'utf8') > FIXTURE_BUNDLE_LIMITS.maxJsonBytes) {
    throw new TypeError(`normalized fixture descriptor exceeds ${FIXTURE_BUNDLE_LIMITS.maxJsonBytes} bytes`)
  }
  return deepFreeze({ descriptor: deepFreeze(descriptor), totalFileBytes: normalizedFiles.totalBytes })
}

export function computeFixtureBundleDigest(value) {
  return digestValue(normalizeFixtureDescriptor(value).descriptor)
}

async function readBoundedFile(path, maximumBytes) {
  let handle
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    )
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size > BigInt(maximumBytes)) {
      throw new Error(`fixture file must be regular and at most ${maximumBytes} bytes: ${path}`)
    }
    const length = Number(before.size)
    const buffer = Buffer.allocUnsafe(length)
    let offset = 0
    while (offset < length) {
      const result = await handle.read(buffer, offset, length - offset, offset)
      if (result.bytesRead === 0) throw new Error(`fixture file changed while reading: ${path}`)
      offset += result.bytesRead
    }
    const growth = Buffer.allocUnsafe(1)
    if ((await handle.read(growth, 0, 1, length)).bytesRead !== 0) {
      throw new Error(`fixture file grew while reading: ${path}`)
    }
    const after = await handle.stat({ bigint: true })
    if (
      !after.isFile()
      || after.size !== before.size
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error(`fixture file changed while reading: ${path}`)
    }
    return {
      buffer,
      identity: Object.freeze({
        path,
        size: before.size.toString(),
        mtimeNs: before.mtimeNs.toString(),
        ctimeNs: before.ctimeNs.toString(),
        device: before.dev.toString(),
        inode: before.ino.toString(),
        uid: before.uid.toString(),
        mode: (before.mode & 0o777n).toString(8).padStart(3, '0'),
      }),
    }
  } finally {
    await handle?.close()
  }
}

async function inspectContainedDirectory(root, path) {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`fixture path ancestor must be a non-symlink directory: ${path}`)
  }
  const canonical = await realpath(path)
  if (!isContainedPath(root, canonical)) throw new Error(`fixture path escapes its bundle: ${path}`)
  return canonical
}

async function resolveFilePath(bundleRoot, relativePath) {
  let current = bundleRoot
  for (const segment of relativePath.split('/').slice(0, -1)) {
    current = await inspectContainedDirectory(bundleRoot, join(current, segment))
  }
  const target = join(bundleRoot, ...relativePath.split('/'))
  if (!isContainedPath(bundleRoot, target)) throw new Error(`fixture file escapes its bundle: ${relativePath}`)
  return target
}

export async function loadFixtureBundle(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) {
    throw new TypeError('fixture bundle directory must be absolute')
  }
  const requested = resolve(directory)
  const root = await inspectContainedDirectory(requested, requested)
  if (root !== requested) throw new Error('fixture bundle directory must be canonical')
  const descriptorResult = await readBoundedFile(
    join(root, 'fixture.json'),
    FIXTURE_BUNDLE_LIMITS.maxDescriptorBytes,
  )
  let parsed
  try {
    parsed = JSON.parse(descriptorResult.buffer.toString('utf8'))
  } catch {
    throw new TypeError('fixture.json must contain valid UTF-8 JSON')
  }
  const normalized = normalizeFixtureDescriptor(parsed)
  const files = []
  for (const file of normalized.descriptor.files) {
    const sourcePath = await resolveFilePath(root, file.path)
    const loaded = await readBoundedFile(sourcePath, FIXTURE_BUNDLE_LIMITS.maxFileBytes)
    const digest = `sha256:${createHash('sha256').update(loaded.buffer).digest('hex')}`
    if (loaded.buffer.length !== file.sizeBytes || digest !== file.sha256) {
      throw new Error(`fixture file does not match its declared size and digest: ${file.path}`)
    }
    files.push(Object.freeze({
      ...file,
      sourcePath,
      identity: loaded.identity,
    }))
  }
  return deepFreeze({
    schemaVersion: FIXTURE_BUNDLE_SCHEMA_VERSION,
    directory: root,
    descriptorIdentity: descriptorResult.identity,
    descriptor: normalized.descriptor,
    fixtureDigest: digestValue(normalized.descriptor),
    totalFileBytes: normalized.totalFileBytes,
    files,
  })
}

export async function resolveFixtureBundle(rootsValue, selection) {
  if (!Array.isArray(rootsValue) || rootsValue.length < 1 || rootsValue.length > 64) {
    throw new TypeError('fixture roots must contain 1 to 64 absolute directories')
  }
  assertExactKeys(selection, new Set(['id', 'version']), 'fixture selection')
  const id = assertString(selection.id, 'fixture id', 1, MAX_ID_LENGTH)
  const version = assertString(selection.version, 'fixture version', 1, MAX_VERSION_LENGTH)
  if (!IDENTIFIER_PATTERN.test(id) || !SEMVER_PATTERN.test(version)) {
    throw new TypeError('fixture selection must contain an identifier and semantic version')
  }
  const found = []
  for (const configuredRoot of rootsValue) {
    if (typeof configuredRoot !== 'string' || !isAbsolute(configuredRoot)) {
      throw new TypeError('fixture roots must be absolute paths')
    }
    let root
    try {
      root = await inspectContainedDirectory(resolve(configuredRoot), resolve(configuredRoot))
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    const candidate = join(root, id, version)
    if (!isContainedPath(root, candidate)) throw new Error('fixture selection escaped its configured root')
    try {
      const bundle = await loadFixtureBundle(candidate)
      if (bundle.descriptor.id !== id || bundle.descriptor.version !== version) {
        throw new Error('fixture descriptor identity does not match its directory selection')
      }
      found.push(bundle)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  if (found.length === 0) return { ok: false, error: { code: 'fixture_not_found', message: `fixture not found: ${id}@${version}` } }
  if (found.length > 1) return { ok: false, error: { code: 'fixture_ambiguous', message: `fixture is present in multiple configured roots: ${id}@${version}` } }
  return { ok: true, fixture: found[0], error: null }
}
