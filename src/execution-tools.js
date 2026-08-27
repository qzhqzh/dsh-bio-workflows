import { validateToolArguments } from './tool-definition.js'

export const EXECUTION_PLAN_TOOL_NAME = 'bio_workflows_plan'
export const EXECUTION_RUN_TOOL_NAME = 'bio_workflows_run'
export const EXECUTION_RUN_GET_TOOL_NAME = 'bio_workflows_run_get'
export const EXECUTION_RUN_LIST_TOOL_NAME = 'bio_workflows_run_list'
export const EXECUTION_RUN_CLEANUP_PLAN_TOOL_NAME = 'bio_workflows_run_cleanup_plan'
export const EXECUTION_RUN_CLEANUP_TOOL_NAME = 'bio_workflows_run_cleanup'

const IDENTIFIER_PATTERN = '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
const SEMVER_PATTERN = '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$'
const DIGEST_PATTERN = '^sha256:[a-f0-9]{64}$'
const RUN_ID_PATTERN = '^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

function textOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  }
}

function stringify(value) {
  return JSON.stringify(value, null, 2)
}

function selectionParameters() {
  return {
    id: {
      type: 'string',
      pattern: IDENTIFIER_PATTERN,
      required: true,
      description: 'Exact built-in workflow bundle id.',
    },
    version: {
      type: 'string',
      pattern: SEMVER_PATTERN,
      required: true,
      description: 'Exact built-in workflow bundle version.',
    },
    expectedDigest: {
      type: 'string',
      pattern: DIGEST_PATTERN,
      required: true,
      description: 'Exact bundle digest returned by bio_workflows_search.',
    },
    inputs: {
      type: 'object',
      additionalProperties: true,
      required: true,
      description: 'Workflow inputs; filesystem paths must be absolute and inside configured input roots.',
    },
  }
}

export function createExecutionTools(defineTool, execution) {
  const plan = defineTool({
    name: EXECUTION_PLAN_TOOL_NAME,
    description:
      'Inspect real inputs, probe miniwdl and Docker, and return a non-executing plan bound to a SHA-256 plan digest.',
    parameters: selectionParameters(),
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (request, exec) => stringify(await execution.plan(request, {
      signal: exec?.signal,
      agent: exec?.agent,
    })),
  })

  const run = defineTool({
    name: EXECUTION_RUN_TOOL_NAME,
    description:
      'Start an approved built-in WDL workflow as a DSH background job. The live plan must still match expectedPlanDigest.',
    parameters: {
      ...selectionParameters(),
      expectedPlanDigest: {
        type: 'string',
        pattern: DIGEST_PATTERN,
        required: true,
        description: 'Exact plan digest returned by bio_workflows_plan.',
      },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (request, exec) => stringify(await execution.run(request, {
      signal: exec?.signal,
      agent: exec?.agent,
    })),
  })

  const getRun = defineTool({
    name: EXECUTION_RUN_GET_TOOL_NAME,
    description:
      'Read owner-scoped workflow status, provenance, output inventory, and normalized checksummed result. Use shared job_output and job_kill for logs and cancellation.',
    parameters: {
      runId: {
        type: 'string',
        pattern: RUN_ID_PATTERN,
        required: true,
        description: 'Run id returned by bio_workflows_run.',
      },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async ({ runId }, exec) => stringify(await execution.getRun(runId, {
      signal: exec?.signal,
      agent: exec?.agent,
    })),
  })

  const listRuns = defineTool({
    name: EXECUTION_RUN_LIST_TOOL_NAME,
    description:
      'List bounded, newest-first, owner-scoped durable workflow run summaries and reconcile restart-interrupted runs without retrying them.',
    parameters: {
      status: {
        type: 'string',
        enum: ['prepared', 'running', 'stopping', 'completed', 'failed', 'killed', 'interrupted'],
        required: false,
        description: 'Optional exact lifecycle status filter.',
      },
      cursor: {
        type: 'string',
        pattern: RUN_ID_PATTERN,
        required: false,
        description: 'Last runId returned by the previous page for the same owner and status filter.',
      },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (request, exec) => stringify(await execution.listRuns(request, {
      signal: exec?.signal,
      agent: exec?.agent,
    })),
  })

  const cleanupPlan = defineTool({
    name: EXECUTION_RUN_CLEANUP_PLAN_TOOL_NAME,
    description:
      'Preview the exact owner-scoped terminal run directories eligible under the configured retention policy. This does not delete data.',
    parameters: {},
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (_request, exec) => stringify(await execution.cleanupPlan({
      signal: exec?.signal,
      agent: exec?.agent,
    })),
  })

  const cleanup = defineTool({
    name: EXECUTION_RUN_CLEANUP_TOOL_NAME,
    description:
      'Delete only the owner-scoped terminal run directories in one approved, exact retention cleanup plan.',
    parameters: {
      expectedCleanupPlanDigest: {
        type: 'string',
        pattern: DIGEST_PATTERN,
        required: true,
        description: 'Exact cleanup plan digest returned by bio_workflows_run_cleanup_plan.',
      },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (request, exec) => stringify(await execution.cleanupRuns(request, {
      signal: exec?.signal,
      agent: exec?.agent,
    })),
  })

  return [plan, run, getRun, listRuns, cleanupPlan, cleanup]
}

export function registerExecutionApprovalGate(ctx, tools, execution) {
  const runTool = tools.find((tool) => tool.name === EXECUTION_RUN_TOOL_NAME)
  const cleanupTool = tools.find((tool) => tool.name === EXECUTION_RUN_CLEANUP_TOOL_NAME)

  ctx.on('tools/pre-execute', async (exec, next) => {
    const tool = ctx.tools.get(exec.name, exec.agent)
    if (tool !== runTool && tool !== cleanupTool) return next()
    if (validateToolArguments(tool, exec.arguments).length > 0) return next()

    if (tool === cleanupTool) {
      const prepared = await execution.prepareCleanup(exec.arguments, {
        signal: exec.signal,
        agent: exec.agent,
      })
      if (prepared.result === undefined) {
        return {
          kind: 'deny',
          reason: `workflow run cleanup preparation failed: ${prepared.error.code}`,
        }
      }
      const candidates = prepared.result.plan.candidates
      return {
        kind: 'ask',
        reason: `Delete ${candidates.length} owner-scoped terminal workflow run director${candidates.length === 1 ? 'y' : 'ies'} under the configured retention policy, bound to cleanup plan ${prepared.result.cleanupPlanDigest}: ${candidates.map((item) => item.runId).join(', ')}`,
      }
    }

    const prepared = await execution.prepareRun(exec.arguments, {
      signal: exec.signal,
      agent: exec.agent,
    })
    if (prepared.result === undefined) {
      return {
        kind: 'deny',
        reason: `workflow execution preparation failed: ${prepared.error.code}`,
      }
    }
    const plan = prepared.result.plan
    return {
      kind: 'ask',
      reason: `Run built-in ${plan.workflow.id}@${plan.workflow.version} with bundle ${plan.workflow.bundleDigest} and plan ${prepared.result.planDigest} using miniwdl ${plan.runner.version}; snapshot ${plan.inputSnapshotPolicy.totalBytes} input bytes and write outputs under ${plan.runsRoot}`,
    }
  })
}
