import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  unlink,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const EXECUTION_PLAN_SCHEMA_VERSION = '1'
export const RUN_PROVENANCE_SCHEMA_VERSION = '1'
export const EXECUTABLE_WORKFLOWS = Object.freeze(['fastq-qc@1.1.0'])

const EXECUTION_CONFIG_KEYS = new Set(['enabled', 'runsRoot', 'inputRoots', 'runner'])
const RUNNER_CONFIG_KEYS = new Set(['executable', 'dockerExecutable'])
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const RUN_ID_PATTERN = /^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_PATH_LENGTH = 4096
const MAX_INPUT_ROOTS = 64
const MAX_INPUT_ITEMS = 1024
const MAX_STRING_INPUT_BYTES = 64 * 1024
const MAX_TOTAL_SNAPSHOT_BYTES = 1024n * 1024n * 1024n * 1024n
const SNAPSHOT_FREE_SPACE_RESERVE_BYTES = 512n * 1024n * 1024n
const MAX_PROBE_BYTES = 64 * 1024
const MAX_RESULT_JSON_BYTES = 2 * 1024 * 1024
const MAX_PROVENANCE_JSON_BYTES = 32 * 1024 * 1024
const JOB_OUTPUT_LIMIT_BYTES = 256 * 1024
const COPY_BUFFER_BYTES = 1024 * 1024
const PROCESS_GRACE_MS = 10_000
const PROBE_TIMEOUT_MS = 15_000
const LOCAL_DOCKER_HOST = 'unix:///var/run/docker.sock'
const EXECUTABLE_SET = new Set(EXECUTABLE_WORKFLOWS)
const SAFE_RUNS_ROOT_PATTERN = /^[A-Za-z0-9_./:+,@=-]+$/
const PLACEHOLDER_PATTERN = '[A-Za-z0-9_./:@+=,-]+'
const FASTQ_SUFFIXES = Object.freeze(['.fastq.gz', '.fq.gz', '.fastq', '.fq'])

function createMiniwdlConfig(runDirectory) {
  return `[scheduler]
container_backend = docker_swarm
fail_fast = true

[docker_swarm]
allow_networks = []
auto_init = false

[file_io]
root = ${runDirectory}
allow_any_input = false
copy_input_files = false

[task_runtime]
allow_privileged = false
memory_limit_multiplier = 1.0
placeholder_regex = ${PLACEHOLDER_PATTERN}
env = {}

[download_cache]
get = false
put = false

[download_awscli]
host_credentials = false

[call_cache]
get = false
put = false
`
}

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
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digestValue(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')}`
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function isContainedPath(root, target) {
  const remainder = relative(root, target)
  return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`))
}

function pathsOverlap(left, right) {
  return isContainedPath(left, right) || isContainedPath(right, left)
}

function throwIfAborted(signal) {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error && signal.reason.name === 'AbortError') throw signal.reason
  const error = new Error(
    signal.reason instanceof Error ? signal.reason.message : 'workflow execution operation was aborted',
    signal.reason instanceof Error ? { cause: signal.reason } : undefined,
  )
  error.name = 'AbortError'
  throw error
}

function validateExecutableName(value, path, errors, requireAbsolute) {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push({ path, code: 'type', message: 'must be a non-empty string' })
  } else if (value.length > MAX_PATH_LENGTH) {
    errors.push({ path, code: 'max_length', message: `must contain at most ${MAX_PATH_LENGTH} characters` })
  } else if (requireAbsolute && !isAbsolute(value)) {
    errors.push({ path, code: 'format', message: 'must be an absolute path when execution is enabled' })
  } else if (!isAbsolute(value) && (value.includes('/') || value.includes('\\'))) {
    errors.push({ path, code: 'format', message: 'must be an absolute path or a bare executable name' })
  }
}

export class ExecutionConfigValidationError extends Error {
  constructor(errors) {
    super(`invalid execution config: ${errors.map((error) => `${error.path} ${error.message}`).join('; ')}`)
    this.name = 'ExecutionConfigValidationError'
    this.errors = errors
  }
}

export function parseExecutionConfig(value = {}) {
  const errors = []
  if (!isPlainObject(value)) {
    throw new ExecutionConfigValidationError([
      { path: '$', code: 'type', message: 'execution config must be an object' },
    ])
  }
  for (const key of Object.keys(value)) {
    if (!EXECUTION_CONFIG_KEYS.has(key)) {
      errors.push({ path: `$.${key}`, code: 'additional_property', message: `unsupported property: ${key}` })
    }
  }

  const enabled = value.enabled ?? false
  if (typeof enabled !== 'boolean') {
    errors.push({ path: '$.enabled', code: 'type', message: 'must be a boolean' })
  }

  let runsRoot = null
  if (value.runsRoot !== undefined) {
    if (typeof value.runsRoot !== 'string' || value.runsRoot.length === 0) {
      errors.push({ path: '$.runsRoot', code: 'type', message: 'must be a non-empty string' })
    } else if (value.runsRoot.length > MAX_PATH_LENGTH) {
      errors.push({ path: '$.runsRoot', code: 'max_length', message: `must contain at most ${MAX_PATH_LENGTH} characters` })
    } else if (!isAbsolute(value.runsRoot)) {
      errors.push({ path: '$.runsRoot', code: 'format', message: 'must be an absolute path' })
    } else if (!SAFE_RUNS_ROOT_PATTERN.test(value.runsRoot)) {
      errors.push({
        path: '$.runsRoot',
        code: 'format',
        message: 'must use only characters safe for the generated miniwdl configuration',
      })
    } else {
      runsRoot = resolve(value.runsRoot)
    }
  }

  const inputRoots = []
  if (value.inputRoots !== undefined && !Array.isArray(value.inputRoots)) {
    errors.push({ path: '$.inputRoots', code: 'type', message: 'must be an array' })
  } else {
    if ((value.inputRoots ?? []).length > MAX_INPUT_ROOTS) {
      errors.push({ path: '$.inputRoots', code: 'max_items', message: `must contain at most ${MAX_INPUT_ROOTS} roots` })
    }
    for (const [index, root] of (value.inputRoots ?? []).entries()) {
      const path = `$.inputRoots[${index}]`
      if (typeof root !== 'string' || root.length === 0) {
        errors.push({ path, code: 'type', message: 'must be a non-empty string' })
      } else if (root.length > MAX_PATH_LENGTH) {
        errors.push({ path, code: 'max_length', message: `must contain at most ${MAX_PATH_LENGTH} characters` })
      } else if (!isAbsolute(root)) {
        errors.push({ path, code: 'format', message: 'must be an absolute path' })
      } else {
        const normalized = resolve(root)
        if (inputRoots.includes(normalized)) {
          errors.push({ path, code: 'duplicate', message: `duplicate input root: ${normalized}` })
        } else {
          inputRoots.push(normalized)
        }
      }
    }
  }

  const runnerValue = value.runner ?? {}
  if (!isPlainObject(runnerValue)) {
    errors.push({ path: '$.runner', code: 'type', message: 'must be an object' })
  }
  if (isPlainObject(runnerValue)) {
    for (const key of Object.keys(runnerValue)) {
      if (!RUNNER_CONFIG_KEYS.has(key)) {
        errors.push({ path: `$.runner.${key}`, code: 'additional_property', message: `unsupported property: ${key}` })
      }
    }
  }
  const executable = isPlainObject(runnerValue) ? runnerValue.executable ?? 'miniwdl' : 'miniwdl'
  const dockerExecutable = isPlainObject(runnerValue) ? runnerValue.dockerExecutable ?? 'docker' : 'docker'
  validateExecutableName(executable, '$.runner.executable', errors, enabled === true)
  validateExecutableName(dockerExecutable, '$.runner.dockerExecutable', errors, enabled === true)

  if (enabled === true) {
    if (runsRoot === null) errors.push({ path: '$.runsRoot', code: 'required', message: 'is required when execution is enabled' })
    if (inputRoots.length === 0) errors.push({ path: '$.inputRoots', code: 'min_items', message: 'must contain at least one root when execution is enabled' })
  }
  if (runsRoot !== null) {
    for (const [index, root] of inputRoots.entries()) {
      if (pathsOverlap(runsRoot, root)) {
        errors.push({
          path: `$.inputRoots[${index}]`,
          code: 'overlap',
          message: 'input roots and the dedicated runs root must not overlap',
        })
      }
    }
  }
  if (errors.length > 0) throw new ExecutionConfigValidationError(errors)

  return deepFreeze({
    enabled,
    runsRoot,
    inputRoots,
    runner: { executable, dockerExecutable },
  })
}

class ExecutionOperationError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ExecutionOperationError'
    this.code = code
    this.details = details
  }
}

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message }, ...details }
}

function operationFailure(error) {
  if (error instanceof ExecutionOperationError) {
    return failure(error.code, error.message, error.details)
  }
  if (error?.name === 'AbortError') throw error
  return failure(
    'execution_operation_failed',
    String(error?.message ?? error).slice(0, 512),
  )
}

async function inspectDirectory(path, label, mode) {
  let initial
  try {
    initial = await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ExecutionOperationError(`${label}_missing`, `${label} does not exist: ${path}`)
    }
    throw error
  }
  if (!initial.isDirectory() || initial.isSymbolicLink()) {
    throw new ExecutionOperationError(`${label}_unsafe`, `${label} must be a non-symlink directory: ${path}`)
  }
  const canonical = await realpath(path)
  const completed = await lstat(path)
  if (
    !completed.isDirectory()
    || completed.isSymbolicLink()
    || completed.dev !== initial.dev
    || completed.ino !== initial.ino
  ) {
    throw new ExecutionOperationError(`${label}_unsafe`, `${label} changed during inspection: ${path}`)
  }
  await access(canonical, mode)
  return canonical
}

function currentUid() {
  return typeof process.getuid === 'function' ? BigInt(process.getuid()) : null
}

function assertPrivateRunsRoot(identity) {
  const uid = currentUid()
  if (uid !== null && BigInt(identity.uid) !== uid) {
    throw new ExecutionOperationError(
      'runs_root_unsafe',
      'runs_root must be owned by the DSH process user',
    )
  }
  if ((BigInt(`0o${identity.mode}`) & 0o022n) !== 0n) {
    throw new ExecutionOperationError(
      'runs_root_unsafe',
      'runs_root must not be writable by group or other users',
    )
  }
}

async function assertProtectedPathAncestors(path, label) {
  const uid = currentUid()
  const ancestors = []
  let ancestor = dirname(path)
  while (true) {
    const metadata = await lstat(ancestor, { bigint: true })
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new ExecutionOperationError(`${label}_unsafe`, `${label} ancestors must be non-symlink directories`)
    }
    ancestors.push(metadata)
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  const filesystemRootUid = ancestors.at(-1).uid
  for (const metadata of ancestors) {
    if (uid !== null && metadata.uid !== filesystemRootUid && metadata.uid !== uid) {
      throw new ExecutionOperationError(
        `${label}_unsafe`,
        `${label} ancestors must be owned by the filesystem root or the DSH process user`,
      )
    }
    if ((metadata.mode & 0o022n) !== 0n && (metadata.mode & 0o1000n) === 0n) {
      throw new ExecutionOperationError(
        `${label}_unsafe`,
        `writable ${label} ancestors must enforce sticky-directory replacement protection`,
      )
    }
  }
}

async function openedDescriptorPath(handle, label) {
  if (process.platform !== 'linux') {
    throw new ExecutionOperationError(`${label}_unsafe`, `${label} descriptor validation requires Linux procfs`)
  }
  try {
    return await realpath(`/proc/self/fd/${handle.fd}`)
  } catch {
    throw new ExecutionOperationError(`${label}_unsafe`, `${label} descriptor path could not be verified`)
  }
}

function directoryIdentity(path, metadata) {
  return {
    path,
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    uid: metadata.uid.toString(),
    mode: (metadata.mode & 0o777n).toString(8).padStart(3, '0'),
  }
}

async function inspectDirectoryIdentity(path, label) {
  const metadata = await lstat(path, { bigint: true })
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new ExecutionOperationError(`${label}_unsafe`, `${label} must remain a non-symlink directory`)
  }
  const canonical = await realpath(path)
  if (canonical !== path) {
    throw new ExecutionOperationError(`${label}_unsafe`, `${label} changed after canonicalization`)
  }
  return directoryIdentity(canonical, metadata)
}

async function assertDirectoryUnchanged(identity, label) {
  const observed = await inspectDirectoryIdentity(identity.path, label)
  if (
    observed.device !== identity.device
    || observed.inode !== identity.inode
    || observed.uid !== identity.uid
    || observed.mode !== identity.mode
  ) {
    throw new ExecutionOperationError(`${label}_changed`, `${label} changed during execution preparation`)
  }
}

function executableIdentity(path, metadata) {
  return {
    path,
    size: metadata.size.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    uid: metadata.uid.toString(),
    mode: (metadata.mode & 0o777n).toString(8).padStart(3, '0'),
  }
}

function sameFileIdentity(left, right) {
  return left.path === right.path
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.device === right.device
    && left.inode === right.inode
    && left.uid === right.uid
    && left.mode === right.mode
}

async function inspectExecutable(path, label) {
  let initial
  try {
    initial = await lstat(path, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ExecutionOperationError(`${label}_missing`, `${label} does not exist: ${path}`)
    }
    throw error
  }
  if (!initial.isFile() || initial.isSymbolicLink()) {
    throw new ExecutionOperationError(`${label}_unsafe`, `${label} must be a canonical non-symlink regular file`)
  }
  const canonical = await realpath(path)
  if (canonical !== path) {
    throw new ExecutionOperationError(`${label}_unsafe`, `${label} must be configured with its canonical path`)
  }
  await assertProtectedPathAncestors(canonical, label)
  let handle
  try {
    handle = await open(
      canonical,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    )
    const metadata = await handle.stat({ bigint: true })
    if (!metadata.isFile()) {
      throw new ExecutionOperationError(`${label}_unsafe`, `${label} must be a regular file`)
    }
    if (await openedDescriptorPath(handle, label) !== canonical) {
      throw new ExecutionOperationError(`${label}_unsafe`, `${label} changed while it was being inspected`)
    }
    const uid = currentUid()
    if (uid !== null && metadata.uid !== 0n && metadata.uid !== uid) {
      throw new ExecutionOperationError(`${label}_unsafe`, `${label} must be owned by root or the DSH process user`)
    }
    if ((metadata.mode & 0o022n) !== 0n) {
      throw new ExecutionOperationError(`${label}_unsafe`, `${label} must not be writable by group or other users`)
    }
    if ((metadata.mode & 0o111n) === 0n) {
      throw new ExecutionOperationError(`${label}_unsafe`, `${label} is not executable`)
    }
    await access(canonical, constants.R_OK | constants.X_OK)
    return executableIdentity(canonical, metadata)
  } finally {
    await handle?.close()
  }
}

async function assertExecutableUnchanged(identity, label) {
  const observed = await inspectExecutable(identity.path, label)
  if (!sameFileIdentity(identity, observed)) {
    throw new ExecutionOperationError(`${label}_changed`, `${label} changed after the approved plan`)
  }
}

function createChildEnvironment(ambientEnvironment) {
  const environment = Object.create(null)
  const ambient = ambientEnvironment !== null && typeof ambientEnvironment === 'object'
    ? ambientEnvironment
    : {}
  for (const key of Object.keys(ambient)) {
    environment[key] = undefined
  }
  Object.assign(environment, ENVIRONMENT_POLICY.set)
  return environment
}

const ENVIRONMENT_POLICY = deepFreeze({
  inheritAmbient: false,
  set: {
    DOCKER_HOST: LOCAL_DOCKER_HOST,
    HOME: '/nonexistent',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    PATH: '/nonexistent',
    PYTHONNOUSERSITE: '1',
    PYTHONSAFEPATH: '1',
  },
  removeAllAmbient: true,
  removeAmbientPrefixes: ['MINIWDL__', 'DOCKER_'],
  removeAmbientKeys: [],
})

async function inspectRunsRoot(config, mode) {
  const runsRoot = await inspectDirectory(
    config.runsRoot,
    'runs_root',
    mode,
  )
  if (!SAFE_RUNS_ROOT_PATTERN.test(runsRoot)) {
    throw new ExecutionOperationError('runs_root_unsafe', 'canonical runs_root contains unsafe configuration characters')
  }
  const runsRootIdentity = await inspectDirectoryIdentity(runsRoot, 'runs_root')
  assertPrivateRunsRoot(runsRootIdentity)
  await assertProtectedPathAncestors(runsRoot, 'runs_root')
  return { runsRoot, runsRootIdentity }
}

async function inspectConfiguredRoots(config) {
  const { runsRoot, runsRootIdentity } = await inspectRunsRoot(
    config,
    constants.R_OK | constants.W_OK | constants.X_OK,
  )
  const inputRoots = []
  for (const root of config.inputRoots) {
    inputRoots.push(await inspectDirectory(root, 'input_root', constants.R_OK | constants.X_OK))
  }
  for (const root of inputRoots) {
    if (pathsOverlap(runsRoot, root)) {
      throw new ExecutionOperationError(
        'execution_roots_overlap',
        'canonical input roots and the dedicated runs root must not overlap',
      )
    }
  }
  return { runsRoot, runsRootIdentity, inputRoots }
}

function validateRequestKeys(value, allowed) {
  if (!isPlainObject(value)) {
    throw new ExecutionOperationError('invalid_execution_request', 'execution request must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ExecutionOperationError('invalid_execution_request', `unsupported execution request property: ${key}`)
    }
  }
  if (typeof value.id !== 'string' || !IDENTIFIER_PATTERN.test(value.id)) {
    throw new ExecutionOperationError('invalid_execution_request', 'id must be a lowercase workflow identifier')
  }
  if (typeof value.version !== 'string' || !SEMVER_PATTERN.test(value.version)) {
    throw new ExecutionOperationError('invalid_execution_request', 'version must be an exact semantic version')
  }
  if (typeof value.expectedDigest !== 'string' || !DIGEST_PATTERN.test(value.expectedDigest)) {
    throw new ExecutionOperationError('invalid_execution_request', 'expectedDigest must be a SHA-256 bundle digest')
  }
  if (!isPlainObject(value.inputs)) {
    throw new ExecutionOperationError('invalid_execution_request', 'inputs must be an object')
  }
}

function validateScalar(value, port, path) {
  if (port.type === 'file' || port.type === 'directory') {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ExecutionOperationError('invalid_workflow_inputs', `${path} must be a non-empty ${port.type} path`)
    }
    return
  }
  if (port.type === 'string') {
    if (typeof value !== 'string') {
      throw new ExecutionOperationError('invalid_workflow_inputs', `${path} must be a string`)
    }
    if (Buffer.byteLength(value, 'utf8') > MAX_STRING_INPUT_BYTES) {
      throw new ExecutionOperationError('invalid_workflow_inputs', `${path} is too large`)
    }
    return
  }
  if (port.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      throw new ExecutionOperationError('invalid_workflow_inputs', `${path} must be a finite integer`)
    }
    return
  }
  if (port.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ExecutionOperationError('invalid_workflow_inputs', `${path} must be a finite number`)
    }
    return
  }
  if (port.type === 'boolean' && typeof value !== 'boolean') {
    throw new ExecutionOperationError('invalid_workflow_inputs', `${path} must be a boolean`)
  }
}

async function normalizePathValue(value, port, inputRoots, inputId, index) {
  if (value.length > MAX_PATH_LENGTH || !isAbsolute(value)) {
    throw new ExecutionOperationError(
      'invalid_workflow_inputs',
      `$.inputs.${inputId}${index === null ? '' : `[${index}]`} must be an absolute path`,
    )
  }
  let canonical
  try {
    canonical = await realpath(value)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ExecutionOperationError('input_path_missing', `input path does not exist: ${value}`)
    }
    throw error
  }
  if (!inputRoots.some((root) => isContainedPath(root, canonical))) {
    throw new ExecutionOperationError('input_path_outside_roots', `input path is outside configured input roots: ${value}`)
  }
  let metadata
  let handle
  let openedPath
  if (port.type === 'file') {
    try {
      handle = await open(
        canonical,
        constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
      )
      metadata = await handle.stat({ bigint: true })
      if (metadata.isFile()) openedPath = await openedDescriptorPath(handle, 'input_path')
    } finally {
      await handle?.close()
    }
  } else {
    metadata = await stat(canonical, { bigint: true })
  }
  if (port.type === 'file' && !metadata.isFile()) {
    throw new ExecutionOperationError('input_path_type', `input must be a regular file: ${value}`)
  }
  if (port.type === 'directory' && !metadata.isDirectory()) {
    throw new ExecutionOperationError('input_path_type', `input must be a directory: ${value}`)
  }
  if (
    port.type === 'file'
    && (openedPath !== canonical || !inputRoots.some((root) => isContainedPath(root, openedPath)))
  ) {
    throw new ExecutionOperationError(
      'input_path_changed',
      `input path changed while it was being inspected: ${value}`,
    )
  }
  if (port.type === 'directory') await access(canonical, constants.R_OK | constants.X_OK)
  return {
    value: canonical,
    fact: {
      input: inputId,
      ...(index === null ? {} : { index }),
      type: port.type,
      path: canonical,
      size: metadata.size.toString(),
      mtimeNs: metadata.mtimeNs.toString(),
      ctimeNs: metadata.ctimeNs.toString(),
      device: metadata.dev.toString(),
      inode: metadata.ino.toString(),
    },
  }
}

async function normalizeInputs(manifest, values, inputRoots) {
  const ports = new Map(manifest.inputs.map((port) => [port.id, port]))
  for (const key of Object.keys(values)) {
    if (!ports.has(key)) {
      throw new ExecutionOperationError('invalid_workflow_inputs', `workflow does not declare input: ${key}`)
    }
  }

  const normalized = {}
  const fileFacts = []
  let pathCount = 0
  for (const port of manifest.inputs) {
    const path = `$.inputs.${port.id}`
    if (!Object.hasOwn(values, port.id)) {
      if (port.required) {
        throw new ExecutionOperationError('invalid_workflow_inputs', `${path} is required`)
      }
      continue
    }
    const supplied = values[port.id]
    if (port.cardinality === 'many') {
      if (!Array.isArray(supplied)) {
        throw new ExecutionOperationError('invalid_workflow_inputs', `${path} must be an array`)
      }
      if (port.required && supplied.length === 0) {
        throw new ExecutionOperationError('invalid_workflow_inputs', `${path} must contain at least one value`)
      }
      if (supplied.length > MAX_INPUT_ITEMS) {
        throw new ExecutionOperationError('invalid_workflow_inputs', `${path} must contain at most ${MAX_INPUT_ITEMS} values`)
      }
      normalized[port.id] = []
      for (const [index, item] of supplied.entries()) {
        validateScalar(item, port, `${path}[${index}]`)
        if (port.type === 'file' || port.type === 'directory') {
          pathCount += 1
          const inspected = await normalizePathValue(item, port, inputRoots, port.id, index)
          normalized[port.id].push(inspected.value)
          fileFacts.push(inspected.fact)
        } else {
          normalized[port.id].push(item)
        }
      }
    } else {
      validateScalar(supplied, port, path)
      if (port.type === 'file' || port.type === 'directory') {
        pathCount += 1
        const inspected = await normalizePathValue(supplied, port, inputRoots, port.id, null)
        normalized[port.id] = inspected.value
        fileFacts.push(inspected.fact)
      } else {
        normalized[port.id] = supplied
      }
    }
  }
  if (pathCount > MAX_INPUT_ITEMS) {
    throw new ExecutionOperationError('invalid_workflow_inputs', `workflow inputs reference more than ${MAX_INPUT_ITEMS} paths`)
  }
  const totalSnapshotBytes = fileFacts
    .filter((fact) => fact.type === 'file')
    .reduce((total, fact) => total + BigInt(fact.size), 0n)
  if (totalSnapshotBytes > MAX_TOTAL_SNAPSHOT_BYTES) {
    throw new ExecutionOperationError(
      'input_snapshot_limit_exceeded',
      `workflow input snapshots exceed the ${MAX_TOTAL_SNAPSHOT_BYTES} byte per-run limit`,
      {
        totalSnapshotBytes: totalSnapshotBytes.toString(),
        maxTotalSnapshotBytes: MAX_TOTAL_SNAPSHOT_BYTES.toString(),
      },
    )
  }
  return { normalized, fileFacts, totalSnapshotBytes: totalSnapshotBytes.toString() }
}

function extractWorkflowName(bundle) {
  const source = bundle.contents[bundle.descriptor.wdl.entrypoint]
  const match = /\bworkflow\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/.exec(source)
  if (match === null) {
    throw new ExecutionOperationError('workflow_name_missing', 'WDL entrypoint does not declare a workflow')
  }
  return match[1]
}

function requiredMiniwdlVersion(bundle) {
  const engine = bundle.descriptor.wdl.engines.find((item) => item.name === 'miniwdl')
  if (engine?.version === undefined) {
    throw new ExecutionOperationError('miniwdl_version_unpinned', 'executable workflow must declare an exact miniwdl version')
  }
  return engine.version
}

function assertPinnedContainers(bundle) {
  const sources = bundle.descriptor.files
    .filter((file) => file.path.endsWith('.wdl'))
    .map((file) => bundle.contents[file.path])
    .join('\n')
  const images = [...sources.matchAll(/\bdocker\s*:\s*"([^"]+)"/g)].map((match) => match[1])
  if (images.length === 0 || images.some((image) => !/@sha256:[a-f0-9]{64}$/.test(image))) {
    throw new ExecutionOperationError(
      'container_digest_unpinned',
      'executable workflow containers must be pinned by SHA-256 digest',
    )
  }
  return images
}

function boundedSignal(signal) {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

function readCollected(reader) {
  if (reader === undefined) return { text: '', lossy: false }
  const result = reader.readFrom(0)
  return { text: result.text, lossy: result.lossy }
}

async function runProbe(subprocess, argv, cwd, signal, identity, label, ambientEnvironment) {
  await assertExecutableUnchanged(identity, label)
  const probeSignal = boundedSignal(signal)
  const handle = subprocess.spawn({
    argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: MAX_PROBE_BYTES },
      stderr: { maxBytes: MAX_PROBE_BYTES },
    },
    graceMs: PROCESS_GRACE_MS,
    signal: probeSignal,
    env: createChildEnvironment(ambientEnvironment),
  })
  const outcome = await handle.done
  await handle.waitForExit()
  if (signal?.aborted === true) throwIfAborted(signal)
  if (probeSignal.aborted === true) {
    throw new ExecutionOperationError('probe_timeout', `probe timed out after ${PROBE_TIMEOUT_MS}ms`)
  }
  const stdout = readCollected(handle.collected.stdout)
  const stderr = readCollected(handle.collected.stderr)
  if (outcome.exitCode !== 0) {
    const detail = (stderr.text || stdout.text).trim().slice(-4096)
    throw new ExecutionOperationError(
      'probe_failed',
      `probe exited unsuccessfully${detail === '' ? '' : `: ${detail}`}`,
      { exitCode: outcome.exitCode, signal: outcome.signal },
    )
  }
  if (stdout.lossy || stderr.lossy) {
    throw new ExecutionOperationError('probe_output_truncated', 'probe output exceeded its bounded capture')
  }
  return { stdout: stdout.text, stderr: stderr.text }
}

async function probeRunner(config, subprocess, bundleDirectory, bundle, signal, ambientEnvironment) {
  const miniwdlExecutable = await subprocess.resolveExecutable(
    config.runner.executable,
    { NO_COLOR: '1' },
    boundedSignal(signal),
  )
  const dockerExecutable = await subprocess.resolveExecutable(
    config.runner.dockerExecutable,
    { NO_COLOR: '1' },
    boundedSignal(signal),
  )
  if (!isAbsolute(miniwdlExecutable) || !isAbsolute(dockerExecutable)) {
    throw new ExecutionOperationError('runner_resolution_invalid', 'runner services must resolve canonical absolute executable paths')
  }
  const miniwdlIdentity = await inspectExecutable(miniwdlExecutable, 'miniwdl_executable')
  const dockerIdentity = await inspectExecutable(dockerExecutable, 'docker_executable')

  const miniwdlVersionResult = await runProbe(
    subprocess,
    [miniwdlExecutable, '--version'],
    bundleDirectory,
    signal,
    miniwdlIdentity,
    'miniwdl_executable',
    ambientEnvironment,
  )
  const versionMatch = /(?:^|\s)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\s|$)/.exec(
    miniwdlVersionResult.stdout.trim(),
  )
  if (versionMatch === null) {
    throw new ExecutionOperationError('miniwdl_version_unknown', 'could not parse miniwdl --version output')
  }
  const requiredVersion = requiredMiniwdlVersion(bundle)
  if (versionMatch[1] !== requiredVersion) {
    throw new ExecutionOperationError(
      'miniwdl_version_mismatch',
      `workflow requires miniwdl ${requiredVersion}, found ${versionMatch[1]}`,
    )
  }

  await runProbe(
    subprocess,
    [miniwdlExecutable, 'check', bundle.descriptor.wdl.entrypoint],
    bundleDirectory,
    signal,
    miniwdlIdentity,
    'miniwdl_executable',
    ambientEnvironment,
  )
  const dockerVersionResult = await runProbe(
    subprocess,
    [dockerExecutable, 'version', '--format', '{{.Server.Version}}'],
    bundleDirectory,
    signal,
    dockerIdentity,
    'docker_executable',
    ambientEnvironment,
  )
  const dockerVersion = dockerVersionResult.stdout.trim()
  if (dockerVersion === '') {
    throw new ExecutionOperationError('docker_version_unknown', 'Docker daemon returned an empty server version')
  }
  const dockerSwarmResult = await runProbe(
    subprocess,
    [dockerExecutable, 'info', '--format', '{{.ID}} {{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}'],
    bundleDirectory,
    signal,
    dockerIdentity,
    'docker_executable',
    ambientEnvironment,
  )
  const [engineId, localNodeState, controlAvailable, ...unexpected] = dockerSwarmResult.stdout.trim().split(/\s+/)
  if (
    typeof engineId !== 'string'
    || engineId.length === 0
    || engineId.length > 256
    || localNodeState?.toLowerCase() !== 'active'
    || controlAvailable?.toLowerCase() !== 'true'
    || unexpected.length !== 0
  ) {
    throw new ExecutionOperationError(
      'docker_swarm_unavailable',
      'Docker Swarm must already be active on a manager node; automatic initialization is disabled',
      { observed: dockerSwarmResult.stdout.trim().slice(0, 256) },
    )
  }
  return {
    miniwdl: {
      executable: miniwdlExecutable,
      identity: miniwdlIdentity,
      version: versionMatch[1],
      semanticCheck: 'pass',
    },
    docker: {
      executable: dockerExecutable,
      identity: dockerIdentity,
      host: LOCAL_DOCKER_HOST,
      engineId,
      serverVersion: dockerVersion.slice(0, 256),
      daemonCheck: 'pass',
      swarm: { localNodeState: 'active', controlAvailable: true, autoInit: false },
    },
  }
}

async function writeExclusiveText(path, content) {
  let handle
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    await handle.writeFile(content, 'utf8')
    const completed = await handle.stat()
    if (!completed.isFile()) throw new Error(`run artifact is not a regular file: ${path}`)
  } finally {
    await handle?.close()
  }
}

async function atomicWriteJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  let renamed = false
  try {
    await writeExclusiveText(temporary, `${JSON.stringify(value, null, 2)}\n`)
    await rename(temporary, path)
    renamed = true
  } finally {
    if (!renamed) await unlink(temporary).catch(() => {})
  }
}

async function stageWdlBundle(runDirectory, bundle) {
  const wdlRoot = join(runDirectory, 'wdl')
  await mkdir(wdlRoot, { mode: 0o700 })
  for (const file of bundle.descriptor.files.filter((item) => item.path.endsWith('.wdl'))) {
    const target = join(wdlRoot, ...file.path.split('/'))
    if (!isContainedPath(wdlRoot, target)) throw new Error(`unsafe staged WDL path: ${file.path}`)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeExclusiveText(target, bundle.contents[file.path])
  }
  return { wdlRoot, entrypoint: join(wdlRoot, ...bundle.descriptor.wdl.entrypoint.split('/')) }
}

function matchesInputFact(fact, metadata) {
  return fact.size === metadata.size.toString()
    && fact.mtimeNs === metadata.mtimeNs.toString()
    && fact.ctimeNs === metadata.ctimeNs.toString()
    && fact.device === metadata.dev.toString()
    && fact.inode === metadata.ino.toString()
}

function sameInputMetadata(left, right) {
  return left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.dev === right.dev
    && left.ino === right.ino
}

function safeInputSuffix(path) {
  const name = basename(path).toLowerCase()
  return FASTQ_SUFFIXES.find((suffix) => name.endsWith(suffix)) ?? '.data'
}

async function snapshotInputFile(sourcePath, targetPath, fact, signal) {
  let source
  let target
  let completed = false
  const digest = createHash('sha256')
  try {
    try {
      source = await open(
        sourcePath,
        constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
      )
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ELOOP') {
        throw new ExecutionOperationError(
          'input_changed_after_plan',
          `input changed after the approved plan: ${sourcePath}`,
        )
      }
      throw error
    }
    const before = await source.stat({ bigint: true })
    if (!before.isFile() || !matchesInputFact(fact, before)) {
      throw new ExecutionOperationError(
        'input_changed_after_plan',
        `input changed after the approved plan: ${sourcePath}`,
      )
    }
    if (await openedDescriptorPath(source, 'input_path') !== sourcePath) {
      throw new ExecutionOperationError(
        'input_changed_after_plan',
        `input changed after the approved plan: ${sourcePath}`,
      )
    }
    if (before.size > MAX_TOTAL_SNAPSHOT_BYTES) {
      throw new ExecutionOperationError(
        'input_snapshot_limit_exceeded',
        `input exceeds the ${MAX_TOTAL_SNAPSHOT_BYTES} byte per-run snapshot limit: ${sourcePath}`,
      )
    }
    target = await open(
      targetPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES)
    const approvedSize = Number(before.size)
    let position = 0
    while (position < approvedSize) {
      throwIfAborted(signal)
      const length = Math.min(buffer.length, approvedSize - position)
      const read = await source.read(buffer, 0, length, position)
      if (read.bytesRead === 0) {
        throw new ExecutionOperationError(
          'input_changed_during_snapshot',
          `input changed while it was being snapshotted: ${sourcePath}`,
        )
      }
      digest.update(buffer.subarray(0, read.bytesRead))
      let written = 0
      while (written < read.bytesRead) {
        const result = await target.write(
          buffer,
          written,
          read.bytesRead - written,
          position + written,
        )
        if (result.bytesWritten === 0) {
          throw new ExecutionOperationError('input_snapshot_failed', `input snapshot write stalled: ${sourcePath}`)
        }
        written += result.bytesWritten
      }
      position += read.bytesRead
    }
    const growthProbe = await source.read(buffer, 0, 1, position)
    if (growthProbe.bytesRead !== 0) {
      throw new ExecutionOperationError(
        'input_changed_during_snapshot',
        `input changed while it was being snapshotted: ${sourcePath}`,
      )
    }
    const after = await source.stat({ bigint: true })
    if (!matchesInputFact(fact, after) || !sameInputMetadata(before, after)) {
      throw new ExecutionOperationError(
        'input_changed_during_snapshot',
        `input changed while it was being snapshotted: ${sourcePath}`,
      )
    }
    await target.sync()
    const targetMetadata = await target.stat({ bigint: true })
    if (!targetMetadata.isFile() || targetMetadata.size !== before.size) {
      throw new ExecutionOperationError('input_snapshot_failed', `input snapshot is incomplete: ${sourcePath}`)
    }
    completed = true
    return {
      sourcePath,
      stagedPath: targetPath,
      size: targetMetadata.size.toString(),
      sha256: digest.digest('hex'),
    }
  } finally {
    await target?.close()
    await source?.close()
    if (!completed) await unlink(targetPath).catch(() => {})
  }
}

async function snapshotInputs(runDirectory, inputs, facts, totalSnapshotBytes, signal) {
  const filesystem = await statfs(runDirectory, { bigint: true })
  const availableBytes = filesystem.bavail * filesystem.bsize
  const requiredBytes = BigInt(totalSnapshotBytes) + SNAPSHOT_FREE_SPACE_RESERVE_BYTES
  if (availableBytes < requiredBytes) {
    throw new ExecutionOperationError(
      'input_snapshot_space_unavailable',
      'runs_root does not have enough free space for the approved snapshots and safety reserve',
      {
        availableBytes: availableBytes.toString(),
        requiredBytes: requiredBytes.toString(),
      },
    )
  }
  const inputDirectory = join(runDirectory, 'inputs')
  await mkdir(inputDirectory, { mode: 0o700 })
  const stagedInputs = cloneJson(inputs)
  const snapshots = []
  for (const [ordinal, fact] of facts.entries()) {
    if (fact.type !== 'file') {
      throw new ExecutionOperationError(
        'directory_input_unsupported',
        'the execution MVP does not support directory inputs',
      )
    }
    const targetPath = join(
      inputDirectory,
      `input-${String(ordinal).padStart(4, '0')}${safeInputSuffix(fact.path)}`,
    )
    const snapshot = await snapshotInputFile(fact.path, targetPath, fact, signal)
    snapshots.push({ input: fact.input, ...(fact.index === undefined ? {} : { index: fact.index }), ...snapshot })
    if (fact.index === undefined) stagedInputs[fact.input] = targetPath
    else stagedInputs[fact.input][fact.index] = targetPath
  }
  return { stagedInputs, snapshots }
}

async function readBoundedJson(path, optional = false, maxBytes = MAX_RESULT_JSON_BYTES) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
    const opened = await handle.stat()
    if (!opened.isFile()) throw new Error(`expected a regular JSON file: ${path}`)
    if (opened.size > maxBytes) throw new Error(`JSON file exceeds ${maxBytes} bytes: ${path}`)
    const chunks = []
    let bytes = 0
    while (bytes <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - bytes))
      if (chunk.length === 0) break
      const result = await handle.read(chunk, 0, chunk.length, bytes)
      if (result.bytesRead === 0) break
      chunks.push(chunk.subarray(0, result.bytesRead))
      bytes += result.bytesRead
    }
    if (bytes > maxBytes) throw new Error(`JSON file exceeds ${maxBytes} bytes: ${path}`)
    const completed = await handle.stat()
    if (
      !completed.isFile()
      || completed.dev !== opened.dev
      || completed.ino !== opened.ino
      || completed.size !== opened.size
      || completed.mtimeMs !== opened.mtimeMs
    ) {
      throw new Error(`JSON file changed while reading: ${path}`)
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null
    throw error
  } finally {
    await handle?.close()
  }
}

function outputValuesForPort(outputs, workflowName, id) {
  if (Object.hasOwn(outputs, `${workflowName}.${id}`)) return outputs[`${workflowName}.${id}`]
  if (Object.hasOwn(outputs, id)) return outputs[id]
  return undefined
}

function outputPathsForPort(value, port) {
  if (port.cardinality === 'many') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new Error(`miniwdl returned an invalid file array for ${port.id}`)
    }
    return value
  }
  if (typeof value !== 'string') {
    throw new Error(`miniwdl returned an invalid file path for ${port.id}`)
  }
  return [value]
}

async function inventoryOutputs(engineDirectory, manifest, workflowName, outputs) {
  if (!isPlainObject(outputs)) throw new Error('miniwdl outputs.json must contain an object')
  const root = await realpath(engineDirectory)
  const inventory = []
  for (const port of manifest.outputs.filter((item) => item.type === 'file' || item.type === 'directory')) {
    const value = outputValuesForPort(outputs, workflowName, port.id)
    if (value === undefined) throw new Error(`miniwdl outputs.json is missing ${workflowName}.${port.id}`)
    for (const path of outputPathsForPort(value, port)) {
      if (!isAbsolute(path)) throw new Error(`miniwdl returned a non-absolute output path: ${path}`)
      const canonical = await realpath(path)
      if (!isContainedPath(root, canonical)) throw new Error(`miniwdl output escapes the run directory: ${path}`)
      const metadata = await stat(canonical, { bigint: true })
      const validType = port.type === 'file' ? metadata.isFile() : metadata.isDirectory()
      if (!validType) throw new Error(`miniwdl output has the wrong type: ${path}`)
      inventory.push({
        output: port.id,
        type: port.type,
        path,
        canonicalPath: canonical,
        size: metadata.size.toString(),
        mtimeNs: metadata.mtimeNs.toString(),
      })
    }
  }
  return inventory
}

function createOutputReader(handle) {
  let stdoutOffset = 0
  let stderrOffset = 0
  return () => {
    try {
      const chunks = []
      for (const [name, reader] of [
        ['stdout', handle.collected.stdout],
        ['stderr', handle.collected.stderr],
      ]) {
        if (reader === undefined) continue
        const offset = name === 'stdout' ? stdoutOffset : stderrOffset
        const read = reader.readFrom(offset)
        if (name === 'stdout') stdoutOffset = read.nextOffset
        else stderrOffset = read.nextOffset
        if (read.lossy) chunks.push(`[${name} output truncated before this read]\n`)
        if (read.text !== '') chunks.push(`[${name}]\n${read.text}`)
      }
      return chunks.join('')
    } catch {
      return '[bio-workflow output unavailable]\n'
    }
  }
}

function assertRunAccess(record, agent) {
  if (agent === null || typeof agent !== 'object' || typeof agent.id !== 'string' || agent.id.length === 0) {
    throw new ExecutionOperationError('execution_owner_required', 'workflow run access requires a DSH agent session')
  }
  if (typeof record.ownerSession !== 'string' || record.ownerSession !== agent.id) {
    throw new ExecutionOperationError('run_access_denied', 'workflow run belongs to another session')
  }
}

export function createExecutionManager(options) {
  if (!isPlainObject(options) || options.store === undefined) {
    throw new TypeError('execution manager requires a workflow store')
  }
  const config = parseExecutionConfig(options.config ?? {})
  const getSubprocess = typeof options.getSubprocess === 'function' ? options.getSubprocess : () => undefined
  const getJobs = typeof options.getJobs === 'function' ? options.getJobs : () => undefined
  const getEnvironment = typeof options.getEnvironment === 'function' ? options.getEnvironment : () => process.env
  const persistRecord = typeof options.persistRecord === 'function' ? options.persistRecord : atomicWriteJson
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const createId = typeof options.createId === 'function' ? options.createId : () => randomUUID()
  const activeRuns = new Map()

  function requireOwner(operation) {
    if (
      operation.agent === null
      || typeof operation.agent !== 'object'
      || typeof operation.agent.id !== 'string'
      || operation.agent.id.length === 0
    ) {
      throw new ExecutionOperationError(
        'execution_owner_required',
        'workflow execution requires an owning DSH agent session',
      )
    }
    return operation.agent
  }

  function serviceSummary() {
    const subprocess = getSubprocess()
    const jobs = getJobs()
    return {
      enabled: config.enabled,
      configured: config.enabled && config.runsRoot !== null && config.inputRoots.length > 0,
      subprocessAvailable: typeof subprocess?.resolveExecutable === 'function' && typeof subprocess?.spawn === 'function',
      jobsAvailable: typeof jobs?.start === 'function',
      supportedWorkflows: [...EXECUTABLE_WORKFLOWS],
    }
  }

  async function buildPlan(request, operation = {}) {
    throwIfAborted(operation.signal)
    validateRequestKeys(request, new Set(['id', 'version', 'expectedDigest', 'inputs']))
    if (!config.enabled) {
      throw new ExecutionOperationError('execution_disabled', 'workflow execution is disabled by plugin configuration')
    }
    const workflowKey = `${request.id}@${request.version}`
    if (!EXECUTABLE_SET.has(workflowKey)) {
      throw new ExecutionOperationError(
        'workflow_execution_unsupported',
        `execution MVP does not support ${workflowKey}; supported: ${EXECUTABLE_WORKFLOWS.join(', ')}`,
      )
    }
    const subprocess = getSubprocess()
    if (typeof subprocess?.resolveExecutable !== 'function' || typeof subprocess?.spawn !== 'function') {
      throw new ExecutionOperationError(
        'subprocess_service_unavailable',
        'DSH subprocess service is unavailable; load @deepseek-ai/dsh-subprocess-local',
      )
    }

    const roots = await inspectConfiguredRoots(config)
    const resolvedBundle = await options.store.resolve(
      { id: request.id, version: request.version, source: 'builtin' },
      { signal: operation.signal },
    )
    if (!resolvedBundle.ok) {
      throw new ExecutionOperationError(resolvedBundle.error.code, resolvedBundle.error.message)
    }
    if (resolvedBundle.bundle.digest !== request.expectedDigest) {
      throw new ExecutionOperationError(
        'bundle_digest_mismatch',
        'built-in workflow bundle digest does not match expectedDigest',
        { expectedDigest: request.expectedDigest, actualDigest: resolvedBundle.bundle.digest },
      )
    }
    const images = assertPinnedContainers(resolvedBundle.bundle)
    const workflowName = extractWorkflowName(resolvedBundle.bundle)
    const inputs = await normalizeInputs(
      resolvedBundle.bundle.descriptor.manifest,
      request.inputs,
      roots.inputRoots,
    )
    throwIfAborted(operation.signal)
    const runner = await probeRunner(
      config,
      subprocess,
      resolvedBundle.directory,
      resolvedBundle.bundle,
      operation.signal,
      getEnvironment(),
    )
    const jobsAvailable = typeof getJobs()?.start === 'function'
    const entrypointPlaceholder = `<run-directory>${sep}wdl${sep}${resolvedBundle.bundle.descriptor.wdl.entrypoint}`
    const plan = {
      schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
      workflow: {
        id: request.id,
        version: request.version,
        source: 'builtin',
        bundleDigest: resolvedBundle.bundle.digest,
        wdlVersion: resolvedBundle.bundle.descriptor.wdl.version,
        workflowName,
        entrypoint: resolvedBundle.bundle.descriptor.wdl.entrypoint,
      },
      inputs: inputs.normalized,
      inputFileFacts: inputs.fileFacts,
      inputSnapshotPolicy: {
        mode: 'run_owned_copy_after_approval',
        totalBytes: inputs.totalSnapshotBytes,
        maxTotalBytes: MAX_TOTAL_SNAPSHOT_BYTES.toString(),
        minimumFreeSpaceReserveBytes: SNAPSHOT_FREE_SPACE_RESERVE_BYTES.toString(),
        rejectGrowthDuringCopy: true,
      },
      runner: {
        name: 'miniwdl',
        executable: runner.miniwdl.executable,
        executableIdentity: runner.miniwdl.identity,
        version: runner.miniwdl.version,
        semanticCheck: runner.miniwdl.semanticCheck,
        containerRuntime: {
          name: 'docker',
          executable: runner.docker.executable,
          executableIdentity: runner.docker.identity,
          host: runner.docker.host,
          engineId: runner.docker.engineId,
          serverVersion: runner.docker.serverVersion,
          daemonCheck: runner.docker.daemonCheck,
          swarm: runner.docker.swarm,
          images,
        },
        argvTemplate: [
          runner.miniwdl.executable,
          'run',
          '--input',
          `<run-directory>${sep}inputs.json`,
          '--dir',
          `<run-directory>${sep}engine${sep}.`,
          '--cfg',
          `<run-directory>${sep}miniwdl.cfg`,
          '--error-json',
          '--log-json',
          '--no-color',
          '--no-cache',
          '--no-outside-imports',
          '--as-me',
          entrypointPlaceholder,
        ],
        environmentPolicy: ENVIRONMENT_POLICY,
        securityPolicy: {
          inputMode: 'run_owned_snapshot',
          maxTotalInputBytes: MAX_TOTAL_SNAPSHOT_BYTES.toString(),
          minimumFreeSpaceReserveBytes: SNAPSHOT_FREE_SPACE_RESERVE_BYTES.toString(),
          fileIoRoot: '<run-directory>',
          placeholderRegex: PLACEHOLDER_PATTERN,
          allowAnyInput: false,
          allowPrivileged: false,
          allowedDockerNetworks: [],
          swarmAutoInit: false,
          callCache: false,
          downloadCache: false,
        },
      },
      runsRoot: roots.runsRoot,
      runsRootIdentity: roots.runsRootIdentity,
      expectedOutputs: resolvedBundle.bundle.descriptor.manifest.outputs.map((output) => ({
        id: output.id,
        type: output.type,
        cardinality: output.cardinality,
      })),
      authorization: {
        required: true,
        binding: 'planDigest',
      },
      services: { jobsAvailable },
      readyToRun: jobsAvailable,
      limitations: [
        'input_content_not_hashed',
        'container_network_isolation_not_enforced',
        'builtin_fastq_qc_only',
      ],
    }
    const result = {
      ok: true,
      observedAt: now().toISOString(),
      planDigest: digestValue(plan),
      plan,
      error: null,
    }
    return {
      result,
      bundle: resolvedBundle.bundle,
      roots,
      subprocess,
      runner,
    }
  }

  async function prepareRun(request, operation = {}) {
    try {
      requireOwner(operation)
      validateRequestKeys(request, new Set(['id', 'version', 'expectedDigest', 'inputs', 'expectedPlanDigest']))
      if (typeof request.expectedPlanDigest !== 'string' || !DIGEST_PATTERN.test(request.expectedPlanDigest)) {
        throw new ExecutionOperationError('invalid_execution_request', 'expectedPlanDigest must be a SHA-256 plan digest')
      }
      const built = await buildPlan({
        id: request.id,
        version: request.version,
        expectedDigest: request.expectedDigest,
        inputs: request.inputs,
      }, operation)
      if (!built.result.plan.readyToRun) {
        return failure(
          'jobs_service_unavailable',
          'DSH background jobs service is unavailable; load the jobs provider and @deepseek-ai/dsh-tool-jobs',
          { planDigest: built.result.planDigest },
        )
      }
      if (built.result.planDigest !== request.expectedPlanDigest) {
        return failure(
          'plan_digest_mismatch',
          'live execution plan does not match expectedPlanDigest',
          { expectedPlanDigest: request.expectedPlanDigest, actualPlanDigest: built.result.planDigest },
        )
      }
      return built
    } catch (error) {
      return operationFailure(error)
    }
  }

  function queuePersist(state) {
    const snapshot = cloneJson(state.record)
    const serializedBytes = Buffer.byteLength(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    if (serializedBytes > MAX_PROVENANCE_JSON_BYTES) {
      throw new ExecutionOperationError(
        'run_provenance_limit_exceeded',
        `run provenance exceeds the ${MAX_PROVENANCE_JSON_BYTES} byte limit`,
      )
    }
    const next = state.persist.catch(() => {}).then(() => persistRecord(state.provenancePath, snapshot))
    state.persist = next
    return next
  }

  function persistInBackground(state) {
    try {
      void queuePersist(state).catch(() => {})
    } catch {
      // The live state remains queryable; a later terminal write can recover provenance.
    }
  }

  async function finalizeRun(state, handle, manifest, workflowName, engineDirectory) {
    try {
      const outcome = await handle.done
      await handle.waitForExit()
      let status = state.cancelRequested
        ? 'killed'
        : outcome.exitCode === 0 ? 'completed' : 'failed'
      let outputs = null
      let outputInventory = []
      let error = null
      if (status === 'completed') {
        try {
          outputs = await readBoundedJson(join(engineDirectory, 'outputs.json'))
          outputInventory = await inventoryOutputs(engineDirectory, manifest, workflowName, outputs)
        } catch (collectionError) {
          status = 'failed'
          error = {
            code: 'output_collection_failed',
            message: String(collectionError?.message ?? collectionError).slice(0, 512),
          }
        }
      } else if (status === 'failed') {
        const miniwdlError = await readBoundedJson(join(engineDirectory, 'error.json'), true).catch(() => null)
        error = {
          code: 'miniwdl_failed',
          message: `miniwdl exited with ${outcome.exitCode === null ? outcome.signal : `code ${outcome.exitCode}`}`,
          ...(miniwdlError === null ? {} : { miniwdl: miniwdlError }),
        }
      }
      state.record.status = status
      state.record.finishedAt = now().toISOString()
      state.record.exit = { exitCode: outcome.exitCode, signal: outcome.signal }
      state.record.outputs = outputs
      state.record.outputInventory = outputInventory
      state.record.error = error
      await queuePersist(state)
      activeRuns.delete(state.record.runId)
      return {
        status,
        detail: outcome.exitCode === null ? String(outcome.signal ?? status) : `exit code: ${outcome.exitCode}`,
      }
    } catch (error) {
      state.record.status = state.cancelRequested ? 'killed' : 'failed'
      state.record.finishedAt = now().toISOString()
      state.record.error = {
        code: 'runner_lifecycle_failed',
        message: String(error?.message ?? error).slice(0, 512),
      }
      let persisted = false
      try {
        await queuePersist(state)
        persisted = true
      } catch {
        // Keep the terminal state queryable in memory when provenance cannot be updated.
      }
      if (persisted) activeRuns.delete(state.record.runId)
      return { status: state.record.status, detail: state.record.error.message }
    }
  }

  async function run(request, operation = {}) {
    const prepared = await prepareRun(request, operation)
    if (prepared.result === undefined) return prepared
    const owner = requireOwner(operation)
    const jobs = getJobs()
    if (typeof jobs?.start !== 'function') {
      return failure('jobs_service_unavailable', 'DSH background jobs service is unavailable')
    }

    const runId = `run-${createId()}`
    if (!RUN_ID_PATTERN.test(runId)) {
      return failure('run_id_invalid', 'run id provider returned an invalid UUID')
    }
    const runDirectory = join(prepared.roots.runsRoot, runId)
    let runDirectoryCreated = false
    try {
      await assertDirectoryUnchanged(prepared.roots.runsRootIdentity, 'runs_root')
      await mkdir(runDirectory, { mode: 0o700 })
      runDirectoryCreated = true
      const canonicalRunDirectory = await inspectDirectory(
        runDirectory,
        'run_directory',
        constants.R_OK | constants.W_OK | constants.X_OK,
      )
      if (!isContainedPath(prepared.roots.runsRoot, canonicalRunDirectory)) {
        throw new ExecutionOperationError('run_directory_unsafe', 'created run directory escapes the configured runs root')
      }
      const runDirectoryIdentity = await inspectDirectoryIdentity(canonicalRunDirectory, 'run_directory')
      const staged = await stageWdlBundle(canonicalRunDirectory, prepared.bundle)
      const stagedInputResult = await snapshotInputs(
        canonicalRunDirectory,
        prepared.result.plan.inputs,
        prepared.result.plan.inputFileFacts,
        prepared.result.plan.inputSnapshotPolicy.totalBytes,
        operation.signal,
      )
      const qualifiedInputs = Object.fromEntries(
        Object.entries(stagedInputResult.stagedInputs).map(([key, value]) => [
          `${prepared.result.plan.workflow.workflowName}.${key}`,
          value,
        ]),
      )
      const inputsPath = join(canonicalRunDirectory, 'inputs.json')
      const configPath = join(canonicalRunDirectory, 'miniwdl.cfg')
      const engineDirectory = join(canonicalRunDirectory, 'engine')
      await writeExclusiveText(inputsPath, `${JSON.stringify(qualifiedInputs, null, 2)}\n`)
      await writeExclusiveText(configPath, createMiniwdlConfig(canonicalRunDirectory))
      const argv = [
        prepared.runner.miniwdl.executable,
        'run',
        '--input',
        inputsPath,
        '--dir',
        `${engineDirectory}${sep}.`,
        '--cfg',
        configPath,
        '--error-json',
        '--log-json',
        '--no-color',
        '--no-cache',
        '--no-outside-imports',
        '--as-me',
        staged.entrypoint,
      ]
      const startedAt = now().toISOString()
      const provenancePath = join(canonicalRunDirectory, 'run.json')
      const state = {
        cancelRequested: false,
        provenancePath,
        persist: Promise.resolve(),
        record: {
          schemaVersion: RUN_PROVENANCE_SCHEMA_VERSION,
          runId,
          jobId: null,
          ownerSession: owner.id,
          status: 'prepared',
          startedAt,
          finishedAt: null,
          runDirectory: canonicalRunDirectory,
          planDigest: prepared.result.planDigest,
          plan: prepared.result.plan,
          inputSnapshots: stagedInputResult.snapshots,
          command: { argv, cwd: canonicalRunDirectory, environmentPolicy: ENVIRONMENT_POLICY },
          pid: null,
          exit: null,
          outputs: null,
          outputInventory: [],
          error: null,
        },
      }
      activeRuns.set(runId, state)
      await queuePersist(state)
      await assertDirectoryUnchanged(prepared.roots.runsRootIdentity, 'runs_root')
      await assertDirectoryUnchanged(runDirectoryIdentity, 'run_directory')
      const liveRunner = await probeRunner(
        config,
        prepared.subprocess,
        staged.wdlRoot,
        prepared.bundle,
        operation.signal,
        getEnvironment(),
      )
      if (digestValue(liveRunner) !== digestValue(prepared.runner)) {
        throw new ExecutionOperationError(
          'runner_changed_after_plan',
          'miniwdl or Docker changed after the approved plan',
        )
      }
      await assertDirectoryUnchanged(prepared.roots.runsRootIdentity, 'runs_root')
      await assertDirectoryUnchanged(runDirectoryIdentity, 'run_directory')
      throwIfAborted(operation.signal)

      let handle
      let jobId
      try {
        jobId = jobs.start({
          kind: 'bio',
          label: `${request.id}@${request.version} ${runId}`,
          outputLimitBytes: JOB_OUTPUT_LIMIT_BYTES,
          owner,
          run() {
            handle = prepared.subprocess.spawn({
              argv,
              cwd: canonicalRunDirectory,
              stdio: {
                stdin: 'ignore',
                stdout: { maxBytes: JOB_OUTPUT_LIMIT_BYTES, spill: { maxBytes: 16 * 1024 * 1024 } },
                stderr: { maxBytes: JOB_OUTPUT_LIMIT_BYTES, spill: { maxBytes: 16 * 1024 * 1024 } },
              },
              graceMs: PROCESS_GRACE_MS,
              env: createChildEnvironment(getEnvironment()),
            })
            state.record.status = 'running'
            state.record.pid = handle.pid
            persistInBackground(state)
            return {
              cancel() {
                if (state.cancelRequested) return
                state.cancelRequested = true
                state.record.status = 'stopping'
                persistInBackground(state)
                handle.terminate()
              },
              done: finalizeRun(
                state,
                handle,
                prepared.bundle.descriptor.manifest,
                prepared.result.plan.workflow.workflowName,
                engineDirectory,
              ),
              readOutput: createOutputReader(handle),
            }
          },
        })
      } catch (error) {
        if (handle !== undefined) {
          handle.terminate()
          await handle.waitForExit().catch(() => false)
        }
        throw new ExecutionOperationError(
          'job_start_failed',
          String(error?.message ?? error).slice(0, 512),
        )
      }
      state.record.jobId = jobId
      persistInBackground(state)
      return {
        ok: true,
        runId,
        jobId,
        status: state.record.status,
        planDigest: prepared.result.planDigest,
        runDirectory: canonicalRunDirectory,
        error: null,
      }
    } catch (error) {
      activeRuns.delete(runId)
      if (runDirectoryCreated) {
        try {
          await rm(runDirectory, { recursive: true, force: true })
        } catch (cleanupError) {
          return failure(
            'run_cleanup_failed',
            `workflow launch failed and its private run directory could not be removed: ${String(cleanupError?.message ?? cleanupError).slice(0, 384)}`,
            { runId },
          )
        }
      }
      return operationFailure(error)
    }
  }

  async function getRun(runId, operation = {}) {
    try {
      if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
        throw new ExecutionOperationError('invalid_run_id', 'runId must be a dsh-bio-workflows run UUID')
      }
      if (!config.enabled) {
        throw new ExecutionOperationError('execution_disabled', 'workflow execution is disabled by plugin configuration')
      }
      const owner = requireOwner(operation)
      const roots = await inspectRunsRoot(config, constants.R_OK | constants.X_OK)
      const state = activeRuns.get(runId)
      let record
      if (state === undefined) {
        const runDirectory = join(roots.runsRoot, runId)
        let canonicalRunDirectory
        try {
          canonicalRunDirectory = await inspectDirectory(
            runDirectory,
            'run_directory',
            constants.R_OK | constants.X_OK,
          )
        } catch (error) {
          if (error instanceof ExecutionOperationError && error.code === 'run_directory_missing') {
            return failure('run_not_found', `workflow run not found: ${runId}`)
          }
          throw error
        }
        if (!isContainedPath(roots.runsRoot, canonicalRunDirectory)) {
          throw new ExecutionOperationError('run_directory_unsafe', 'workflow run directory escapes the configured runs root')
        }
        record = await readBoundedJson(
          join(canonicalRunDirectory, 'run.json'),
          true,
          MAX_PROVENANCE_JSON_BYTES,
        )
        if (record === null) return failure('run_not_found', `workflow run not found: ${runId}`)
      } else {
        record = cloneJson(state.record)
      }
      assertRunAccess(record, owner)
      let job = null
      const jobs = getJobs()
      if (record.jobId !== null && typeof jobs?.get === 'function') {
        try {
          job = jobs.get(record.jobId, owner)
        } catch {
          job = null
        }
      }
      return { ok: true, run: record, job, error: null }
    } catch (error) {
      return operationFailure(error)
    }
  }

  return Object.freeze({
    config,
    get summary() {
      return serviceSummary()
    },
    async plan(request, operation = {}) {
      try {
        return (await buildPlan(request, operation)).result
      } catch (error) {
        return operationFailure(error)
      }
    },
    prepareRun,
    run,
    getRun,
  })
}
