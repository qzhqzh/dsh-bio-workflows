import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDraftStore } from '../src/draft-store.js'
import {
  createDraftTools,
  DRAFT_CREATE_TOOL_NAME,
  DRAFT_GET_TOOL_NAME,
  DRAFT_UPDATE_TOOL_NAME,
  DRAFT_VALIDATE_TOOL_NAME,
  registerDraftApprovalGate,
} from '../src/draft-tools.js'
import { defineTool, ToolArgsError } from '../src/tool-definition.js'

const AGENT = Object.freeze({
  id: 'session-draft-tools',
  session: Object.freeze({ id: 'session-draft-tools' }),
})

function makeContext(tools) {
  const listeners = new Map()
  return {
    ctx: {
      tools: { get: (name) => tools.find((tool) => tool.name === name) },
      on: (event, listener) => listeners.set(event, listener),
    },
    listeners,
  }
}

test('draft tools expose exact schemas, owner-derived operations, and no execution authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-draft-tools-test-'))
  try {
    const store = createDraftStore({ root, writeEnabled: true })
    const validator = {
      validate: async (options) => ({
        ok: true,
        validation: { draftId: options.draftId, revision: options.revision, valid: true },
      }),
    }
    const tools = createDraftTools(defineTool, store, validator)
    assert.deepEqual(tools.map((tool) => tool.name), [
      DRAFT_CREATE_TOOL_NAME,
      DRAFT_GET_TOOL_NAME,
      DRAFT_UPDATE_TOOL_NAME,
      DRAFT_VALIDATE_TOOL_NAME,
    ])
    assert.equal(tools[1].parameters.properties.revision.type, 'integer')
    assert.equal(tools[2].parameters.properties.replacements.type, 'array')
    assert.deepEqual(
      tools[2].parameters.properties.replacements.items.required,
      ['path', 'role', 'content'],
    )
    assert.equal(tools.every((tool) => tool.isConcurrencySafe({}) === false), true)

    await assert.rejects(
      tools[0].execute({
        id: `a-${'b'.repeat(64)}`,
        name: 'Oversized id',
        summary: 'Must fail before approval or persistence.',
      }, { agent: AGENT }),
      (error) => error instanceof ToolArgsError && error.violations.some((item) => item.includes('64')),
    )

    await assert.rejects(
      tools[2].execute({
        draftId: 'draft-11111111-1111-4111-8111-111111111111',
        expectedRevision: 1,
        expectedContentDigest: `sha256:${'0'.repeat(64)}`,
        replacements: [{ path: 'main.wdl', role: 'workflow', extra: true }],
      }, { agent: AGENT }),
      (error) => error instanceof ToolArgsError && error.violations.length === 2,
    )

    const created = JSON.parse(await tools[0].execute({
      id: 'rna-qc',
      name: 'RNA QC',
      summary: 'RNA sequencing quality control.',
    }, { agent: AGENT }))
    assert.equal(created.ok, true)
    assert.equal(created.executionAuthorized, false)
    const fetched = JSON.parse(await tools[1].execute(
      { draftId: created.draftId, revision: 1, path: 'main.wdl' },
      { agent: AGENT },
    ))
    assert.equal(fetched.file.path, 'main.wdl')
    const validation = JSON.parse(await tools[3].execute(
      { draftId: created.draftId, revision: 1 },
      { agent: AGENT },
    ))
    assert.equal(validation.validation.valid, true)

    await assert.rejects(
      tools[1].execute(
        { draftId: created.draftId },
        { agent: { id: AGENT.id, session: { id: 'different-session' } } },
      ),
      /consistent owning DSH agent session/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('draft approval gate denies default-off writes and binds approved create and update digests', async () => {
  const disabledStore = createDraftStore()
  const disabledTools = createDraftTools(defineTool, disabledStore, { validate: async () => ({}) })
  const disabledContext = makeContext(disabledTools)
  registerDraftApprovalGate(disabledContext.ctx, disabledTools, disabledStore)
  const disabled = await disabledContext.listeners.get('tools/pre-execute')({
    name: DRAFT_CREATE_TOOL_NAME,
    arguments: { id: 'rna-qc', name: 'RNA QC', summary: 'QC' },
    agent: AGENT,
  }, async () => assert.fail('disabled mutation delegated'))
  assert.equal(disabled.kind, 'deny')

  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-draft-approval-test-'))
  try {
    const store = createDraftStore({ root, writeEnabled: true })
    const tools = createDraftTools(defineTool, store, { validate: async () => ({}) })
    const context = makeContext(tools)
    registerDraftApprovalGate(context.ctx, tools, store)
    const createArguments = { id: 'rna-qc', name: 'RNA QC', summary: 'QC' }
    const malformedOwnerDecision = await context.listeners.get('tools/pre-execute')({
      name: DRAFT_CREATE_TOOL_NAME,
      arguments: createArguments,
      agent: { id: 'session-a', session: { id: 'session-b' } },
    }, async () => assert.fail('malformed-owner create delegated'))
    assert.equal(malformedOwnerDecision.kind, 'deny')
    assert.match(malformedOwnerDecision.reason, /consistent owning DSH agent session/)

    const createDecision = await context.listeners.get('tools/pre-execute')({
      name: DRAFT_CREATE_TOOL_NAME,
      arguments: createArguments,
      agent: AGENT,
    }, async () => assert.fail('create mutation delegated'))
    assert.equal(createDecision.kind, 'ask')
    assert.match(createDecision.reason, /revision 1/)
    assert.match(createDecision.reason, /sha256:[a-f0-9]{64}/)

    const created = await store.create(createArguments, { ownerSession: AGENT.session.id })
    const updateArguments = {
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{ path: 'README.md', role: 'documentation', content: 'approved update\n' }],
    }
    const updateDecision = await context.listeners.get('tools/pre-execute')({
      name: DRAFT_UPDATE_TOOL_NAME,
      arguments: updateArguments,
      agent: AGENT,
    }, async () => assert.fail('update mutation delegated'))
    assert.equal(updateDecision.kind, 'ask')
    assert.match(updateDecision.reason, new RegExp(created.contentDigest))
    assert.match(updateDecision.reason, /to revision 2 \(sha256:[a-f0-9]{64}\)/)

    await store.update(updateArguments, { ownerSession: AGENT.session.id })
    const staleDecision = await context.listeners.get('tools/pre-execute')({
      name: DRAFT_UPDATE_TOOL_NAME,
      arguments: updateArguments,
      agent: AGENT,
    }, async () => assert.fail('stale mutation delegated'))
    assert.equal(staleDecision.kind, 'deny')
    assert.match(staleDecision.reason, /revision_conflict/)

    const readDecision = { kind: 'allow' }
    const read = await context.listeners.get('tools/pre-execute')({
      name: DRAFT_GET_TOOL_NAME,
      arguments: { draftId: created.draftId },
      agent: AGENT,
    }, async () => readDecision)
    assert.equal(read, readDecision)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
