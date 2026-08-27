import assert from 'node:assert/strict'
import test from 'node:test'

import { DRAFT_TEST_DEFAULT_BUDGETS } from '../src/draft-test-contract.js'
import {
  DRAFT_TEST_CANCEL_TOOL_NAME,
  DRAFT_TEST_GET_TOOL_NAME,
  DRAFT_TEST_PREPARE_TOOL_NAME,
  DRAFT_TEST_REPORT_TOOL_NAME,
  DRAFT_TEST_START_TOOL_NAME,
  createDraftTestTools,
  registerDraftTestApprovalGate,
} from '../src/draft-test-tools.js'
import { defineTool } from '../src/tool-definition.js'

const AGENT = Object.freeze({
  id: 'draft-test-owner',
  session: Object.freeze({ id: 'draft-test-owner' }),
})
const PLAN_DIGEST = `sha256:${'1'.repeat(64)}`
const REQUEST = Object.freeze({
  missionId: 'mission-11111111-1111-4111-8111-111111111111',
  fixtureId: 'text-roundtrip',
  fixtureVersion: '1.0.0',
})

function preparedPlan() {
  return {
    ok: true,
    readyToStart: true,
    planDigest: PLAN_DIGEST,
    plan: {
      mission: {
        missionId: REQUEST.missionId,
        software: {
          containerImage: `python@sha256:${'a'.repeat(64)}`,
        },
      },
      draft: {
        draftId: 'draft-22222222-2222-4222-8222-222222222222',
        revision: 3,
      },
      fixture: {
        id: REQUEST.fixtureId,
        version: REQUEST.fixtureVersion,
        fixtureDigest: `sha256:${'b'.repeat(64)}`,
      },
      runner: { runnerDigest: `sha256:${'c'.repeat(64)}` },
      isolation: { isolationPolicyDigest: `sha256:${'d'.repeat(64)}` },
      budgets: { wallTimeMs: 30_000 },
    },
  }
}

function manager(overrides = {}) {
  const calls = []
  return {
    calls,
    config: { budgets: DRAFT_TEST_DEFAULT_BUDGETS },
    async prepare(request, operation) {
      calls.push({ method: 'prepare', request, operation })
      return preparedPlan()
    },
    async start(request, operation) {
      calls.push({ method: 'start', request, operation })
      return { ok: true, testId: 'test-33333333-3333-4333-8333-333333333333' }
    },
    async get(testId, operation) {
      calls.push({ method: 'get', testId, operation })
      return { ok: true, test: { testId } }
    },
    async cancel(testId, operation) {
      calls.push({ method: 'cancel', testId, operation })
      return { ok: true, test: { testId, status: 'stopping' } }
    },
    async report(testId, operation) {
      calls.push({ method: 'report', testId, operation })
      return { ok: true, report: { testId } }
    },
    ...overrides,
  }
}

function context(tools) {
  const listeners = new Map()
  return {
    ctx: {
      tools: { get: (name) => tools.find((tool) => tool.name === name) },
      on: (event, listener) => listeners.set(event, listener),
    },
    listeners,
  }
}

test('draft-test tools expose five owner-scoped bounded lifecycle contracts', async () => {
  const fake = manager()
  const tools = createDraftTestTools(defineTool, fake)
  assert.deepEqual(tools.map((tool) => tool.name), [
    DRAFT_TEST_PREPARE_TOOL_NAME,
    DRAFT_TEST_START_TOOL_NAME,
    DRAFT_TEST_GET_TOOL_NAME,
    DRAFT_TEST_CANCEL_TOOL_NAME,
    DRAFT_TEST_REPORT_TOOL_NAME,
  ])
  assert.deepEqual(tools[0].parameters.required, ['missionId', 'fixtureId', 'fixtureVersion'])
  assert.equal(tools[0].parameters.properties.budgets.additionalProperties, false)
  assert.equal(tools[1].parameters.required.includes('expectedPlanDigest'), true)

  const prepared = JSON.parse(await tools[0].execute(REQUEST, { agent: AGENT }))
  assert.equal(prepared.planDigest, PLAN_DIGEST)
  const started = JSON.parse(await tools[1].execute(
    { ...REQUEST, expectedPlanDigest: PLAN_DIGEST },
    { agent: AGENT },
  ))
  assert.equal(started.ok, true)
  const testId = started.testId
  assert.equal(JSON.parse(await tools[2].execute({ testId }, { agent: AGENT })).test.testId, testId)
  assert.equal(JSON.parse(await tools[3].execute({ testId }, { agent: AGENT })).test.status, 'stopping')
  assert.equal(JSON.parse(await tools[4].execute({ testId }, { agent: AGENT })).report.testId, testId)
  for (const tool of tools) {
    assert.deepEqual(
      tool.output.render({}, '{"ok":true}'),
      [{ type: 'text', text: '{"ok":true}' }],
    )
  }
  assert.equal(tools.every((tool) => tool.isConcurrencySafe() === false), true)
  assert.equal(fake.calls.every((call) => call.operation.ownerSession === AGENT.id), true)
})

test('draft-test start approval is bound to the exact live plan and grants no production authority', async () => {
  const fake = manager()
  const tools = createDraftTestTools(defineTool, fake)
  const gate = context(tools)
  registerDraftTestApprovalGate(gate.ctx, tools, fake)
  const listener = gate.listeners.get('tools/pre-execute')

  const mismatch = await listener({
    name: DRAFT_TEST_START_TOOL_NAME,
    arguments: { ...REQUEST, expectedPlanDigest: `sha256:${'0'.repeat(64)}` },
    agent: AGENT,
  }, async () => assert.fail('digest mismatch delegated'))
  assert.equal(mismatch.kind, 'deny')
  assert.match(mismatch.reason, /plan digest mismatch/)

  const decision = await listener({
    name: DRAFT_TEST_START_TOOL_NAME,
    arguments: { ...REQUEST, expectedPlanDigest: PLAN_DIGEST },
    agent: AGENT,
  }, async () => assert.fail('approved draft-test start delegated'))
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /exact draft/)
  assert.match(decision.reason, /fixture "text-roundtrip@1\.0\.0"/)
  assert.match(decision.reason, /grants no install, promotion, allowlist, or production execution authority/)

  const delegated = await listener({ name: DRAFT_TEST_GET_TOOL_NAME, arguments: {}, agent: AGENT }, async () => 'next')
  assert.equal(delegated, 'next')
})

test('draft-test approval fails closed when preparation or argument validation fails', async () => {
  const unavailable = manager({
    async prepare() {
      return { ok: false, error: { code: 'draft_testing_disabled', message: 'disabled' } }
    },
  })
  const tools = createDraftTestTools(defineTool, unavailable)
  const gate = context(tools)
  registerDraftTestApprovalGate(gate.ctx, tools, unavailable)
  const listener = gate.listeners.get('tools/pre-execute')

  const denied = await listener({
    name: DRAFT_TEST_START_TOOL_NAME,
    arguments: { ...REQUEST, expectedPlanDigest: PLAN_DIGEST },
    agent: AGENT,
  }, async () => assert.fail('unavailable runner delegated'))
  assert.deepEqual(denied, {
    kind: 'deny',
    reason: 'isolated draft-test preparation failed: draft_testing_disabled',
  })

  const noJobs = manager({
    async prepare() {
      return { ...preparedPlan(), readyToStart: false }
    },
  })
  const noJobTools = createDraftTestTools(defineTool, noJobs)
  const noJobGate = context(noJobTools)
  registerDraftTestApprovalGate(noJobGate.ctx, noJobTools, noJobs)
  const noJobDecision = await noJobGate.listeners.get('tools/pre-execute')({
    name: DRAFT_TEST_START_TOOL_NAME,
    arguments: { ...REQUEST, expectedPlanDigest: PLAN_DIGEST },
    agent: AGENT,
  }, async () => assert.fail('missing jobs service delegated'))
  assert.deepEqual(noJobDecision, {
    kind: 'deny',
    reason: 'isolated draft-test jobs service is unavailable',
  })

  const throws = manager({
    async prepare() {
      throw new Error('synthetic preparation failure')
    },
  })
  const throwingTools = createDraftTestTools(defineTool, throws)
  const throwingGate = context(throwingTools)
  registerDraftTestApprovalGate(throwingGate.ctx, throwingTools, throws)
  const failedClosed = await throwingGate.listeners.get('tools/pre-execute')({
    name: DRAFT_TEST_START_TOOL_NAME,
    arguments: { ...REQUEST, expectedPlanDigest: PLAN_DIGEST },
    agent: AGENT,
  }, async () => assert.fail('throwing preparation delegated'))
  assert.deepEqual(failedClosed, {
    kind: 'deny',
    reason: 'isolated draft-test preparation failed closed',
  })

  const invalid = await listener({
    name: DRAFT_TEST_START_TOOL_NAME,
    arguments: { ...REQUEST, expectedPlanDigest: 'not-a-digest' },
    agent: AGENT,
  }, async () => 'argument guard')
  assert.equal(invalid, 'argument guard')
})
