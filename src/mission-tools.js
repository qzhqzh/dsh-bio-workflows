import { ownerSession } from './draft-tools.js'
import { validateToolArguments } from './tool-definition.js'

export const MISSION_PREPARE_TOOL_NAME = 'bio_workflows_mission_prepare'
export const MISSION_START_TOOL_NAME = 'bio_workflows_mission_start'
export const MISSION_GET_TOOL_NAME = 'bio_workflows_mission_get'
export const MISSION_CANCEL_TOOL_NAME = 'bio_workflows_mission_cancel'
export const MISSION_REPORT_TOOL_NAME = 'bio_workflows_mission_report'

const MISSION_ID_PATTERN = '^mission-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
const DIGEST_PATTERN = '^sha256:[a-f0-9]{64}$'
const PINNED_IMAGE_PATTERN = '^[^\\s"\'\\\\]+@sha256:[a-f0-9]{64}$'

function textOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  }
}

function stringify(value) {
  return JSON.stringify(value, null, 2)
}

function approvalLiteral(value, maxLength = 512) {
  return JSON.stringify(String(value).slice(0, maxLength))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function softwareParameter() {
  return {
    type: 'object',
    topLevelRequired: true,
    description: 'Exact software identity for this trial mission.',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 160 },
      version: { type: 'string', minLength: 1, maxLength: 128 },
      containerImage: {
        type: 'string',
        minLength: 1,
        maxLength: 512,
        pattern: PINNED_IMAGE_PATTERN,
        description: 'Exact container reference pinned with @sha256:<64 lowercase hex characters>.',
      },
    },
    required: ['name', 'version', 'containerImage'],
    additionalProperties: false,
  }
}

function budgetParameter(limits) {
  const properties = {}
  for (const [name, maximum] of Object.entries(limits)) {
    properties[name] = {
      type: 'integer',
      minimum: name === 'maxWallTimeMs' ? 60 * 1000 : 1,
      maximum,
    }
  }
  return {
    type: 'object',
    description: 'Optional lower per-mission limits; configured maxima cannot be exceeded.',
    properties,
    additionalProperties: false,
  }
}

function goalParameters(limits) {
  return {
    software: softwareParameter(),
    objective: {
      type: 'string',
      minLength: 1,
      maxLength: 4000,
      required: true,
      description: 'Concrete software-trial objective.',
    },
    acceptanceCriteria: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      required: true,
      description: 'Observable criteria for the eventual isolated software trial.',
      items: { type: 'string', minLength: 1, maxLength: 1000 },
    },
    budget: budgetParameter(limits),
  }
}

function missionIdParameter(description) {
  return {
    type: 'string',
    pattern: MISSION_ID_PATTERN,
    required: true,
    description,
  }
}

export function createMissionTools(defineTool, missionStore) {
  const goal = goalParameters(missionStore.config.limits)
  const prepare = defineTool({
    name: MISSION_PREPARE_TOOL_NAME,
    description:
      'Prepare a digest-bound, bounded autonomous WDL draft-authoring plan for one exact software version. This does not create a mission, run a container, or authorize production execution.',
    parameters: goal,
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async (options) => stringify(await missionStore.prepare(options)),
  })

  const start = defineTool({
    name: MISSION_START_TOOL_NAME,
    description:
      'Start one owner-session Mission from an exact prepared plan digest after a single DSH approval. The grant covers only bounded draft create, update, and validation actions.',
    parameters: {
      ...goalParameters(missionStore.config.limits),
      expectedPlanDigest: {
        type: 'string',
        pattern: DIGEST_PATTERN,
        required: true,
        description: 'Exact planDigest returned by mission_prepare.',
      },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (options, exec) => stringify(await missionStore.start(options, {
      ownerSession: ownerSession(exec),
      signal: exec?.signal,
    })),
  })

  const get = defineTool({
    name: MISSION_GET_TOOL_NAME,
    description:
      'Read one owner-session Mission, including its bounded budget, draft binding, validation evidence, and fail-closed stop reason.',
    parameters: {
      missionId: missionIdParameter('Opaque Mission UUID returned by mission_start.'),
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async ({ missionId }, exec) => stringify(await missionStore.get(missionId, {
      ownerSession: ownerSession(exec),
      signal: exec?.signal,
    })),
  })

  const cancel = defineTool({
    name: MISSION_CANCEL_TOOL_NAME,
    description:
      'Cancel one owner-session Mission. Cancellation never retries an in-flight operation and does not delete its evidence.',
    parameters: {
      missionId: missionIdParameter('Opaque Mission UUID returned by mission_start.'),
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async ({ missionId }, exec) => stringify(await missionStore.cancel(missionId, {
      ownerSession: ownerSession(exec),
      signal: exec?.signal,
    })),
  })

  const report = defineTool({
    name: MISSION_REPORT_TOOL_NAME,
    description:
      'Build a bounded software-trial report from owner-session Mission evidence. Until an isolated test runner exists, success is always false and readiness stops at validated WDL draft.',
    parameters: {
      missionId: missionIdParameter('Opaque Mission UUID returned by mission_start.'),
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async ({ missionId }, exec) => stringify(await missionStore.report(missionId, {
      ownerSession: ownerSession(exec),
      signal: exec?.signal,
    })),
  })

  return [prepare, start, get, cancel, report]
}

export function registerMissionApprovalGate(ctx, tools, missionStore) {
  const start = tools.find((tool) => tool.name === MISSION_START_TOOL_NAME)

  ctx.on('tools/pre-execute', async (exec, next) => {
    const tool = ctx.tools.get(exec.name, exec.agent)
    if (tool !== start) return next()
    if (validateToolArguments(tool, exec.arguments).length > 0) return next()
    if (!missionStore.config.enabled) {
      return { kind: 'deny', reason: 'autonomous Mission authoring is disabled by plugin configuration' }
    }
    try {
      ownerSession(exec)
      const prepared = await missionStore.prepare(exec.arguments)
      if (!prepared.ok) {
        return { kind: 'deny', reason: `mission preparation failed: ${prepared.error.code}` }
      }
      if (prepared.planDigest !== exec.arguments.expectedPlanDigest) {
        return {
          kind: 'deny',
          reason: `mission plan digest mismatch: expected ${exec.arguments.expectedPlanDigest}, prepared ${prepared.planDigest}`,
        }
      }
      const policy = prepared.plan.policy
      const software = prepared.plan.goal.software
      return {
        kind: 'ask',
        reason: `Authorize one owner-session Mission for ${approvalLiteral(software.name)} ${approvalLiteral(software.version)} (${approvalLiteral(software.containerImage)}) bound to ${prepared.planDigest}; at most ${policy.maxActions} draft actions, ${policy.maxDraftCreates} creates, ${policy.maxDraftUpdates} updates, ${policy.maxValidationFailures} validation failures, ${policy.maxSameFailureFingerprint} repeats of one failure fingerprint, and ${policy.maxWallTimeMs} ms. Container execution and production execution remain disabled.`,
      }
    } catch (error) {
      return {
        kind: 'deny',
        reason: `mission preparation failed: ${approvalLiteral(error instanceof Error ? error.message : 'invalid request')}`,
      }
    }
  })
}
