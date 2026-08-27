import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

import {
  DRAFT_TEST_EVIDENCE_SCHEMA_VERSION,
  DRAFT_TEST_DOCKER_BROKER_ADDITIONAL_PROCESSES,
  DRAFT_TEST_POLICY_VERSION,
  computeDraftTestDigest,
  createDraftTestPlan,
  effectiveDraftTestBudgets,
  parseDraftTestConfig,
  sealDraftTestEvidence,
} from './draft-test-contract.js'
import { computeDraftContentDigest } from './draft-store.js'
import { evaluateFixtureAssertions } from './fixture-assertions.js'
import { resolveFixtureBundle } from './fixture-bundle.js'
import { isSafeBundlePath } from './wdl-bundle.js'

export const DRAFT_TEST_RECORD_SCHEMA_VERSION = '1'
export const DRAFT_TEST_REPORT_SCHEMA_VERSION = '1'

const TEST_ID_PATTERN = /^test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const PINNED_IMAGE_PATTERN = /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/
const SAFE_PATH_PATTERN = /^[A-Za-z0-9_./:+@=-]+$/
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const NON_TERMINAL_STATUSES = new Set(['prepared', 'running', 'stopping'])
const MAX_OWNER_SESSION_BYTES = 512
const MAX_OWNER_TESTS = 128
const MAX_OWNER_ENTRIES = 512
const MAX_RECORD_BYTES = 12 * 1024 * 1024
const MAX_RUNNER_OUTPUT_BYTES = 256 * 1024
const MAX_RUNNER_EVIDENCE_BYTES = 2 * 1024 * 1024
const MAX_OUTPUTS_BYTES = 2 * 1024 * 1024
const MAX_ARTIFACT_PATH_BYTES = 4096
const RUNNER_PROBE_TIMEOUT_MS = 15_000
const RESOURCE_CLEANUP_TIMEOUT_MS = 30_000
const PROCESS_GRACE_MS = 10_000
const RECOVERY_PROCESS_GRACE_MS = 2_000
const RECOVERY_POLL_MS = 25
const MAX_RECOVERY_OWNERS = 512
const MAX_RECOVERY_TESTS = 4096
const TASK_CONTAINER_ROOT = '/mnt/miniwdl_task_container'
const CONTROLLER_ENVIRONMENT_BASIS = Object.freeze({
  HOME: '$RUN/controller-home',
  TMPDIR: '/tmp',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
})
const CONTROLLER_NETWORK_POLICY = 'seccomp_deny_non_unix_sockets_before_wdl_load'
const REQUIRED_ISOLATION_PROBES = Object.freeze([
  'ambient_credentials_absent',
  'bridge_gateway',
  'cap_eff',
  'credential_paths_absent',
  'controller_name_resolution_denied',
  'controller_network_denied',
  'docker_socket_absent',
  'egress',
  'fixture_matches',
  'fixture_sha256',
  'host_canary_connections',
  'host_loopback',
  'interfaces',
  'loopback_positive',
  'no_new_privs',
  'root_write',
  'tmpfs_write',
])
const WRAPPER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../runner/dsh_fixture_runner.py',
)

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
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

function runnerDigest(value, domain) {
  const hash = createHash('sha256')
  hash.update(`dsh-bio-fixture-runner-${domain}-v1\n`, 'utf8')
  hash.update(stableStringify(value), 'utf8')
  return `sha256:${hash.digest('hex')}`
}

function parseLinuxProcStat(text, expectedPid) {
  if (typeof text !== 'string' || text.length > 4096) return null
  const openIndex = text.indexOf('(')
  const closeIndex = text.lastIndexOf(')')
  if (openIndex < 1 || closeIndex <= openIndex) return null
  const pid = Number(text.slice(0, openIndex).trim())
  const fields = text.slice(closeIndex + 1).trim().split(/\s+/)
  const processGroupId = Number(fields[2])
  const sessionId = Number(fields[3])
  const startTimeTicks = fields[19]
  if (
    pid !== expectedPid
    || fields.length < 20
    || !Number.isSafeInteger(processGroupId)
    || !Number.isSafeInteger(sessionId)
    || typeof startTimeTicks !== 'string'
    || !/^\d{1,40}$/.test(startTimeTicks)
  ) return null
  return {
    pid,
    state: fields[0],
    processGroupId,
    sessionId,
    startTimeTicks,
  }
}

function controllerPathDigest(path) {
  return computeDraftTestDigest(path, 'controller-executable-path')
}

function controllerCommandDigest(argv) {
  return computeDraftTestDigest(argv, 'controller-command-line')
}

async function linuxControllerIdentity(pid, expectedArgv = null) {
  if (process.platform !== 'linux' || !Number.isSafeInteger(pid) || pid < 2) return null
  let statText
  let commandLine
  let executablePath
  let bootId
  let processMetadata
  try {
    [statText, commandLine, executablePath, bootId, processMetadata] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile(`/proc/${pid}/cmdline`),
      readlink(`/proc/${pid}/exe`),
      readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      lstat(`/proc/${pid}`, { bigint: true }),
    ])
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error?.code)) return null
    throw error
  }
  const parsed = parseLinuxProcStat(statText, pid)
  if (parsed === null || parsed.state === 'Z' || commandLine.length > 1024 * 1024) return null
  const argv = commandLine.toString('utf8').split('\0')
  if (argv.at(-1) === '') argv.pop()
  if (
    argv.length < 1
    || argv.length > 256
    || argv.some((item) => item.length < 1 || Buffer.byteLength(item, 'utf8') > 16 * 1024)
  ) return null
  if (expectedArgv !== null && stableStringify(argv) !== stableStringify(expectedArgv)) {
    throw new DraftTestOperationError(
      'controller_identity_unavailable',
      'spawned controller command line did not match the exact approved launch',
    )
  }
  const expectedExecutable = expectedArgv === null ? null : await realpath(expectedArgv[0])
  if (expectedExecutable !== null && executablePath !== expectedExecutable) {
    throw new DraftTestOperationError(
      'controller_identity_unavailable',
      'spawned controller executable did not match the exact approved launch',
    )
  }
  if (parsed.processGroupId !== pid || parsed.sessionId !== pid) {
    throw new DraftTestOperationError(
      'controller_identity_unavailable',
      'spawned controller was not the leader of its isolated process group and session',
    )
  }
  return {
    schemaVersion: '1',
    pid,
    startTimeTicks: parsed.startTimeTicks,
    processGroupId: parsed.processGroupId,
    sessionId: parsed.sessionId,
    uid: processMetadata.uid.toString(),
    bootIdDigest: computeDraftTestDigest(bootId.trim(), 'controller-boot-id'),
    executablePathDigest: controllerPathDigest(executablePath),
    commandLineDigest: controllerCommandDigest(argv),
  }
}

function validControllerIdentity(identity) {
  return (
    isPlainObject(identity)
    && identity.schemaVersion === '1'
    && Number.isSafeInteger(identity.pid)
    && identity.pid >= 2
    && identity.processGroupId === identity.pid
    && identity.sessionId === identity.pid
    && typeof identity.startTimeTicks === 'string'
    && /^\d{1,40}$/.test(identity.startTimeTicks)
    && typeof identity.uid === 'string'
    && /^\d{1,40}$/.test(identity.uid)
    && ['bootIdDigest', 'executablePathDigest', 'commandLineDigest']
      .every((key) => typeof identity[key] === 'string' && DIGEST_PATTERN.test(identity[key]))
  )
}

function sameControllerIdentity(left, right) {
  return validControllerIdentity(left) && stableStringify(left) === stableStringify(right)
}

async function linuxProcessGroupHasLiveMembers(processGroupId) {
  if (process.platform !== 'linux' || !Number.isSafeInteger(processGroupId) || processGroupId < 2) {
    return false
  }
  let entries = 0
  const directory = await opendir('/proc')
  for await (const entry of directory) {
    if (!/^\d+$/.test(entry.name)) continue
    entries += 1
    if (entries > 1_000_000) {
      throw new DraftTestOperationError(
        'controller_termination_unverified',
        'process table exceeded the bounded recovery scan',
      )
    }
    const pid = Number(entry.name)
    const parsed = await readFile(`/proc/${pid}/stat`, 'utf8')
      .then((value) => parseLinuxProcStat(value, pid), () => null)
    if (parsed?.processGroupId === processGroupId && parsed.state !== 'Z') return true
  }
  return false
}

async function terminateLinuxController(identity) {
  if (!validControllerIdentity(identity)) {
    throw new DraftTestOperationError(
      'controller_termination_unverified',
      'persisted controller identity is invalid',
    )
  }
  const inspect = () => linuxControllerIdentity(identity.pid)
  const absence = async () => {
    const current = await inspect()
    const groupLive = await linuxProcessGroupHasLiveMembers(identity.processGroupId)
    if (sameControllerIdentity(current, identity)) return false
    if (groupLive) {
      throw new DraftTestOperationError(
        'controller_termination_unverified',
        'controller identity changed while its process group remained live',
      )
    }
    return true
  }
  if (await absence()) {
    return { verified: true, mode: 'exact_identity_already_absent' }
  }
  const signalExactGroup = async (signal) => {
    const current = await inspect()
    if (!sameControllerIdentity(current, identity)) return false
    try {
      process.kill(-identity.processGroupId, signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
    return true
  }
  await signalExactGroup('SIGTERM')
  let deadline = Date.now() + RECOVERY_PROCESS_GRACE_MS
  while (Date.now() < deadline) {
    if (await absence()) return { verified: true, mode: 'exact_identity_terminated' }
    await delay(RECOVERY_POLL_MS)
  }
  if (!await signalExactGroup('SIGKILL')) {
    if (await absence()) return { verified: true, mode: 'exact_identity_terminated' }
    throw new DraftTestOperationError(
      'controller_termination_unverified',
      'controller identity changed before bounded termination escalation',
    )
  }
  deadline = Date.now() + RECOVERY_PROCESS_GRACE_MS
  while (Date.now() < deadline) {
    if (await absence()) return { verified: true, mode: 'exact_identity_killed' }
    await delay(RECOVERY_POLL_MS)
  }
  throw new DraftTestOperationError(
    'controller_termination_unverified',
    'exact persisted controller process group remained live after bounded termination',
  )
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
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('draft test operation was aborted')
  error.name = 'AbortError'
  throw error
}

function validateOwnerSession(value) {
  if (
    typeof value !== 'string'
    || Buffer.byteLength(value, 'utf8') < 1
    || Buffer.byteLength(value, 'utf8') > MAX_OWNER_SESSION_BYTES
  ) {
    throw new DraftTestOperationError(
      'draft_test_owner_required',
      'isolated draft testing requires a bounded owning DSH agent session',
    )
  }
  return value
}

function validateTestId(value) {
  if (typeof value !== 'string' || !TEST_ID_PATTERN.test(value)) {
    throw new DraftTestOperationError(
      'invalid_draft_test_id',
      'testId must be a dsh-bio-workflows draft-test UUID',
    )
  }
  return value
}

function currentUid() {
  return typeof process.getuid === 'function' ? BigInt(process.getuid()) : null
}

function currentGid() {
  return typeof process.getgid === 'function' ? process.getgid() : null
}

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message }, ...details }
}

export class DraftTestOperationError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DraftTestOperationError'
    this.code = code
    this.details = details
  }
}

function operationFailure(error) {
  if (error instanceof DraftTestOperationError) {
    return failure(error.code, error.message, error.details)
  }
  if (error?.name === 'AbortError') throw error
  return failure(
    'draft_test_operation_failed',
    'isolated draft-test preparation failed closed; no test was started',
  )
}

async function inspectPrivateDirectory(path, code, writable = false) {
  let initial
  try {
    initial = await lstat(path, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new DraftTestOperationError(code, 'configured isolated draft-test storage is unavailable')
    }
    throw error
  }
  if (!initial.isDirectory() || initial.isSymbolicLink()) {
    throw new DraftTestOperationError(code, 'isolated draft-test storage must be a non-symlink directory')
  }
  const canonical = await realpath(path)
  const completed = await lstat(path, { bigint: true })
  if (
    canonical !== path
    || !completed.isDirectory()
    || completed.isSymbolicLink()
    || completed.dev !== initial.dev
    || completed.ino !== initial.ino
  ) {
    throw new DraftTestOperationError(code, 'isolated draft-test storage identity changed during inspection')
  }
  const uid = currentUid()
  if (uid !== null && completed.uid !== uid) {
    throw new DraftTestOperationError(code, 'isolated draft-test storage must be owned by the DSH process user')
  }
  if ((completed.mode & (writable ? 0o077n : 0o022n)) !== 0n) {
    throw new DraftTestOperationError(
      code,
      writable
        ? 'isolated draft-test storage must be private to the DSH process user'
        : 'isolated draft-test storage must not be writable by group or other users',
    )
  }
  return {
    path: canonical,
    device: completed.dev.toString(),
    inode: completed.ino.toString(),
    uid: completed.uid.toString(),
    mode: (completed.mode & 0o777n).toString(8).padStart(3, '0'),
  }
}

async function assertDirectoryUnchanged(identity, code, writable = false) {
  const observed = await inspectPrivateDirectory(identity.path, code, writable)
  if (
    observed.device !== identity.device
    || observed.inode !== identity.inode
    || observed.uid !== identity.uid
    || observed.mode !== identity.mode
  ) {
    throw new DraftTestOperationError(code, 'isolated draft-test storage identity drifted')
  }
}

async function ensurePrivateDirectory(path, parentIdentity) {
  await assertDirectoryUnchanged(parentIdentity, 'draft_test_runs_root_unsafe', true)
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  const identity = await inspectPrivateDirectory(path, 'draft_test_directory_unsafe', true)
  if (!isContainedPath(parentIdentity.path, identity.path) || dirname(identity.path) !== parentIdentity.path) {
    throw new DraftTestOperationError(
      'draft_test_directory_unsafe',
      'isolated draft-test directory escaped its dedicated parent',
    )
  }
  return identity
}

async function makeOwnedTreeRemovable(path, parentIdentity) {
  await assertDirectoryUnchanged(parentIdentity, 'draft_test_owner_root_unsafe', true)
  const root = await realpath(path)
  if (!isContainedPath(parentIdentity.path, root) || dirname(root) !== parentIdentity.path) {
    throw new DraftTestOperationError(
      'draft_test_cleanup_failed',
      'draft-test cleanup target escaped its dedicated owner directory',
    )
  }
  const uid = currentUid()
  async function restore(directoryPath) {
    const metadata = await lstat(directoryPath, { bigint: true })
    if (
      !metadata.isDirectory()
      || metadata.isSymbolicLink()
      || (uid !== null && metadata.uid !== uid)
    ) {
      throw new DraftTestOperationError(
        'draft_test_cleanup_failed',
        'draft-test cleanup encountered an unsafe directory',
      )
    }
    const canonical = await realpath(directoryPath)
    if (canonical !== directoryPath || !isContainedPath(root, canonical)) {
      throw new DraftTestOperationError(
        'draft_test_cleanup_failed',
        'draft-test cleanup directory identity changed',
      )
    }
    const directory = await opendir(canonical)
    for await (const entry of directory) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await restore(join(canonical, entry.name))
      }
    }
    await chmod(canonical, 0o700)
  }
  await restore(root)
  await assertDirectoryUnchanged(parentIdentity, 'draft_test_owner_root_unsafe', true)
}

async function writeExclusive(path, content, mode = 0o600) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  let handle
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      mode,
    )
    let offset = 0
    while (offset < buffer.length) {
      const result = await handle.write(buffer, offset, buffer.length - offset, offset)
      if (result.bytesWritten === 0) throw new Error('exclusive file write made no progress')
      offset += result.bytesWritten
    }
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

async function snapshotRunnerWrapper(source, identity, target) {
  if (
    !isPlainObject(identity)
    || !Number.isSafeInteger(identity.sizeBytes)
    || identity.sizeBytes < 1
    || identity.sizeBytes > 256 * 1024 * 1024
    || !DIGEST_PATTERN.test(identity.sha256)
  ) {
    throw new DraftTestOperationError('runner_identity_invalid', 'runner wrapper identity is invalid')
  }
  const sourceBytes = await readBoundedFile(source, identity.sizeBytes, 'runner_wrapper')
  const sourceDigest = `sha256:${createHash('sha256').update(sourceBytes).digest('hex')}`
  if (sourceBytes.length !== identity.sizeBytes || sourceDigest !== identity.sha256) {
    throw new DraftTestOperationError('runner_identity_drift', 'runner wrapper changed before private snapshot')
  }
  await writeExclusive(target, sourceBytes, 0o400)
  const snapshot = await readBoundedFile(target, identity.sizeBytes, 'runner_wrapper_snapshot')
  const snapshotDigest = `sha256:${createHash('sha256').update(snapshot).digest('hex')}`
  if (snapshot.length !== identity.sizeBytes || snapshotDigest !== identity.sha256) {
    throw new DraftTestOperationError('runner_identity_drift', 'private runner wrapper snapshot is invalid')
  }
  return target
}

async function atomicWriteJson(path, value) {
  const encoded = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  if (encoded.length > MAX_RECORD_BYTES) {
    throw new DraftTestOperationError(
      'draft_test_evidence_too_large',
      'draft-test retained evidence exceeded its bounded record limit',
    )
  }
  const temporary = join(dirname(path), `.record-${randomUUID()}.tmp`)
  try {
    await writeExclusive(temporary, encoded)
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function readBoundedFile(path, maximum, label, signal) {
  throwIfAborted(signal)
  let handle
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    )
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size > BigInt(maximum)) {
      throw new DraftTestOperationError(
        `${label}_invalid`,
        `${label.replaceAll('_', ' ')} is missing or exceeds its byte limit`,
      )
    }
    const buffer = Buffer.allocUnsafe(Number(before.size))
    let offset = 0
    while (offset < buffer.length) {
      throwIfAborted(signal)
      const result = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (result.bytesRead === 0) throw new Error('bounded file changed while reading')
      offset += result.bytesRead
    }
    const growth = Buffer.allocUnsafe(1)
    if ((await handle.read(growth, 0, 1, buffer.length)).bytesRead !== 0) {
      throw new Error('bounded file grew while reading')
    }
    const after = await handle.stat({ bigint: true })
    if (
      after.size !== before.size
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error('bounded file changed while reading')
    }
    return buffer
  } finally {
    await handle?.close()
  }
}

async function readBoundedJson(path, maximum, label, signal) {
  const buffer = await readBoundedFile(path, maximum, label, signal)
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new DraftTestOperationError(`${label}_invalid`, `${label.replaceAll('_', ' ')} is not valid JSON`)
  }
}

async function assertProtectedPathAncestors(path, label, code = 'runner_identity_invalid') {
  const uid = currentUid()
  const ancestors = []
  let ancestor = dirname(path)
  while (true) {
    const metadata = await lstat(ancestor, { bigint: true })
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new DraftTestOperationError(
        code,
        `${label} ancestors must be non-symlink directories`,
      )
    }
    ancestors.push(metadata)
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  const filesystemRootUid = ancestors.at(-1).uid
  for (const metadata of ancestors) {
    if (uid !== null && metadata.uid !== filesystemRootUid && metadata.uid !== uid) {
      throw new DraftTestOperationError(
        code,
        `${label} ancestors have an unsafe owner`,
      )
    }
    if ((metadata.mode & 0o022n) !== 0n && (metadata.mode & 0o1000n) === 0n) {
      throw new DraftTestOperationError(
        code,
        `writable ${label} ancestors lack sticky replacement protection`,
      )
    }
  }
}

async function executableIdentity(
  path,
  { requireExecutable = true, snapshotBeforeUse = false } = {},
) {
  const invocation = resolve(path)
  const canonical = await realpath(path)
  if (
    !isAbsolute(invocation)
    || !SAFE_PATH_PATTERN.test(invocation)
    || !isAbsolute(canonical)
    || !SAFE_PATH_PATTERN.test(canonical)
  ) {
    throw new DraftTestOperationError('runner_identity_invalid', 'runner executable path is unsafe')
  }
  const launchMetadata = await lstat(invocation, { bigint: true })
  if (!launchMetadata.isFile() && !launchMetadata.isSymbolicLink()) {
    throw new DraftTestOperationError('runner_identity_invalid', 'runner executable launch path is unsupported')
  }
  const uid = currentUid()
  if (uid !== null && launchMetadata.uid !== 0n && launchMetadata.uid !== uid) {
    throw new DraftTestOperationError('runner_identity_invalid', 'runner executable launch path has an unsafe owner')
  }
  if (!snapshotBeforeUse) {
    await assertProtectedPathAncestors(invocation, 'runner executable launch path')
    if (canonical !== invocation) await assertProtectedPathAncestors(canonical, 'runner executable target')
  }

  let handle
  try {
    handle = await open(
      canonical,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    )
    const metadata = await handle.stat({ bigint: true })
    if (!metadata.isFile() || metadata.size > 256n * 1024n * 1024n) {
      throw new DraftTestOperationError('runner_identity_invalid', 'runner executable identity is unsupported')
    }
    if (
      process.platform !== 'linux'
      || await realpath(`/proc/self/fd/${handle.fd}`) !== canonical
    ) {
      throw new DraftTestOperationError('runner_identity_invalid', 'runner executable descriptor identity is unavailable')
    }
    if (uid !== null && metadata.uid !== 0n && metadata.uid !== uid) {
      throw new DraftTestOperationError('runner_identity_invalid', 'runner executable target has an unsafe owner')
    }
    if (
      (metadata.mode & (snapshotBeforeUse ? 0o002n : 0o022n)) !== 0n
      || (requireExecutable && (metadata.mode & 0o111n) === 0n)
    ) {
      throw new DraftTestOperationError('runner_identity_invalid', 'runner executable target permissions are unsafe')
    }
    await access(canonical, constants.R_OK | (requireExecutable ? constants.X_OK : 0))
    const bytes = Buffer.allocUnsafe(Number(metadata.size))
    let offset = 0
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (result.bytesRead === 0) throw new Error('runner executable changed while hashing')
      offset += result.bytesRead
    }
    const growth = Buffer.allocUnsafe(1)
    if ((await handle.read(growth, 0, 1, bytes.length)).bytesRead !== 0) {
      throw new Error('runner executable grew while hashing')
    }
    const completed = await handle.stat({ bigint: true })
    const completedLaunch = await lstat(invocation, { bigint: true })
    const completedCanonical = await realpath(invocation)
    if (
      completedCanonical !== canonical
      || completedLaunch.dev !== launchMetadata.dev
      || completedLaunch.ino !== launchMetadata.ino
      || completedLaunch.mode !== launchMetadata.mode
      || completedLaunch.size !== launchMetadata.size
      || completedLaunch.mtimeNs !== launchMetadata.mtimeNs
      || completedLaunch.ctimeNs !== launchMetadata.ctimeNs
      || completed.dev !== metadata.dev
      || completed.ino !== metadata.ino
      || completed.size !== metadata.size
      || completed.mtimeNs !== metadata.mtimeNs
      || completed.ctimeNs !== metadata.ctimeNs
    ) {
      throw new DraftTestOperationError('runner_identity_drift', 'runner executable changed while hashing')
    }
    return {
      path: invocation,
      public: {
        launchPathDigest: `sha256:${createHash('sha256').update(invocation, 'utf8').digest('hex')}`,
        canonicalPathDigest: `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`,
        launchDevice: launchMetadata.dev.toString(),
        launchInode: launchMetadata.ino.toString(),
        launchMode: (launchMetadata.mode & 0o7777n).toString(8),
        launchSizeBytes: Number(launchMetadata.size),
        launchMtimeNs: launchMetadata.mtimeNs.toString(),
        launchCtimeNs: launchMetadata.ctimeNs.toString(),
        sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        sizeBytes: Number(metadata.size),
        device: metadata.dev.toString(),
        inode: metadata.ino.toString(),
        uid: metadata.uid.toString(),
        mode: (metadata.mode & 0o777n).toString(8).padStart(3, '0'),
        mtimeNs: metadata.mtimeNs.toString(),
        ctimeNs: metadata.ctimeNs.toString(),
      },
    }
  } finally {
    await handle?.close()
  }
}

function exactControllerEnvironment(home) {
  return {
    ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])),
    HOME: home,
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  }
}

function collectedText(reader) {
  if (typeof reader?.readFrom !== 'function') return { text: '', nextOffset: 0, lossy: false }
  const value = reader.readFrom(0)
  return {
    text: typeof value?.text === 'string' ? value.text : '',
    nextOffset: Number.isSafeInteger(value?.nextOffset) ? value.nextOffset : 0,
    lossy: value?.lossy === true,
  }
}

async function runSubprocess(subprocess, spec, timeoutMs, signal) {
  throwIfAborted(signal)
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => {
    const error = new Error(`runner probe timed out after ${timeoutMs}ms`)
    error.name = 'TimeoutError'
    controller.abort(error)
  }, timeoutMs)
  timeout.unref?.()
  try {
    const handle = subprocess.spawn({
      ...spec,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_RUNNER_OUTPUT_BYTES },
        stderr: { maxBytes: MAX_RUNNER_OUTPUT_BYTES },
      },
      graceMs: PROCESS_GRACE_MS,
      signal: controller.signal,
    })
    const outcome = await handle.done
    await handle.waitForExit()
    throwIfAborted(signal)
    if (controller.signal.aborted) {
      throw new DraftTestOperationError('runner_probe_timeout', 'runner identity probe timed out')
    }
    const stdout = collectedText(handle.collected?.stdout)
    const stderr = collectedText(handle.collected?.stderr)
    if (stdout.lossy || stderr.lossy) {
      throw new DraftTestOperationError('runner_probe_truncated', 'runner identity probe output was truncated')
    }
    return { outcome, stdout: stdout.text, stderr: stderr.text }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function runProbeCommand(subprocess, argv, cwd, environment, signal, label) {
  const result = await runSubprocess(
    subprocess,
    { argv, cwd, env: environment },
    RUNNER_PROBE_TIMEOUT_MS,
    signal,
  )
  if (result.outcome.exitCode !== 0 || result.outcome.signal !== null) {
    throw new DraftTestOperationError(
      `${label}_probe_failed`,
      `${label.replaceAll('_', ' ')} probe failed closed`,
    )
  }
  return result.stdout.trim()
}

async function cleanupOwnedDockerResources({ subprocess, dockerExecutable, plan, testId }) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DraftTestOperationError(
      'resource_cleanup_timeout',
      'owned Docker resource cleanup exceeded its fixed time limit',
    ))
  }, RESOURCE_CLEANUP_TIMEOUT_MS)
  timer.unref?.()
  try {
    if (typeof subprocess?.resolveExecutable !== 'function' || typeof subprocess?.spawn !== 'function') {
      throw new DraftTestOperationError(
        'resource_cleanup_unavailable',
        'Docker cleanup requires the DSH subprocess service',
      )
    }
    const dockerResolved = await subprocess.resolveExecutable(dockerExecutable)
    const docker = await executableIdentity(dockerResolved)
    if (stableStringify(docker.public) !== stableStringify(plan.runner.identity.executables.docker)) {
      throw new DraftTestOperationError(
        'resource_cleanup_identity_drift',
        'Docker executable identity changed before exact resource cleanup',
      )
    }
    const environment = exactControllerEnvironment('/nonexistent')
    const filters = [
      'label=dsh.fixture.owner=dsh-bio-workflows',
      `label=dsh.fixture.test-id=${testId}`,
      `label=dsh.fixture.plan-digest=${computeDraftTestDigest(plan, 'plan')}`,
    ]
    const list = async (kind) => {
      const command = kind === 'container'
        ? [docker.path, 'container', 'ls', '--all', '--quiet']
        : [docker.path, 'volume', 'ls', '--quiet']
      for (const filter of filters) command.push('--filter', filter)
      const output = await runProbeCommand(
        subprocess,
        command,
        dirname(WRAPPER_PATH),
        environment,
        controller.signal,
        'resource_cleanup',
      )
      const ids = output.split('\n').filter(Boolean)
      const pattern = kind === 'container' ? /^[a-f0-9]{12,64}$/ : /^dshbio-vol-[a-f0-9]{20}$/
      if (ids.length > 256 || ids.some((id) => !pattern.test(id)) || new Set(ids).size !== ids.length) {
        throw new DraftTestOperationError('resource_cleanup_invalid', `Docker ${kind} cleanup inventory is invalid`)
      }
      return ids.sort()
    }
    const removedContainers = new Set()
    const removedVolumes = new Set()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const containers = await list('container')
      if (containers.length > 0) {
        await runProbeCommand(
          subprocess,
          [docker.path, 'container', 'rm', '--force', ...containers],
          dirname(WRAPPER_PATH),
          environment,
          controller.signal,
          'resource_cleanup',
        )
        containers.forEach((id) => removedContainers.add(id))
      }
      const volumes = await list('volume')
      if (volumes.length > 0) {
        await runProbeCommand(
          subprocess,
          [docker.path, 'volume', 'rm', ...volumes],
          dirname(WRAPPER_PATH),
          environment,
          controller.signal,
          'resource_cleanup',
        )
        volumes.forEach((name) => removedVolumes.add(name))
      }
      if ((await list('container')).length === 0 && (await list('volume')).length === 0) {
        const basis = {
          cleanupVerified: true,
          cleanupMode: 'exact_labels_and_absence_probe',
          containersRemaining: 0,
          volumesRemaining: 0,
          removedContainers: removedContainers.size,
          removedVolumes: removedVolumes.size,
        }
        return { ...basis, cleanupDigest: computeDraftTestDigest(basis, 'resource-cleanup') }
      }
    }
    throw new DraftTestOperationError(
      'resource_cleanup_unverified',
      'owned Docker resources remained after bounded exact cleanup',
    )
  } finally {
    clearTimeout(timer)
  }
}

function bindControllerTermination(resources, termination) {
  const basis = cloneJson(resources)
  delete basis.cleanupDigest
  basis.controllerTerminationVerified = termination.verified === true
  basis.controllerTerminationMode = termination.mode
  return { ...basis, cleanupDigest: computeDraftTestDigest(basis, 'resource-cleanup') }
}

function failedResourceCleanup(
  code = 'resource_cleanup_unverified',
  termination = { verified: false, mode: 'controller_termination_unverified' },
) {
  const basis = {
    cleanupVerified: false,
    cleanupMode: 'exact_labels_and_absence_probe',
    containersRemaining: null,
    volumesRemaining: null,
    removedContainers: 0,
    removedVolumes: 0,
    failureCode: code,
    controllerTerminationVerified: termination.verified === true,
    controllerTerminationMode: termination.mode,
  }
  return { ...basis, cleanupDigest: computeDraftTestDigest(basis, 'resource-cleanup') }
}

function parseExactJson(text, code) {
  try {
    return JSON.parse(text)
  } catch {
    throw new DraftTestOperationError(code, 'runner identity probe returned invalid JSON')
  }
}

async function probeRunnerIdentity({ config, subprocess, taskImage, budgets, signal }) {
  const pythonResolved = await subprocess.resolveExecutable(config.runner.pythonExecutable)
  const dockerResolved = await subprocess.resolveExecutable(config.runner.dockerExecutable)
  const python = await executableIdentity(pythonResolved)
  const docker = await executableIdentity(dockerResolved)
  const wrapper = await executableIdentity(WRAPPER_PATH, {
    requireExecutable: false,
    snapshotBeforeUse: true,
  })
  const environment = exactControllerEnvironment('/nonexistent')
  const runtimeVersion = parseExactJson(await runProbeCommand(
    subprocess,
    [
      python.path,
      '-B',
      '-I',
      '-S',
      wrapper.path,
      '--dsh-version',
    ],
    dirname(wrapper.path),
    environment,
    signal,
    'runner_version',
  ), 'runner_version_invalid')
  if (
    !isPlainObject(runtimeVersion)
    || Object.keys(runtimeVersion).sort().join(',') !== [
      'backend',
      'controllerNetwork',
      'expectedMiniwdlVersion',
      'miniwdlVersion',
      'policyVersion',
      'pythonEnvironment',
      'pythonVersion',
      'wrapper',
    ].sort().join(',')
    || runtimeVersion.backend !== 'dsh_fixture_docker'
    || runtimeVersion.policyVersion !== DRAFT_TEST_POLICY_VERSION
    || runtimeVersion.expectedMiniwdlVersion !== config.runner.expectedMiniwdlVersion
    || runtimeVersion.miniwdlVersion !== config.runner.expectedMiniwdlVersion
    || typeof runtimeVersion.pythonVersion !== 'string'
    || runtimeVersion.pythonVersion.length > 64
    || !isPlainObject(runtimeVersion.wrapper)
    || runtimeVersion.wrapper.sha256 !== wrapper.public.sha256
    || runtimeVersion.wrapper.sizeBytes !== wrapper.public.sizeBytes
    || !isPlainObject(runtimeVersion.pythonEnvironment)
    || !DIGEST_PATTERN.test(runtimeVersion.pythonEnvironment.environmentDigest)
    || !isPlainObject(runtimeVersion.pythonEnvironment.startupPolicy)
    || !Array.isArray(runtimeVersion.pythonEnvironment.distributions)
    || runtimeVersion.pythonEnvironment.distributions.length < 1
    || runtimeVersion.pythonEnvironment.distributions.length > 128
  ) {
    throw new DraftTestOperationError('runner_version_mismatch', 'isolated runner version identity does not match configuration')
  }
  const controllerNetwork = runtimeVersion.controllerNetwork
  if (!isPlainObject(controllerNetwork)) {
    throw new DraftTestOperationError('runner_version_mismatch', 'isolated controller network filter identity is invalid')
  }
  const controllerNetworkBasis = cloneJson(controllerNetwork)
  delete controllerNetworkBasis.filterDigest
  const architecture = controllerNetwork?.architecture
  const expectedArchitecture = {
    x86_64: { auditArchitecture: '0xc000003e', socketSyscall: 41, seccompSyscall: 317 },
    aarch64: { auditArchitecture: '0xc00000b7', socketSyscall: 198, seccompSyscall: 277 },
  }[architecture]
  if (
    Object.keys(controllerNetwork).sort().join(',') !== [
      'allowedSocketDomain',
      'architecture',
      'auditArchitecture',
      'deniedAction',
      'filterDigest',
      'noNewPrivileges',
      'policy',
      'seccompSyscall',
      'socketSyscall',
      'threadSynchronization',
    ].sort().join(',')
    || expectedArchitecture === undefined
    || controllerNetwork.policy !== CONTROLLER_NETWORK_POLICY
    || controllerNetwork.auditArchitecture !== expectedArchitecture.auditArchitecture
    || controllerNetwork.socketSyscall !== expectedArchitecture.socketSyscall
    || controllerNetwork.seccompSyscall !== expectedArchitecture.seccompSyscall
    || controllerNetwork.allowedSocketDomain !== 'AF_UNIX'
    || controllerNetwork.deniedAction !== 'errno:EPERM'
    || controllerNetwork.noNewPrivileges !== true
    || controllerNetwork.threadSynchronization !== 'SECCOMP_FILTER_FLAG_TSYNC'
    || controllerNetwork.filterDigest !== runnerDigest(controllerNetworkBasis, 'controller-network-filter')
  ) {
    throw new DraftTestOperationError('runner_version_mismatch', 'isolated controller network filter identity is invalid')
  }
  const version = {
    backend: 'dsh_fixture_docker',
    policyVersion: DRAFT_TEST_POLICY_VERSION,
    miniwdlVersion: runtimeVersion.miniwdlVersion,
    pythonVersion: runtimeVersion.pythonVersion,
  }
  const dockerInfo = (await runProbeCommand(
    subprocess,
    [
      docker.path,
      'info',
      '--format',
      '{{.ID}}\t{{.ServerVersion}}\t{{.CgroupVersion}}\t{{json .SecurityOptions}}',
    ],
    dirname(wrapper.path),
    environment,
    signal,
    'docker_identity',
  )).split('\t', 4)
  if (dockerInfo.length !== 4 || dockerInfo[2] !== '2') {
    throw new DraftTestOperationError('docker_isolation_unavailable', 'Docker cgroup v2 isolation prerequisites are unavailable')
  }
  let securityOptions
  try {
    securityOptions = JSON.parse(dockerInfo[3])
  } catch {
    throw new DraftTestOperationError('docker_identity_invalid', 'Docker security identity is invalid')
  }
  if (
    !Array.isArray(securityOptions)
    || !securityOptions.includes('name=apparmor')
    || !securityOptions.includes('name=seccomp,profile=builtin')
  ) {
    throw new DraftTestOperationError(
      'docker_isolation_unavailable',
      'Docker AppArmor and builtin seccomp are required for isolated draft testing',
    )
  }

  const images = []
  for (const reference of [...new Set([taskImage, config.runner.supportImage])].sort()) {
    if (typeof reference !== 'string' || !PINNED_IMAGE_PATTERN.test(reference)) {
      throw new DraftTestOperationError('container_identity_invalid', 'container image must be exact and digest-pinned')
    }
    const fields = (await runProbeCommand(
      subprocess,
      [docker.path, 'image', 'inspect', '--format', '{{.Id}}\t{{json .RepoDigests}}', reference],
      dirname(wrapper.path),
      environment,
      signal,
      'container_identity',
    )).split('\t', 2)
    let repoDigests
    try {
      repoDigests = JSON.parse(fields[1])
    } catch {
      repoDigests = null
    }
    if (
      fields.length !== 2
      || !DIGEST_PATTERN.test(fields[0])
      || !Array.isArray(repoDigests)
      || !repoDigests.includes(reference)
    ) {
      throw new DraftTestOperationError(
        'container_identity_unavailable',
        'exact approved container image is not present in the local Docker store',
      )
    }
    images.push({ reference, imageId: fields[0] })
  }
  const taskImageIdentity = images.find((item) => item.reference === taskImage)
  const supportImageIdentity = images.find((item) => item.reference === config.runner.supportImage)
  return {
    internal: {
      pythonPath: python.path,
      dockerPath: docker.path,
      wrapperPath: wrapper.path,
    },
    public: {
      backend: version.backend,
      policyVersion: version.policyVersion,
      miniwdlVersion: version.miniwdlVersion,
      pythonVersion: version.pythonVersion,
      controller: {
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
        gid: currentGid(),
        network: cloneJson(controllerNetwork),
        environment: {
          policy: 'exact_allowlist',
          allowedKeys: Object.keys(CONTROLLER_ENVIRONMENT_BASIS).sort(),
          nonEmptyKeys: Object.keys(CONTROLLER_ENVIRONMENT_BASIS).sort(),
          credentialLikeKeys: [],
          environmentDigest: runnerDigest(CONTROLLER_ENVIRONMENT_BASIS, 'controller-environment'),
        },
        limits: {
          residentMemoryBytes: budgets.memoryBytes,
          virtualAddressSpaceBytes: budgets.memoryBytes,
          cpuSeconds: Math.ceil(budgets.wallTimeMs / 1000),
          additionalProcesses: budgets.pids,
          openFiles: 256,
          fileBytes: budgets.totalOutputBytes,
          wallTimeMs: budgets.wallTimeMs,
        },
        dockerBroker: {
          networkFilterDigest: controllerNetwork.filterDigest,
          kernelEnforced: true,
          threadSynchronized: true,
          limits: {
            virtualAddressSpaceBytes: 4 * 1024 * 1024 * 1024,
            cpuSeconds: Math.ceil(budgets.wallTimeMs / 1000),
            additionalProcesses: DRAFT_TEST_DOCKER_BROKER_ADDITIONAL_PROCESSES,
            openFiles: 256,
            fileBytes: budgets.totalOutputBytes,
          },
        },
      },
      pythonEnvironment: cloneJson(runtimeVersion.pythonEnvironment),
      executables: {
        python: python.public,
        docker: docker.public,
        wrapper: wrapper.public,
      },
      docker: {
        engineId: dockerInfo[0],
        serverVersion: dockerInfo[1],
        cgroupVersion: dockerInfo[2],
        securityOptions: [...securityOptions].sort(),
      },
      taskImage: taskImageIdentity,
      supportImage: supportImageIdentity,
      supportContainerLimits: {
        cpu: 1,
        memoryBytesMaximum: 128 * 1024 * 1024,
        pidsMaximum: 16,
      },
    },
  }
}

function validatePrepareRequest(request, includeDigest = false) {
  if (!isPlainObject(request)) throw new TypeError('draft-test request must be an object')
  const allowed = new Set([
    'missionId',
    'fixtureId',
    'fixtureVersion',
    'budgets',
    ...(includeDigest ? ['expectedPlanDigest'] : []),
  ])
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) throw new TypeError(`unsupported draft-test request property: ${key}`)
  }
  if (typeof request.missionId !== 'string') throw new TypeError('missionId must be a string')
  if (typeof request.fixtureId !== 'string') throw new TypeError('fixtureId must be a string')
  if (typeof request.fixtureVersion !== 'string') throw new TypeError('fixtureVersion must be a string')
  if (includeDigest && (typeof request.expectedPlanDigest !== 'string' || !DIGEST_PATTERN.test(request.expectedPlanDigest))) {
    throw new TypeError('expectedPlanDigest must be a SHA-256 digest')
  }
}

function prepareRequest(request) {
  return {
    missionId: request.missionId,
    fixtureId: request.fixtureId,
    fixtureVersion: request.fixtureVersion,
    ...(request.budgets === undefined ? {} : { budgets: request.budgets }),
  }
}

function replaceFixtureReferences(value, stagedPaths) {
  if (Array.isArray(value)) return value.map((item) => replaceFixtureReferences(item, stagedPaths))
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 1 && typeof value.$fixture === 'string') {
      const selected = stagedPaths.get(value.$fixture)
      if (selected === undefined) throw new Error('fixture reference was not staged')
      return selected
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceFixtureReferences(item, stagedPaths)]),
    )
  }
  return value
}

async function ensureSnapshotParent(root, relativePath) {
  let current = root
  for (const segment of relativePath.split('/').slice(0, -1)) {
    current = join(current, segment)
    try {
      await mkdir(current, { mode: 0o700 })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const metadata = await lstat(current)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new DraftTestOperationError('snapshot_path_unsafe', 'snapshot directory is unsafe')
    }
    const canonical = await realpath(current)
    if (!isContainedPath(root, canonical)) {
      throw new DraftTestOperationError('snapshot_path_unsafe', 'snapshot directory escaped its root')
    }
  }
}

async function snapshotDraft(draft, targetRoot) {
  if (computeDraftContentDigest(draft.snapshot.files) !== draft.snapshot.contentDigest) {
    throw new DraftTestOperationError('draft_identity_drift', 'draft snapshot content digest is invalid')
  }
  await mkdir(targetRoot, { mode: 0o700 })
  for (const file of draft.snapshot.files) {
    if (!isSafeBundlePath(file.path)) {
      throw new DraftTestOperationError('draft_snapshot_unsafe', 'draft snapshot contains an unsafe path')
    }
    await ensureSnapshotParent(targetRoot, file.path)
    await writeExclusive(join(targetRoot, ...file.path.split('/')), file.content, 0o400)
  }
  for (const file of [...draft.snapshot.files].reverse()) {
    let current = dirname(join(targetRoot, ...file.path.split('/')))
    while (current !== targetRoot && isContainedPath(targetRoot, current)) {
      await chmod(current, 0o500)
      current = dirname(current)
    }
  }
  await chmod(targetRoot, 0o500)
  const entrypoint = join(targetRoot, ...draft.metadata.entrypoint.split('/'))
  if (!isContainedPath(targetRoot, entrypoint)) {
    throw new DraftTestOperationError('draft_snapshot_unsafe', 'draft entrypoint escaped its snapshot')
  }
  return entrypoint
}

async function readFixtureSource(file) {
  let handle
  try {
    handle = await open(
      file.sourcePath,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    )
    const before = await handle.stat({ bigint: true })
    const expected = file.identity
    if (
      !before.isFile()
      || before.size.toString() !== expected.size
      || before.dev.toString() !== expected.device
      || before.ino.toString() !== expected.inode
      || before.mtimeNs.toString() !== expected.mtimeNs
      || before.ctimeNs.toString() !== expected.ctimeNs
      || before.uid.toString() !== expected.uid
    ) {
      throw new DraftTestOperationError('fixture_identity_drift', 'fixture source identity changed after approval preparation')
    }
    const buffer = Buffer.allocUnsafe(file.sizeBytes)
    let offset = 0
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (result.bytesRead === 0) {
        throw new DraftTestOperationError('fixture_identity_drift', 'fixture source changed while snapshotting')
      }
      offset += result.bytesRead
    }
    const growth = Buffer.allocUnsafe(1)
    if ((await handle.read(growth, 0, 1, buffer.length)).bytesRead !== 0) {
      throw new DraftTestOperationError('fixture_identity_drift', 'fixture source grew while snapshotting')
    }
    const after = await handle.stat({ bigint: true })
    if (
      after.size !== before.size
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
    ) {
      throw new DraftTestOperationError('fixture_identity_drift', 'fixture source changed while snapshotting')
    }
    const digest = `sha256:${createHash('sha256').update(buffer).digest('hex')}`
    if (digest !== file.sha256) {
      throw new DraftTestOperationError('fixture_identity_drift', 'fixture source digest changed after approval preparation')
    }
    return buffer
  } finally {
    await handle?.close()
  }
}

async function snapshotFixture(fixture, targetRoot, maximumBytes) {
  if (fixture.totalFileBytes > maximumBytes) {
    throw new DraftTestOperationError('fixture_budget_exceeded', 'fixture exceeds the approved snapshot byte budget')
  }
  await mkdir(targetRoot, { mode: 0o700 })
  const stagedPaths = new Map()
  let copiedBytes = 0
  for (const [index, file] of fixture.files.entries()) {
    const bytes = await readFixtureSource(file)
    copiedBytes += bytes.length
    if (copiedBytes > maximumBytes) {
      throw new DraftTestOperationError('fixture_budget_exceeded', 'fixture exceeds the approved snapshot byte budget')
    }
    const destination = join(targetRoot, `fixture-${String(index).padStart(4, '0')}.bin`)
    await writeExclusive(destination, bytes, 0o400)
    stagedPaths.set(file.path, destination)
  }
  if (copiedBytes !== fixture.totalFileBytes) {
    throw new DraftTestOperationError('fixture_identity_drift', 'fixture aggregate size changed while snapshotting')
  }
  await chmod(targetRoot, 0o500)
  return {
    inputs: replaceFixtureReferences(fixture.descriptor.inputs, stagedPaths),
    stagedPaths,
    totalBytes: copiedBytes,
  }
}

function createMiniwdlConfig({
  runDirectory,
  wdlRoot,
  fixtureRoot,
  fixtureDataRoot,
  inputsPath,
  evidencePath,
  launchGatePath,
  launchGateDigest,
  canaryPath,
  canaryDigest,
  testId,
  planDigest,
  plan,
  runner,
}) {
  for (const path of [runDirectory, wdlRoot, fixtureRoot, fixtureDataRoot, inputsPath, evidencePath, launchGatePath, canaryPath, runner.dockerPath]) {
    if (!isAbsolute(path) || !SAFE_PATH_PATTERN.test(path)) {
      throw new DraftTestOperationError('runner_config_unsafe', 'isolated runner configuration contains an unsafe path')
    }
  }
  const budgets = plan.budgets
  const taskImage = plan.mission.software.containerImage
  return `[scheduler]
container_backend = dsh_fixture_docker
task_concurrency = 1
fail_fast = true

[file_io]
root = ${fixtureRoot}
allow_any_input = false
copy_input_files = false
chown = false

[task_runtime]
cpu_max = ${budgets.cpu}
memory_max = ${budgets.memoryBytes}
memory_limit_multiplier = 1.0
defaults = ${JSON.stringify({ cpu: budgets.cpu, memory: `${budgets.memoryBytes}B` })}
as_user = true
allow_privileged = false
command_shell = /bin/bash
placeholder_regex = [A-Za-z0-9_./:@+=,-]+
env = {}

[download_cache]
get = false
put = false

[download_awscli]
host_credentials = false

[call_cache]
get = false
put = false

[dsh_fixture_docker]
docker_executable = ${runner.dockerPath}
test_id = ${testId}
plan_digest = ${planDigest}
test_root = ${runDirectory}
wdl_root = ${wdlRoot}
fixture_root = ${fixtureRoot}
fixture_data_root = ${fixtureDataRoot}
inputs_path = ${inputsPath}
runtime_environment_digest = ${plan.runner.identity.pythonEnvironment.environmentDigest}
wrapper_digest = ${plan.runner.identity.executables.wrapper.sha256}
controller_environment_digest = ${plan.runner.identity.controller.environment.environmentDigest}
controller_network_filter_digest = ${plan.runner.identity.controller.network.filterDigest}
support_image = ${plan.runner.identity.supportImage.reference}
allowed_images = ${JSON.stringify([taskImage])}
evidence_path = ${evidencePath}
launch_gate_path = ${launchGatePath}
launch_gate_digest = ${launchGateDigest}
probe_canary_path = ${canaryPath}
probe_canary_digest = ${canaryDigest}
cpu = ${budgets.cpu}
memory_bytes = ${budgets.memoryBytes}
pids = ${budgets.pids}
wall_time_ms = ${budgets.wallTimeMs}
task_time_ms = ${budgets.taskTimeMs}
log_bytes = ${budgets.logBytes}
artifact_count = ${budgets.artifactCount}
artifact_bytes = ${budgets.artifactBytes}
total_output_bytes = ${budgets.totalOutputBytes}
task_count = ${budgets.taskCount}
`
}

function runnerArgv({ runner, entrypoint, inputsPath, engineDirectory, configPath }) {
  return [
    runner.pythonPath,
    '-B',
    '-I',
    '-S',
    runner.wrapperPath,
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
    entrypoint,
  ]
}

function sanitizedLog(reader, maximumBytes, replacements) {
  const collected = collectedText(reader)
  let value = collected.text
  for (const [source, replacement] of replacements) value = value.replaceAll(source, replacement)
  let buffer = Buffer.from(value, 'utf8')
  let truncated = collected.lossy
  if (buffer.length > maximumBytes) {
    buffer = buffer.subarray(0, maximumBytes)
    truncated = true
  }
  let captured = buffer.toString('utf8')
  while (Buffer.byteLength(captured, 'utf8') > maximumBytes) captured = captured.slice(0, -1)
  return {
    captured,
    capturedBytes: Buffer.byteLength(captured, 'utf8'),
    observedBytes: Math.min(256 * 1024 * 1024, Math.max(collected.nextOffset, buffer.length)),
    sha256: `sha256:${createHash('sha256').update(captured, 'utf8').digest('hex')}`,
    truncated,
  }
}

function failureEvidence(code, message, basis = {}) {
  const boundedMessage = Buffer.from(message, 'utf8').subarray(0, 512).toString('utf8')
  return {
    code,
    message: boundedMessage,
    failureFingerprint: computeDraftTestDigest({ code, ...basis }, 'failure'),
    automaticRetry: false,
  }
}

function syntheticIsolationEvidence(code) {
  const probes = [{ id: code, status: 'failed', expected: true, observed: false }]
  return {
    verified: false,
    probeDigest: computeDraftTestDigest({ code, probes }, 'synthetic-isolation'),
    probes,
    containers: [],
    controller: null,
  }
}

function emptyAssertionEvidence() {
  return {
    schemaVersion: '1',
    passed: false,
    assertions: [],
    executableAssertions: false,
  }
}

function fallbackTerminalEvidence({ testId, plan, startedAt, finishedAt, code }) {
  const basis = {
    schemaVersion: DRAFT_TEST_EVIDENCE_SCHEMA_VERSION,
    testId,
    planDigest: computeDraftTestDigest(plan, 'plan'),
    status: 'failed',
    startedAt,
    finishedAt,
    identities: identitiesFromPlan(plan),
    budgets: cloneJson(plan.budgets),
    isolation: syntheticIsolationEvidence(code),
    exit: {
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: false,
      ambiguous: true,
    },
    logs: {
      stdout: sanitizedLog(null, 0, []),
      stderr: sanitizedLog(null, 0, []),
    },
    artifacts: [],
    assertionEvidence: emptyAssertionEvidence(),
    resources: failedResourceCleanup(code),
    failure: failureEvidence(
      code,
      'terminal draft-test evidence failed contract validation and was replaced fail closed',
    ),
    passed: false,
    capabilities: {
      isolatedDraftTest: true,
      productionExecution: false,
      workflowPromotion: false,
      productionAllowlistMutation: false,
    },
  }
  return basis
}

function sealTerminalEvidence(value, context, sealEvidence = sealDraftTestEvidence) {
  try {
    return sealEvidence(value)
  } catch {
    const fallback = fallbackTerminalEvidence({ ...context, code: 'evidence_contract_failed' })
    try {
      return sealDraftTestEvidence(fallback)
    } catch {
      return {
        ...fallback,
        evidenceDigest: computeDraftTestDigest(fallback, 'evidence'),
      }
    }
  }
}

function identitiesFromPlan(plan) {
  return {
    missionId: plan.mission.missionId,
    draftId: plan.draft.draftId,
    revision: plan.draft.revision,
    contentDigest: plan.draft.contentDigest,
    validationDigest: plan.draft.validationDigest,
    fixtureDigest: plan.fixture.fixtureDigest,
    runnerDigest: plan.runner.runnerDigest,
    isolationPolicyDigest: plan.isolation.isolationPolicyDigest,
    containerImages: [...new Set([
      plan.mission.software.containerImage,
      plan.runner.identity.supportImage.reference,
    ])].sort(),
  }
}

function validateTaskContainerControls(value, controlsDigest, plan) {
  const allowedKeys = new Set([
    'networkMode',
    'readonlyRootfs',
    'capDrop',
    'securityOpt',
    'pidsLimit',
    'nanoCpus',
    'memory',
    'memorySwap',
    'ipcMode',
    'pidMode',
    'cgroupnsMode',
    'devices',
    'deviceRequests',
    'supplementaryGroups',
    'logDriver',
    'apparmorProfile',
    'environment',
    'tmpfs',
    'ulimits',
    'mounts',
    'outputStorageDigest',
  ])
  if (
    !isPlainObject(value)
    || Object.keys(value).some((key) => !allowedKeys.has(key))
    || Object.keys(value).length !== allowedKeys.size
    || controlsDigest !== runnerDigest(value, 'container-controls')
  ) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'task container controls digest is invalid')
  }
  const budgets = plan.budgets
  const uid = plan.runner.identity.controller.uid
  const gid = plan.runner.identity.controller.gid
  const tmpBytes = Math.min(16 * 1024 * 1024, budgets.totalOutputBytes)
  const expectedUlimits = [
    { name: 'fsize', soft: budgets.artifactBytes, hard: budgets.artifactBytes },
    { name: 'nofile', soft: 256, hard: 256 },
  ]
  const expectedStorage = {
    driver: 'local',
    scope: 'local',
    type: 'tmpfs',
    device: 'tmpfs',
    sizeBytes: budgets.totalOutputBytes,
    uid,
    gid,
    mode: '0700',
  }
  const expectedSecurity = ['apparmor=docker-default', 'no-new-privileges=true', 'seccomp=builtin']
  const fixedEnvironment = {
    HOME: '/tmp/home',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  }
  const environmentKeys = isPlainObject(value.environment) ? Object.keys(value.environment) : []
  const environmentValid = (
    isPlainObject(value.environment)
    && environmentKeys.length >= Object.keys(fixedEnvironment).length
    && environmentKeys.length <= 133
    && environmentKeys.every((key) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))
    && Object.entries(fixedEnvironment).every(([key, expected]) => value.environment[key] === expected)
    && Object.entries(value.environment).every(([key, observed]) => (
      Object.hasOwn(fixedEnvironment, key) || observed === ''
    ))
  )
  const controlChecks = {
    network: value.networkMode === 'none',
    rootfs: value.readonlyRootfs === true,
    capabilities: stableStringify(value.capDrop) === stableStringify(['ALL']),
    security: stableStringify(value.securityOpt) === stableStringify(expectedSecurity),
    pids: value.pidsLimit === budgets.pids,
    cpu: value.nanoCpus === budgets.cpu * 1_000_000_000,
    memory: value.memory === budgets.memoryBytes && value.memorySwap === budgets.memoryBytes,
    ipc: value.ipcMode === 'none',
    pid_namespace: ['', null].includes(value.pidMode),
    cgroup_namespace: ['', 'private'].includes(value.cgroupnsMode),
    devices: value.devices === 0 && value.deviceRequests === 0,
    supplementary_groups: value.supplementaryGroups === 0,
    log_driver: value.logDriver === 'none',
    apparmor: value.apparmorProfile === 'docker-default',
    environment: environmentValid,
    tmpfs: stableStringify(value.tmpfs) === stableStringify({
      '/tmp': `rw,nosuid,nodev,noexec,size=${tmpBytes},uid=${uid},gid=${gid},mode=0700`,
    }),
    ulimits: stableStringify(value.ulimits) === stableStringify(expectedUlimits),
    output_storage: value.outputStorageDigest === runnerDigest(expectedStorage, 'output-storage'),
  }
  const failedControls = Object.entries(controlChecks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  if (failedControls.length > 0) {
    throw new DraftTestOperationError(
      'isolation_probe_failed',
      `task resource or isolation controls drifted: ${failedControls.join(', ')}`,
    )
  }
  if (!Array.isArray(value.mounts) || value.mounts.length < 2 || value.mounts.length > 130) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'task mount control evidence is invalid')
  }
  const destinations = new Set()
  let outputVolumes = 0
  let commandBinds = 0
  for (const mount of value.mounts) {
    const mountKeys = isPlainObject(mount) ? Object.keys(mount).sort() : []
    if (
      !isPlainObject(mount)
      || stableStringify(mountKeys) !== stableStringify(['destination', 'propagation', 'rw', 'type'])
      || !['bind', 'volume'].includes(mount.type)
      || typeof mount.destination !== 'string'
      || destinations.has(mount.destination)
      || !mount.destination.startsWith(TASK_CONTAINER_ROOT)
      || typeof mount.rw !== 'boolean'
      || typeof mount.propagation !== 'string'
    ) {
      throw new DraftTestOperationError('runner_evidence_invalid', 'task mount control evidence is invalid')
    }
    destinations.add(mount.destination)
    if (
      mount.type === 'volume'
      && mount.destination === TASK_CONTAINER_ROOT
      && mount.rw === true
      && mount.propagation === ''
    ) outputVolumes += 1
    else if (
      mount.type === 'bind'
      && mount.destination === `${TASK_CONTAINER_ROOT}/command`
      && mount.rw === false
      && mount.propagation === 'rprivate'
    ) commandBinds += 1
    else if (
      mount.type !== 'bind'
      || mount.rw !== false
      || mount.propagation !== 'rprivate'
      || !mount.destination.startsWith(`${TASK_CONTAINER_ROOT}/`)
    ) {
      throw new DraftTestOperationError('isolation_probe_failed', 'task mount controls exceeded the isolated root')
    }
  }
  if (outputVolumes !== 1 || commandBinds !== 1) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'required task mounts are missing or duplicated')
  }
  return cloneJson(value)
}

async function readRunnerEvidence(path, plan, testId, signal) {
  throwIfAborted(signal)
  const buffer = await readBoundedFile(path, MAX_RUNNER_EVIDENCE_BYTES, 'runner_evidence')
  const text = buffer.toString('utf8')
  const lines = text.split('\n').filter((line) => line.length > 0)
  if (lines.length < 1 || lines.length > plan.budgets.taskCount + 3) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'runner evidence event count is invalid')
  }
  if (lines.some((line) => Buffer.byteLength(line, 'utf8') > 64 * 1024)) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'runner evidence event exceeds its byte limit')
  }
  const events = lines.map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      throw new DraftTestOperationError('runner_evidence_invalid', 'runner evidence contains invalid JSON')
    }
  })
  const probes = events.filter((event) => event?.type === 'isolation_probe')
  const controllerGuards = events.filter((event) => event?.type === 'controller_guard')
  const tasks = events.filter((event) => event?.type === 'task')
  const taskFailures = events.filter((event) => event?.type === 'task_failure')
  if (controllerGuards.length !== 1 || probes.length !== 1 || tasks.length + taskFailures.length < 1) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'runner evidence is incomplete or duplicated')
  }
  if (events.length !== controllerGuards.length + probes.length + tasks.length + taskFailures.length) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'runner evidence contains an unsupported event')
  }

  const controllerGuard = controllerGuards[0]
  const controllerBasis = cloneJson(controllerGuard)
  delete controllerBasis.type
  delete controllerBasis.controllerGuardDigest
  const plannedController = plan.runner.identity.controller
  const limits = controllerGuard.limits
  const environment = controllerGuard.environment
  const network = controllerGuard.network
  const dockerBroker = controllerGuard.dockerBroker
  const plannedDockerBroker = plannedController.dockerBroker
  const limitPair = (value) => (
    isPlainObject(value)
    && Object.keys(value).sort().join(',') === 'hard,soft'
    && Number.isSafeInteger(value.soft)
    && Number.isSafeInteger(value.hard)
    && value.soft > 0
    && value.hard === value.soft
  )
  if (
    controllerGuard.controllerGuardDigest !== runnerDigest(controllerBasis, 'controller-guard')
    || controllerGuard.testId !== testId
    || controllerGuard.planDigest !== computeDraftTestDigest(plan, 'plan')
    || controllerGuard.runtimeEnvironmentDigest !== plan.runner.identity.pythonEnvironment.environmentDigest
    || controllerGuard.wrapperDigest !== plan.runner.identity.executables.wrapper.sha256
    || !isPlainObject(network)
    || stableStringify(network) !== stableStringify({
      policy: plannedController.network.policy,
      architecture: plannedController.network.architecture,
      filterDigest: plannedController.network.filterDigest,
      kernelEnforced: true,
      threadSynchronized: true,
      outboundDenied: true,
      nameResolutionDenied: true,
      hostCanaryConnections: 1,
    })
    || !isPlainObject(environment)
    || stableStringify(environment.keys) !== stableStringify(plannedController.environment.allowedKeys)
    || stableStringify(environment.nonEmptyKeys) !== stableStringify(plannedController.environment.nonEmptyKeys)
    || stableStringify(environment.credentialLikeKeys) !== stableStringify([])
    || environment.environmentDigest !== plannedController.environment.environmentDigest
    || !isPlainObject(limits)
    || Object.keys(limits).sort().join(',') !== 'addressSpace,cpuSeconds,fileBytes,openFiles,processes,residentMemory'
    || !limitPair(limits.addressSpace)
    || limits.addressSpace.soft !== plannedController.limits.virtualAddressSpaceBytes
    || !isPlainObject(limits.residentMemory)
    || stableStringify(limits.residentMemory) !== stableStringify({
      maximumBytes: plannedController.limits.residentMemoryBytes,
      enforcement: 'rlimit_as_hard_with_proc_rss_watchdog',
      intervalMs: 5,
    })
    || !limitPair(limits.cpuSeconds)
    || limits.cpuSeconds.soft > plannedController.limits.cpuSeconds
    || !limitPair(limits.processes)
    || !Number.isSafeInteger(controllerGuard.processBaseline)
    || controllerGuard.processBaseline < 1
    || limits.processes.soft - controllerGuard.processBaseline !== plannedController.limits.additionalProcesses
    || !limitPair(limits.openFiles)
    || limits.openFiles.soft > plannedController.limits.openFiles
    || !limitPair(limits.fileBytes)
    || limits.fileBytes.soft > plannedController.limits.fileBytes
    || !isPlainObject(dockerBroker)
    || Object.keys(dockerBroker).sort().join(',') !== 'kernelEnforced,limits,networkFilterDigest,processBaseline,threadSynchronized'
    || dockerBroker.networkFilterDigest !== plannedDockerBroker.networkFilterDigest
    || dockerBroker.kernelEnforced !== true
    || dockerBroker.threadSynchronized !== true
    || !Number.isSafeInteger(dockerBroker.processBaseline)
    || dockerBroker.processBaseline < 1
    || !isPlainObject(dockerBroker.limits)
    || Object.keys(dockerBroker.limits).sort().join(',') !== 'addressSpace,cpuSeconds,fileBytes,openFiles,processes'
    || !limitPair(dockerBroker.limits.addressSpace)
    || dockerBroker.limits.addressSpace.soft !== plannedDockerBroker.limits.virtualAddressSpaceBytes
    || !limitPair(dockerBroker.limits.cpuSeconds)
    || dockerBroker.limits.cpuSeconds.soft > plannedDockerBroker.limits.cpuSeconds
    || !limitPair(dockerBroker.limits.processes)
    || dockerBroker.limits.processes.soft - dockerBroker.processBaseline !== plannedDockerBroker.limits.additionalProcesses
    || !limitPair(dockerBroker.limits.openFiles)
    || dockerBroker.limits.openFiles.soft > plannedDockerBroker.limits.openFiles
    || !limitPair(dockerBroker.limits.fileBytes)
    || dockerBroker.limits.fileBytes.soft > plannedDockerBroker.limits.fileBytes
  ) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'runner controller guard evidence is invalid')
  }

  const probe = probes[0]
  const probeBasis = {
    policyVersion: probe.policyVersion,
    daemon: probe.daemon,
    supportImage: probe.supportImage,
    containerConfigDigest: probe.containerConfigDigest,
    probes: probe.probes,
  }
  const plannedDocker = plan.runner.identity.docker
  const plannedSupportImage = plan.runner.identity.supportImage
  if (
    probe.policyVersion !== DRAFT_TEST_POLICY_VERSION
    || !DIGEST_PATTERN.test(probe.containerConfigDigest)
    || probe.probeDigest !== runnerDigest(probeBasis, 'probe')
    || !isPlainObject(probe.daemon)
    || probe.daemon.engineId !== plannedDocker.engineId
    || probe.daemon.serverVersion !== plannedDocker.serverVersion
    || probe.daemon.cgroupVersion !== plannedDocker.cgroupVersion
    || stableStringify(probe.daemon.securityOptions) !== stableStringify(plannedDocker.securityOptions)
    || !isPlainObject(probe.supportImage)
    || probe.supportImage.reference !== plannedSupportImage.reference
    || probe.supportImage.imageId !== plannedSupportImage.imageId
    || !Array.isArray(probe.probes)
    || probe.probes.length < 1
    || probe.probes.length > 64
  ) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'runner isolation evidence identity is invalid')
  }
  for (const item of probe.probes) {
    const probeKeys = isPlainObject(item) ? Object.keys(item).sort() : []
    if (
      !isPlainObject(item)
      || stableStringify(probeKeys) !== stableStringify(['expected', 'id', 'observed', 'status'])
      || typeof item.id !== 'string'
      || item.id.length < 1
      || item.id.length > 128
      || item.status !== 'passed'
      || !Object.hasOwn(item, 'expected')
      || !Object.hasOwn(item, 'observed')
      || stableStringify(item.expected) !== stableStringify(item.observed)
    ) {
      throw new DraftTestOperationError('isolation_probe_failed', 'a deterministic isolation denial probe failed')
    }
  }
  const controllerProbes = [
    { id: 'controller_name_resolution_denied', status: 'passed', expected: true, observed: network.nameResolutionDenied },
    { id: 'controller_network_denied', status: 'passed', expected: true, observed: network.outboundDenied },
  ]
  const combinedProbes = [...probe.probes, ...controllerProbes]
  const probeIds = combinedProbes.map((item) => item.id).sort()
  if (stableStringify(probeIds) !== stableStringify([...REQUIRED_ISOLATION_PROBES].sort())) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'required isolation denial probes are missing or duplicated')
  }

  const taskOrdinals = new Set()
  const containers = []
  const taskExitFacts = []
  for (const event of tasks) {
    const basis = cloneJson(event)
    delete basis.eventDigest
    const containerControls = validateTaskContainerControls(
      event.containerControls,
      event.containerControlsDigest,
      plan,
    )
    if (
      event.eventDigest !== runnerDigest(basis, 'task-event')
      || !Number.isSafeInteger(event.taskOrdinal)
      || event.taskOrdinal < 1
      || event.taskOrdinal > plan.budgets.taskCount
      || taskOrdinals.has(event.taskOrdinal)
      || typeof event.task !== 'string'
      || event.task.length < 1
      || event.task.length > 256
      || event.image !== plan.mission.software.containerImage
      || !DIGEST_PATTERN.test(event.imageId)
      || event.imageId !== plan.runner.identity.taskImage.imageId
      || !DIGEST_PATTERN.test(event.containerConfigDigest)
      || !DIGEST_PATTERN.test(event.outputManifestDigest)
      || !Number.isInteger(event.exitCode)
      || typeof event.timedOut !== 'boolean'
      || typeof event.cancelled !== 'boolean'
      || typeof event.ambiguous !== 'boolean'
    ) {
      throw new DraftTestOperationError('runner_evidence_invalid', 'runner task evidence identity is invalid')
    }
    taskOrdinals.add(event.taskOrdinal)
    containers.push({
      task: event.task,
      image: event.image,
      imageId: event.imageId,
      containerConfigDigest: event.containerConfigDigest,
      containerControls,
      containerControlsDigest: event.containerControlsDigest,
      outputManifestDigest: event.outputManifestDigest,
    })
    taskExitFacts.push({
      taskOrdinal: event.taskOrdinal,
      exitCode: event.exitCode,
      timedOut: event.timedOut,
      cancelled: event.cancelled,
      ambiguous: event.ambiguous,
    })
  }
  for (const event of taskFailures) {
    const basis = cloneJson(event)
    delete basis.failureFingerprint
    if (
      event.failureFingerprint !== runnerDigest(basis, 'task-failure')
      || !Number.isSafeInteger(event.taskOrdinal)
      || event.taskOrdinal < 1
      || event.taskOrdinal > plan.budgets.taskCount
      || taskOrdinals.has(event.taskOrdinal)
      || event.image !== plan.mission.software.containerImage
      || event.imageId !== plan.runner.identity.taskImage.imageId
      || typeof event.task !== 'string'
      || event.task.length < 1
      || event.task.length > 256
      || typeof event.code !== 'string'
      || event.automaticRetry !== false
    ) {
      throw new DraftTestOperationError('runner_evidence_invalid', 'runner task failure evidence is invalid')
    }
    taskOrdinals.add(event.taskOrdinal)
    taskExitFacts.push({
      taskOrdinal: event.taskOrdinal,
      exitCode: null,
      timedOut: event.timedOut === true,
      cancelled: event.cancelled === true,
      ambiguous: event.ambiguous === true,
      failureCode: event.code,
    })
  }
  const ordered = [...taskOrdinals].sort((left, right) => left - right)
  if (ordered.some((ordinal, index) => ordinal !== index + 1)) {
    throw new DraftTestOperationError('runner_evidence_invalid', 'runner task evidence ordinals are not contiguous')
  }
  containers.sort((left, right) => left.task.localeCompare(right.task))
  taskExitFacts.sort((left, right) => left.taskOrdinal - right.taskOrdinal)
  return {
    isolation: {
      verified: taskFailures.length === 0,
      probeDigest: runnerDigest({
        controllerGuardDigest: controllerGuard.controllerGuardDigest,
        containerProbeDigest: probe.probeDigest,
      }, 'combined-isolation'),
      probes: cloneJson(combinedProbes),
      containers,
      controller: {
        environment: cloneJson(environment),
        limits: cloneJson(limits),
        network: cloneJson(network),
        processBaseline: controllerGuard.processBaseline,
        dockerBroker: cloneJson(dockerBroker),
        runtimeEnvironmentDigest: controllerGuard.runtimeEnvironmentDigest,
        wrapperDigest: controllerGuard.wrapperDigest,
        controllerGuardDigest: controllerGuard.controllerGuardDigest,
      },
    },
    taskExitFacts,
    taskFailures,
  }
}

async function exactFileFact(path, engineRoot, limit, signal) {
  throwIfAborted(signal)
  const initial = await lstat(path, { bigint: true })
  if (!initial.isFile() && !initial.isSymbolicLink()) {
    throw new DraftTestOperationError('output_artifact_unsafe', 'workflow output artifact is not a regular file')
  }
  const canonical = await realpath(path)
  if (!isContainedPath(engineRoot, canonical)) {
    throw new DraftTestOperationError('output_artifact_unsafe', 'workflow output artifact escapes the isolated engine root')
  }
  const relativePath = relative(engineRoot, canonical).split(sep).join('/')
  if (
    relativePath.length < 1
    || Buffer.byteLength(relativePath, 'utf8') > MAX_ARTIFACT_PATH_BYTES
    || !isSafeBundlePath(relativePath)
  ) {
    throw new DraftTestOperationError('output_artifact_unsafe', 'workflow output artifact has an unsafe relative path')
  }
  let handle
  try {
    handle = await open(
      canonical,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    )
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size > BigInt(limit)) {
      throw new DraftTestOperationError('output_artifact_limit', 'workflow output artifact exceeds its byte limit')
    }
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let offset = 0n
    while (offset < before.size) {
      throwIfAborted(signal)
      const length = Number(before.size - offset > BigInt(buffer.length) ? BigInt(buffer.length) : before.size - offset)
      const result = await handle.read(buffer, 0, length, Number(offset))
      if (result.bytesRead === 0) throw new Error('output artifact changed while hashing')
      hash.update(buffer.subarray(0, result.bytesRead))
      offset += BigInt(result.bytesRead)
    }
    const after = await handle.stat({ bigint: true })
    if (
      after.size !== before.size
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
    ) {
      throw new DraftTestOperationError('output_artifact_drift', 'workflow output artifact changed while hashing')
    }
    return {
      canonical,
      relativePath,
      sizeBytes: Number(before.size),
      sha256: `sha256:${hash.digest('hex')}`,
    }
  } finally {
    await handle?.close()
  }
}

async function inventoryDirectory(path, output, ordinalState, engineRoot, budgets, signal, artifacts, seen) {
  const canonical = await realpath(path)
  if (!isContainedPath(engineRoot, canonical)) {
    throw new DraftTestOperationError('output_artifact_unsafe', 'workflow output directory escapes the isolated engine root')
  }
  const stack = [canonical]
  let entries = 0
  while (stack.length > 0) {
    throwIfAborted(signal)
    const directoryPath = stack.pop()
    const directory = await opendir(directoryPath)
    const children = []
    for await (const entry of directory) children.push(entry)
    children.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))
    for (const entry of children) {
      entries += 1
      if (entries > budgets.artifactCount * 4 + 256) {
        throw new DraftTestOperationError('output_artifact_limit', 'workflow output directory entry limit was exceeded')
      }
      const child = join(directoryPath, entry.name)
      const metadata = await lstat(child)
      if (metadata.isSymbolicLink()) {
        throw new DraftTestOperationError('output_artifact_unsafe', 'workflow output directory contains a symlink')
      }
      if (metadata.isDirectory()) stack.push(child)
      else if (metadata.isFile()) {
        const fact = await exactFileFact(child, engineRoot, budgets.artifactBytes, signal)
        const key = `${output}\u0000${fact.canonical}`
        if (!seen.has(key)) {
          seen.add(key)
          artifacts.push({ output, ordinal: ordinalState.value, ...fact })
          ordinalState.value += 1
        }
      } else {
        throw new DraftTestOperationError('output_artifact_unsafe', 'workflow output directory contains a special file')
      }
    }
  }
}

async function inventoryOutputs(outputs, engineDirectory, budgets, signal) {
  const engineRoot = await realpath(engineDirectory)
  const artifacts = []
  const seen = new Set()
  async function visit(value, output, ordinalState) {
    throwIfAborted(signal)
    if (Array.isArray(value)) {
      for (const item of value) await visit(item, output, ordinalState)
      return
    }
    if (isPlainObject(value)) {
      for (const key of Object.keys(value).sort()) await visit(value[key], output, ordinalState)
      return
    }
    if (typeof value !== 'string' || !isAbsolute(value)) return
    let metadata
    try {
      metadata = await lstat(value)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new DraftTestOperationError('output_artifact_missing', 'workflow output references a missing absolute path')
      }
      throw error
    }
    if (metadata.isDirectory()) {
      await inventoryDirectory(value, output, ordinalState, engineRoot, budgets, signal, artifacts, seen)
      return
    }
    const fact = await exactFileFact(value, engineRoot, budgets.artifactBytes, signal)
    const key = `${output}\u0000${fact.canonical}`
    if (!seen.has(key)) {
      seen.add(key)
      artifacts.push({ output, ordinal: ordinalState.value, ...fact })
      ordinalState.value += 1
    }
  }
  for (const output of Object.keys(outputs).sort()) {
    await visit(outputs[output], output, { value: 0 })
  }
  if (artifacts.length > budgets.artifactCount) {
    throw new DraftTestOperationError('output_artifact_limit', 'workflow output artifact count limit was exceeded')
  }
  const totalBytes = artifacts.reduce((sum, item) => sum + item.sizeBytes, 0)
  if (totalBytes > budgets.totalOutputBytes) {
    throw new DraftTestOperationError('output_artifact_limit', 'workflow output aggregate byte limit was exceeded')
  }
  return artifacts
    .sort((left, right) => left.output.localeCompare(right.output) || left.ordinal - right.ordinal)
    .map(({ canonical: _canonical, ...item }) => item)
}

function validatePersistedRecord(record, testId, ownerSession) {
  if (
    !isPlainObject(record)
    || record.schemaVersion !== DRAFT_TEST_RECORD_SCHEMA_VERSION
    || record.testId !== testId
    || record.ownerSession !== ownerSession
    || typeof record.runtimeId !== 'string'
    || !DIGEST_PATTERN.test(record.planDigest)
    || !DIGEST_PATTERN.test(record.commandDigest)
    || !DIGEST_PATTERN.test(record.launchGateDigest)
    || typeof record.launchReleased !== 'boolean'
    || !isPlainObject(record.plan)
    || computeDraftTestDigest(record.plan, 'plan') !== record.planDigest
    || (!TERMINAL_STATUSES.has(record.status) && !NON_TERMINAL_STATUSES.has(record.status))
  ) {
    throw new DraftTestOperationError('draft_test_record_invalid', 'draft-test record failed integrity validation')
  }
  if (
    (record.controllerIdentity !== null && (
      !validControllerIdentity(record.controllerIdentity)
      || record.controllerIdentity.pid !== record.pid
    ))
    || (record.launchReleased && record.controllerIdentity === null)
  ) {
    throw new DraftTestOperationError('draft_test_record_invalid', 'draft-test controller identity is invalid')
  }
  if (record.evidence !== null) {
    const resealed = sealDraftTestEvidence(record.evidence)
    if (resealed.evidenceDigest !== record.evidence.evidenceDigest) {
      throw new DraftTestOperationError('draft_test_record_invalid', 'draft-test evidence digest is invalid')
    }
  }
  return record
}

export function createDraftTestManager(options) {
  if (
    !isPlainObject(options)
    || typeof options.missionStore?.get !== 'function'
    || typeof options.draftStore?.resolve !== 'function'
  ) {
    throw new TypeError('draft-test manager requires Mission and draft stores')
  }
  const config = parseDraftTestConfig(options.config ?? {})
  const draftStoreRoot = options.draftStore.config?.root
  if (
    config.runsRoot !== null
    && typeof draftStoreRoot === 'string'
    && pathsOverlap(config.runsRoot, resolve(draftStoreRoot))
  ) {
    throw new TypeError('draft-test runsRoot must not overlap the workflow/draft store')
  }
  const getSubprocess = typeof options.getSubprocess === 'function' ? options.getSubprocess : () => undefined
  const getJobs = typeof options.getJobs === 'function' ? options.getJobs : () => undefined
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const createId = typeof options.createId === 'function' ? options.createId : () => randomUUID()
  const probeIdentity = typeof options.probeRunnerIdentity === 'function'
    ? options.probeRunnerIdentity
    : probeRunnerIdentity
  const cleanupResources = typeof options.cleanupDockerResources === 'function'
    ? options.cleanupDockerResources
    : cleanupOwnedDockerResources
  const sealEvidence = typeof options.sealEvidence === 'function'
    ? options.sealEvidence
    : sealDraftTestEvidence
  const captureControllerIdentity = typeof options.captureControllerIdentity === 'function'
    ? options.captureControllerIdentity
    : linuxControllerIdentity
  const terminateRecoveredController = typeof options.terminateRecoveredController === 'function'
    ? options.terminateRecoveredController
    : terminateLinuxController
  const runtimeId = options.runtimeId ?? randomUUID()
  if (typeof runtimeId !== 'string' || runtimeId.length < 1 || runtimeId.length > 128) {
    throw new TypeError('draft-test runtimeId must be a bounded string')
  }
  const activeTests = new Map()
  let initializationStatus = config.enabled ? 'pending' : 'completed'
  let initializationError = null
  let initializationPromise = null

  function ensureInitialized() {
    if (initializationPromise === null) {
      initializationPromise = Promise.resolve()
        .then(initializeRecovery)
        .then((result) => {
          initializationStatus = 'completed'
          return result
        })
        .catch((error) => {
          initializationStatus = 'failed'
          initializationError = error instanceof DraftTestOperationError
            ? error
            : new DraftTestOperationError(
              'draft_test_recovery_failed',
              'isolated draft-test startup recovery failed closed',
            )
          return { reconciledCount: 0, failed: true }
        })
    }
    return initializationPromise.then((result) => {
      if (initializationError !== null) throw initializationError
      return result
    })
  }

  function serviceSummary() {
    const subprocess = getSubprocess()
    const jobs = getJobs()
    const subprocessAvailable = (
      typeof subprocess?.resolveExecutable === 'function'
      && typeof subprocess?.spawn === 'function'
    )
    const jobsAvailable = typeof jobs?.start === 'function'
    const configured = (
      config.enabled
      && config.runsRoot !== null
      && config.fixtureRoots.length > 0
      && config.runner.supportImage !== null
    )
    return {
      enabled: config.enabled,
      configured,
      subprocessAvailable,
      jobsAvailable,
      preflightVerified: false,
      preflightScope: 'exact_mission_plan_only',
      recoveryStatus: initializationStatus,
      ready: false,
      ownerScope: 'session',
      schemaVersions: {
        record: DRAFT_TEST_RECORD_SCHEMA_VERSION,
        evidence: DRAFT_TEST_EVIDENCE_SCHEMA_VERSION,
      },
      capabilities: {
        isolatedDraftTest: configured && subprocessAvailable && jobsAvailable,
        productionExecution: false,
        workflowPromotion: false,
        productionAllowlistMutation: false,
      },
      budgets: config.budgets,
    }
  }

  async function inspectRunsRoot() {
    if (!config.enabled || config.runsRoot === null) {
      throw new DraftTestOperationError('draft_testing_disabled', 'isolated draft testing is disabled')
    }
    await assertProtectedPathAncestors(
      config.runsRoot,
      'draft-test runs root',
      'draft_test_runs_root_unsafe',
    )
    return inspectPrivateDirectory(config.runsRoot, 'draft_test_runs_root_unsafe', true)
  }

  function ownerDirectoryName(ownerSession) {
    return `owner-${createHash('sha256').update(ownerSession, 'utf8').digest('hex')}`
  }

  async function ownerDirectory(rootIdentity, ownerSession, create = false) {
    const path = join(rootIdentity.path, ownerDirectoryName(ownerSession))
    if (!create) {
      try {
        return await inspectPrivateDirectory(path, 'draft_test_owner_root_unsafe', true)
      } catch (error) {
        if (error instanceof DraftTestOperationError && error.code === 'draft_test_owner_root_unsafe') {
          const exists = await lstat(path).then(() => true, (reason) => reason?.code !== 'ENOENT')
          if (!exists) return null
        }
        throw error
      }
    }
    const identity = await ensurePrivateDirectory(path, rootIdentity)
    let entries = 0
    let tests = 0
    const directory = await opendir(identity.path)
    for await (const entry of directory) {
      entries += 1
      if (entries > MAX_OWNER_ENTRIES) {
        throw new DraftTestOperationError('draft_test_capacity_exceeded', 'owner draft-test directory entry limit was exceeded')
      }
      if (!entry.isDirectory() || entry.isSymbolicLink() || !TEST_ID_PATTERN.test(entry.name)) {
        throw new DraftTestOperationError('draft_test_owner_root_unsafe', 'owner draft-test storage contains an unsafe entry')
      }
      tests += 1
    }
    if (tests >= MAX_OWNER_TESTS) {
      throw new DraftTestOperationError('draft_test_capacity_exceeded', 'owner draft-test history capacity was exhausted')
    }
    return identity
  }

  async function initializeRecovery() {
    if (!config.enabled || config.runsRoot === null) return { reconciledCount: 0, failed: false }
    const rootIdentity = await inspectRunsRoot()
    let owners = 0
    let tests = 0
    let reconciledCount = 0
    const rootDirectory = await opendir(rootIdentity.path)
    for await (const ownerEntry of rootDirectory) {
      owners += 1
      if (owners > MAX_RECOVERY_OWNERS) {
        throw new DraftTestOperationError(
          'draft_test_recovery_capacity_exceeded',
          'draft-test owner recovery scan exceeded its bound',
        )
      }
      if (
        !ownerEntry.isDirectory()
        || ownerEntry.isSymbolicLink()
        || !/^owner-[a-f0-9]{64}$/.test(ownerEntry.name)
      ) {
        throw new DraftTestOperationError(
          'draft_test_runs_root_unsafe',
          'draft-test runs root contains an unsafe recovery entry',
        )
      }
      const ownerIdentity = await inspectPrivateDirectory(
        join(rootIdentity.path, ownerEntry.name),
        'draft_test_owner_root_unsafe',
        true,
      )
      const ownerTests = await opendir(ownerIdentity.path)
      for await (const testEntry of ownerTests) {
        tests += 1
        if (tests > MAX_RECOVERY_TESTS) {
          throw new DraftTestOperationError(
            'draft_test_recovery_capacity_exceeded',
            'draft-test recovery scan exceeded its test bound',
          )
        }
        if (
          !testEntry.isDirectory()
          || testEntry.isSymbolicLink()
          || !TEST_ID_PATTERN.test(testEntry.name)
        ) {
          throw new DraftTestOperationError(
            'draft_test_owner_root_unsafe',
            'draft-test owner root contains an unsafe recovery entry',
          )
        }
        const testIdentity = await inspectPrivateDirectory(
          join(ownerIdentity.path, testEntry.name),
          'draft_test_directory_unsafe',
          true,
        )
        const recordPath = join(testIdentity.path, 'test.json')
        const rawRecord = await readBoundedJson(recordPath, MAX_RECORD_BYTES, 'draft_test_record')
        const ownerSession = validateOwnerSession(rawRecord?.ownerSession)
        if (ownerDirectoryName(ownerSession) !== ownerEntry.name) {
          throw new DraftTestOperationError(
            'draft_test_record_invalid',
            'draft-test record owner directory identity is invalid',
          )
        }
        const record = validatePersistedRecord(rawRecord, testEntry.name, ownerSession)
        if (NON_TERMINAL_STATUSES.has(record.status)) {
          await reconcileInterrupted(record, recordPath)
          reconciledCount += 1
        }
      }
    }
    return { reconciledCount, failed: false }
  }

  async function buildPlan(request, operation = {}) {
    throwIfAborted(operation.signal)
    validatePrepareRequest(request)
    const ownerSession = validateOwnerSession(operation.ownerSession)
    const rootIdentity = await inspectRunsRoot()
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      throw new DraftTestOperationError('runner_controller_unsafe', 'isolated draft testing requires a non-root DSH process')
    }
    const subprocess = getSubprocess()
    if (
      typeof subprocess?.resolveExecutable !== 'function'
      || typeof subprocess?.spawn !== 'function'
    ) {
      throw new DraftTestOperationError(
        'subprocess_service_unavailable',
        'DSH subprocess service is unavailable for isolated draft testing',
      )
    }
    const mission = await options.missionStore.get(request.missionId, {
      ownerSession,
      signal: operation.signal,
    })
    if (!mission.ok) {
      throw new DraftTestOperationError('ready_mission_not_found', 'an owner-visible ready Mission was not found')
    }
    if (mission.status !== 'ready' || mission.phase !== 'validated') {
      throw new DraftTestOperationError('mission_not_ready', 'Mission must be ready with exact validation evidence')
    }
    const draft = await options.draftStore.resolve({
      draftId: mission.draft.draftId,
      revision: mission.draft.revision,
    }, {
      ownerSession,
      signal: operation.signal,
    })
    if (!draft.ok) {
      throw new DraftTestOperationError('validated_draft_not_found', 'the exact owner-visible validated draft was not found')
    }
    const resolvedFixture = await resolveFixtureBundle(config.fixtureRoots, {
      id: request.fixtureId,
      version: request.fixtureVersion,
    })
    if (!resolvedFixture.ok) {
      throw new DraftTestOperationError(resolvedFixture.error.code, resolvedFixture.error.message)
    }
    const budgets = effectiveDraftTestBudgets(request.budgets, config.budgets)
    if (resolvedFixture.fixture.totalFileBytes > budgets.fixtureBytes) {
      throw new DraftTestOperationError('fixture_budget_exceeded', 'fixture exceeds the requested snapshot byte budget')
    }
    const runner = await probeIdentity({
      config,
      subprocess,
      taskImage: mission.goal.software.containerImage,
      budgets,
      signal: operation.signal,
    })
    if (!isPlainObject(runner?.public) || !isPlainObject(runner?.internal)) {
      throw new DraftTestOperationError('runner_identity_invalid', 'isolated runner identity provider returned an invalid result')
    }
    const fixtureIdentity = {
      descriptor: {
        size: resolvedFixture.fixture.descriptorIdentity.size,
        mtimeNs: resolvedFixture.fixture.descriptorIdentity.mtimeNs,
        ctimeNs: resolvedFixture.fixture.descriptorIdentity.ctimeNs,
        device: resolvedFixture.fixture.descriptorIdentity.device,
        inode: resolvedFixture.fixture.descriptorIdentity.inode,
      },
      files: resolvedFixture.fixture.files.map((file) => ({
        path: file.path,
        identity: {
          size: file.identity.size,
          mtimeNs: file.identity.mtimeNs,
          ctimeNs: file.identity.ctimeNs,
          device: file.identity.device,
          inode: file.identity.inode,
        },
      })),
    }
    const runnerPublic = {
      ...runner.public,
      storage: {
        runsRoot: {
          device: rootIdentity.device,
          inode: rootIdentity.inode,
          uid: rootIdentity.uid,
          mode: rootIdentity.mode,
        },
        fixtureSourceIdentityDigest: computeDraftTestDigest(fixtureIdentity, 'fixture-source-identity'),
      },
    }
    const created = createDraftTestPlan({
      mission,
      draft,
      fixture: resolvedFixture.fixture,
      runner: runnerPublic,
      budgets,
    })
    return {
      result: {
        ...created,
        observedAt: now().toISOString(),
        readyToStart: typeof getJobs()?.start === 'function',
      },
      ownerSession,
      rootIdentity,
      mission,
      draft,
      fixture: resolvedFixture.fixture,
      runner,
      subprocess,
    }
  }

  function queuePersist(state) {
    const snapshot = cloneJson(state.record)
    const next = state.persist.catch(() => {}).then(() => atomicWriteJson(state.recordPath, snapshot))
    state.persist = next
    return next
  }

  function persistInBackground(state) {
    void queuePersist(state).catch(() => {})
  }

  function publicTest(record, job = null) {
    return {
      testId: record.testId,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      planDigest: record.planDigest,
      plan: cloneJson(record.plan),
      jobId: record.jobId,
      job,
      evidence: record.evidence === null ? null : cloneJson(record.evidence),
      automaticRetryAfterRestart: false,
      capabilities: {
        isolatedDraftTest: true,
        productionExecution: false,
        workflowPromotion: false,
        productionAllowlistMutation: false,
      },
    }
  }

  async function finalize(state, handle, staged) {
    let outcome = { exitCode: null, signal: null }
    let runnerEvidence = null
    let outputs = null
    let artifacts = []
    let assertionEvidence = emptyAssertionEvidence()
    let resources = failedResourceCleanup()
    let error = null
    const evidenceSignal = state.evidenceController.signal
    try {
      outcome = await handle.done
      await handle.waitForExit()
      throwIfAborted(evidenceSignal)
      const parsedEvidence = await readRunnerEvidence(
        staged.evidencePath,
        state.record.plan,
        state.record.testId,
        evidenceSignal,
      )
      runnerEvidence = parsedEvidence
      const taskTimedOut = parsedEvidence.taskExitFacts.some((item) => item.timedOut)
      const taskCancelled = parsedEvidence.taskExitFacts.some((item) => item.cancelled)
      const taskAmbiguous = parsedEvidence.taskExitFacts.some((item) => item.ambiguous)
      if (
        !state.cancelRequested
        && !state.wallTimedOut
        && !taskTimedOut
        && !taskCancelled
        && !taskAmbiguous
        && parsedEvidence.taskFailures.length === 0
        && outcome.exitCode === 0
        && outcome.signal === null
      ) {
        outputs = await readBoundedJson(
          join(staged.engineDirectory, 'outputs.json'),
          MAX_OUTPUTS_BYTES,
          'workflow_outputs',
          evidenceSignal,
        )
        assertionEvidence = await evaluateFixtureAssertions({
          assertions: state.record.plan.fixture.assertions,
          outputs,
          engineRoot: staged.engineDirectory,
          signal: evidenceSignal,
        })
        artifacts = await inventoryOutputs(
          outputs,
          staged.engineDirectory,
          state.record.plan.budgets,
          evidenceSignal,
        )
        throwIfAborted(evidenceSignal)
        if (!assertionEvidence.passed) {
          error = failureEvidence(
            'fixture_assertion_failed',
            'one or more deterministic fixture assertions failed',
            {
              failed: assertionEvidence.assertions
                .filter((item) => item.status !== 'passed')
                .map((item) => ({ id: item.id, code: item.code })),
            },
          )
        }
      } else if (state.cancelRequested || taskCancelled) {
        error = failureEvidence('draft_test_cancelled', 'isolated draft test was cancelled by its owner')
      } else if (state.wallTimedOut) {
        error = failureEvidence('wall_time_exceeded', 'isolated draft test exceeded its approved wall-time budget')
      } else if (taskTimedOut) {
        error = failureEvidence('task_time_exceeded', 'an isolated WDL task exceeded its approved time budget')
      } else if (taskAmbiguous) {
        error = failureEvidence('task_launch_ambiguous', 'isolated task launch outcome was ambiguous and was not retried')
      } else if (parsedEvidence.taskFailures.length > 0) {
        error = failureEvidence(
          parsedEvidence.taskFailures[0].code,
          'isolated task backend failed closed without retry',
        )
      } else {
        error = failureEvidence('miniwdl_failed', 'isolated miniwdl controller exited unsuccessfully')
      }
    } catch (caught) {
      error = state.cancelRequested
        ? failureEvidence('draft_test_cancelled', 'isolated draft test was cancelled by its owner')
        : state.wallTimedOut
        ? failureEvidence('wall_time_exceeded', 'isolated draft test exceeded its approved wall-time budget')
        : state.launchFailure instanceof DraftTestOperationError
        ? failureEvidence(state.launchFailure.code, state.launchFailure.message)
        : caught instanceof DraftTestOperationError
        ? failureEvidence(caught.code, caught.message)
        : failureEvidence('evidence_collection_failed', 'isolated draft-test evidence collection failed closed')
    }

    try {
      resources = bindControllerTermination(await cleanupResources({
        subprocess: staged.subprocess,
        dockerExecutable: config.runner.dockerExecutable,
        plan: state.record.plan,
        testId: state.record.testId,
      }), { verified: true, mode: 'live_handle_exit_verified' })
    } catch (cleanupError) {
      resources = failedResourceCleanup(
        cleanupError instanceof DraftTestOperationError
          ? cleanupError.code
          : 'resource_cleanup_unverified',
        { verified: true, mode: 'live_handle_exit_verified' },
      )
      error = failureEvidence(
        'resource_cleanup_unverified',
        'owned Docker resource cleanup could not be verified after the isolated test',
      )
    } finally {
      clearTimeout(state.wallTimer)
    }

    if (state.cancelRequested) {
      error = failureEvidence('draft_test_cancelled', 'isolated draft test was cancelled by its owner')
    } else if (state.wallTimedOut) {
      error = failureEvidence('wall_time_exceeded', 'isolated draft test exceeded its approved wall-time budget')
    }

    const logMaximum = Math.floor(state.record.plan.budgets.logBytes / 2)
    const replacements = [
      [state.record.runDirectory, '$RUN'],
      [staged.runner.wrapperPath, '$RUNNER'],
      [staged.runner.pythonPath, '$PYTHON'],
      [staged.runner.dockerPath, '$DOCKER'],
    ]
    const logs = {
      stdout: sanitizedLog(handle.collected?.stdout, logMaximum, replacements),
      stderr: sanitizedLog(handle.collected?.stderr, logMaximum, replacements),
    }
    const taskExitFacts = runnerEvidence?.taskExitFacts ?? []
    const timedOut = state.wallTimedOut || taskExitFacts.some((item) => item.timedOut)
    const cancelled = state.cancelRequested || taskExitFacts.some((item) => item.cancelled)
    const ambiguous = taskExitFacts.some((item) => item.ambiguous)
    const passed = (
      error === null
      && runnerEvidence?.isolation.verified === true
      && assertionEvidence.passed === true
      && outcome.exitCode === 0
      && outcome.signal === null
      && !timedOut
      && !cancelled
      && !ambiguous
      && resources.cleanupVerified === true
    )
    const status = cancelled ? 'cancelled' : passed || error?.code === 'fixture_assertion_failed' ? 'completed' : 'failed'
    const finishedAt = now().toISOString()
    const evidence = sealTerminalEvidence({
      schemaVersion: DRAFT_TEST_EVIDENCE_SCHEMA_VERSION,
      testId: state.record.testId,
      planDigest: state.record.planDigest,
      status,
      startedAt: state.record.startedAt,
      finishedAt,
      identities: identitiesFromPlan(state.record.plan),
      budgets: cloneJson(state.record.plan.budgets),
      isolation: runnerEvidence?.isolation ?? syntheticIsolationEvidence(error?.code ?? 'runner_evidence_missing'),
      exit: {
        exitCode: Number.isInteger(outcome.exitCode) ? outcome.exitCode : null,
        signal: typeof outcome.signal === 'string' ? outcome.signal.slice(0, 64) : null,
        timedOut,
        cancelled,
        ambiguous,
      },
      logs,
      artifacts,
      assertionEvidence,
      resources,
      failure: error,
      passed,
      capabilities: {
        isolatedDraftTest: true,
        productionExecution: false,
        workflowPromotion: false,
        productionAllowlistMutation: false,
      },
    }, {
      testId: state.record.testId,
      plan: state.record.plan,
      startedAt: state.record.startedAt,
      finishedAt,
    }, sealEvidence)
    state.record.status = evidence.status
    state.record.finishedAt = finishedAt
    state.record.exit = evidence.exit
    state.record.outputsDigest = evidence.failure?.code === 'evidence_contract_failed' || outputs === null
      ? null
      : computeDraftTestDigest(outputs, 'outputs')
    state.record.evidence = evidence
    try {
      await queuePersist(state)
      activeTests.delete(state.record.testId)
    } catch {
      state.record.status = 'failed'
      return { status: 'failed', detail: 'terminal draft-test evidence could not be persisted' }
    }
    return {
      status: evidence.status,
      detail: evidence.passed
        ? 'isolated fixture assertions passed'
        : `${evidence.failure?.code ?? 'failed'}: ${evidence.failure?.message ?? 'failed'}`,
    }
  }

  async function start(request, operation = {}) {
    let testDirectoryCreated = false
    let testDirectory = null
    let testId = null
    let state = null
    let ownerIdentity = null
    try {
      await ensureInitialized()
      validatePrepareRequest(request, true)
      const prepared = await buildPlan(prepareRequest(request), operation)
      if (!prepared.result.readyToStart) {
        throw new DraftTestOperationError('jobs_service_unavailable', 'DSH background jobs service is unavailable')
      }
      if (prepared.result.planDigest !== request.expectedPlanDigest) {
        return failure(
          'draft_test_plan_digest_mismatch',
          'live draft-test plan does not match expectedPlanDigest',
          {
            expectedPlanDigest: request.expectedPlanDigest,
            actualPlanDigest: prepared.result.planDigest,
          },
        )
      }
      ownerIdentity = await ownerDirectory(
        prepared.rootIdentity,
        prepared.ownerSession,
        true,
      )
      testId = `test-${createId()}`
      validateTestId(testId)
      testDirectory = join(ownerIdentity.path, testId)
      await assertDirectoryUnchanged(ownerIdentity, 'draft_test_owner_root_unsafe', true)
      await mkdir(testDirectory, { mode: 0o700 })
      testDirectoryCreated = true
      const testIdentity = await inspectPrivateDirectory(testDirectory, 'draft_test_directory_unsafe', true)
      const homeDirectory = join(testIdentity.path, 'controller-home')
      await mkdir(homeDirectory, { mode: 0o700 })
      const wdlRoot = join(testIdentity.path, 'wdl')
      const fixtureRoot = join(testIdentity.path, 'fixture')
      const fixtureDataRoot = join(fixtureRoot, 'data')
      await mkdir(fixtureRoot, { mode: 0o700 })
      const entrypoint = await snapshotDraft(prepared.draft, wdlRoot)
      const fixtureSnapshot = await snapshotFixture(
        prepared.fixture,
        fixtureDataRoot,
        prepared.result.plan.budgets.fixtureBytes,
      )
      const inputsPath = join(testIdentity.path, 'inputs.json')
      const evidencePath = join(testIdentity.path, 'runner-evidence.jsonl')
      const launchGatePath = join(testIdentity.path, 'launch-gate.bin')
      const launchGateToken = randomBytes(32)
      const launchGateDigest = `sha256:${createHash('sha256').update(launchGateToken).digest('hex')}`
      const canaryPath = join(testIdentity.path, 'isolation-canary.bin')
      const configPath = join(testIdentity.path, 'miniwdl.cfg')
      const engineDirectory = join(fixtureRoot, 'engine')
      await writeExclusive(inputsPath, `${JSON.stringify(fixtureSnapshot.inputs, null, 2)}\n`, 0o400)
      await writeExclusive(evidencePath, Buffer.alloc(0), 0o600)
      const canary = randomBytes(32)
      const canaryDigest = `sha256:${createHash('sha256').update(canary).digest('hex')}`
      await writeExclusive(canaryPath, canary, 0o400)
      await writeExclusive(configPath, createMiniwdlConfig({
        runDirectory: testIdentity.path,
        wdlRoot,
        fixtureRoot,
        fixtureDataRoot,
        inputsPath,
        evidencePath,
        launchGatePath,
        launchGateDigest,
        canaryPath,
        canaryDigest,
        testId,
        planDigest: prepared.result.planDigest,
        plan: prepared.result.plan,
        runner: prepared.runner.internal,
      }), 0o400)

      const live = await buildPlan(prepareRequest(request), operation)
      if (
        live.result.planDigest !== prepared.result.planDigest
        || stableStringify(live.runner.internal) !== stableStringify(prepared.runner.internal)
      ) {
        throw new DraftTestOperationError(
          'draft_test_identity_drift',
          'draft, fixture, runner, or isolation identity changed after approval',
        )
      }
      const stagedRunner = {
        ...live.runner.internal,
        wrapperPath: await snapshotRunnerWrapper(
          live.runner.internal.wrapperPath,
          live.runner.public.executables.wrapper,
          join(testIdentity.path, 'dsh_fixture_runner.py'),
        ),
      }
      await assertDirectoryUnchanged(prepared.rootIdentity, 'draft_test_runs_root_unsafe', true)
      await assertDirectoryUnchanged(ownerIdentity, 'draft_test_owner_root_unsafe', true)
      await assertDirectoryUnchanged(testIdentity, 'draft_test_directory_unsafe', true)
      throwIfAborted(operation.signal)

      const argv = runnerArgv({
        runner: stagedRunner,
        entrypoint,
        inputsPath,
        engineDirectory,
        configPath,
      })
      const startedAt = now().toISOString()
      const recordPath = join(testIdentity.path, 'test.json')
      state = {
        cancelRequested: false,
        wallTimedOut: false,
        wallTimer: null,
        evidenceController: new AbortController(),
        handle: null,
        launchReady: Promise.resolve(true),
        launchFailure: null,
        cancel: null,
        persist: Promise.resolve(),
        recordPath,
        record: {
          schemaVersion: DRAFT_TEST_RECORD_SCHEMA_VERSION,
          testId,
          ownerSession: prepared.ownerSession,
          runtimeId,
          status: 'prepared',
          startedAt,
          finishedAt: null,
          jobId: null,
          runDirectory: testIdentity.path,
          planDigest: prepared.result.planDigest,
          plan: prepared.result.plan,
          commandDigest: computeDraftTestDigest({
            argv: argv.map((item) => item.replaceAll(testIdentity.path, '$RUN')),
            environment: 'exact_allowlist_without_ambient_credentials',
          }, 'command'),
          pid: null,
          controllerIdentity: null,
          launchGateDigest,
          launchReleased: false,
          exit: null,
          outputsDigest: null,
          evidence: null,
        },
      }
      activeTests.set(testId, state)
      await queuePersist(state)
      const jobs = getJobs()
      const owner = operation.agent ?? { id: prepared.ownerSession }
      let handle
      let jobId
      try {
        jobId = jobs.start({
          kind: 'bio-draft-test',
          label: `isolated ${testId}`,
          outputLimitBytes: prepared.result.plan.budgets.logBytes,
          owner,
          run() {
            handle = live.subprocess.spawn({
              argv,
              cwd: wdlRoot,
              stdio: {
                stdin: 'ignore',
                stdout: { maxBytes: Math.floor(prepared.result.plan.budgets.logBytes / 2) },
                stderr: { maxBytes: Math.floor(prepared.result.plan.budgets.logBytes / 2) },
              },
              graceMs: PROCESS_GRACE_MS,
              env: exactControllerEnvironment(homeDirectory),
            })
            state.handle = handle
            state.record.pid = handle.pid ?? null
            state.launchReady = (async () => {
              const controllerIdentity = await captureControllerIdentity(handle.pid, argv)
              if (
                !validControllerIdentity(controllerIdentity)
                || controllerIdentity.pid !== handle.pid
              ) {
                throw new DraftTestOperationError(
                  'controller_identity_unavailable',
                  'spawned controller identity could not be durably proven',
                )
              }
              state.record.controllerIdentity = controllerIdentity
              state.record.status = 'running'
              state.record.launchReleased = true
              await queuePersist(state)
              await writeExclusive(launchGatePath, launchGateToken, 0o400)
              return true
            })().catch((launchError) => {
              state.launchFailure = launchError instanceof DraftTestOperationError
                ? launchError
                : new DraftTestOperationError(
                  'controller_identity_unavailable',
                  'spawned controller identity could not be durably proven',
                )
              state.record.status = 'stopping'
              persistInBackground(state)
              handle.terminate()
              return false
            })
            state.wallTimer = setTimeout(() => {
              if (TERMINAL_STATUSES.has(state.record.status)) return
              state.wallTimedOut = true
              state.evidenceController.abort(new DraftTestOperationError(
                'wall_time_exceeded',
                'isolated draft test exceeded its approved wall-time budget',
              ))
              handle.terminate()
            }, prepared.result.plan.budgets.wallTimeMs)
            state.wallTimer.unref?.()
            state.cancel = () => {
              if (state.cancelRequested || TERMINAL_STATUSES.has(state.record.status)) return
              state.cancelRequested = true
              state.record.status = 'stopping'
              state.evidenceController.abort(new DraftTestOperationError(
                'draft_test_cancelled',
                'isolated draft test was cancelled by its owner',
              ))
              persistInBackground(state)
              handle.terminate()
            }
            return {
              cancel: state.cancel,
              done: state.launchReady.then(() => finalize(state, handle, {
                engineDirectory,
                evidencePath,
                runner: stagedRunner,
                subprocess: live.subprocess,
              })),
              readOutput() {
                const stdout = collectedText(handle.collected?.stdout).text
                const stderr = collectedText(handle.collected?.stderr).text
                return [stdout, stderr].filter(Boolean).join('\n')
                  .replaceAll(testIdentity.path, '$RUN')
                  .slice(0, prepared.result.plan.budgets.logBytes)
              },
            }
          },
        })
      } catch {
        handle?.terminate()
        await handle?.waitForExit?.().catch(() => false)
        throw new DraftTestOperationError(
          'job_start_ambiguous',
          'draft-test job launch failed or was ambiguous; it was not retried',
        )
      }
      state.record.jobId = jobId
      await state.launchReady
      await queuePersist(state).catch(() => {})
      return {
        ok: true,
        testId,
        jobId,
        status: state.record.status,
        planDigest: state.record.planDigest,
        capabilities: {
          isolatedDraftTest: true,
          productionExecution: false,
          workflowPromotion: false,
          productionAllowlistMutation: false,
        },
        error: null,
      }
    } catch (error) {
      if (testId !== null) activeTests.delete(testId)
      if (state?.wallTimer != null) clearTimeout(state.wallTimer)
      if (testDirectoryCreated && testDirectory !== null) {
        try {
          if (state !== null) await state.persist.catch(() => {})
          if (ownerIdentity !== null) await makeOwnedTreeRemovable(testDirectory, ownerIdentity)
          await rm(testDirectory, { recursive: true })
        } catch {
          return failure(
            'draft_test_cleanup_failed',
            'draft-test launch failed and its newly created private directory could not be removed',
            testId === null ? {} : { testId },
          )
        }
      }
      return operationFailure(error)
    }
  }

  async function readOwnedRecord(testId, ownerSession) {
    const rootIdentity = await inspectRunsRoot()
    const ownerIdentity = await ownerDirectory(rootIdentity, ownerSession, false)
    if (ownerIdentity === null) return null
    const directoryPath = join(ownerIdentity.path, testId)
    let testIdentity
    try {
      testIdentity = await inspectPrivateDirectory(directoryPath, 'draft_test_directory_unsafe', true)
    } catch (error) {
      if (error instanceof DraftTestOperationError) {
        const exists = await lstat(directoryPath).then(() => true, (reason) => reason?.code !== 'ENOENT')
        if (!exists) return null
      }
      throw error
    }
    const record = await readBoundedJson(join(testIdentity.path, 'test.json'), MAX_RECORD_BYTES, 'draft_test_record')
    return {
      record: validatePersistedRecord(record, testId, ownerSession),
      recordPath: join(testIdentity.path, 'test.json'),
    }
  }

  async function reconcileInterrupted(record, recordPath) {
    if (!NON_TERMINAL_STATUSES.has(record.status)) return record
    const finishedAt = now().toISOString()
    let resources
    let error
    let termination = { verified: false, mode: 'controller_termination_unverified' }
    try {
      if (record.controllerIdentity === null) {
        if (record.launchReleased) {
          throw new DraftTestOperationError(
            'controller_termination_unverified',
            'a released draft-test controller has no durable anti-PID-reuse identity',
          )
        }
        termination = { verified: true, mode: 'no_controller_started' }
      } else {
        termination = await terminateRecoveredController(record.controllerIdentity)
        if (
          !isPlainObject(termination)
          || termination.verified !== true
          || !['exact_identity_already_absent', 'exact_identity_terminated', 'exact_identity_killed']
            .includes(termination.mode)
        ) {
          throw new DraftTestOperationError(
            'controller_termination_unverified',
            'persisted draft-test controller termination was not proved exactly',
          )
        }
      }
      resources = bindControllerTermination(await cleanupResources({
        subprocess: getSubprocess(),
        dockerExecutable: config.runner.dockerExecutable,
        plan: record.plan,
        testId: record.testId,
      }), termination)
      error = failureEvidence(
        'runtime_restart_interrupted',
        'the prior draft-test controller was terminated or proved absent after runtime restart; automatic retry is disabled',
      )
    } catch (cleanupError) {
      resources = failedResourceCleanup(
        cleanupError instanceof DraftTestOperationError
          ? cleanupError.code
          : 'resource_cleanup_unverified',
        termination,
      )
      error = failureEvidence(
        cleanupError instanceof DraftTestOperationError
          ? cleanupError.code
          : 'resource_cleanup_unverified',
        'runtime restart reconciliation could not prove controller termination and owned resource removal',
      )
    }
    record.status = 'interrupted'
    record.finishedAt = finishedAt
    record.exit = {
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: false,
      ambiguous: true,
    }
    record.evidence = sealTerminalEvidence({
      schemaVersion: DRAFT_TEST_EVIDENCE_SCHEMA_VERSION,
      testId: record.testId,
      planDigest: record.planDigest,
      status: 'interrupted',
      startedAt: record.startedAt,
      finishedAt,
      identities: identitiesFromPlan(record.plan),
      budgets: cloneJson(record.plan.budgets),
      isolation: syntheticIsolationEvidence('runtime_restart_interrupted'),
      exit: record.exit,
      logs: {
        stdout: sanitizedLog(null, 0, []),
        stderr: sanitizedLog(null, 0, []),
      },
      artifacts: [],
      assertionEvidence: emptyAssertionEvidence(),
      resources,
      failure: error,
      passed: false,
      capabilities: {
        isolatedDraftTest: true,
        productionExecution: false,
        workflowPromotion: false,
        productionAllowlistMutation: false,
      },
    }, {
      testId: record.testId,
      plan: record.plan,
      startedAt: record.startedAt,
      finishedAt,
    }, sealEvidence)
    record.status = record.evidence.status
    record.exit = record.evidence.exit
    await atomicWriteJson(recordPath, record)
    return record
  }

  async function get(testId, operation = {}) {
    try {
      await ensureInitialized()
      validateTestId(testId)
      const ownerSession = validateOwnerSession(operation.ownerSession)
      const active = activeTests.get(testId)
      let record
      if (active !== undefined) {
        if (active.record.ownerSession !== ownerSession) {
          return failure('draft_test_not_found', 'draft test was not found')
        }
        record = cloneJson(active.record)
      } else {
        const persisted = await readOwnedRecord(testId, ownerSession)
        if (persisted === null) return failure('draft_test_not_found', 'draft test was not found')
        record = persisted.record
        if (NON_TERMINAL_STATUSES.has(record.status)) {
          record = await reconcileInterrupted(record, persisted.recordPath)
        }
      }
      let job = null
      if (typeof record.jobId === 'string' && typeof getJobs()?.get === 'function') {
        try {
          job = await getJobs().get(record.jobId, operation.agent ?? { id: ownerSession })
        } catch {
          job = null
        }
      }
      return { ok: true, test: publicTest(record, job), error: null }
    } catch (error) {
      return operationFailure(error)
    }
  }

  async function cancel(testId, operation = {}) {
    try {
      await ensureInitialized()
      validateTestId(testId)
      const ownerSession = validateOwnerSession(operation.ownerSession)
      const active = activeTests.get(testId)
      if (active === undefined || active.record.ownerSession !== ownerSession) {
        const existing = await get(testId, operation)
        if (!existing.ok) return existing
        return existing
      }
      if (!TERMINAL_STATUSES.has(active.record.status)) active.cancel?.()
      return { ok: true, test: publicTest(active.record), error: null }
    } catch (error) {
      return operationFailure(error)
    }
  }

  async function report(testId, operation = {}) {
    const result = await get(testId, operation)
    if (!result.ok) return result
    const test = result.test
    return {
      ok: true,
      report: {
        schemaVersion: DRAFT_TEST_REPORT_SCHEMA_VERSION,
        testId: test.testId,
        generatedAt: now().toISOString(),
        status: test.status,
        outcome: test.evidence?.passed === true ? 'isolated_fixture_passed' : test.status,
        passed: test.evidence?.passed === true,
        planDigest: test.planDigest,
        identities: test.evidence?.identities ?? identitiesFromPlan(test.plan),
        assertionEvidence: test.evidence?.assertionEvidence ?? emptyAssertionEvidence(),
        failure: test.evidence?.failure ?? null,
        capabilities: {
          isolatedDraftTest: true,
          productionExecution: false,
          workflowPromotion: false,
          productionAllowlistMutation: false,
        },
        limitations: [
          'isolated_trial_does_not_install_or_promote_the_draft',
          'isolated_trial_does_not_modify_the_production_allowlist',
          'isolated_trial_does_not_authorize_production_execution',
          'software_trial_report_v1_success_remains_false',
        ],
      },
      error: null,
    }
  }

  queueMicrotask(() => {
    void ensureInitialized().catch(() => {})
  })

  return Object.freeze({
    config,
    get summary() {
      return serviceSummary()
    },
    async prepare(request, operation = {}) {
      try {
        await ensureInitialized()
        return (await buildPlan(request, operation)).result
      } catch (error) {
        return operationFailure(error)
      }
    },
    initialize: ensureInitialized,
    start,
    get,
    cancel,
    report,
  })
}
