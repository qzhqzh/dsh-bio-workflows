import { ownerSession } from './draft-tools.js'
import { validateToolArguments } from './tool-definition.js'

export const DRAFT_TEST_PREPARE_TOOL_NAME = 'bio_workflows_draft_test_prepare'
export const DRAFT_TEST_START_TOOL_NAME = 'bio_workflows_draft_test_start'
export const DRAFT_TEST_GET_TOOL_NAME = 'bio_workflows_draft_test_get'
export const DRAFT_TEST_CANCEL_TOOL_NAME = 'bio_workflows_draft_test_cancel'
export const DRAFT_TEST_REPORT_TOOL_NAME = 'bio_workflows_draft_test_report'

const MISSION_ID_PATTERN = '^mission-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
const TEST_ID_PATTERN = '^test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
const IDENTIFIER_PATTERN = '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
const SEMVER_PATTERN = '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$'
const DIGEST_PATTERN = '^sha256:[a-f0-9]{64}$'
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

function textOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  }
}

function stringify(value) {
  return JSON.stringify(value, null, 2)
}

function approvalLiteral(value, maximum = 512) {
  return JSON.stringify(String(value).slice(0, maximum))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function budgetParameter(maxima) {
  return {
    type: 'object',
    description: 'Optional lower limits; configured maxima cannot be exceeded.',
    properties: Object.fromEntries(Object.entries(maxima).map(([key, maximum]) => [key, {
      type: 'integer',
      minimum: MINIMUM_BUDGETS[key],
      maximum,
    }])),
    additionalProperties: false,
  }
}

function selectionParameters(maxima) {
  return {
    missionId: {
      type: 'string',
      pattern: MISSION_ID_PATTERN,
      required: true,
      description: 'Exact owner-visible ready Mission containing the validated draft identity.',
    },
    fixtureId: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      pattern: IDENTIFIER_PATTERN,
      required: true,
      description: 'Exact declarative fixture bundle id.',
    },
    fixtureVersion: {
      type: 'string',
      maxLength: 128,
      pattern: SEMVER_PATTERN,
      required: true,
      description: 'Exact declarative fixture bundle version.',
    },
    budgets: budgetParameter(maxima),
  }
}

function operation(exec) {
  return {
    ownerSession: ownerSession(exec),
    agent: exec?.agent,
    signal: exec?.signal,
  }
}

export function createDraftTestTools(defineTool, manager) {
  const selection = selectionParameters(manager.config.budgets)
  const prepare = defineTool({
    name: DRAFT_TEST_PREPARE_TOOL_NAME,
    description:
      'Prepare a separately authorized isolated fixture-test plan for one exact ready Mission draft. This does not execute, install, promote, allowlist, or production-run the draft.',
    parameters: selection,
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (request, exec) => stringify(await manager.prepare(request, operation(exec))),
  })
  const start = defineTool({
    name: DRAFT_TEST_START_TOOL_NAME,
    description:
      'Start one explicitly approved owner-session isolated fixture test bound to the exact live plan digest. No production or promotion authority is granted.',
    parameters: {
      ...selectionParameters(manager.config.budgets),
      expectedPlanDigest: {
        type: 'string',
        pattern: DIGEST_PATTERN,
        required: true,
        description: 'Exact planDigest returned by bio_workflows_draft_test_prepare.',
      },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (request, exec) => stringify(await manager.start(request, operation(exec))),
  })
  const get = defineTool({
    name: DRAFT_TEST_GET_TOOL_NAME,
    description:
      'Read one owner-session isolated draft test and its digest-bound, bounded evidence.',
    parameters: {
      testId: {
        type: 'string',
        pattern: TEST_ID_PATTERN,
        required: true,
        description: 'Opaque draft-test UUID returned by draft_test_start.',
      },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async ({ testId }, exec) => stringify(await manager.get(testId, operation(exec))),
  })
  const cancel = defineTool({
    name: DRAFT_TEST_CANCEL_TOOL_NAME,
    description:
      'Cancel one owner-session isolated draft test without retrying or deleting retained evidence.',
    parameters: {
      testId: {
        type: 'string',
        pattern: TEST_ID_PATTERN,
        required: true,
        description: 'Opaque draft-test UUID returned by draft_test_start.',
      },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async ({ testId }, exec) => stringify(await manager.cancel(testId, operation(exec))),
  })
  const report = defineTool({
    name: DRAFT_TEST_REPORT_TOOL_NAME,
    description:
      'Build a bounded isolated fixture-test report. Passing does not install, promote, allowlist, or authorize production execution.',
    parameters: {
      testId: {
        type: 'string',
        pattern: TEST_ID_PATTERN,
        required: true,
        description: 'Opaque draft-test UUID returned by draft_test_start.',
      },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async ({ testId }, exec) => stringify(await manager.report(testId, operation(exec))),
  })
  return [prepare, start, get, cancel, report]
}

export function registerDraftTestApprovalGate(ctx, tools, manager) {
  const start = tools.find((tool) => tool.name === DRAFT_TEST_START_TOOL_NAME)
  ctx.on('tools/pre-execute', async (exec, next) => {
    const tool = ctx.tools.get(exec.name, exec.agent)
    if (tool !== start) return next()
    if (validateToolArguments(tool, exec.arguments).length > 0) return next()
    try {
      const request = { ...exec.arguments }
      delete request.expectedPlanDigest
      const prepared = await manager.prepare(request, operation(exec))
      if (!prepared.ok) {
        return { kind: 'deny', reason: `isolated draft-test preparation failed: ${prepared.error.code}` }
      }
      if (!prepared.readyToStart) {
        return { kind: 'deny', reason: 'isolated draft-test jobs service is unavailable' }
      }
      if (prepared.planDigest !== exec.arguments.expectedPlanDigest) {
        return {
          kind: 'deny',
          reason: `draft-test plan digest mismatch: expected ${exec.arguments.expectedPlanDigest}, prepared ${prepared.planDigest}`,
        }
      }
      const plan = prepared.plan
      return {
        kind: 'ask',
        reason: `Authorize one isolated owner-session fixture test for Mission ${approvalLiteral(plan.mission.missionId)} using exact draft ${approvalLiteral(plan.draft.draftId)} revision ${plan.draft.revision}, fixture ${approvalLiteral(`${plan.fixture.id}@${plan.fixture.version}`)} (${plan.fixture.fixtureDigest}), container ${approvalLiteral(plan.mission.software.containerImage)}, runner ${plan.runner.runnerDigest}, isolation policy ${plan.isolation.isolationPolicyDigest}, plan ${prepared.planDigest}, and bounded wall time ${plan.budgets.wallTimeMs} ms. This grants no install, promotion, allowlist, or production execution authority.`,
      }
    } catch {
      return { kind: 'deny', reason: 'isolated draft-test preparation failed closed' }
    }
  })
}
