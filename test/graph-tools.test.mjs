import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDraftStore } from '../src/draft-store.js'
import { createGraphTools, DRAFT_GRAPH_TOOL_NAME } from '../src/graph-tools.js'
import { defineTool } from '../src/tool-definition.js'

const AGENT = Object.freeze({
  id: 'session-graph-tools',
  session: Object.freeze({ id: 'session-graph-tools' }),
})

test('draft graph tool binds output to one exact owner-scoped revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-graph-tools-test-'))
  try {
    const store = createDraftStore({ root, writeEnabled: true })
    const [tool] = createGraphTools(defineTool, store)
    assert.equal(tool.name, DRAFT_GRAPH_TOOL_NAME)
    assert.equal(tool.presentCall({
      draftId: 'draft-11111111-1111-4111-8111-111111111111',
      revision: 1,
    }).title, 'Visualize an AI WDL draft')

    const created = await store.create({
      id: 'rna-qc',
      name: 'RNA QC',
      summary: 'RNA sequencing quality control.',
    }, { ownerSession: AGENT.session.id })
    const graph = JSON.parse(await tool.execute({
      draftId: created.draftId,
      revision: 1,
    }, { agent: AGENT }))

    assert.equal(graph.draftId, created.draftId)
    assert.equal(graph.revision, 1)
    assert.equal(graph.contentDigest, created.contentDigest)
    assert.equal(graph.workflow.name, 'rna_qc')
    assert.equal(graph.executionAuthorized, false)

    const otherOwner = JSON.parse(await tool.execute(
      { draftId: created.draftId, revision: 1 },
      { agent: { id: 'other-session', session: { id: 'other-session' } } },
    ))
    assert.equal(otherOwner.ok, false)
    assert.equal(otherOwner.error.code, 'draft_not_found')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
