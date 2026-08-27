import { WDL_FILE_ROLES } from './wdl-bundle.js'
import { validateToolArguments } from './tool-definition.js'

export const DRAFT_CREATE_TOOL_NAME = 'bio_workflows_draft_create'
export const DRAFT_GET_TOOL_NAME = 'bio_workflows_draft_get'
export const DRAFT_UPDATE_TOOL_NAME = 'bio_workflows_draft_update'
export const DRAFT_VALIDATE_TOOL_NAME = 'bio_workflows_draft_validate'

const IDENTIFIER_PATTERN = '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
const SEMVER_PATTERN = '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$'
const DRAFT_ID_PATTERN = '^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
const MISSION_ID_PATTERN = '^mission-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
const DIGEST_PATTERN = '^sha256:[a-f0-9]{64}$'
const SAFE_PATH_PATTERN = '^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*\\\\)(?!.*\\u0000)[^/]+(?:/[^/]+)*$'
const MAX_FILES = 128
const MAX_FILE_CHARACTERS = 1024 * 1024
const MAX_REVISIONS = 256

function textOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  }
}

function stringify(value) {
  return JSON.stringify(value, null, 2)
}

function errorResult(code, message, details = {}) {
  return { ok: false, error: { code, message }, ...details }
}

function missionParameter() {
  return {
    type: 'string',
    pattern: MISSION_ID_PATTERN,
    description: 'Optional active owner-session Mission whose bounded grant authorizes this draft action.',
  }
}

function withoutMissionId(options) {
  const { missionId: _missionId, ...request } = options
  return request
}

async function safeMissionRecord(record) {
  try {
    return await record()
  } catch {
    return errorResult(
      'mission_record_failed',
      'the draft action outcome could not be synchronized to its Mission; do not replay the same call',
    )
  }
}

async function executeMissionAction({ missionStore, options, exec, action, perform, record }) {
  const operation = {
    ownerSession: ownerSession(exec),
    signal: exec?.signal,
  }
  if (options.missionId === undefined) return perform(options, operation)
  if (missionStore === undefined) {
    return errorResult('mission_unavailable', 'Mission support is unavailable for this draft tool')
  }
  const request = withoutMissionId(options)
  let reserved
  try {
    reserved = await missionStore.reserveAction(options.missionId, action, request, operation)
  } catch {
    return errorResult(
      'mission_reservation_failed',
      'the Mission action could not be reserved; no draft operation was attempted',
    )
  }
  if (!reserved.ok) return reserved

  let result
  try {
    result = await perform(request, operation)
  } catch {
    result = errorResult(
      'mission_action_outcome_unknown',
      'the draft operation did not return a bounded outcome; automatic replay is unsafe',
    )
  }
  const mission = await safeMissionRecord(() => record(
    options.missionId,
    reserved.reservation,
    result,
    operation,
  ))
  return {
    ...result,
    missionRecorded: mission.ok === true,
    sameCallRetryAllowed: false,
    mission,
  }
}

export function ownerSession(exec) {
  const agent = exec?.agent
  const sessionId = agent?.session?.id
  if (
    typeof sessionId !== 'string'
    || sessionId.length === 0
    || typeof agent?.id !== 'string'
    || agent.id !== sessionId
  ) {
    throw new Error('draft operations require a consistent owning DSH agent session')
  }
  return sessionId
}

export function createDraftTools(defineTool, store, validator, missionStore) {
  const create = defineTool({
    name: DRAFT_CREATE_TOOL_NAME,
    description:
      'Create revision 1 of an owner-scoped, non-executable WDL authoring draft from a deterministic template. Store writes and DSH approval are required.',
    parameters: {
      id: { type: 'string', maxLength: 64, pattern: IDENTIFIER_PATTERN, required: true, description: 'Lowercase workflow identifier.' },
      version: { type: 'string', maxLength: 128, pattern: SEMVER_PATTERN, description: 'Semantic version; defaults to 0.1.0.' },
      name: { type: 'string', minLength: 1, maxLength: 160, required: true, description: 'Human-readable workflow name.' },
      summary: { type: 'string', minLength: 1, maxLength: 1000, required: true, description: 'Short workflow purpose.' },
      ...(missionStore === undefined ? {} : { missionId: missionParameter() }),
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (options, exec) => stringify(await executeMissionAction({
      missionStore,
      options,
      exec,
      action: 'draft_create',
      perform: (request, operation) => store.create(request, operation),
      record: (missionId, reservation, result, operation) => missionStore.recordDraftResult(
        missionId,
        'draft_create',
        reservation,
        result,
        operation,
      ),
    })),
  })

  const get = defineTool({
    name: DRAFT_GET_TOOL_NAME,
    description:
      'Read the owner-scoped head or one exact immutable WDL draft revision. Omit path for the file index or provide one path for one bounded file body.',
    parameters: {
      draftId: { type: 'string', pattern: DRAFT_ID_PATTERN, required: true, description: 'Opaque draft UUID returned by draft_create.' },
      revision: { type: 'integer', minimum: 1, maximum: MAX_REVISIONS, description: 'Optional exact positive revision; the current head is selected when omitted.' },
      path: { type: 'string', minLength: 1, maxLength: 240, pattern: SAFE_PATH_PATTERN, description: 'Optional exact safe relative file path.' },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (options, exec) => stringify(await store.get(options, {
      ownerSession: ownerSession(exec),
      signal: exec?.signal,
    })),
  })

  const update = defineTool({
    name: DRAFT_UPDATE_TOOL_NAME,
    description:
      'Atomically create one immutable WDL draft revision from explicit file replacements and deletions under revision-and-content-digest compare-and-swap. Store writes and DSH approval are required.',
    parameters: {
      draftId: { type: 'string', pattern: DRAFT_ID_PATTERN, required: true, description: 'Opaque draft UUID returned by draft_create.' },
      expectedRevision: { type: 'integer', minimum: 1, maximum: MAX_REVISIONS, required: true, description: 'Exact current positive revision returned by draft_get.' },
      expectedContentDigest: { type: 'string', pattern: DIGEST_PATTERN, required: true, description: 'Exact current sha256 content digest returned by draft_get.' },
      replacements: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_FILES,
        description: 'Complete replacement bodies for selected files.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', minLength: 1, maxLength: 240, pattern: SAFE_PATH_PATTERN, description: 'Safe relative POSIX path.' },
            role: { type: 'string', enum: [...WDL_FILE_ROLES], description: 'Declared file role.' },
            content: { type: 'string', maxLength: MAX_FILE_CHARACTERS, description: 'Complete well-formed UTF-8 file body; runtime also enforces a 1 MiB UTF-8 byte limit.' },
          },
          required: ['path', 'role', 'content'],
          additionalProperties: false,
        },
      },
      deletions: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_FILES,
        description: 'Exact safe relative paths to remove; main.wdl cannot be deleted.',
        items: { type: 'string', minLength: 1, maxLength: 240, pattern: SAFE_PATH_PATTERN },
      },
      ...(missionStore === undefined ? {} : { missionId: missionParameter() }),
    },
    refineArguments: (options) => (
      options.replacements === undefined && options.deletions === undefined
        ? ['$.replacements or $.deletions is required']
        : []
    ),
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (options, exec) => stringify(await executeMissionAction({
      missionStore,
      options,
      exec,
      action: 'draft_update',
      perform: (request, operation) => store.update(request, operation),
      record: (missionId, reservation, result, operation) => missionStore.recordDraftResult(
        missionId,
        'draft_update',
        reservation,
        result,
        operation,
      ),
    })),
  })

  const validate = defineTool({
    name: DRAFT_VALIDATE_TOOL_NAME,
    description:
      'Validate one exact owner-scoped WDL draft revision with bounded structural checks and identity-pinned miniwdl check. This never runs WDL tasks or authorizes execution.',
    parameters: {
      draftId: { type: 'string', pattern: DRAFT_ID_PATTERN, required: true, description: 'Opaque draft UUID returned by draft_create.' },
      revision: { type: 'integer', minimum: 1, maximum: MAX_REVISIONS, required: true, description: 'Exact immutable revision to validate.' },
      ...(missionStore === undefined ? {} : { missionId: missionParameter() }),
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (options, exec) => stringify(await executeMissionAction({
      missionStore,
      options,
      exec,
      action: 'draft_validate',
      perform: (request, operation) => validator.validate(request, operation),
      record: (missionId, reservation, result, operation) => missionStore.recordValidationResult(
        missionId,
        reservation,
        result,
        operation,
      ),
    })),
  })

  return [create, get, update, validate]
}

export function registerDraftApprovalGate(ctx, tools, store, missionStore) {
  const mutationNames = new Set([DRAFT_CREATE_TOOL_NAME, DRAFT_UPDATE_TOOL_NAME])
  const mutationTools = new Set(tools.filter((tool) => mutationNames.has(tool.name)))
  const missionActionNames = new Set([
    DRAFT_CREATE_TOOL_NAME,
    DRAFT_UPDATE_TOOL_NAME,
    DRAFT_VALIDATE_TOOL_NAME,
  ])
  const missionActionTools = new Set(tools.filter((tool) => missionActionNames.has(tool.name)))

  ctx.on('tools/pre-execute', async (exec, next) => {
    const tool = ctx.tools.get(exec.name, exec.agent)
    if (!missionActionTools.has(tool)) return next()
    if (validateToolArguments(tool, exec.arguments).length > 0) return next()
    if (mutationTools.has(tool) && !store.config.writeEnabled) {
      return { kind: 'deny', reason: 'workflow store writes are disabled by plugin configuration' }
    }
    let sessionId
    try {
      sessionId = ownerSession(exec)
    } catch {
      return { kind: 'deny', reason: 'draft operation requires a consistent owning DSH agent session' }
    }
    if (exec.arguments.missionId !== undefined) {
      if (missionStore?.config.enabled !== true) {
        return { kind: 'deny', reason: 'autonomous Mission authoring is disabled by plugin configuration' }
      }
      return next()
    }
    if (!mutationTools.has(tool)) return next()
    if (exec.name === DRAFT_CREATE_TOOL_NAME) {
      const prepared = store.prepareCreate(exec.arguments)
      return {
        kind: 'ask',
        reason: `Create owner-scoped WDL draft ${prepared.workflowId}@${prepared.version} revision 1 with content digest ${prepared.contentDigest}`,
      }
    }
    const prepared = await store.prepareUpdate(exec.arguments, {
      ownerSession: sessionId,
      signal: exec.signal,
    })
    if (!prepared.ok) {
      return { kind: 'deny', reason: `draft update preparation failed: ${prepared.error.code}` }
    }
    return {
      kind: 'ask',
      reason: `Update owner-scoped WDL ${prepared.next.draftId} from revision ${prepared.current.revision} (${prepared.current.contentDigest}) to revision ${prepared.next.revision} (${prepared.next.contentDigest})`,
    }
  })
}
