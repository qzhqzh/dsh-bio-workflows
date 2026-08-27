import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EXECUTION_PLAN_TOOL_NAME,
  EXECUTION_RUN_GET_TOOL_NAME,
  EXECUTION_RUN_LIST_TOOL_NAME,
  EXECUTION_RUN_CLEANUP_PLAN_TOOL_NAME,
  EXECUTION_RUN_CLEANUP_TOOL_NAME,
  EXECUTION_RUN_TOOL_NAME,
  createExecutionTools,
  registerExecutionApprovalGate,
} from '../src/execution-tools.js'
import { defineTool } from '../src/tool-definition.js'

const bundleDigest = `sha256:${'1'.repeat(64)}`
const planDigest = `sha256:${'2'.repeat(64)}`
const request = {
  id: 'fastq-qc',
  version: '1.1.0',
  expectedDigest: bundleDigest,
  inputs: { reads: ['/data/sample.fastq.gz'] },
}

test('execution tools expose exact selection, plan binding, and run lookup schemas', async () => {
  const calls = []
  const execution = {
    plan: async (value, operation) => {
      calls.push(['plan', value, operation])
      return { ok: true, planDigest }
    },
    run: async (value, operation) => {
      calls.push(['run', value, operation])
      return { ok: true, runId: 'run-123e4567-e89b-42d3-a456-426614174000' }
    },
    getRun: async (runId, operation) => {
      calls.push(['get', runId, operation])
      return { ok: true, run: { runId } }
    },
    listRuns: async (value, operation) => {
      calls.push(['list', value, operation])
      return { ok: true, runs: [] }
    },
    cleanupPlan: async (operation) => {
      calls.push(['cleanup-plan', operation])
      return { ok: true, cleanupPlanDigest: planDigest, plan: { candidates: [] } }
    },
    cleanupRuns: async (value, operation) => {
      calls.push(['cleanup', value, operation])
      return { ok: true, removedCount: 1 }
    },
  }
  const tools = createExecutionTools(defineTool, execution)

  assert.deepEqual(tools.map((tool) => tool.name), [
    EXECUTION_PLAN_TOOL_NAME,
    EXECUTION_RUN_TOOL_NAME,
    EXECUTION_RUN_GET_TOOL_NAME,
    EXECUTION_RUN_LIST_TOOL_NAME,
    EXECUTION_RUN_CLEANUP_PLAN_TOOL_NAME,
    EXECUTION_RUN_CLEANUP_TOOL_NAME,
  ])
  assert.deepEqual(tools[0].parameters.required, ['id', 'version', 'expectedDigest', 'inputs'])
  assert.deepEqual(tools[1].parameters.required, [
    'id',
    'version',
    'expectedDigest',
    'inputs',
    'expectedPlanDigest',
  ])
  assert.deepEqual(tools[2].parameters.required, ['runId'])
  assert.equal(tools[3].parameters.required, undefined)
  assert.equal(tools[4].parameters.required, undefined)
  assert.deepEqual(tools[5].parameters.required, ['expectedCleanupPlanDigest'])
  assert.deepEqual(tools[3].parameters.properties.status.enum, [
    'prepared',
    'running',
    'stopping',
    'completed',
    'failed',
    'killed',
    'interrupted',
  ])

  const signal = new AbortController().signal
  const agent = { id: 'owner' }
  assert.equal(JSON.parse(await tools[0].execute(request, { signal, agent })).planDigest, planDigest)
  assert.equal(JSON.parse(await tools[1].execute({
    ...request,
    expectedPlanDigest: planDigest,
  }, { signal, agent })).ok, true)
  assert.equal(JSON.parse(await tools[2].execute({
    runId: 'run-123e4567-e89b-42d3-a456-426614174000',
  }, { signal, agent })).ok, true)
  assert.equal(JSON.parse(await tools[3].execute({ status: 'completed' }, { signal, agent })).ok, true)
  assert.equal(JSON.parse(await tools[4].execute({}, { signal, agent })).ok, true)
  assert.equal(JSON.parse(await tools[5].execute({
    expectedCleanupPlanDigest: planDigest,
  }, { signal, agent })).ok, true)
  await assert.rejects(
    tools[3].execute({ status: 'unknown' }, { signal, agent }),
    (error) => error.code === 'INVALID_ARGS',
  )
  assert.equal(calls.length, 6)
})

test('execution approval is denied on preparation failure and bound to the exact live plan', async () => {
  let prepared = {
    result: {
      planDigest,
      plan: {
        workflow: {
          id: 'fastq-qc',
          version: '1.1.0',
          bundleDigest,
        },
        runner: { version: '1.15.0' },
        inputSnapshotPolicy: { totalBytes: '18' },
        runsRoot: '/runs',
      },
    },
  }
  const execution = { prepareRun: async () => prepared }
  const tools = createExecutionTools(defineTool, {
    ...execution,
    plan: async () => ({}),
    run: async () => ({}),
    getRun: async () => ({}),
    listRuns: async () => ({}),
    cleanupPlan: async () => ({}),
    cleanupRuns: async () => ({}),
  })
  let listener
  const ctx = {
    tools: { get: (name) => tools.find((tool) => tool.name === name) },
    on: (_event, value) => { listener = value },
  }
  registerExecutionApprovalGate(ctx, tools, execution)

  const approved = await listener({
    name: EXECUTION_RUN_TOOL_NAME,
    arguments: { ...request, expectedPlanDigest: planDigest },
    signal: new AbortController().signal,
    agent: { id: 'owner' },
  }, async () => ({ kind: 'allow' }))
  assert.equal(approved.kind, 'ask')
  assert.match(approved.reason, new RegExp(bundleDigest))
  assert.match(approved.reason, new RegExp(planDigest))
  assert.match(approved.reason, /miniwdl 1\.15\.0/)
  assert.match(approved.reason, /snapshot 18 input bytes/)

  prepared = { ok: false, error: { code: 'plan_digest_mismatch' } }
  const denied = await listener({
    name: EXECUTION_RUN_TOOL_NAME,
    arguments: { ...request, expectedPlanDigest: planDigest },
    signal: new AbortController().signal,
  }, async () => ({ kind: 'allow' }))
  assert.deepEqual(denied, {
    kind: 'deny',
    reason: 'workflow execution preparation failed: plan_digest_mismatch',
  })

  let delegated = false
  const unrelated = await listener({ name: 'other', arguments: {} }, async () => {
    delegated = true
    return { kind: 'allow' }
  })
  assert.equal(delegated, true)
  assert.equal(unrelated.kind, 'allow')
})

test('retention cleanup approval is bound to the exact owner-scoped candidate set', async () => {
  let prepared = {
    result: {
      cleanupPlanDigest: planDigest,
      plan: {
        candidates: [{ runId: 'run-123e4567-e89b-42d3-a456-426614174000' }],
      },
    },
  }
  const execution = {
    plan: async () => ({}),
    run: async () => ({}),
    getRun: async () => ({}),
    listRuns: async () => ({}),
    cleanupPlan: async () => ({}),
    cleanupRuns: async () => ({}),
    prepareRun: async () => ({}),
    prepareCleanup: async () => prepared,
  }
  const tools = createExecutionTools(defineTool, execution)
  let listener
  const ctx = {
    tools: { get: (name) => tools.find((tool) => tool.name === name) },
    on: (_event, value) => { listener = value },
  }
  registerExecutionApprovalGate(ctx, tools, execution)

  const approved = await listener({
    name: EXECUTION_RUN_CLEANUP_TOOL_NAME,
    arguments: { expectedCleanupPlanDigest: planDigest },
    signal: new AbortController().signal,
    agent: { id: 'owner' },
  }, async () => ({ kind: 'allow' }))
  assert.equal(approved.kind, 'ask')
  assert.match(approved.reason, new RegExp(planDigest))
  assert.match(approved.reason, /run-123e4567/)

  prepared = { ok: false, error: { code: 'cleanup_plan_digest_mismatch' } }
  const denied = await listener({
    name: EXECUTION_RUN_CLEANUP_TOOL_NAME,
    arguments: { expectedCleanupPlanDigest: planDigest },
    signal: new AbortController().signal,
    agent: { id: 'owner' },
  }, async () => ({ kind: 'allow' }))
  assert.deepEqual(denied, {
    kind: 'deny',
    reason: 'workflow run cleanup preparation failed: cleanup_plan_digest_mismatch',
  })
})
