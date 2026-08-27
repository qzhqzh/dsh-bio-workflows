import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

export const FIXTURE_ASSERTION_SCHEMA_VERSION = '1'
export const FIXTURE_ASSERTION_LIMITS = Object.freeze({
  maxAssertions: 64,
  maxArtifactBytes: 16 * 1024 * 1024,
  maxEvidenceMessageBytes: 512,
})

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
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

function isContainedPath(root, target) {
  const remainder = relative(root, target)
  return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`))
}

function throwIfAborted(signal) {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('fixture assertion evaluation was aborted')
  error.name = 'AbortError'
  throw error
}

function boundedMessage(value) {
  const buffer = Buffer.from(String(value), 'utf8')
  if (buffer.length <= FIXTURE_ASSERTION_LIMITS.maxEvidenceMessageBytes) return buffer.toString('utf8')
  return `${buffer.subarray(0, FIXTURE_ASSERTION_LIMITS.maxEvidenceMessageBytes).toString('utf8')}…`
}

function resolveOutput(outputs, name) {
  if (!isPlainObject(outputs) || !Object.hasOwn(outputs, name)) {
    return { ok: false, code: 'output_missing', message: `output is missing: ${name}` }
  }
  return { ok: true, value: outputs[name] }
}

async function hashExactFile(root, path, expectedSize, signal) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096) {
    throw new Error('asserted file output must be a bounded absolute path')
  }
  const declared = await lstat(path, { bigint: true })
  if (!declared.isFile() && !declared.isSymbolicLink()) {
    throw new Error('asserted output must resolve from a regular file or trusted engine symlink')
  }
  const canonical = await realpath(path)
  if (!isContainedPath(root, canonical)) throw new Error('asserted output escapes the isolated engine root')
  let handle
  try {
    handle = await open(
      canonical,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    )
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) throw new Error('asserted output is not a regular file')
    if (before.size > BigInt(FIXTURE_ASSERTION_LIMITS.maxArtifactBytes)) {
      throw new Error('asserted output exceeds the artifact byte limit')
    }
    if (before.size !== BigInt(expectedSize)) {
      return { sizeBytes: Number(before.size), sha256: null, sizeMatched: false }
    }
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let offset = 0
    while (offset < expectedSize) {
      throwIfAborted(signal)
      const result = await handle.read(buffer, 0, Math.min(buffer.length, expectedSize - offset), offset)
      if (result.bytesRead === 0) throw new Error('asserted output changed while hashing')
      hash.update(buffer.subarray(0, result.bytesRead))
      offset += result.bytesRead
    }
    if ((await handle.read(buffer, 0, 1, offset)).bytesRead !== 0) {
      throw new Error('asserted output grew while hashing')
    }
    const after = await handle.stat({ bigint: true })
    if (
      after.size !== before.size
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error('asserted output changed while hashing')
    }
    return {
      sizeBytes: expectedSize,
      sha256: `sha256:${hash.digest('hex')}`,
      sizeMatched: true,
    }
  } finally {
    await handle?.close()
  }
}

async function evaluateOne(assertion, outputs, engineRoot, signal) {
  const selected = resolveOutput(outputs, assertion.output)
  if (!selected.ok) {
    return {
      id: assertion.id,
      kind: assertion.kind,
      output: assertion.output,
      status: 'failed',
      code: selected.code,
      message: boundedMessage(selected.message),
    }
  }
  if (assertion.kind === 'value_equals') {
    const actualDigest = `sha256:${createHash('sha256').update(stableStringify(selected.value), 'utf8').digest('hex')}`
    const expectedDigest = `sha256:${createHash('sha256').update(stableStringify(assertion.expected), 'utf8').digest('hex')}`
    const passed = stableStringify(selected.value) === stableStringify(assertion.expected)
    return {
      id: assertion.id,
      kind: assertion.kind,
      output: assertion.output,
      status: passed ? 'passed' : 'failed',
      code: passed ? 'value_equal' : 'value_mismatch',
      message: passed ? 'output value matched' : 'output value did not match',
      expectedDigest,
      actualDigest,
    }
  }
  let path = selected.value
  if (assertion.index !== undefined) {
    if (!Array.isArray(path) || assertion.index >= path.length) {
      return {
        id: assertion.id,
        kind: assertion.kind,
        output: assertion.output,
        status: 'failed',
        code: 'output_index_missing',
        message: 'asserted output array index is missing',
      }
    }
    path = path[assertion.index]
  } else if (Array.isArray(path)) {
    return {
      id: assertion.id,
      kind: assertion.kind,
      output: assertion.output,
      status: 'failed',
      code: 'output_index_required',
      message: 'file array assertion requires an exact index',
    }
  }
  try {
    const observed = await hashExactFile(engineRoot, path, assertion.sizeBytes, signal)
    const passed = observed.sizeMatched && observed.sha256 === assertion.sha256
    return {
      id: assertion.id,
      kind: assertion.kind,
      output: assertion.output,
      ...(assertion.index === undefined ? {} : { index: assertion.index }),
      status: passed ? 'passed' : 'failed',
      code: passed ? 'file_digest_equal' : observed.sizeMatched ? 'file_digest_mismatch' : 'file_size_mismatch',
      message: passed ? 'output file size and digest matched' : 'output file size or digest did not match',
      expected: { sizeBytes: assertion.sizeBytes, sha256: assertion.sha256 },
      actual: { sizeBytes: observed.sizeBytes, sha256: observed.sha256 },
    }
  } catch (error) {
    return {
      id: assertion.id,
      kind: assertion.kind,
      output: assertion.output,
      ...(assertion.index === undefined ? {} : { index: assertion.index }),
      status: 'failed',
      code: 'file_inspection_failed',
      message: boundedMessage(error?.message ?? error),
    }
  }
}

export async function evaluateFixtureAssertions(options) {
  if (!isPlainObject(options)) throw new TypeError('assertion evaluation options must be an object')
  if (!Array.isArray(options.assertions) || options.assertions.length > FIXTURE_ASSERTION_LIMITS.maxAssertions) {
    throw new TypeError('assertions exceed the evaluation limit')
  }
  if (typeof options.engineRoot !== 'string' || !isAbsolute(options.engineRoot)) {
    throw new TypeError('engineRoot must be absolute')
  }
  const engineRoot = await realpath(options.engineRoot)
  const evidence = []
  for (const assertion of options.assertions) {
    throwIfAborted(options.signal)
    evidence.push(await evaluateOne(assertion, options.outputs, engineRoot, options.signal))
  }
  evidence.sort((left, right) => left.id.localeCompare(right.id))
  return Object.freeze({
    schemaVersion: FIXTURE_ASSERTION_SCHEMA_VERSION,
    passed: evidence.length > 0 && evidence.every((item) => item.status === 'passed'),
    assertions: evidence,
    executableAssertions: false,
  })
}
