import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const DRAFT_TEST_PLAN_SCHEMA_VERSION = '1'
export const DRAFT_TEST_EVIDENCE_SCHEMA_VERSION = '1'
export const DRAFT_TEST_POLICY_VERSION = '1'
export const DRAFT_TEST_DOCKER_BROKER_ADDITIONAL_PROCESSES = 128

export const DRAFT_TEST_DEFAULT_BUDGETS = Object.freeze({
  cpu: 1,
  memoryBytes: 512 * 1024 * 1024,
  pids: 64,
  wallTimeMs: 5 * 60 * 1000,
  taskTimeMs: 2 * 60 * 1000,
  logBytes: 1024 * 1024,
  artifactCount: 128,
  artifactBytes: 16 * 1024 * 1024,
  totalOutputBytes: 64 * 1024 * 1024,
  fixtureBytes: 64 * 1024 * 1024,
  taskCount: 16,
})

export const DRAFT_TEST_HARD_LIMITS = Object.freeze({
  cpu: 4,
  memoryBytes: 4 * 1024 * 1024 * 1024,
  pids: 512,
  wallTimeMs: 30 * 60 * 1000,
  taskTimeMs: 10 * 60 * 1000,
  logBytes: 4 * 1024 * 1024,
  artifactCount: 1024,
  artifactBytes: 64 * 1024 * 1024,
  totalOutputBytes: 256 * 1024 * 1024,
  fixtureBytes: 64 * 1024 * 1024,
  taskCount: 64,
})

export const DRAFT_TEST_ISOLATION_POLICY = deepFreeze({
  schemaVersion: '1',
  backend: 'dsh_fixture_docker',
  network: 'none',
  rootFilesystem: 'read_only',
  writableStorage: 'bounded_tmpfs_volume',
  taskUser: 'invoking_non_root_uid_gid',
  capabilities: 'none',
  noNewPrivileges: true,
  seccomp: 'builtin',
  mandatoryAccessControl: 'required',
  ipc: 'none',
  devices: 'none',
  dockerSocket: 'absent',
  hostPaths: 'fixture_snapshot_and_command_read_only_only',
  ambientEnvironment: 'removed',
  registryPulls: false,
  remoteDownloads: false,
  callCache: false,
  taskRetries: false,
  productionRunnerReuse: false,
})

const CONFIG_KEYS = new Set(['enabled', 'runsRoot', 'fixtureRoots', 'runner', 'budgets'])
const RUNNER_KEYS = new Set([
  'pythonExecutable',
  'dockerExecutable',
  'expectedMiniwdlVersion',
  'supportImage',
])
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const PINNED_IMAGE_PATTERN = /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const MISSION_ID_PATTERN = /^mission-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DRAFT_ID_PATTERN = /^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TEST_ID_PATTERN = /^test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROLLER_NETWORK_POLICY = 'seccomp_deny_non_unix_sockets_before_wdl_load'
const MAX_PATH_LENGTH = 4096
const SAFE_CONFIG_PATH_PATTERN = /^[A-Za-z0-9_./:+@=-]+$/
const MINIMUM_BUDGETS = Object.freeze({
  cpu: 1,
  memoryBytes: 64 * 1024 * 1024,
  pids: 8,
  wallTimeMs: 10 * 1000,
  taskTimeMs: 5 * 1000,
  logBytes: 4 * 1024,
  artifactCount: 1,
  artifactBytes: 4 * 1024,
  totalOutputBytes: 4 * 1024,
  fixtureBytes: 1,
  taskCount: 1,
})

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isContainedPath(root, target) {
  const remainder = relative(root, target)
  return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`))
}

function pathsOverlap(left, right) {
  return isContainedPath(left, right) || isContainedPath(right, left)
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
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

export function computeDraftTestDigest(value, domain = 'contract') {
  const hash = createHash('sha256')
  hash.update(`dsh-bio-draft-test-${domain}-v1\n`, 'utf8')
  hash.update(stableStringify(value), 'utf8')
  return `sha256:${hash.digest('hex')}`
}

function computeRunnerDigest(value, domain) {
  const hash = createHash('sha256')
  hash.update(`dsh-bio-fixture-runner-${domain}-v1\n`, 'utf8')
  hash.update(stableStringify(value), 'utf8')
  return `sha256:${hash.digest('hex')}`
}

function assertExactKeys(value, allowed, label, errors) {
  if (!isPlainObject(value)) {
    errors.push({ path: label, code: 'type', message: 'must be an object' })
    return false
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push({ path: `${label}.${key}`, code: 'additional_property', message: `unsupported property: ${key}` })
  }
  return true
}

function validateExecutable(value, path, requireAbsolute, errors) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_PATH_LENGTH) {
    errors.push({ path, code: 'type', message: 'must be a bounded non-empty string' })
  } else if (requireAbsolute && !isAbsolute(value)) {
    errors.push({ path, code: 'format', message: 'must be absolute when draft testing is enabled' })
  } else if (!isAbsolute(value) && (value.includes('/') || value.includes('\\'))) {
    errors.push({ path, code: 'format', message: 'must be absolute or a bare executable name' })
  }
}

function normalizeConfiguredBudgets(value, errors) {
  const supplied = value ?? {}
  if (!assertExactKeys(supplied, new Set(Object.keys(DRAFT_TEST_DEFAULT_BUDGETS)), '$.budgets', errors)) {
    return cloneJson(DRAFT_TEST_DEFAULT_BUDGETS)
  }
  const budgets = {}
  for (const [key, fallback] of Object.entries(DRAFT_TEST_DEFAULT_BUDGETS)) {
    const selected = supplied[key] ?? fallback
    if (
      !Number.isSafeInteger(selected)
      || selected < MINIMUM_BUDGETS[key]
      || selected > DRAFT_TEST_HARD_LIMITS[key]
    ) {
      errors.push({
        path: `$.budgets.${key}`,
        code: 'range',
        message: `must be an integer from ${MINIMUM_BUDGETS[key]} to ${DRAFT_TEST_HARD_LIMITS[key]}`,
      })
      budgets[key] = fallback
    } else {
      budgets[key] = selected
    }
  }
  if (budgets.artifactBytes > budgets.totalOutputBytes) {
    errors.push({ path: '$.budgets.artifactBytes', code: 'range', message: 'must not exceed totalOutputBytes' })
  }
  if (budgets.taskTimeMs > budgets.wallTimeMs) {
    errors.push({ path: '$.budgets.taskTimeMs', code: 'range', message: 'must not exceed wallTimeMs' })
  }
  return budgets
}

export class DraftTestConfigValidationError extends Error {
  constructor(errors) {
    super(`invalid draft testing config: ${errors.map((item) => `${item.path} ${item.message}`).join('; ')}`)
    this.name = 'DraftTestConfigValidationError'
    this.errors = errors
  }
}

export function parseDraftTestConfig(value = {}) {
  const errors = []
  if (!assertExactKeys(value, CONFIG_KEYS, '$', errors)) throw new DraftTestConfigValidationError(errors)
  const enabled = value.enabled ?? false
  if (typeof enabled !== 'boolean') errors.push({ path: '$.enabled', code: 'type', message: 'must be a boolean' })
  let runsRoot = null
  if (value.runsRoot !== undefined) {
    if (
      typeof value.runsRoot !== 'string'
      || !isAbsolute(value.runsRoot)
      || value.runsRoot.length > MAX_PATH_LENGTH
      || !SAFE_CONFIG_PATH_PATTERN.test(value.runsRoot)
    ) {
      errors.push({ path: '$.runsRoot', code: 'format', message: 'must be a bounded absolute path' })
    } else {
      runsRoot = resolve(value.runsRoot)
    }
  } else if (enabled === true) {
    errors.push({ path: '$.runsRoot', code: 'required', message: 'is required when draft testing is enabled' })
  }

  const fixtureRoots = []
  if (value.fixtureRoots !== undefined && !Array.isArray(value.fixtureRoots)) {
    errors.push({ path: '$.fixtureRoots', code: 'type', message: 'must be an array' })
  } else {
    if ((value.fixtureRoots ?? []).length > 64) {
      errors.push({ path: '$.fixtureRoots', code: 'max_items', message: 'must contain at most 64 roots' })
    }
    for (const [index, root] of (value.fixtureRoots ?? []).entries()) {
      if (
        typeof root !== 'string'
        || !isAbsolute(root)
        || root.length > MAX_PATH_LENGTH
        || !SAFE_CONFIG_PATH_PATTERN.test(root)
      ) {
        errors.push({ path: `$.fixtureRoots[${index}]`, code: 'format', message: 'must be a bounded absolute path' })
      } else {
        const normalized = resolve(root)
        if (fixtureRoots.includes(normalized)) {
          errors.push({ path: `$.fixtureRoots[${index}]`, code: 'duplicate', message: `duplicate fixture root: ${normalized}` })
        } else {
          fixtureRoots.push(normalized)
        }
      }
    }
  }
  if (enabled === true && fixtureRoots.length === 0) {
    errors.push({ path: '$.fixtureRoots', code: 'required', message: 'must contain at least one root when enabled' })
  }
  if (runsRoot !== null) {
    for (const [index, root] of fixtureRoots.entries()) {
      if (pathsOverlap(runsRoot, root)) {
        errors.push({
          path: `$.fixtureRoots[${index}]`,
          code: 'overlap',
          message: 'fixture roots and the dedicated draft-test runs root must not overlap',
        })
      }
    }
  }

  const runner = isPlainObject(value.runner) ? value.runner : {}
  if (value.runner !== undefined) assertExactKeys(value.runner, RUNNER_KEYS, '$.runner', errors)
  const pythonExecutable = runner.pythonExecutable ?? 'python3'
  const dockerExecutable = runner.dockerExecutable ?? 'docker'
  const expectedMiniwdlVersion = runner.expectedMiniwdlVersion ?? '1.15.0'
  const supportImage = runner.supportImage ?? null
  validateExecutable(pythonExecutable, '$.runner.pythonExecutable', enabled === true, errors)
  validateExecutable(dockerExecutable, '$.runner.dockerExecutable', enabled === true, errors)
  if (typeof expectedMiniwdlVersion !== 'string' || !SEMVER_PATTERN.test(expectedMiniwdlVersion)) {
    errors.push({ path: '$.runner.expectedMiniwdlVersion', code: 'format', message: 'must be an exact semantic version' })
  } else if (enabled === true && expectedMiniwdlVersion !== '1.15.0') {
    errors.push({ path: '$.runner.expectedMiniwdlVersion', code: 'const', message: 'must equal the pinned version 1.15.0' })
  }
  if (supportImage !== null && (typeof supportImage !== 'string' || !PINNED_IMAGE_PATTERN.test(supportImage))) {
    errors.push({ path: '$.runner.supportImage', code: 'format', message: 'must be an exact digest-pinned image' })
  }
  if (enabled === true && supportImage === null) {
    errors.push({ path: '$.runner.supportImage', code: 'required', message: 'is required when draft testing is enabled' })
  }

  const budgets = normalizeConfiguredBudgets(value.budgets, errors)
  if (errors.length > 0) throw new DraftTestConfigValidationError(errors)
  return deepFreeze({
    enabled,
    runsRoot,
    fixtureRoots,
    runner: { pythonExecutable, dockerExecutable, expectedMiniwdlVersion, supportImage },
    budgets,
  })
}

export function effectiveDraftTestBudgets(requested, maxima) {
  if (requested !== undefined && !isPlainObject(requested)) throw new TypeError('budgets must be an object')
  const allowed = new Set(Object.keys(DRAFT_TEST_DEFAULT_BUDGETS))
  for (const key of Object.keys(requested ?? {})) {
    if (!allowed.has(key)) throw new TypeError(`unsupported draft test budget: ${key}`)
  }
  const result = {}
  for (const key of allowed) {
    const selected = requested?.[key] ?? maxima[key]
    if (!Number.isSafeInteger(selected) || selected < MINIMUM_BUDGETS[key] || selected > maxima[key]) {
      throw new TypeError(`budgets.${key} must be an integer from ${MINIMUM_BUDGETS[key]} to ${maxima[key]}`)
    }
    result[key] = selected
  }
  if (result.artifactBytes > result.totalOutputBytes) throw new TypeError('budgets.artifactBytes must not exceed totalOutputBytes')
  if (result.taskTimeMs > result.wallTimeMs) throw new TypeError('budgets.taskTimeMs must not exceed wallTimeMs')
  return deepFreeze(result)
}

function requireDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw new TypeError(`${label} must be a SHA-256 digest`)
  return value
}

function requireClosedObject(value, keys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object`)
  const expected = [...keys].sort()
  const observed = Object.keys(value).sort()
  if (stableStringify(observed) !== stableStringify(expected)) {
    throw new TypeError(`${label} must contain exactly: ${expected.join(', ')}`)
  }
  return value
}

function requireBoundedString(value, label, maximum = 4096) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 1 || Buffer.byteLength(value, 'utf8') > maximum) {
    throw new TypeError(`${label} must be a bounded non-empty string`)
  }
  return value
}

function requireInteger(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`)
  return value
}

function validateJsonValue(value, label, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1
  if (state.nodes > 4096 || depth > 16) throw new TypeError(`${label} exceeds the JSON complexity limit`)
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must contain finite JSON numbers`)
    return
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > 64 * 1024) throw new TypeError(`${label} contains an oversized string`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${label}[${index}]`, state, depth + 1))
    return
  }
  if (!isPlainObject(value)) throw new TypeError(`${label} must contain JSON values only`)
  for (const [key, item] of Object.entries(value)) {
    if (Buffer.byteLength(key, 'utf8') < 1 || Buffer.byteLength(key, 'utf8') > 240) {
      throw new TypeError(`${label} contains an invalid object key`)
    }
    validateJsonValue(item, `${label}.${key}`, state, depth + 1)
  }
}

function validateControllerNetwork(value, label) {
  requireClosedObject(value, [
    'policy', 'architecture', 'auditArchitecture', 'socketSyscall', 'seccompSyscall',
    'allowedSocketDomain', 'deniedAction', 'noNewPrivileges', 'threadSynchronization',
    'filterDigest',
  ], label)
  const expected = {
    x86_64: { auditArchitecture: '0xc000003e', socketSyscall: 41, seccompSyscall: 317 },
    aarch64: { auditArchitecture: '0xc00000b7', socketSyscall: 198, seccompSyscall: 277 },
  }[value.architecture]
  if (
    value.policy !== CONTROLLER_NETWORK_POLICY
    || expected === undefined
    || value.auditArchitecture !== expected.auditArchitecture
    || value.socketSyscall !== expected.socketSyscall
    || value.seccompSyscall !== expected.seccompSyscall
    || value.allowedSocketDomain !== 'AF_UNIX'
    || value.deniedAction !== 'errno:EPERM'
    || value.noNewPrivileges !== true
    || value.threadSynchronization !== 'SECCOMP_FILTER_FLAG_TSYNC'
  ) throw new TypeError(`${label} is invalid`)
  requireDigest(value.filterDigest, `${label}.filterDigest`)
  const basis = cloneJson(value)
  delete basis.filterDigest
  if (computeRunnerDigest(basis, 'controller-network-filter') !== value.filterDigest) {
    throw new TypeError(`${label}.filterDigest is invalid`)
  }
}

function validateExecutableIdentity(value, label) {
  requireClosedObject(value, [
    'launchPathDigest',
    'canonicalPathDigest',
    'launchDevice',
    'launchInode',
    'launchMode',
    'launchSizeBytes',
    'launchMtimeNs',
    'launchCtimeNs',
    'sha256',
    'sizeBytes',
    'device',
    'inode',
    'uid',
    'mode',
    'mtimeNs',
    'ctimeNs',
  ], label)
  for (const key of ['launchPathDigest', 'canonicalPathDigest', 'sha256']) requireDigest(value[key], `${label}.${key}`)
  for (const key of ['launchDevice', 'launchInode', 'launchMtimeNs', 'launchCtimeNs', 'device', 'inode', 'uid', 'mtimeNs', 'ctimeNs']) {
    if (typeof value[key] !== 'string' || !/^\d{1,40}$/.test(value[key])) throw new TypeError(`${label}.${key} must be a decimal identity`)
  }
  for (const key of ['launchMode', 'mode']) {
    if (typeof value[key] !== 'string' || !/^[0-7]{3,4}$/.test(value[key])) throw new TypeError(`${label}.${key} must be an octal mode`)
  }
  requireInteger(value.launchSizeBytes, `${label}.launchSizeBytes`, 1, 256 * 1024 * 1024)
  requireInteger(value.sizeBytes, `${label}.sizeBytes`, 1, 256 * 1024 * 1024)
}

function validatePythonEnvironment(value, label) {
  requireClosedObject(value, ['startupPolicy', 'distributions', 'environmentDigest'], label)
  requireDigest(value.environmentDigest, `${label}.environmentDigest`)
  requireClosedObject(value.startupPolicy, [
    'mode',
    'dontWriteBytecode',
    'ignoreEnvironment',
    'noUserSite',
    'pthFilesExecuted',
    'sitecustomizeImported',
    'usercustomizeImported',
    'sitePackagesPathDigest',
  ], `${label}.startupPolicy`)
  if (
    value.startupPolicy.mode !== 'python_isolated_no_site'
    || value.startupPolicy.dontWriteBytecode !== true
    || value.startupPolicy.ignoreEnvironment !== true
    || value.startupPolicy.noUserSite !== true
    || value.startupPolicy.pthFilesExecuted !== false
    || value.startupPolicy.sitecustomizeImported !== false
    || value.startupPolicy.usercustomizeImported !== false
  ) throw new TypeError(`${label}.startupPolicy is invalid`)
  requireDigest(value.startupPolicy.sitePackagesPathDigest, `${label}.startupPolicy.sitePackagesPathDigest`)
  if (!Array.isArray(value.distributions) || value.distributions.length < 1 || value.distributions.length > 128) {
    throw new TypeError(`${label}.distributions must contain 1 to 128 identities`)
  }
  const names = new Set()
  for (const [index, item] of value.distributions.entries()) {
    const itemLabel = `${label}.distributions[${index}]`
    requireClosedObject(item, ['name', 'version', 'fileCount', 'sizeBytes', 'digest'], itemLabel)
    const name = requireBoundedString(item.name, `${itemLabel}.name`, 128)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || names.has(name)) throw new TypeError(`${itemLabel}.name is invalid or duplicated`)
    names.add(name)
    requireBoundedString(item.version, `${itemLabel}.version`, 128)
    requireInteger(item.fileCount, `${itemLabel}.fileCount`, 1, 8192)
    requireInteger(item.sizeBytes, `${itemLabel}.sizeBytes`, 1, 256 * 1024 * 1024)
    requireDigest(item.digest, `${itemLabel}.digest`)
  }
  if (!names.has('miniwdl')) throw new TypeError(`${label}.distributions must include miniwdl`)
  if (computeRunnerDigest({
    startupPolicy: value.startupPolicy,
    distributions: value.distributions,
  }, 'python-environment') !== value.environmentDigest) {
    throw new TypeError(`${label}.environmentDigest is invalid`)
  }
}

function validateImageIdentity(value, label) {
  requireClosedObject(value, ['reference', 'imageId'], label)
  if (typeof value.reference !== 'string' || !PINNED_IMAGE_PATTERN.test(value.reference)) throw new TypeError(`${label}.reference must be digest-pinned`)
  requireDigest(value.imageId, `${label}.imageId`)
}

function validateRunnerIdentity(value) {
  requireClosedObject(value, [
    'backend',
    'policyVersion',
    'miniwdlVersion',
    'pythonVersion',
    'controller',
    'pythonEnvironment',
    'executables',
    'docker',
    'taskImage',
    'supportImage',
    'supportContainerLimits',
    'storage',
  ], '$.runner.identity')
  if (value.backend !== 'dsh_fixture_docker' || value.policyVersion !== DRAFT_TEST_POLICY_VERSION || value.miniwdlVersion !== '1.15.0') {
    throw new TypeError('$.runner.identity backend and pinned versions are invalid')
  }
  requireBoundedString(value.pythonVersion, '$.runner.identity.pythonVersion', 64)
  requireClosedObject(value.controller, ['uid', 'gid', 'network', 'environment', 'limits', 'dockerBroker'], '$.runner.identity.controller')
  requireInteger(value.controller.uid, '$.runner.identity.controller.uid', 1)
  requireInteger(value.controller.gid, '$.runner.identity.controller.gid', 0)
  validateControllerNetwork(value.controller.network, '$.runner.identity.controller.network')
  requireClosedObject(value.controller.environment, ['policy', 'allowedKeys', 'nonEmptyKeys', 'credentialLikeKeys', 'environmentDigest'], '$.runner.identity.controller.environment')
  if (
    value.controller.environment.policy !== 'exact_allowlist'
    || stableStringify(value.controller.environment.allowedKeys) !== stableStringify(['HOME', 'LANG', 'LC_ALL', 'TMPDIR'])
    || stableStringify(value.controller.environment.nonEmptyKeys) !== stableStringify(['HOME', 'LANG', 'LC_ALL', 'TMPDIR'])
    || stableStringify(value.controller.environment.credentialLikeKeys) !== stableStringify([])
  ) throw new TypeError('$.runner.identity.controller.environment is invalid')
  requireDigest(value.controller.environment.environmentDigest, '$.runner.identity.controller.environment.environmentDigest')
  requireClosedObject(value.controller.limits, ['residentMemoryBytes', 'virtualAddressSpaceBytes', 'cpuSeconds', 'additionalProcesses', 'openFiles', 'fileBytes', 'wallTimeMs'], '$.runner.identity.controller.limits')
  requireInteger(value.controller.limits.residentMemoryBytes, '$.runner.identity.controller.limits.residentMemoryBytes', MINIMUM_BUDGETS.memoryBytes, DRAFT_TEST_HARD_LIMITS.memoryBytes)
  requireInteger(value.controller.limits.virtualAddressSpaceBytes, '$.runner.identity.controller.limits.virtualAddressSpaceBytes', MINIMUM_BUDGETS.memoryBytes, DRAFT_TEST_HARD_LIMITS.memoryBytes)
  if (value.controller.limits.virtualAddressSpaceBytes !== value.controller.limits.residentMemoryBytes) throw new TypeError('$.runner.identity.controller.limits.virtualAddressSpaceBytes must equal the hard memory budget')
  requireInteger(value.controller.limits.cpuSeconds, '$.runner.identity.controller.limits.cpuSeconds', 1, Math.ceil(DRAFT_TEST_HARD_LIMITS.wallTimeMs / 1000))
  requireInteger(value.controller.limits.additionalProcesses, '$.runner.identity.controller.limits.additionalProcesses', MINIMUM_BUDGETS.pids, DRAFT_TEST_HARD_LIMITS.pids)
  if (value.controller.limits.openFiles !== 256) throw new TypeError('$.runner.identity.controller.limits.openFiles must equal 256')
  requireInteger(value.controller.limits.fileBytes, '$.runner.identity.controller.limits.fileBytes', MINIMUM_BUDGETS.totalOutputBytes, DRAFT_TEST_HARD_LIMITS.totalOutputBytes)
  requireInteger(value.controller.limits.wallTimeMs, '$.runner.identity.controller.limits.wallTimeMs', MINIMUM_BUDGETS.wallTimeMs, DRAFT_TEST_HARD_LIMITS.wallTimeMs)
  requireClosedObject(value.controller.dockerBroker, ['networkFilterDigest', 'kernelEnforced', 'threadSynchronized', 'limits'], '$.runner.identity.controller.dockerBroker')
  requireDigest(value.controller.dockerBroker.networkFilterDigest, '$.runner.identity.controller.dockerBroker.networkFilterDigest')
  if (
    value.controller.dockerBroker.networkFilterDigest !== value.controller.network.filterDigest
    || value.controller.dockerBroker.kernelEnforced !== true
    || value.controller.dockerBroker.threadSynchronized !== true
  ) throw new TypeError('$.runner.identity.controller.dockerBroker isolation is invalid')
  requireClosedObject(value.controller.dockerBroker.limits, ['virtualAddressSpaceBytes', 'cpuSeconds', 'additionalProcesses', 'openFiles', 'fileBytes'], '$.runner.identity.controller.dockerBroker.limits')
  if (value.controller.dockerBroker.limits.virtualAddressSpaceBytes !== 4 * 1024 * 1024 * 1024) throw new TypeError('$.runner.identity.controller.dockerBroker.limits.virtualAddressSpaceBytes is invalid')
  requireInteger(value.controller.dockerBroker.limits.cpuSeconds, '$.runner.identity.controller.dockerBroker.limits.cpuSeconds', 1, Math.ceil(DRAFT_TEST_HARD_LIMITS.wallTimeMs / 1000))
  if (value.controller.dockerBroker.limits.additionalProcesses !== DRAFT_TEST_DOCKER_BROKER_ADDITIONAL_PROCESSES) throw new TypeError('$.runner.identity.controller.dockerBroker.limits.additionalProcesses is invalid')
  if (value.controller.dockerBroker.limits.openFiles !== 256) throw new TypeError('$.runner.identity.controller.dockerBroker.limits.openFiles must equal 256')
  requireInteger(value.controller.dockerBroker.limits.fileBytes, '$.runner.identity.controller.dockerBroker.limits.fileBytes', MINIMUM_BUDGETS.totalOutputBytes, DRAFT_TEST_HARD_LIMITS.totalOutputBytes)
  validatePythonEnvironment(value.pythonEnvironment, '$.runner.identity.pythonEnvironment')
  requireClosedObject(value.executables, ['python', 'docker', 'wrapper'], '$.runner.identity.executables')
  for (const key of ['python', 'docker', 'wrapper']) validateExecutableIdentity(value.executables[key], `$.runner.identity.executables.${key}`)
  requireClosedObject(value.docker, ['engineId', 'serverVersion', 'cgroupVersion', 'securityOptions'], '$.runner.identity.docker')
  requireBoundedString(value.docker.engineId, '$.runner.identity.docker.engineId', 256)
  requireBoundedString(value.docker.serverVersion, '$.runner.identity.docker.serverVersion', 64)
  if (value.docker.cgroupVersion !== '2') throw new TypeError('$.runner.identity.docker.cgroupVersion must equal 2')
  if (
    !Array.isArray(value.docker.securityOptions)
    || value.docker.securityOptions.length > 32
    || !value.docker.securityOptions.includes('name=apparmor')
    || !value.docker.securityOptions.includes('name=seccomp,profile=builtin')
    || value.docker.securityOptions.some((item) => typeof item !== 'string' || item.length > 256)
  ) throw new TypeError('$.runner.identity.docker.securityOptions are invalid')
  validateImageIdentity(value.taskImage, '$.runner.identity.taskImage')
  validateImageIdentity(value.supportImage, '$.runner.identity.supportImage')
  requireClosedObject(value.supportContainerLimits, ['cpu', 'memoryBytesMaximum', 'pidsMaximum'], '$.runner.identity.supportContainerLimits')
  if (value.supportContainerLimits.cpu !== 1 || value.supportContainerLimits.memoryBytesMaximum !== 128 * 1024 * 1024 || value.supportContainerLimits.pidsMaximum !== 16) {
    throw new TypeError('$.runner.identity.supportContainerLimits are invalid')
  }
  requireClosedObject(value.storage, ['runsRoot', 'fixtureSourceIdentityDigest'], '$.runner.identity.storage')
  requireClosedObject(value.storage.runsRoot, ['device', 'inode', 'uid', 'mode'], '$.runner.identity.storage.runsRoot')
  for (const key of ['device', 'inode', 'uid']) {
    if (typeof value.storage.runsRoot[key] !== 'string' || !/^\d{1,40}$/.test(value.storage.runsRoot[key])) throw new TypeError(`$.runner.identity.storage.runsRoot.${key} is invalid`)
  }
  if (typeof value.storage.runsRoot.mode !== 'string' || !/^[0-7]{3}$/.test(value.storage.runsRoot.mode)) throw new TypeError('$.runner.identity.storage.runsRoot.mode is invalid')
  requireDigest(value.storage.fixtureSourceIdentityDigest, '$.runner.identity.storage.fixtureSourceIdentityDigest')
}

function validateAssertion(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object`)
  if (value.kind === 'value_equals') {
    requireClosedObject(value, ['id', 'kind', 'output', 'expected'], label)
    validateJsonValue(value.expected, `${label}.expected`)
  } else if (value.kind === 'file_digest') {
    requireClosedObject(
      value,
      value.index === undefined
        ? ['id', 'kind', 'output', 'sha256', 'sizeBytes']
        : ['id', 'kind', 'output', 'index', 'sha256', 'sizeBytes'],
      label,
    )
    if (value.index !== undefined) requireInteger(value.index, `${label}.index`, 0, 1023)
    requireDigest(value.sha256, `${label}.sha256`)
    requireInteger(value.sizeBytes, `${label}.sizeBytes`, 0, 16 * 1024 * 1024)
  } else {
    throw new TypeError(`${label}.kind is unsupported`)
  }
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value.id)) throw new TypeError(`${label}.id is invalid`)
  if (typeof value.output !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(value.output)) throw new TypeError(`${label}.output is invalid`)
}

function validateBudgets(value, label = '$.budgets') {
  requireClosedObject(value, Object.keys(DRAFT_TEST_DEFAULT_BUDGETS), label)
  effectiveDraftTestBudgets(value, DRAFT_TEST_HARD_LIMITS)
  return value
}

export function validateDraftTestPlan(value) {
  requireClosedObject(value, ['schemaVersion', 'mission', 'draft', 'fixture', 'runner', 'isolation', 'budgets', 'authorization'], '$')
  if (value.schemaVersion !== DRAFT_TEST_PLAN_SCHEMA_VERSION) throw new TypeError('$.schemaVersion is invalid')
  requireClosedObject(value.mission, ['missionId', 'missionPlanDigest', 'software', 'objective', 'acceptanceCriteria'], '$.mission')
  if (typeof value.mission.missionId !== 'string' || !MISSION_ID_PATTERN.test(value.mission.missionId)) throw new TypeError('$.mission.missionId is invalid')
  requireDigest(value.mission.missionPlanDigest, '$.mission.missionPlanDigest')
  requireClosedObject(value.mission.software, ['name', 'version', 'containerImage'], '$.mission.software')
  requireBoundedString(value.mission.software.name, '$.mission.software.name', 160)
  requireBoundedString(value.mission.software.version, '$.mission.software.version', 128)
  if (typeof value.mission.software.containerImage !== 'string' || !PINNED_IMAGE_PATTERN.test(value.mission.software.containerImage)) throw new TypeError('$.mission.software.containerImage must be digest-pinned')
  requireBoundedString(value.mission.objective, '$.mission.objective', 4000)
  if (!Array.isArray(value.mission.acceptanceCriteria) || value.mission.acceptanceCriteria.length < 1 || value.mission.acceptanceCriteria.length > 16 || value.mission.acceptanceCriteria.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 1000)) throw new TypeError('$.mission.acceptanceCriteria are invalid')

  requireClosedObject(value.draft, ['draftId', 'revision', 'contentDigest', 'validationDigest'], '$.draft')
  if (typeof value.draft.draftId !== 'string' || !DRAFT_ID_PATTERN.test(value.draft.draftId)) throw new TypeError('$.draft.draftId is invalid')
  requireInteger(value.draft.revision, '$.draft.revision', 1, 256)
  requireDigest(value.draft.contentDigest, '$.draft.contentDigest')
  requireDigest(value.draft.validationDigest, '$.draft.validationDigest')

  requireClosedObject(value.fixture, ['id', 'version', 'fixtureDigest', 'totalFileBytes', 'files', 'inputsDigest', 'assertionsDigest', 'assertions'], '$.fixture')
  requireBoundedString(value.fixture.id, '$.fixture.id', 128)
  requireBoundedString(value.fixture.version, '$.fixture.version', 128)
  if (!IDENTIFIER_PATTERN.test(value.fixture.id) || !SEMVER_PATTERN.test(value.fixture.version)) throw new TypeError('$.fixture identity is invalid')
  requireDigest(value.fixture.fixtureDigest, '$.fixture.fixtureDigest')
  requireInteger(value.fixture.totalFileBytes, '$.fixture.totalFileBytes', 0, 64 * 1024 * 1024)
  if (!Array.isArray(value.fixture.files) || value.fixture.files.length < 1 || value.fixture.files.length > 128) throw new TypeError('$.fixture.files are invalid')
  let totalFileBytes = 0
  const fixturePaths = new Set()
  for (const [index, file] of value.fixture.files.entries()) {
    const label = `$.fixture.files[${index}]`
    requireClosedObject(file, ['path', 'sizeBytes', 'sha256'], label)
    requireBoundedString(file.path, `${label}.path`, 240)
    const segments = file.path.split('/')
    if (isAbsolute(file.path) || file.path.includes('\\') || segments.some((item) => item === '' || item === '.' || item === '..') || file.path === 'fixture.json' || fixturePaths.has(file.path)) throw new TypeError(`${label}.path is unsafe or duplicated`)
    fixturePaths.add(file.path)
    requireInteger(file.sizeBytes, `${label}.sizeBytes`, 0, 16 * 1024 * 1024)
    requireDigest(file.sha256, `${label}.sha256`)
    totalFileBytes += file.sizeBytes
  }
  if (totalFileBytes !== value.fixture.totalFileBytes) throw new TypeError('$.fixture.totalFileBytes does not match files')
  requireDigest(value.fixture.inputsDigest, '$.fixture.inputsDigest')
  requireDigest(value.fixture.assertionsDigest, '$.fixture.assertionsDigest')
  if (!Array.isArray(value.fixture.assertions) || value.fixture.assertions.length < 1 || value.fixture.assertions.length > 64) throw new TypeError('$.fixture.assertions are invalid')
  value.fixture.assertions.forEach((assertion, index) => validateAssertion(assertion, `$.fixture.assertions[${index}]`))
  if (new Set(value.fixture.assertions.map((assertion) => assertion.id)).size !== value.fixture.assertions.length) throw new TypeError('$.fixture.assertions contain duplicate ids')
  if (computeDraftTestDigest(value.fixture.assertions, 'fixture-assertions') !== value.fixture.assertionsDigest) throw new TypeError('$.fixture.assertionsDigest is invalid')

  requireClosedObject(value.runner, ['identity', 'runnerDigest'], '$.runner')
  validateRunnerIdentity(value.runner.identity)
  requireDigest(value.runner.runnerDigest, '$.runner.runnerDigest')
  if (computeDraftTestDigest(value.runner.identity, 'runner') !== value.runner.runnerDigest) throw new TypeError('$.runner.runnerDigest is invalid')
  requireClosedObject(value.isolation, ['policy', 'isolationPolicyDigest'], '$.isolation')
  if (stableStringify(value.isolation.policy) !== stableStringify(DRAFT_TEST_ISOLATION_POLICY)) throw new TypeError('$.isolation.policy is invalid')
  if (computeDraftTestDigest(value.isolation.policy, 'isolation-policy') !== value.isolation.isolationPolicyDigest) throw new TypeError('$.isolation.isolationPolicyDigest is invalid')
  validateBudgets(value.budgets)
  requireClosedObject(value.authorization, ['required', 'binding', 'productionExecution', 'workflowPromotion', 'productionAllowlistMutation'], '$.authorization')
  if (stableStringify(value.authorization) !== stableStringify({ required: true, binding: 'planDigest', productionExecution: false, workflowPromotion: false, productionAllowlistMutation: false })) throw new TypeError('$.authorization is invalid')
  if (
    value.runner.identity.taskImage.reference !== value.mission.software.containerImage
    || value.runner.identity.controller.limits.residentMemoryBytes !== value.budgets.memoryBytes
    || value.runner.identity.controller.limits.virtualAddressSpaceBytes !== value.budgets.memoryBytes
    || value.runner.identity.controller.limits.cpuSeconds !== Math.ceil(value.budgets.wallTimeMs / 1000)
    || value.runner.identity.controller.limits.additionalProcesses !== value.budgets.pids
    || value.runner.identity.controller.limits.fileBytes !== value.budgets.totalOutputBytes
    || value.runner.identity.controller.limits.wallTimeMs !== value.budgets.wallTimeMs
    || value.runner.identity.controller.dockerBroker.limits.cpuSeconds !== Math.ceil(value.budgets.wallTimeMs / 1000)
    || value.runner.identity.controller.dockerBroker.limits.additionalProcesses !== DRAFT_TEST_DOCKER_BROKER_ADDITIONAL_PROCESSES
    || value.runner.identity.controller.dockerBroker.limits.fileBytes !== value.budgets.totalOutputBytes
  ) throw new TypeError('$.runner.identity does not match the approved plan budgets or task image')
  return value
}

export function createDraftTestPlan({ mission, draft, fixture, runner, budgets }) {
  if (mission?.ok !== true || mission.status !== 'ready' || mission.phase !== 'validated') {
    throw new TypeError('draft test plan requires an owner-visible ready Mission')
  }
  if (
    mission.draft === null
    || mission.lastValidation === null
    || mission.draft.draftId !== draft.metadata?.draftId
    || mission.draft.revision !== draft.snapshot?.revision
    || mission.draft.contentDigest !== draft.snapshot?.contentDigest
    || mission.lastValidation.revision !== draft.snapshot?.revision
    || mission.lastValidation.contentDigest !== draft.snapshot?.contentDigest
    || mission.lastValidation.valid !== true
  ) {
    throw new TypeError('Mission, validation evidence, and draft revision identity do not match')
  }
  requireDigest(mission.lastValidation.validationDigest, 'validationDigest')
  requireDigest(fixture.fixtureDigest, 'fixtureDigest')
  const normalizedBudgets = effectiveDraftTestBudgets(undefined, budgets)
  const isolationPolicyDigest = computeDraftTestDigest(DRAFT_TEST_ISOLATION_POLICY, 'isolation-policy')
  const runnerIdentity = cloneJson(runner)
  const runnerDigest = computeDraftTestDigest(runnerIdentity, 'runner')
  const plan = deepFreeze({
    schemaVersion: DRAFT_TEST_PLAN_SCHEMA_VERSION,
    mission: {
      missionId: mission.missionId,
      missionPlanDigest: requireDigest(mission.planDigest, 'missionPlanDigest'),
      software: cloneJson(mission.goal.software),
      objective: mission.goal.objective,
      acceptanceCriteria: cloneJson(mission.goal.acceptanceCriteria),
    },
    draft: {
      draftId: draft.metadata.draftId,
      revision: draft.snapshot.revision,
      contentDigest: draft.snapshot.contentDigest,
      validationDigest: mission.lastValidation.validationDigest,
    },
    fixture: {
      id: fixture.descriptor.id,
      version: fixture.descriptor.version,
      fixtureDigest: fixture.fixtureDigest,
      totalFileBytes: fixture.totalFileBytes,
      files: fixture.descriptor.files.map(({ path, sizeBytes, sha256 }) => ({ path, sizeBytes, sha256 })),
      inputsDigest: computeDraftTestDigest(fixture.descriptor.inputs, 'fixture-inputs'),
      assertionsDigest: computeDraftTestDigest(fixture.descriptor.assertions, 'fixture-assertions'),
      assertions: cloneJson(fixture.descriptor.assertions),
    },
    runner: { identity: runnerIdentity, runnerDigest },
    isolation: { policy: cloneJson(DRAFT_TEST_ISOLATION_POLICY), isolationPolicyDigest },
    budgets: cloneJson(normalizedBudgets),
    authorization: {
      required: true,
      binding: 'planDigest',
      productionExecution: false,
      workflowPromotion: false,
      productionAllowlistMutation: false,
    },
  })
  validateDraftTestPlan(plan)
  return deepFreeze({
    ok: true,
    plan,
    planDigest: computeDraftTestDigest(plan, 'plan'),
    error: null,
  })
}

function validateProbe(value, label) {
  requireClosedObject(value, ['id', 'status', 'expected', 'observed'], label)
  requireBoundedString(value.id, `${label}.id`, 128)
  if (!['passed', 'failed'].includes(value.status)) throw new TypeError(`${label}.status is invalid`)
  for (const key of ['expected', 'observed']) {
    if (!['string', 'number', 'boolean'].includes(typeof value[key]) && value[key] !== null) throw new TypeError(`${label}.${key} is invalid`)
    if (typeof value[key] === 'string' && value[key].length > 512) throw new TypeError(`${label}.${key} is too long`)
  }
}

function validateContainerEnvironment(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object`)
  const fixed = {
    HOME: '/tmp/home',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  }
  const keys = Object.keys(value)
  if (keys.length < 5 || keys.length > 133) throw new TypeError(`${label} has an invalid key count`)
  for (const [key, observed] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof observed !== 'string') throw new TypeError(`${label}.${key} is invalid`)
    if (Object.hasOwn(fixed, key) ? observed !== fixed[key] : observed !== '') throw new TypeError(`${label}.${key} contains an unapproved value`)
  }
  for (const [key, expected] of Object.entries(fixed)) {
    if (value[key] !== expected) throw new TypeError(`${label}.${key} is missing or invalid`)
  }
}

function validateContainerControls(value, label) {
  requireClosedObject(value, [
    'networkMode', 'readonlyRootfs', 'capDrop', 'securityOpt', 'pidsLimit', 'nanoCpus',
    'memory', 'memorySwap', 'ipcMode', 'pidMode', 'cgroupnsMode', 'devices',
    'deviceRequests', 'supplementaryGroups', 'logDriver', 'apparmorProfile', 'environment',
    'tmpfs', 'ulimits', 'mounts', 'outputStorageDigest',
  ], label)
  if (
    value.networkMode !== 'none'
    || value.readonlyRootfs !== true
    || stableStringify(value.capDrop) !== stableStringify(['ALL'])
    || stableStringify(value.securityOpt) !== stableStringify(['apparmor=docker-default', 'no-new-privileges=true', 'seccomp=builtin'])
    || value.ipcMode !== 'none'
    || !['', null].includes(value.pidMode)
    || value.cgroupnsMode !== 'private'
    || value.devices !== 0
    || value.deviceRequests !== 0
    || value.supplementaryGroups !== 0
    || value.logDriver !== 'none'
    || value.apparmorProfile !== 'docker-default'
  ) throw new TypeError(`${label} isolation controls are invalid`)
  requireInteger(value.pidsLimit, `${label}.pidsLimit`, MINIMUM_BUDGETS.pids, DRAFT_TEST_HARD_LIMITS.pids)
  requireInteger(value.nanoCpus, `${label}.nanoCpus`, 1_000_000_000, 4_000_000_000)
  requireInteger(value.memory, `${label}.memory`, MINIMUM_BUDGETS.memoryBytes, DRAFT_TEST_HARD_LIMITS.memoryBytes)
  requireInteger(value.memorySwap, `${label}.memorySwap`, MINIMUM_BUDGETS.memoryBytes, DRAFT_TEST_HARD_LIMITS.memoryBytes)
  validateContainerEnvironment(value.environment, `${label}.environment`)
  requireClosedObject(value.tmpfs, ['/tmp'], `${label}.tmpfs`)
  requireBoundedString(value.tmpfs['/tmp'], `${label}.tmpfs./tmp`, 256)
  if (!Array.isArray(value.ulimits) || value.ulimits.length !== 2) throw new TypeError(`${label}.ulimits are invalid`)
  for (const [index, limit] of value.ulimits.entries()) {
    requireClosedObject(limit, ['name', 'soft', 'hard'], `${label}.ulimits[${index}]`)
    if (!['fsize', 'nofile'].includes(limit.name) || !Number.isSafeInteger(limit.soft) || limit.soft !== limit.hard) throw new TypeError(`${label}.ulimits[${index}] is invalid`)
  }
  if (!Array.isArray(value.mounts) || value.mounts.length < 2 || value.mounts.length > 130) throw new TypeError(`${label}.mounts are invalid`)
  for (const [index, mount] of value.mounts.entries()) {
    const mountLabel = `${label}.mounts[${index}]`
    requireClosedObject(mount, ['type', 'destination', 'rw', 'propagation'], mountLabel)
    if (!['bind', 'volume'].includes(mount.type) || typeof mount.destination !== 'string' || !mount.destination.startsWith('/mnt/miniwdl_task_container') || typeof mount.rw !== 'boolean' || !['', 'rprivate'].includes(mount.propagation)) throw new TypeError(`${mountLabel} is invalid`)
  }
  requireDigest(value.outputStorageDigest, `${label}.outputStorageDigest`)
}

function validateAssertionResult(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object`)
  const common = ['id', 'kind', 'output', 'status', 'code', 'message']
  const allowed = value.kind === 'value_equals'
    ? [...common, 'expectedDigest', 'actualDigest']
    : [...common, 'index', 'expected', 'actual']
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new TypeError(`${label} contains an unsupported property`)
  for (const key of common) requireBoundedString(value[key], `${label}.${key}`, key === 'message' ? 1024 : 240)
  if (!['value_equals', 'file_digest'].includes(value.kind) || !['passed', 'failed'].includes(value.status)) throw new TypeError(`${label} kind or status is invalid`)
  if (value.kind === 'value_equals') {
    if (value.expectedDigest !== undefined) requireDigest(value.expectedDigest, `${label}.expectedDigest`)
    if (value.actualDigest !== undefined) requireDigest(value.actualDigest, `${label}.actualDigest`)
  } else {
    if (value.index !== undefined) requireInteger(value.index, `${label}.index`, 0, 1023)
    for (const key of ['expected', 'actual']) {
      if (value[key] === undefined) continue
      requireClosedObject(value[key], ['sizeBytes', 'sha256'], `${label}.${key}`)
      requireInteger(value[key].sizeBytes, `${label}.${key}.sizeBytes`, 0, 16 * 1024 * 1024)
      if (value[key].sha256 !== null) requireDigest(value[key].sha256, `${label}.${key}.sha256`)
    }
  }
}

function validateResources(value, label) {
  const successKeys = ['cleanupVerified', 'cleanupMode', 'containersRemaining', 'volumesRemaining', 'removedContainers', 'removedVolumes', 'controllerTerminationVerified', 'controllerTerminationMode', 'cleanupDigest']
  const failureKeys = [...successKeys, 'failureCode']
  requireClosedObject(value, value.cleanupVerified === true ? successKeys : failureKeys, label)
  if (value.cleanupMode !== 'exact_labels_and_absence_probe') throw new TypeError(`${label}.cleanupMode is invalid`)
  requireBoolean(value.controllerTerminationVerified, `${label}.controllerTerminationVerified`)
  if (![
    'live_handle_exit_verified',
    'exact_identity_already_absent',
    'exact_identity_terminated',
    'exact_identity_killed',
    'no_controller_started',
    'controller_termination_unverified',
  ].includes(value.controllerTerminationMode)) throw new TypeError(`${label}.controllerTerminationMode is invalid`)
  requireInteger(value.removedContainers, `${label}.removedContainers`, 0, 256)
  requireInteger(value.removedVolumes, `${label}.removedVolumes`, 0, 256)
  if (value.cleanupVerified === true) {
    if (value.containersRemaining !== 0 || value.volumesRemaining !== 0) throw new TypeError(`${label} successful cleanup must prove absence`)
    if (value.controllerTerminationVerified !== true) throw new TypeError(`${label} successful cleanup must prove controller termination`)
  } else {
    if (value.containersRemaining !== null || value.volumesRemaining !== null) throw new TypeError(`${label} failed cleanup counters must be unknown`)
    requireBoundedString(value.failureCode, `${label}.failureCode`, 128)
  }
  requireDigest(value.cleanupDigest, `${label}.cleanupDigest`)
  const basis = cloneJson(value)
  delete basis.cleanupDigest
  if (computeDraftTestDigest(basis, 'resource-cleanup') !== value.cleanupDigest) throw new TypeError(`${label}.cleanupDigest is invalid`)
}

function validateDraftTestEvidenceBasis(value) {
  requireClosedObject(value, [
    'schemaVersion', 'testId', 'planDigest', 'status', 'startedAt', 'finishedAt', 'identities',
    'budgets', 'isolation', 'exit', 'logs', 'artifacts', 'assertionEvidence', 'resources',
    'failure', 'passed', 'capabilities',
  ], '$')
  if (value.schemaVersion !== DRAFT_TEST_EVIDENCE_SCHEMA_VERSION || typeof value.testId !== 'string' || !TEST_ID_PATTERN.test(value.testId)) throw new TypeError('draft test evidence identity is invalid')
  requireDigest(value.planDigest, '$.planDigest')
  if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(value.status)) throw new TypeError('$.status is invalid')
  for (const key of ['startedAt', 'finishedAt']) {
    if (typeof value[key] !== 'string' || Number.isNaN(Date.parse(value[key]))) throw new TypeError(`$.${key} is invalid`)
  }
  requireClosedObject(value.identities, ['missionId', 'draftId', 'revision', 'contentDigest', 'validationDigest', 'fixtureDigest', 'runnerDigest', 'isolationPolicyDigest', 'containerImages'], '$.identities')
  if (typeof value.identities.missionId !== 'string' || !MISSION_ID_PATTERN.test(value.identities.missionId)) throw new TypeError('$.identities.missionId is invalid')
  if (typeof value.identities.draftId !== 'string' || !DRAFT_ID_PATTERN.test(value.identities.draftId)) throw new TypeError('$.identities.draftId is invalid')
  requireInteger(value.identities.revision, '$.identities.revision', 1, 256)
  for (const key of ['contentDigest', 'validationDigest', 'fixtureDigest', 'runnerDigest', 'isolationPolicyDigest']) requireDigest(value.identities[key], `$.identities.${key}`)
  if (!Array.isArray(value.identities.containerImages) || value.identities.containerImages.length < 1 || value.identities.containerImages.length > 128 || value.identities.containerImages.some((image) => typeof image !== 'string' || !PINNED_IMAGE_PATTERN.test(image))) throw new TypeError('$.identities.containerImages are invalid')
  validateBudgets(value.budgets)

  requireClosedObject(value.isolation, ['verified', 'probeDigest', 'probes', 'containers', 'controller'], '$.isolation')
  requireBoolean(value.isolation.verified, '$.isolation.verified')
  requireDigest(value.isolation.probeDigest, '$.isolation.probeDigest')
  if (!Array.isArray(value.isolation.probes) || value.isolation.probes.length < 1 || value.isolation.probes.length > 64) throw new TypeError('$.isolation.probes are invalid')
  value.isolation.probes.forEach((probe, index) => validateProbe(probe, `$.isolation.probes[${index}]`))
  if (!Array.isArray(value.isolation.containers) || value.isolation.containers.length > 64) throw new TypeError('$.isolation.containers are invalid')
  for (const [index, container] of value.isolation.containers.entries()) {
    const label = `$.isolation.containers[${index}]`
    requireClosedObject(container, ['task', 'image', 'imageId', 'containerConfigDigest', 'containerControls', 'containerControlsDigest', 'outputManifestDigest'], label)
    requireBoundedString(container.task, `${label}.task`, 256)
    if (typeof container.image !== 'string' || !PINNED_IMAGE_PATTERN.test(container.image)) throw new TypeError(`${label}.image is invalid`)
    for (const key of ['imageId', 'containerConfigDigest', 'containerControlsDigest', 'outputManifestDigest']) requireDigest(container[key], `${label}.${key}`)
    validateContainerControls(container.containerControls, `${label}.containerControls`)
  }
  if (value.isolation.controller !== null) {
    requireClosedObject(value.isolation.controller, ['environment', 'limits', 'network', 'processBaseline', 'dockerBroker', 'runtimeEnvironmentDigest', 'wrapperDigest', 'controllerGuardDigest'], '$.isolation.controller')
    requireClosedObject(value.isolation.controller.environment, ['keys', 'nonEmptyKeys', 'credentialLikeKeys', 'environmentDigest'], '$.isolation.controller.environment')
    if (
      stableStringify(value.isolation.controller.environment.keys) !== stableStringify(['HOME', 'LANG', 'LC_ALL', 'TMPDIR'])
      || stableStringify(value.isolation.controller.environment.nonEmptyKeys) !== stableStringify(['HOME', 'LANG', 'LC_ALL', 'TMPDIR'])
      || stableStringify(value.isolation.controller.environment.credentialLikeKeys) !== stableStringify([])
    ) throw new TypeError('$.isolation.controller.environment is invalid')
    requireDigest(value.isolation.controller.environment.environmentDigest, '$.isolation.controller.environment.environmentDigest')
    requireClosedObject(value.isolation.controller.network, ['policy', 'architecture', 'filterDigest', 'kernelEnforced', 'threadSynchronized', 'outboundDenied', 'nameResolutionDenied', 'hostCanaryConnections'], '$.isolation.controller.network')
    if (value.isolation.controller.network.policy !== CONTROLLER_NETWORK_POLICY || !['x86_64', 'aarch64'].includes(value.isolation.controller.network.architecture) || value.isolation.controller.network.kernelEnforced !== true || value.isolation.controller.network.threadSynchronized !== true || value.isolation.controller.network.outboundDenied !== true || value.isolation.controller.network.nameResolutionDenied !== true || value.isolation.controller.network.hostCanaryConnections !== 1) throw new TypeError('$.isolation.controller.network is invalid')
    requireDigest(value.isolation.controller.network.filterDigest, '$.isolation.controller.network.filterDigest')
    requireClosedObject(value.isolation.controller.limits, ['addressSpace', 'residentMemory', 'cpuSeconds', 'processes', 'openFiles', 'fileBytes'], '$.isolation.controller.limits')
    for (const [key, pair] of Object.entries(value.isolation.controller.limits).filter(([key]) => key !== 'residentMemory')) {
      requireClosedObject(pair, ['soft', 'hard'], `$.isolation.controller.limits.${key}`)
      requireInteger(pair.soft, `$.isolation.controller.limits.${key}.soft`, 1)
      if (pair.hard !== pair.soft) throw new TypeError(`$.isolation.controller.limits.${key} is invalid`)
    }
    requireClosedObject(value.isolation.controller.limits.residentMemory, ['maximumBytes', 'enforcement', 'intervalMs'], '$.isolation.controller.limits.residentMemory')
    requireInteger(value.isolation.controller.limits.residentMemory.maximumBytes, '$.isolation.controller.limits.residentMemory.maximumBytes', MINIMUM_BUDGETS.memoryBytes, DRAFT_TEST_HARD_LIMITS.memoryBytes)
    if (value.isolation.controller.limits.residentMemory.enforcement !== 'rlimit_as_hard_with_proc_rss_watchdog' || value.isolation.controller.limits.residentMemory.intervalMs !== 5) throw new TypeError('$.isolation.controller.limits.residentMemory is invalid')
    requireInteger(value.isolation.controller.processBaseline, '$.isolation.controller.processBaseline', 1)
    requireClosedObject(value.isolation.controller.dockerBroker, ['networkFilterDigest', 'kernelEnforced', 'threadSynchronized', 'limits', 'processBaseline'], '$.isolation.controller.dockerBroker')
    requireDigest(value.isolation.controller.dockerBroker.networkFilterDigest, '$.isolation.controller.dockerBroker.networkFilterDigest')
    if (value.isolation.controller.dockerBroker.kernelEnforced !== true || value.isolation.controller.dockerBroker.threadSynchronized !== true) throw new TypeError('$.isolation.controller.dockerBroker isolation is invalid')
    requireInteger(value.isolation.controller.dockerBroker.processBaseline, '$.isolation.controller.dockerBroker.processBaseline', 1)
    requireClosedObject(value.isolation.controller.dockerBroker.limits, ['addressSpace', 'cpuSeconds', 'processes', 'openFiles', 'fileBytes'], '$.isolation.controller.dockerBroker.limits')
    for (const [key, pair] of Object.entries(value.isolation.controller.dockerBroker.limits)) {
      requireClosedObject(pair, ['soft', 'hard'], `$.isolation.controller.dockerBroker.limits.${key}`)
      requireInteger(pair.soft, `$.isolation.controller.dockerBroker.limits.${key}.soft`, 1)
      if (pair.hard !== pair.soft) throw new TypeError(`$.isolation.controller.dockerBroker.limits.${key} is invalid`)
    }
    for (const key of ['runtimeEnvironmentDigest', 'wrapperDigest', 'controllerGuardDigest']) requireDigest(value.isolation.controller[key], `$.isolation.controller.${key}`)
    if (
      value.isolation.controller.limits.residentMemory.maximumBytes !== value.budgets.memoryBytes
      || value.isolation.controller.limits.addressSpace.soft !== value.budgets.memoryBytes
      || value.isolation.controller.limits.cpuSeconds.soft > Math.ceil(value.budgets.wallTimeMs / 1000)
      || value.isolation.controller.limits.processes.soft - value.isolation.controller.processBaseline !== value.budgets.pids
      || value.isolation.controller.limits.openFiles.soft > 256
      || value.isolation.controller.limits.fileBytes.soft > value.budgets.totalOutputBytes
      || value.isolation.controller.dockerBroker.limits.addressSpace.soft !== 4 * 1024 * 1024 * 1024
      || value.isolation.controller.dockerBroker.limits.cpuSeconds.soft > Math.ceil(value.budgets.wallTimeMs / 1000)
      || value.isolation.controller.dockerBroker.limits.processes.soft - value.isolation.controller.dockerBroker.processBaseline !== DRAFT_TEST_DOCKER_BROKER_ADDITIONAL_PROCESSES
      || value.isolation.controller.dockerBroker.limits.openFiles.soft > 256
      || value.isolation.controller.dockerBroker.limits.fileBytes.soft > value.budgets.totalOutputBytes
    ) throw new TypeError('$.isolation.controller limits do not match evidence budgets')
  } else if (value.isolation.verified) {
    throw new TypeError('verified isolation evidence requires controller guard evidence')
  }

  requireClosedObject(value.exit, ['exitCode', 'signal', 'timedOut', 'cancelled', 'ambiguous'], '$.exit')
  if (value.exit.exitCode !== null && !Number.isInteger(value.exit.exitCode)) throw new TypeError('$.exit.exitCode is invalid')
  if (value.exit.signal !== null && (typeof value.exit.signal !== 'string' || value.exit.signal.length > 64)) throw new TypeError('$.exit.signal is invalid')
  for (const key of ['timedOut', 'cancelled', 'ambiguous']) requireBoolean(value.exit[key], `$.exit.${key}`)
  requireClosedObject(value.logs, ['stdout', 'stderr'], '$.logs')
  for (const key of ['stdout', 'stderr']) {
    const stream = value.logs[key]
    requireClosedObject(stream, ['captured', 'capturedBytes', 'observedBytes', 'sha256', 'truncated'], `$.logs.${key}`)
    if (typeof stream.captured !== 'string' || Buffer.byteLength(stream.captured, 'utf8') !== stream.capturedBytes) throw new TypeError(`$.logs.${key}.captured is invalid`)
    requireInteger(stream.capturedBytes, `$.logs.${key}.capturedBytes`, 0, DRAFT_TEST_HARD_LIMITS.logBytes)
    requireInteger(stream.observedBytes, `$.logs.${key}.observedBytes`, 0, DRAFT_TEST_HARD_LIMITS.totalOutputBytes)
    requireDigest(stream.sha256, `$.logs.${key}.sha256`)
    requireBoolean(stream.truncated, `$.logs.${key}.truncated`)
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length > DRAFT_TEST_HARD_LIMITS.artifactCount) throw new TypeError('$.artifacts are invalid')
  for (const [index, artifact] of value.artifacts.entries()) {
    const label = `$.artifacts[${index}]`
    requireClosedObject(artifact, ['output', 'ordinal', 'relativePath', 'sizeBytes', 'sha256'], label)
    requireBoundedString(artifact.output, `${label}.output`, 240)
    requireInteger(artifact.ordinal, `${label}.ordinal`, 0, 1023)
    requireBoundedString(artifact.relativePath, `${label}.relativePath`, 4096)
    requireInteger(artifact.sizeBytes, `${label}.sizeBytes`, 0, DRAFT_TEST_HARD_LIMITS.artifactBytes)
    requireDigest(artifact.sha256, `${label}.sha256`)
  }
  requireClosedObject(value.assertionEvidence, ['schemaVersion', 'passed', 'assertions', 'executableAssertions'], '$.assertionEvidence')
  if (value.assertionEvidence.schemaVersion !== '1' || value.assertionEvidence.executableAssertions !== false) throw new TypeError('$.assertionEvidence metadata are invalid')
  requireBoolean(value.assertionEvidence.passed, '$.assertionEvidence.passed')
  if (!Array.isArray(value.assertionEvidence.assertions) || value.assertionEvidence.assertions.length > 64) throw new TypeError('$.assertionEvidence.assertions are invalid')
  value.assertionEvidence.assertions.forEach((assertion, index) => validateAssertionResult(assertion, `$.assertionEvidence.assertions[${index}]`))
  if (new Set(value.assertionEvidence.assertions.map((assertion) => assertion.id)).size !== value.assertionEvidence.assertions.length) throw new TypeError('$.assertionEvidence.assertions contain duplicate ids')
  validateResources(value.resources, '$.resources')
  if (value.failure !== null) {
    requireClosedObject(value.failure, ['code', 'message', 'failureFingerprint', 'automaticRetry'], '$.failure')
    requireBoundedString(value.failure.code, '$.failure.code', 128)
    requireBoundedString(value.failure.message, '$.failure.message', 512)
    requireDigest(value.failure.failureFingerprint, '$.failure.failureFingerprint')
    if (value.failure.automaticRetry !== false) throw new TypeError('$.failure.automaticRetry must be false')
  }
  requireBoolean(value.passed, '$.passed')
  requireClosedObject(value.capabilities, ['isolatedDraftTest', 'productionExecution', 'workflowPromotion', 'productionAllowlistMutation'], '$.capabilities')
  if (stableStringify(value.capabilities) !== stableStringify({ isolatedDraftTest: true, productionExecution: false, workflowPromotion: false, productionAllowlistMutation: false })) throw new TypeError('$.capabilities are invalid')
  const artifactBytes = value.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0)
  if (value.artifacts.length > value.budgets.artifactCount || artifactBytes > value.budgets.totalOutputBytes || value.artifacts.some((artifact) => artifact.sizeBytes > value.budgets.artifactBytes)) throw new TypeError('$.artifacts exceed evidence budgets')
  if (new Set(value.identities.containerImages).size !== value.identities.containerImages.length) throw new TypeError('$.identities.containerImages contain duplicates')
  if (Date.parse(value.finishedAt) < Date.parse(value.startedAt)) throw new TypeError('$.finishedAt precedes $.startedAt')
  if (value.passed && (value.status !== 'completed' || value.failure !== null || !value.isolation.verified || !value.assertionEvidence.passed || !value.resources.cleanupVerified || value.exit.exitCode !== 0 || value.exit.signal !== null || value.exit.timedOut || value.exit.cancelled || value.exit.ambiguous)) throw new TypeError('passing draft test evidence is internally inconsistent')
  if (!value.passed && value.failure === null) throw new TypeError('non-passing draft test evidence requires failure evidence')
  return value
}

export function validateDraftTestEvidence(value) {
  if (!isPlainObject(value)) throw new TypeError('draft test evidence must be an object')
  requireClosedObject(value, [
    'schemaVersion', 'testId', 'planDigest', 'status', 'startedAt', 'finishedAt', 'identities',
    'budgets', 'isolation', 'exit', 'logs', 'artifacts', 'assertionEvidence', 'resources',
    'failure', 'passed', 'capabilities', 'evidenceDigest',
  ], '$')
  const basis = cloneJson(value)
  delete basis.evidenceDigest
  validateDraftTestEvidenceBasis(basis)
  requireDigest(value.evidenceDigest, '$.evidenceDigest')
  if (computeDraftTestDigest(basis, 'evidence') !== value.evidenceDigest) {
    throw new TypeError('$.evidenceDigest is invalid')
  }
  return value
}

export function sealDraftTestEvidence(value) {
  if (!isPlainObject(value)) throw new TypeError('draft test evidence must be an object')
  const basis = cloneJson(value)
  delete basis.evidenceDigest
  if (basis.schemaVersion !== DRAFT_TEST_EVIDENCE_SCHEMA_VERSION) {
    throw new TypeError(`draft test evidence schemaVersion must equal ${DRAFT_TEST_EVIDENCE_SCHEMA_VERSION}`)
  }
  validateDraftTestEvidenceBasis(basis)
  return deepFreeze({
    ...basis,
    evidenceDigest: computeDraftTestDigest(basis, 'evidence'),
  })
}
