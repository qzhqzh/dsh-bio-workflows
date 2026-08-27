import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { TextDecoder } from 'node:util'

import { parseWorkflowStoreConfig } from './workflow-store.js'

export const MISSION_SCHEMA_VERSION = '1'
export const FAILURE_EVIDENCE_SCHEMA_VERSION = '1'
export const SOFTWARE_TRIAL_REPORT_SCHEMA_VERSION = '1'

export const MISSION_ACTIONS = Object.freeze([
  'draft_create',
  'draft_update',
  'draft_validate',
])

export const MISSION_DEFAULT_LIMITS = Object.freeze({
  maxActions: 32,
  maxDraftCreates: 1,
  maxDraftUpdates: 8,
  maxValidationFailures: 8,
  maxSameFailureFingerprint: 3,
  maxWallTimeMs: 45 * 60 * 1000,
})

const AUTONOMY_CONFIG_KEYS = new Set(['enabled', ...Object.keys(MISSION_DEFAULT_LIMITS)])
const BUDGET_KEYS = new Set(Object.keys(MISSION_DEFAULT_LIMITS))
const STATUS_SET = new Set(['active', 'ready', 'exhausted', 'blocked', 'cancelled', 'interrupted'])
const TERMINAL_STATUS_SET = new Set(['ready', 'exhausted', 'blocked', 'cancelled', 'interrupted'])
const PHASE_SET = new Set(['authoring', 'validating', 'diagnosing', 'validated', 'stopped'])
const MISSION_ID_PATTERN = /^mission-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DRAFT_ID_PATTERN = /^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const PINNED_IMAGE_PATTERN = /^[^\s"'\\]+@sha256:[a-f0-9]{64}$/
const MAX_OWNER_LENGTH = 512
const MAX_MISSIONS_PER_OWNER = 128
const MAX_OWNER_DIRECTORY_ENTRIES = 512
const MAX_RECORD_BYTES = 512 * 1024
const MAX_EVENTS = 64
const MAX_FAILURES = 32
const MAX_CRITERIA = 16
const MAX_NAME_LENGTH = 160
const MAX_VERSION_LENGTH = 128
const MAX_IMAGE_LENGTH = 512
const MAX_OBJECTIVE_LENGTH = 4000
const MAX_CRITERION_LENGTH = 1000
const MAX_EVENT_CODE_LENGTH = 128
const MAX_EVENT_MESSAGE_LENGTH = 512
const HARD_LIMITS = Object.freeze({
  maxActions: 64,
  maxDraftCreates: 4,
  maxDraftUpdates: 16,
  maxValidationFailures: 16,
  maxSameFailureFingerprint: 5,
  maxWallTimeMs: 24 * 60 * 60 * 1000,
})
const MIN_LIMITS = Object.freeze({
  maxActions: 1,
  maxDraftCreates: 1,
  maxDraftUpdates: 1,
  maxValidationFailures: 1,
  maxSameFailureFingerprint: 1,
  maxWallTimeMs: 60 * 1000,
})
const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
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
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function digestValue(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')}`
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function errorResult(code, message, details = {}) {
  return { ok: false, error: { code, message }, ...details }
}

function throwIfAborted(signal) {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('mission store operation was aborted')
  error.name = 'AbortError'
  throw error
}

function assertString(value, label, minLength, maxLength) {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    throw new TypeError(`${label} must contain ${minLength} to ${maxLength} characters`)
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${label} must contain well-formed Unicode`)
      }
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${label} must contain well-formed Unicode`)
    }
  }
  return value
}

function validateOwnerSession(value) {
  return assertString(value, 'owner session', 1, MAX_OWNER_LENGTH)
}

function validateMissionId(value) {
  if (typeof value !== 'string' || !MISSION_ID_PATTERN.test(value)) {
    throw new TypeError('missionId must be a plugin-minted mission UUID')
  }
  return value
}

function validateDraftId(value) {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) {
    throw new TypeError('draftId must be a plugin-minted draft UUID')
  }
  return value
}

function validateDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a SHA-256 digest`)
  }
  return value
}

function validateDate(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO date-time string`)
  }
  return value
}

function validateInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function parseAutonomyConfig(value = {}, storeConfig = {}) {
  if (!isPlainObject(value)) throw new TypeError('autonomy config must be an object')
  for (const key of Object.keys(value)) {
    if (!AUTONOMY_CONFIG_KEYS.has(key)) {
      throw new TypeError(`unsupported autonomy config property: ${key}`)
    }
  }
  const parsedStore = parseWorkflowStoreConfig(storeConfig)
  const enabled = value.enabled ?? false
  if (typeof enabled !== 'boolean') throw new TypeError('autonomy.enabled must be a boolean')
  if (enabled && (!parsedStore.writeEnabled || parsedStore.root === null)) {
    throw new TypeError('autonomy requires a configured write-enabled workflow store')
  }
  const limits = {}
  for (const [key, fallback] of Object.entries(MISSION_DEFAULT_LIMITS)) {
    const supplied = value[key] ?? fallback
    limits[key] = validateInteger(supplied, `autonomy.${key}`, MIN_LIMITS[key], HARD_LIMITS[key])
  }
  return deepFreeze({
    enabled,
    root: parsedStore.root === null ? null : join(parsedStore.root, 'missions'),
    limits,
  })
}

function normalizeGoal(request) {
  if (!isPlainObject(request)) throw new TypeError('mission request must be an object')
  for (const key of Object.keys(request)) {
    if (!['software', 'objective', 'acceptanceCriteria', 'budget', 'expectedPlanDigest'].includes(key)) {
      throw new TypeError(`unsupported mission request property: ${key}`)
    }
  }
  if (!isPlainObject(request.software)) throw new TypeError('software must be an object')
  for (const key of Object.keys(request.software)) {
    if (!['name', 'version', 'containerImage'].includes(key)) {
      throw new TypeError(`unsupported software property: ${key}`)
    }
  }
  const software = {
    name: assertString(request.software.name, 'software.name', 1, MAX_NAME_LENGTH),
    version: assertString(request.software.version, 'software.version', 1, MAX_VERSION_LENGTH),
    containerImage: assertString(
      request.software.containerImage,
      'software.containerImage',
      1,
      MAX_IMAGE_LENGTH,
    ),
  }
  if (!PINNED_IMAGE_PATTERN.test(software.containerImage)) {
    throw new TypeError('software.containerImage must be an exact SHA-256 digest-pinned image')
  }
  const objective = assertString(request.objective, 'objective', 1, MAX_OBJECTIVE_LENGTH)
  if (
    !Array.isArray(request.acceptanceCriteria)
    || request.acceptanceCriteria.length < 1
    || request.acceptanceCriteria.length > MAX_CRITERIA
  ) {
    throw new TypeError(`acceptanceCriteria must contain 1 to ${MAX_CRITERIA} items`)
  }
  const acceptanceCriteria = request.acceptanceCriteria.map((item, index) => (
    assertString(item, `acceptanceCriteria[${index}]`, 1, MAX_CRITERION_LENGTH)
  ))
  return deepFreeze({ software, objective, acceptanceCriteria })
}

function effectivePolicy(requested, maxima) {
  if (requested !== undefined && !isPlainObject(requested)) {
    throw new TypeError('budget must be an object')
  }
  for (const key of Object.keys(requested ?? {})) {
    if (!BUDGET_KEYS.has(key)) throw new TypeError(`unsupported budget property: ${key}`)
  }
  const limits = {}
  for (const [key, maximum] of Object.entries(maxima)) {
    const supplied = requested?.[key] ?? maximum
    const bounded = validateInteger(supplied, `budget.${key}`, MIN_LIMITS[key], HARD_LIMITS[key])
    limits[key] = Math.min(bounded, maximum)
  }
  return deepFreeze({ allowedActions: [...MISSION_ACTIONS], ...limits })
}

function createPlan(request, config) {
  const goal = normalizeGoal(request)
  const policy = effectivePolicy(request.budget, config.limits)
  const plan = deepFreeze({
    schemaVersion: MISSION_SCHEMA_VERSION,
    goal,
    policy,
    authorization: {
      required: true,
      binding: 'planDigest',
      grantScope: 'same-owner-session-bounded-draft-authoring',
    },
    capabilities: {
      draftAuthoring: true,
      deterministicValidation: true,
      isolatedDraftTest: false,
      productionExecution: false,
      workflowPromotion: false,
    },
    limitations: [
      'container_identity_not_pulled_or_executed',
      'isolated_draft_test_runner_unavailable',
      'production_execution_not_authorized',
      'runtime_restart_interrupts_without_retry',
    ],
  })
  return deepFreeze({ ok: true, planDigest: digestValue(plan), plan, error: null })
}

function isContainedPath(root, target) {
  const remainder = relative(root, target)
  return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`))
}

function currentUid() {
  return typeof process.getuid === 'function' ? BigInt(process.getuid()) : null
}

function assertPrivateDirectory(metadata, path) {
  const uid = currentUid()
  if (uid !== null && metadata.uid !== uid) {
    throw new Error(`mission store directory must be owned by the DSH process user: ${path}`)
  }
  if ((metadata.mode & 0o022n) !== 0n) {
    throw new Error(`mission store directory must not be writable by group or other users: ${path}`)
  }
}

async function assertProtectedPathAncestors(path) {
  const uid = currentUid()
  const ancestors = []
  let ancestor = dirname(path)
  while (true) {
    const metadata = await lstat(ancestor, { bigint: true })
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('mission store ancestors must be non-symlink directories')
    }
    ancestors.push(metadata)
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  const rootUid = ancestors.at(-1).uid
  for (const metadata of ancestors) {
    if (uid !== null && metadata.uid !== rootUid && metadata.uid !== uid) {
      throw new Error('mission store ancestors must be owned by filesystem root or the DSH process user')
    }
    if ((metadata.mode & 0o022n) !== 0n && (metadata.mode & 0o1000n) === 0n) {
      throw new Error('writable mission store ancestors must use sticky replacement protection')
    }
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

async function inspectDirectoryIdentity(path, containmentRoot, requirePrivate = true) {
  const initial = await lstat(path, { bigint: true })
  if (!initial.isDirectory() || initial.isSymbolicLink()) {
    throw new Error(`unsafe mission store path component: ${path}`)
  }
  const canonical = await realpath(path)
  const completed = await lstat(path, { bigint: true })
  if (
    !completed.isDirectory()
    || completed.isSymbolicLink()
    || completed.dev !== initial.dev
    || completed.ino !== initial.ino
    || !isContainedPath(containmentRoot, canonical)
    || canonical !== path
  ) {
    throw new Error(`unsafe mission store path component: ${path}`)
  }
  if (requirePrivate) assertPrivateDirectory(completed, path)
  return directoryIdentity(canonical, completed)
}

async function ensureDirectory(path, containmentRoot = path, requirePrivate = true) {
  try {
    return await inspectDirectoryIdentity(path, containmentRoot, requirePrivate)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (mkdirError) {
      if (mkdirError?.code !== 'EEXIST') throw mkdirError
    }
  }
  return inspectDirectoryIdentity(path, containmentRoot, requirePrivate)
}

async function ensureRoot(path) {
  const parsed = parse(path)
  let current = parsed.root
  for (const segment of path.slice(parsed.root.length).split(sep).filter(Boolean)) {
    current = join(current, segment)
    await ensureDirectory(current, current, false)
  }
  await assertProtectedPathAncestors(path)
  return ensureDirectory(path)
}

async function assertDirectoryUnchanged(identity, containmentRoot) {
  const observed = await inspectDirectoryIdentity(identity.path, containmentRoot)
  if (
    !isContainedPath(containmentRoot, observed.path)
    || observed.device !== identity.device
    || observed.inode !== identity.inode
    || observed.uid !== identity.uid
    || observed.mode !== identity.mode
  ) {
    throw new Error(`mission store directory changed during operation: ${identity.path}`)
  }
}

async function writeExclusiveText(path, content, containmentRoot) {
  let handle
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    const opened = await handle.stat({ bigint: true })
    const canonical = await realpath(path)
    const observed = await lstat(path, { bigint: true })
    if (
      !opened.isFile()
      || observed.isSymbolicLink()
      || opened.dev !== observed.dev
      || opened.ino !== observed.ino
      || !isContainedPath(containmentRoot, canonical)
    ) {
      throw new Error(`unsafe mission store destination: ${path}`)
    }
    await handle.writeFile(content, 'utf8')
    const completed = await handle.stat({ bigint: true })
    if (
      !completed.isFile()
      || completed.dev !== opened.dev
      || completed.ino !== opened.ino
    ) {
      throw new Error(`mission store destination changed while writing: ${path}`)
    }
  } finally {
    await handle?.close()
  }
}

async function atomicWriteRecord(path, record, identity) {
  const content = `${JSON.stringify(record)}\n`
  if (Buffer.byteLength(content, 'utf8') > MAX_RECORD_BYTES) {
    throw new Error('mission record exceeds the bounded persistence size')
  }
  const temporary = join(identity.path, `.mission-${randomUUID()}.tmp`)
  let renamed = false
  try {
    await writeExclusiveText(temporary, content, identity.path)
    await assertDirectoryUnchanged(identity, identity.path)
    await rename(temporary, path)
    renamed = true
  } finally {
    if (!renamed) await unlink(temporary).catch(() => {})
  }
}

async function readBoundedJson(path, containmentRoot) {
  let handle
  try {
    const initial = await lstat(path, { bigint: true })
    if (!initial.isFile() || initial.isSymbolicLink() || initial.size > BigInt(MAX_RECORD_BYTES)) {
      throw new Error(`unsafe or oversized mission record: ${path}`)
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = await handle.stat({ bigint: true })
    const canonical = await realpath(path)
    if (
      !opened.isFile()
      || opened.dev !== initial.dev
      || opened.ino !== initial.ino
      || opened.size > BigInt(MAX_RECORD_BYTES)
      || !isContainedPath(containmentRoot, canonical)
    ) {
      throw new Error(`unsafe or changed mission record: ${path}`)
    }
    const bytes = Number(opened.size)
    const buffer = Buffer.allocUnsafe(bytes)
    let offset = 0
    while (offset < bytes) {
      const read = await handle.read(buffer, offset, bytes - offset, offset)
      if (read.bytesRead === 0) throw new Error(`mission record changed while reading: ${path}`)
      offset += read.bytesRead
    }
    const completed = await handle.stat({ bigint: true })
    if (
      completed.dev !== opened.dev
      || completed.ino !== opened.ino
      || completed.size !== opened.size
      || completed.mtimeNs !== opened.mtimeNs
      || completed.ctimeNs !== opened.ctimeNs
    ) {
      throw new Error(`mission record changed while reading: ${path}`)
    }
    return JSON.parse(STRICT_UTF8_DECODER.decode(buffer))
  } finally {
    await handle?.close()
  }
}

function ownerDirectoryName(ownerSession) {
  return createHash('sha256').update(ownerSession, 'utf8').digest('hex')
}

function withoutRecordDigest(record) {
  const copy = cloneJson(record)
  delete copy.recordDigest
  return copy
}

function sealRecord(record) {
  const copy = withoutRecordDigest(record)
  copy.recordDigest = digestValue(copy)
  return copy
}

function parseRecord(value, missionId, ownerSession) {
  if (!isPlainObject(value)) throw new Error('invalid mission record')
  const recordKeys = [
    'schemaVersion',
    'missionId',
    'ownerSession',
    'runtimeId',
    'status',
    'phase',
    'sequence',
    'goal',
    'policy',
    'planDigest',
    'policyDigest',
    'createdAt',
    'updatedAt',
    'expiresAt',
    'draft',
    'usage',
    'lastValidation',
    'failureCounts',
    'failures',
    'events',
    'stop',
    'recordDigest',
  ]
  if (
    Object.keys(value).length !== recordKeys.length
    || Object.keys(value).some((key) => !recordKeys.includes(key))
  ) {
    throw new Error('invalid mission record properties')
  }
  if (
    value.schemaVersion !== MISSION_SCHEMA_VERSION
    || value.missionId !== missionId
    || value.ownerSession !== ownerSession
    || typeof value.runtimeId !== 'string'
    || value.runtimeId.length < 1
    || value.runtimeId.length > 128
    || !STATUS_SET.has(value.status)
    || !PHASE_SET.has(value.phase)
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < 1
    || !DIGEST_PATTERN.test(value.planDigest)
    || !DIGEST_PATTERN.test(value.policyDigest)
    || !DIGEST_PATTERN.test(value.recordDigest)
    || digestValue(withoutRecordDigest(value)) !== value.recordDigest
  ) {
    throw new Error('invalid or mismatched mission record')
  }
  validateDate(value.createdAt, 'createdAt')
  validateDate(value.updatedAt, 'updatedAt')
  validateDate(value.expiresAt, 'expiresAt')
  const createdAt = Date.parse(value.createdAt)
  const updatedAt = Date.parse(value.updatedAt)
  const expiresAt = Date.parse(value.expiresAt)
  if (updatedAt < createdAt || expiresAt <= createdAt) throw new Error('invalid mission timeline')
  const goal = normalizeGoal({
    software: value.goal?.software,
    objective: value.goal?.objective,
    acceptanceCriteria: value.goal?.acceptanceCriteria,
  })
  const policyKeys = ['allowedActions', ...Object.keys(MISSION_DEFAULT_LIMITS)]
  if (
    !isPlainObject(value.policy)
    || Object.keys(value.policy).length !== policyKeys.length
    || Object.keys(value.policy).some((key) => !policyKeys.includes(key))
    || digestValue({ goal, policy: value.policy }) !== value.policyDigest
  ) {
    throw new Error('invalid mission policy')
  }
  if (
    !Array.isArray(value.policy.allowedActions)
    || value.policy.allowedActions.length !== MISSION_ACTIONS.length
    || value.policy.allowedActions.some((action, index) => action !== MISSION_ACTIONS[index])
  ) {
    throw new Error('invalid mission action policy')
  }
  for (const key of Object.keys(MISSION_DEFAULT_LIMITS)) {
    validateInteger(value.policy[key], `policy.${key}`, MIN_LIMITS[key], HARD_LIMITS[key])
  }
  const policyLimits = Object.fromEntries(
    Object.keys(MISSION_DEFAULT_LIMITS).map((key) => [key, value.policy[key]]),
  )
  const expectedPlan = createPlan({ ...goal, budget: policyLimits }, { limits: policyLimits })
  if (expectedPlan.planDigest !== value.planDigest) throw new Error('invalid mission plan digest')
  if (expiresAt - createdAt !== value.policy.maxWallTimeMs) throw new Error('invalid mission expiration')
  const usageKeys = ['actions', 'draftCreates', 'draftUpdates', 'validations', 'validationFailures']
  if (
    !isPlainObject(value.usage)
    || Object.keys(value.usage).length !== usageKeys.length
    || Object.keys(value.usage).some((key) => !usageKeys.includes(key))
  ) {
    throw new Error('invalid mission usage')
  }
  for (const key of usageKeys) {
    validateInteger(value.usage[key], `usage.${key}`, 0, HARD_LIMITS.maxActions)
  }
  if (
    value.usage.actions > value.policy.maxActions
    || value.usage.draftCreates > value.policy.maxDraftCreates
    || value.usage.draftUpdates > value.policy.maxDraftUpdates
    || value.usage.validationFailures > value.policy.maxValidationFailures
    || value.usage.validationFailures > value.usage.validations
  ) {
    throw new Error('mission usage exceeds policy')
  }
  if (value.draft !== null) {
    if (
      !isPlainObject(value.draft)
      || Object.keys(value.draft).length !== 3
      || Object.keys(value.draft).some((key) => !['draftId', 'revision', 'contentDigest'].includes(key))
    ) {
      throw new Error('invalid mission draft')
    }
    validateDraftId(value.draft?.draftId)
    validateInteger(value.draft?.revision, 'draft.revision', 1, 256)
    validateDigest(value.draft?.contentDigest, 'draft.contentDigest')
  }
  if (!Array.isArray(value.events) || value.events.length > MAX_EVENTS) throw new Error('invalid mission events')
  if (!Array.isArray(value.failures) || value.failures.length > MAX_FAILURES) throw new Error('invalid mission failures')
  if (!isPlainObject(value.failureCounts)) throw new Error('invalid mission failure counts')
  let previousSequence = 1
  const eventCounts = { draft_create: 0, draft_update: 0, draft_validate: 0 }
  let reservedEvents = 0
  for (const event of value.events) {
    if (
      !isPlainObject(event)
      || Object.keys(event).length !== 7
      || Object.keys(event).some((key) => ![
        'sequence', 'action', 'requestDigest', 'status', 'at', 'code', 'message',
      ].includes(key))
      || !MISSION_ACTIONS.includes(event.action)
      || !['reserved', 'succeeded', 'failed'].includes(event.status)
      || event.sequence <= previousSequence
      || event.sequence > value.sequence
    ) {
      throw new Error('invalid mission event')
    }
    validateInteger(event.sequence, 'event.sequence', 2, HARD_LIMITS.maxActions + 16)
    validateDigest(event.requestDigest, 'event.requestDigest')
    validateDate(event.at, 'event.at')
    if (event.code !== null) assertString(event.code, 'event.code', 1, MAX_EVENT_CODE_LENGTH)
    if (event.message !== null) assertString(event.message, 'event.message', 1, MAX_EVENT_MESSAGE_LENGTH)
    if (event.status === 'reserved') reservedEvents += 1
    eventCounts[event.action] += 1
    previousSequence = event.sequence
  }
  if (
    value.usage.actions !== value.events.length
    || value.usage.draftCreates !== eventCounts.draft_create
    || value.usage.draftUpdates !== eventCounts.draft_update
    || value.usage.validations !== eventCounts.draft_validate
    || reservedEvents > 1
  ) {
    throw new Error('mission event usage mismatch')
  }
  let failureOccurrences = 0
  for (const [fingerprint, count] of Object.entries(value.failureCounts)) {
    validateDigest(fingerprint, 'failure fingerprint')
    validateInteger(count, 'failure count', 1, HARD_LIMITS.maxValidationFailures)
    failureOccurrences += count
  }
  if (failureOccurrences !== value.usage.validationFailures) {
    throw new Error('mission failure usage mismatch')
  }
  for (const failure of value.failures) {
    if (
      !isPlainObject(failure)
      || Object.keys(failure).length !== 8
      || Object.keys(failure).some((key) => ![
        'schemaVersion',
        'failureClass',
        'draft',
        'diagnostics',
        'failureFingerprint',
        'evidenceDigest',
        'occurrence',
        'observedAt',
      ].includes(key))
      || failure.schemaVersion !== FAILURE_EVIDENCE_SCHEMA_VERSION
      || !['wdl_validation', 'validation_infrastructure'].includes(failure.failureClass)
      || !isPlainObject(failure.draft)
      || Object.keys(failure.draft).length !== 3
      || !Array.isArray(failure.diagnostics)
      || failure.diagnostics.length > 32
    ) {
      throw new Error('invalid mission failure evidence')
    }
    validateDraftId(failure.draft.draftId)
    validateInteger(failure.draft.revision, 'failure.draft.revision', 1, 256)
    validateDigest(failure.draft.contentDigest, 'failure.draft.contentDigest')
    validateDigest(failure.failureFingerprint, 'failure.failureFingerprint')
    validateDigest(failure.evidenceDigest, 'failure.evidenceDigest')
    validateInteger(failure.occurrence, 'failure.occurrence', 1, HARD_LIMITS.maxValidationFailures)
    validateDate(failure.observedAt, 'failure.observedAt')
    for (const diagnostic of failure.diagnostics) {
      if (
        !isPlainObject(diagnostic)
        || Object.keys(diagnostic).length !== 3
        || Object.keys(diagnostic).some((key) => !['path', 'code', 'severity'].includes(key))
      ) {
        throw new Error('invalid mission failure diagnostic')
      }
      assertString(diagnostic.path, 'failure diagnostic path', 0, 512)
      assertString(diagnostic.code, 'failure diagnostic code', 1, MAX_EVENT_CODE_LENGTH)
      if (!['error', 'warning'].includes(diagnostic.severity)) {
        throw new Error('invalid mission failure diagnostic severity')
      }
    }
    const evidenceBasis = {
      schemaVersion: failure.schemaVersion,
      failureClass: failure.failureClass,
      draft: failure.draft,
      diagnostics: failure.diagnostics,
    }
    if (
      failure.evidenceDigest !== digestValue(evidenceBasis)
      || (value.failureCounts[failure.failureFingerprint] ?? 0) < failure.occurrence
    ) {
      throw new Error('invalid mission failure evidence digest')
    }
  }
  if (value.lastValidation !== null) {
    if (
      !isPlainObject(value.lastValidation)
      || Object.keys(value.lastValidation).length !== 5
      || Object.keys(value.lastValidation).some((key) => ![
        'revision', 'contentDigest', 'validationDigest', 'valid', 'observedAt',
      ].includes(key))
    ) {
      throw new Error('invalid mission validation result')
    }
    validateInteger(value.lastValidation.revision, 'lastValidation.revision', 1, 256)
    validateDigest(value.lastValidation.contentDigest, 'lastValidation.contentDigest')
    validateDigest(value.lastValidation.validationDigest, 'lastValidation.validationDigest')
    validateDate(value.lastValidation.observedAt, 'lastValidation.observedAt')
    if (
      value.lastValidation.valid !== true
      || value.draft === null
      || value.lastValidation.revision !== value.draft.revision
      || value.lastValidation.contentDigest !== value.draft.contentDigest
    ) {
      throw new Error('invalid mission validation binding')
    }
  }
  if (value.status === 'ready') {
    if (value.stop !== null || value.phase !== 'validated' || value.lastValidation === null) {
      throw new Error('invalid ready mission state')
    }
  } else if (value.stop === null) {
    if (value.status !== 'active' || value.phase === 'stopped') throw new Error('invalid active mission state')
  } else {
    if (
      !TERMINAL_STATUS_SET.has(value.status)
      || value.phase !== 'stopped'
      || !isPlainObject(value.stop)
      || Object.keys(value.stop).length !== 4
      || Object.keys(value.stop).some((key) => !['code', 'message', 'at', 'automaticRetry'].includes(key))
      || value.stop.automaticRetry !== false
    ) {
      throw new Error('invalid stopped mission state')
    }
    assertString(value.stop.code, 'stop.code', 1, MAX_EVENT_CODE_LENGTH)
    assertString(value.stop.message, 'stop.message', 1, MAX_EVENT_MESSAGE_LENGTH)
    validateDate(value.stop.at, 'stop.at')
  }
  if (value.phase === 'validated' && value.lastValidation === null) {
    throw new Error('validated mission lacks validation evidence')
  }
  return value
}

function publicMission(record, observedAt = new Date()) {
  const remaining = {
    actions: Math.max(0, record.policy.maxActions - record.usage.actions),
    draftCreates: Math.max(0, record.policy.maxDraftCreates - record.usage.draftCreates),
    draftUpdates: Math.max(0, record.policy.maxDraftUpdates - record.usage.draftUpdates),
    validationFailures: Math.max(
      0,
      record.policy.maxValidationFailures - record.usage.validationFailures,
    ),
    wallTimeMs: Math.max(0, Date.parse(record.expiresAt) - observedAt.getTime()),
  }
  return deepFreeze({
    ok: true,
    schemaVersion: MISSION_SCHEMA_VERSION,
    missionId: record.missionId,
    status: record.status,
    phase: record.phase,
    sequence: record.sequence,
    goal: cloneJson(record.goal),
    policy: cloneJson(record.policy),
    planDigest: record.planDigest,
    policyDigest: record.policyDigest,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    draft: record.draft === null ? null : cloneJson(record.draft),
    budget: { used: cloneJson(record.usage), remaining },
    lastValidation: record.lastValidation === null ? null : cloneJson(record.lastValidation),
    failures: cloneJson(record.failures),
    stop: record.stop === null ? null : cloneJson(record.stop),
    capabilities: {
      autonomousDraftAuthoring: true,
      autonomousValidationRepair: true,
      isolatedDraftTest: false,
      productionExecution: false,
      workflowPromotion: false,
    },
    automaticRetryAfterRestart: false,
    error: null,
  })
}

function requestDigest(action, request) {
  const copy = cloneJson(request)
  delete copy.missionId
  return digestValue({ action, request: copy })
}

function validationEvidence(result, draft) {
  if (result?.ok === true && result.validation?.valid === false) {
    const diagnostics = (result.validation.diagnostics ?? [])
      .slice(0, 32)
      .map((item) => ({
        path: String(item.path ?? '').slice(0, 512),
        code: String(item.code ?? 'validation_error').slice(0, MAX_EVENT_CODE_LENGTH),
        severity: ['error', 'warning'].includes(item.severity) ? item.severity : 'error',
      }))
      .sort((left, right) => (
        compareUtf8(left.code, right.code)
        || compareUtf8(left.path, right.path)
        || compareUtf8(left.severity, right.severity)
      ))
    const basis = {
      schemaVersion: FAILURE_EVIDENCE_SCHEMA_VERSION,
      failureClass: 'wdl_validation',
      draft,
      diagnostics,
    }
    return {
      ...basis,
      failureFingerprint: digestValue({ failureClass: basis.failureClass, diagnostics }),
      evidenceDigest: digestValue(basis),
    }
  }
  if (result?.ok !== true) {
    const code = String(result?.error?.code ?? 'validation_unavailable').slice(0, MAX_EVENT_CODE_LENGTH)
    const basis = {
      schemaVersion: FAILURE_EVIDENCE_SCHEMA_VERSION,
      failureClass: 'validation_infrastructure',
      draft,
      diagnostics: [{ path: '$', code, severity: 'error' }],
    }
    return {
      ...basis,
      failureFingerprint: digestValue({ failureClass: basis.failureClass, code }),
      evidenceDigest: digestValue(basis),
    }
  }
  return null
}

function enforceMissionValidationIdentity(result, record) {
  if (result?.ok !== true || result.validation?.valid !== true) return result
  const validation = result.validation
  if (
    record.draft !== null
    && validation.draftId === record.draft.draftId
    && validation.revision === record.draft.revision
    && validation.contentDigest === record.draft.contentDigest
    && typeof validation.validationDigest === 'string'
    && DIGEST_PATTERN.test(validation.validationDigest)
  ) {
    return result
  }
  const diagnostics = Array.isArray(validation.diagnostics)
    ? validation.diagnostics.slice(0, 31)
    : []
  diagnostics.push({
    path: '$.mission.draft',
    code: 'mission_validation_identity_mismatch',
    message: 'validation evidence must bind the exact Mission draft id, revision, and content digest',
    severity: 'error',
    source: 'mission',
  })
  return {
    ...result,
    validation: {
      ...validation,
      valid: false,
      diagnostics,
    },
  }
}

function enforceMissionContainerIdentity(result, record) {
  if (result?.ok !== true || result.validation?.valid !== true) return result
  const expected = record.goal.software.containerImage
  const observed = result.validation.containerImages
  if (
    Array.isArray(observed)
    && observed.length === 1
    && observed[0] === expected
    && result.validation.containerPolicy?.complete === true
  ) {
    return result
  }
  const diagnostics = Array.isArray(result.validation.diagnostics)
    ? result.validation.diagnostics.slice(0, 31)
    : []
  diagnostics.push({
    path: '$.mission.software.containerImage',
    code: 'mission_container_identity_mismatch',
    message: 'validated WDL must use exactly the digest-pinned container identity approved by the Mission',
    severity: 'error',
    source: 'mission',
  })
  return {
    ...result,
    validation: {
      ...result.validation,
      valid: false,
      diagnostics,
    },
  }
}

function nextEvent(record, action, request, now) {
  return {
    sequence: record.sequence + 1,
    action,
    requestDigest: requestDigest(action, request),
    status: 'reserved',
    at: now,
    code: null,
    message: null,
  }
}

function updateEvent(record, reservation, outcome) {
  const event = record.events.find((item) => item.sequence === reservation.sequence)
  if (
    event === undefined
    || event.status !== 'reserved'
    || event.action !== reservation.action
    || event.requestDigest !== reservation.requestDigest
  ) {
    return false
  }
  event.status = outcome.ok ? 'succeeded' : 'failed'
  event.code = outcome.code === null ? null : String(outcome.code).slice(0, MAX_EVENT_CODE_LENGTH)
  event.message = outcome.message === null ? null : String(outcome.message).slice(0, MAX_EVENT_MESSAGE_LENGTH)
  return true
}

function stopRecord(record, status, code, message, at) {
  record.status = status
  record.phase = 'stopped'
  record.stop = { code, message, at, automaticRetry: false }
}

export function createMissionStore(storeConfig = {}, autonomyConfig = {}, options = {}) {
  const config = parseAutonomyConfig(autonomyConfig, storeConfig)
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const createId = typeof options.createId === 'function' ? options.createId : () => randomUUID()
  const runtimeId = options.runtimeId ?? randomUUID()
  assertString(runtimeId, 'runtimeId', 1, 128)
  const grants = new Map()
  const queues = new Map()

  function expose(record) {
    return publicMission(record, now())
  }

  function withQueue(key, operation) {
    const previous = queues.get(key) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    queues.set(key, current)
    return current.finally(() => {
      if (queues.get(key) === current) queues.delete(key)
    })
  }

  async function ownerRoot(ownerSession, create) {
    if (config.root === null) return null
    const root = resolve(config.root)
    let rootIdentity
    try {
      rootIdentity = create
        ? await ensureRoot(root)
        : await inspectDirectoryIdentity(root, root)
    } catch (error) {
      if (!create && error?.code === 'ENOENT') return null
      throw error
    }
    await assertProtectedPathAncestors(root)
    const ownerPath = join(root, ownerDirectoryName(ownerSession))
    try {
      const ownerIdentity = create
        ? await ensureDirectory(ownerPath, root)
        : await inspectDirectoryIdentity(ownerPath, root)
      return ownerIdentity.path
    } catch (error) {
      if (!create && error?.code === 'ENOENT') return null
      throw error
    } finally {
      await assertDirectoryUnchanged(rootIdentity, root)
    }
  }

  async function missionDirectory(ownerSession, missionId) {
    const ownerPath = await ownerRoot(ownerSession, false)
    if (ownerPath === null) return null
    const path = join(ownerPath, missionId)
    try {
      return await inspectDirectoryIdentity(path, ownerPath)
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async function readRecord(ownerSession, missionId) {
    const directory = await missionDirectory(ownerSession, missionId)
    if (directory === null) return null
    const value = await readBoundedJson(join(directory.path, 'mission.json'), directory.path)
    return { directory, record: parseRecord(value, missionId, ownerSession) }
  }

  async function persist(current, record) {
    const sealed = sealRecord(record)
    await atomicWriteRecord(join(current.directory.path, 'mission.json'), sealed, current.directory)
    return sealed
  }

  async function mutate(ownerSession, missionId, operation) {
    return withQueue(`${ownerSession}:${missionId}`, async () => {
      const current = await readRecord(ownerSession, missionId)
      if (current === null) return errorResult('mission_not_found', 'mission was not found')
      const record = cloneJson(current.record)
      const result = await operation(record)
      if (result?.persist !== true) return result?.value ?? result
      record.updatedAt = now().toISOString()
      const persisted = await persist(current, record)
      return result.value === undefined ? expose(persisted) : result.value(expose(persisted))
    })
  }

  async function reconcile(record, ownerSession, missionId) {
    if (record.status !== 'active') return expose(record)
    const currentTime = now().getTime()
    if (record.runtimeId !== runtimeId || grants.get(missionId) !== ownerSession) {
      return mutate(ownerSession, missionId, async (next) => {
        if (next.status !== 'active') return { persist: false, value: expose(next) }
        stopRecord(
          next,
          'interrupted',
          'runtime_restarted',
          'the owning runtime grant is absent; automatic retry is disabled',
          now().toISOString(),
        )
        next.sequence += 1
        return { persist: true }
      })
    }
    if (currentTime >= Date.parse(record.expiresAt)) {
      grants.delete(missionId)
      return mutate(ownerSession, missionId, async (next) => {
        if (next.status !== 'active') return { persist: false, value: expose(next) }
        stopRecord(next, 'exhausted', 'wall_time_exhausted', 'mission wall-time budget is exhausted', now().toISOString())
        next.sequence += 1
        return { persist: true }
      })
    }
    return expose(record)
  }

  async function prepare(request) {
    if (!config.enabled) return errorResult('autonomy_disabled', 'autonomous mission authoring is disabled')
    return createPlan(request, config)
  }

  async function start(request, operation = {}) {
    throwIfAborted(operation.signal)
    const ownerSession = validateOwnerSession(operation.ownerSession)
    if (!config.enabled) return errorResult('autonomy_disabled', 'autonomous mission authoring is disabled')
    const prepared = createPlan(request, config)
    validateDigest(request.expectedPlanDigest, 'expectedPlanDigest')
    if (prepared.planDigest !== request.expectedPlanDigest) {
      return errorResult('mission_plan_digest_mismatch', 'mission plan does not match expectedPlanDigest', {
        expectedPlanDigest: request.expectedPlanDigest,
        actualPlanDigest: prepared.planDigest,
      })
    }
    return withQueue(ownerSession, async () => {
      const ownerPath = await ownerRoot(ownerSession, true)
      const ownerIdentity = await inspectDirectoryIdentity(ownerPath, config.root)
      let entriesObserved = 0
      let missionCount = 0
      const directory = await opendir(ownerPath)
      for await (const entry of directory) {
        entriesObserved += 1
        if (entriesObserved > MAX_OWNER_DIRECTORY_ENTRIES) {
          return errorResult('mission_capacity_exceeded', 'owner mission directory entry budget is exhausted')
        }
        if (!entry.isDirectory() || entry.isSymbolicLink() || !MISSION_ID_PATTERN.test(entry.name)) {
          throw new Error(`unsafe owner mission directory entry: ${entry.name}`)
        }
        await inspectDirectoryIdentity(join(ownerPath, entry.name), ownerPath)
        missionCount += 1
      }
      await assertDirectoryUnchanged(ownerIdentity, config.root)
      if (missionCount >= MAX_MISSIONS_PER_OWNER) {
        return errorResult('mission_capacity_exceeded', 'owner mission capacity is exhausted')
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const missionId = `mission-${createId()}`
        validateMissionId(missionId)
        const target = join(ownerPath, missionId)
        try {
          await mkdir(target, { mode: 0o700 })
        } catch (error) {
          if (error?.code === 'EEXIST') continue
          throw error
        }
        try {
          await assertDirectoryUnchanged(ownerIdentity, config.root)
          const directoryIdentity = await inspectDirectoryIdentity(target, ownerPath)
          const createdAt = now().toISOString()
          const expiresAt = new Date(Date.parse(createdAt) + prepared.plan.policy.maxWallTimeMs).toISOString()
          const record = sealRecord({
            schemaVersion: MISSION_SCHEMA_VERSION,
            missionId,
            ownerSession,
            runtimeId,
            status: 'active',
            phase: 'authoring',
            sequence: 1,
            goal: prepared.plan.goal,
            policy: prepared.plan.policy,
            planDigest: prepared.planDigest,
            policyDigest: digestValue({ goal: prepared.plan.goal, policy: prepared.plan.policy }),
            createdAt,
            updatedAt: createdAt,
            expiresAt,
            draft: null,
            usage: { actions: 0, draftCreates: 0, draftUpdates: 0, validations: 0, validationFailures: 0 },
            lastValidation: null,
            failureCounts: {},
            failures: [],
            events: [],
            stop: null,
          })
          await writeExclusiveText(
            join(target, 'mission.json'),
            `${JSON.stringify(record)}\n`,
            directoryIdentity.path,
          )
          await assertDirectoryUnchanged(directoryIdentity, ownerPath)
          await assertDirectoryUnchanged(ownerIdentity, config.root)
          grants.set(missionId, ownerSession)
          return expose(record)
        } catch (error) {
          grants.delete(missionId)
          await unlink(join(target, 'mission.json')).catch(() => {})
          await rmdir(target).catch(() => {})
          throw error
        }
      }
      return errorResult('mission_id_conflict', 'could not mint a unique mission identifier')
    })
  }

  async function get(missionId, operation = {}) {
    throwIfAborted(operation.signal)
    validateMissionId(missionId)
    const ownerSession = validateOwnerSession(operation.ownerSession)
    if (config.root === null) return errorResult('mission_store_unconfigured', 'mission store is not configured')
    const current = await readRecord(ownerSession, missionId)
    if (current === null) return errorResult('mission_not_found', 'mission was not found')
    return reconcile(current.record, ownerSession, missionId)
  }

  async function reserveAction(missionId, action, request, operation = {}) {
    throwIfAborted(operation.signal)
    validateMissionId(missionId)
    if (!MISSION_ACTIONS.includes(action)) throw new TypeError(`unsupported mission action: ${action}`)
    if (!isPlainObject(request)) throw new TypeError('mission action request must be an object')
    const ownerSession = validateOwnerSession(operation.ownerSession)
    if (grants.get(missionId) !== ownerSession) {
      return errorResult('mission_grant_inactive', 'mission grant is not active for the owning session')
    }
    return mutate(ownerSession, missionId, async (record) => {
      if (record.status !== 'active' || record.runtimeId !== runtimeId) {
        return { persist: false, value: errorResult('mission_inactive', 'mission is not active') }
      }
      if (record.events.some((event) => event.status === 'reserved')) {
        return { persist: false, value: errorResult('mission_action_in_flight', 'another mission action is still in flight') }
      }
      if (now().getTime() >= Date.parse(record.expiresAt)) {
        grants.delete(missionId)
        stopRecord(record, 'exhausted', 'wall_time_exhausted', 'mission wall-time budget is exhausted', now().toISOString())
        record.sequence += 1
        return { persist: true, value: (mission) => errorResult('mission_budget_exhausted', 'mission wall-time budget is exhausted', { mission }) }
      }
      if (!record.policy.allowedActions.includes(action)) {
        return { persist: false, value: errorResult('mission_action_denied', 'mission policy does not allow this action') }
      }
      if (record.usage.actions >= record.policy.maxActions || record.events.length >= MAX_EVENTS) {
        grants.delete(missionId)
        stopRecord(record, 'exhausted', 'action_budget_exhausted', 'mission action budget is exhausted', now().toISOString())
        record.sequence += 1
        return { persist: true, value: (mission) => errorResult('mission_budget_exhausted', 'mission action budget is exhausted', { mission }) }
      }
      if (action === 'draft_create') {
        if (record.draft !== null) {
          return { persist: false, value: errorResult('mission_draft_bound', 'mission is already bound to a draft') }
        }
        if (record.usage.draftCreates >= record.policy.maxDraftCreates) {
          grants.delete(missionId)
          stopRecord(record, 'exhausted', 'draft_create_budget_exhausted', 'mission draft-create budget is exhausted', now().toISOString())
          record.sequence += 1
          return {
            persist: true,
            value: (mission) => errorResult('mission_budget_exhausted', 'mission draft-create budget is exhausted', { mission }),
          }
        }
      } else {
        if (record.draft === null) {
          return { persist: false, value: errorResult('mission_draft_missing', 'mission is not bound to a draft') }
        }
        if (request.draftId !== record.draft.draftId) {
          return { persist: false, value: errorResult('mission_draft_mismatch', 'request does not target the mission draft') }
        }
        const revision = action === 'draft_update' ? request.expectedRevision : request.revision
        const contentDigest = action === 'draft_update' ? request.expectedContentDigest : record.draft.contentDigest
        if (revision !== record.draft.revision || contentDigest !== record.draft.contentDigest) {
          return { persist: false, value: errorResult('mission_draft_stale', 'request does not match the mission draft baseline') }
        }
        if (action === 'draft_update' && record.usage.draftUpdates >= record.policy.maxDraftUpdates) {
          grants.delete(missionId)
          stopRecord(record, 'exhausted', 'draft_update_budget_exhausted', 'mission draft-update budget is exhausted', now().toISOString())
          record.sequence += 1
          return {
            persist: true,
            value: (mission) => errorResult('mission_budget_exhausted', 'mission draft-update budget is exhausted', { mission }),
          }
        }
      }
      const at = now().toISOString()
      const event = nextEvent(record, action, request, at)
      record.sequence = event.sequence
      record.events.push(event)
      record.usage.actions += 1
      if (action === 'draft_create') record.usage.draftCreates += 1
      if (action === 'draft_update') record.usage.draftUpdates += 1
      if (action === 'draft_validate') {
        record.usage.validations += 1
        record.phase = 'validating'
      }
      return {
        persist: true,
        value: (mission) => ({
          ok: true,
          reservation: { missionId, sequence: event.sequence, action, requestDigest: event.requestDigest },
          mission,
          error: null,
        }),
      }
    })
  }

  async function recordDraftResult(missionId, action, reservation, result, operation = {}) {
    validateMissionId(missionId)
    const ownerSession = validateOwnerSession(operation.ownerSession)
    if (!reservation || reservation.missionId !== missionId || reservation.action !== action) {
      return errorResult('mission_reservation_missing', 'mission action reservation is missing')
    }
    return mutate(ownerSession, missionId, async (record) => {
      const ok = result?.ok === true
      const code = ok ? null : result?.error?.code ?? 'draft_action_failed'
      const completed = updateEvent(record, reservation, {
        ok,
        code,
        message: ok ? null : result?.error?.message ?? 'draft action failed',
      })
      if (!completed) {
        return { persist: false, value: errorResult('mission_reservation_mismatch', 'mission reservation no longer matches its event') }
      }
      if (record.status !== 'active') return { persist: true }
      if (ok) {
        const draft = {
          draftId: validateDraftId(result.draftId),
          revision: validateInteger(result.revision, 'result.revision', 1, 256),
          contentDigest: validateDigest(result.contentDigest, 'result.contentDigest'),
        }
        if (
          action === 'draft_create'
          && (record.draft !== null || draft.revision !== 1)
        ) {
          stopRecord(record, 'blocked', 'mission_draft_conflict', 'draft create returned a conflicting draft binding', now().toISOString())
          grants.delete(missionId)
        } else if (
          action === 'draft_update'
          && (
            record.draft?.draftId !== draft.draftId
            || draft.revision !== record.draft.revision + 1
          )
        ) {
          stopRecord(record, 'blocked', 'mission_draft_conflict', 'draft update returned a conflicting draft identity or revision', now().toISOString())
          grants.delete(missionId)
        } else {
          record.draft = draft
          record.phase = 'authoring'
          record.lastValidation = null
        }
      } else if (code === 'mission_action_outcome_unknown') {
        stopRecord(
          record,
          'blocked',
          'mission_action_outcome_unknown',
          'draft action outcome is ambiguous; automatic replay is disabled',
          now().toISOString(),
        )
        grants.delete(missionId)
      } else if (
        action === 'draft_create'
        && record.draft === null
        && record.usage.draftCreates >= record.policy.maxDraftCreates
      ) {
        stopRecord(
          record,
          'exhausted',
          'draft_create_budget_exhausted',
          'mission draft-create budget is exhausted without a bound draft',
          now().toISOString(),
        )
        grants.delete(missionId)
      }
      if (record.usage.actions >= record.policy.maxActions && record.status === 'active') {
        stopRecord(record, 'exhausted', 'action_budget_exhausted', 'mission action budget is exhausted', now().toISOString())
        grants.delete(missionId)
      }
      return { persist: true }
    })
  }

  async function recordValidationResult(missionId, reservation, result, operation = {}) {
    validateMissionId(missionId)
    const ownerSession = validateOwnerSession(operation.ownerSession)
    if (!reservation || reservation.missionId !== missionId || reservation.action !== 'draft_validate') {
      return errorResult('mission_reservation_missing', 'mission validation reservation is missing')
    }
    return mutate(ownerSession, missionId, async (record) => {
      const identityChecked = enforceMissionValidationIdentity(result, record)
      const validationIdentityMismatch = result?.ok === true
        && result.validation?.valid === true
        && identityChecked.validation?.valid === false
      const evaluated = enforceMissionContainerIdentity(identityChecked, record)
      const valid = evaluated?.ok === true && evaluated.validation?.valid === true
      const containerIdentityMismatch = identityChecked?.ok === true
        && identityChecked.validation?.valid === true
        && valid === false
      const code = valid
        ? null
        : validationIdentityMismatch
          ? 'mission_validation_identity_mismatch'
          : containerIdentityMismatch
            ? 'mission_container_identity_mismatch'
          : evaluated?.ok === true
            ? 'wdl_validation_failed'
            : evaluated?.error?.code ?? 'validation_unavailable'
      const completed = updateEvent(record, reservation, {
        ok: valid,
        code,
        message: valid ? null : evaluated?.error?.message ?? 'WDL validation did not pass Mission policy',
      })
      if (!completed) {
        return { persist: false, value: errorResult('mission_reservation_mismatch', 'mission reservation no longer matches its event') }
      }
      if (record.status !== 'active') return { persist: true }
      if (valid) {
        record.status = 'ready'
        record.phase = 'validated'
        record.lastValidation = {
          revision: record.draft.revision,
          contentDigest: record.draft.contentDigest,
          validationDigest: validateDigest(result.validation.validationDigest, 'validationDigest'),
          valid: true,
          observedAt: now().toISOString(),
        }
        grants.delete(missionId)
      } else {
        const evidence = validationEvidence(evaluated, record.draft)
        record.phase = 'diagnosing'
        record.usage.validationFailures += 1
        const count = (record.failureCounts[evidence.failureFingerprint] ?? 0) + 1
        record.failureCounts[evidence.failureFingerprint] = count
        record.failures.push({ ...evidence, occurrence: count, observedAt: now().toISOString() })
        if (record.failures.length > MAX_FAILURES) record.failures.shift()
        if (evidence.failureClass === 'validation_infrastructure') {
          stopRecord(record, 'blocked', code, 'validation infrastructure is unavailable', now().toISOString())
          grants.delete(missionId)
        } else if (count >= record.policy.maxSameFailureFingerprint) {
          stopRecord(record, 'exhausted', 'repeated_failure', 'the same validation failure exceeded its retry threshold', now().toISOString())
          grants.delete(missionId)
        } else if (record.usage.validationFailures >= record.policy.maxValidationFailures) {
          stopRecord(record, 'exhausted', 'validation_failure_budget_exhausted', 'validation failure budget is exhausted', now().toISOString())
          grants.delete(missionId)
        }
      }
      if (record.usage.actions >= record.policy.maxActions && record.status === 'active') {
        stopRecord(record, 'exhausted', 'action_budget_exhausted', 'mission action budget is exhausted', now().toISOString())
        grants.delete(missionId)
      }
      return { persist: true }
    })
  }

  async function cancel(missionId, operation = {}) {
    throwIfAborted(operation.signal)
    validateMissionId(missionId)
    const ownerSession = validateOwnerSession(operation.ownerSession)
    return mutate(ownerSession, missionId, async (record) => {
      if (TERMINAL_STATUS_SET.has(record.status)) return { persist: false, value: expose(record) }
      stopRecord(record, 'cancelled', 'cancelled_by_owner', 'mission was cancelled by its owning session', now().toISOString())
      record.sequence += 1
      grants.delete(missionId)
      return { persist: true }
    })
  }

  async function report(missionId, operation = {}) {
    const mission = await get(missionId, operation)
    if (!mission.ok) return mission
    const outcome = mission.status === 'ready'
      ? 'ready_for_isolated_test'
      : mission.status === 'active'
      ? mission.phase === 'validated' ? 'ready_for_isolated_test' : 'in_progress'
      : mission.status
    return deepFreeze({
      ok: true,
      report: {
        schemaVersion: SOFTWARE_TRIAL_REPORT_SCHEMA_VERSION,
        missionId: mission.missionId,
        generatedAt: now().toISOString(),
        outcome,
        success: false,
        software: mission.goal.software,
        objective: mission.goal.objective,
        acceptanceCriteria: mission.goal.acceptanceCriteria,
        planDigest: mission.planDigest,
        policyDigest: mission.policyDigest,
        draft: mission.draft,
        lastValidation: mission.lastValidation,
        attempts: mission.budget.used,
        failures: mission.failures,
        stop: mission.stop,
        readiness: {
          draftValidated: mission.lastValidation?.valid === true,
          isolatedTestCompleted: false,
          productionExecutionAuthorized: false,
          workflowPromotionAuthorized: false,
        },
        limitations: [
          'software_container_not_executed',
          'isolated_draft_test_runner_unavailable',
          'report_is_not_production_validation',
        ],
        recommendedNextAction: outcome === 'ready_for_isolated_test'
          ? 'configure and approve a separately isolated draft-test runner before executing this software'
          : mission.stop?.message ?? 'continue owner-scoped draft repair within the remaining budget',
      },
      error: null,
    })
  }

  return Object.freeze({
    config,
    summary: Object.freeze({
      configured: config.root !== null,
      enabled: config.enabled,
      ownerScope: 'session',
      schemaVersion: MISSION_SCHEMA_VERSION,
      capabilities: Object.freeze({
        boundedDraftAuthoring: true,
        deterministicValidationRepair: true,
        isolatedDraftTest: false,
        productionExecution: false,
      }),
      limits: config.limits,
    }),
    prepare,
    start,
    get,
    reserveAction,
    recordDraftResult,
    recordValidationResult,
    cancel,
    report,
  })
}
