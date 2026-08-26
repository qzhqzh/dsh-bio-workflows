import assert from 'node:assert/strict'
import test from 'node:test'

import {
  STORE_INSTALL_TOOL_NAME,
  STORE_SCAFFOLD_TOOL_NAME,
  STORE_SEARCH_TOOL_NAME,
  STORE_VALIDATE_TOOL_NAME,
  registerStoreApprovalGate,
  registerStoreTools,
} from '../src/store-tools.js'
import { defineTool } from '../src/tool-definition.js'
import { createWorkflowStore } from '../src/workflow-store.js'

test('store tools expose search, validation, install, and scaffold contracts', async () => {
  const registered = []
  const listeners = new Map()
  const ctx = {
    tools: {
      register: (tool) => registered.push(tool),
      get: (name) => registered.find((tool) => tool.name === name),
    },
    on: (event, listener) => listeners.set(event, listener),
  }
  const store = createWorkflowStore()
  const tools = registerStoreTools(ctx, defineTool, store)
  registerStoreApprovalGate(ctx, tools, store)

  assert.deepEqual(tools.map((tool) => tool.name), [
    STORE_SEARCH_TOOL_NAME,
    STORE_VALIDATE_TOOL_NAME,
    STORE_INSTALL_TOOL_NAME,
    STORE_SCAFFOLD_TOOL_NAME,
  ])
  assert.equal(registered.length, 4)
  assert.deepEqual(tools[0].output.schema, { type: 'string' })
  assert.equal(tools[0].isConcurrencySafe({}), false)
  assert.equal(tools[1].isConcurrencySafe({ id: 'fastq-qc' }), false)
  assert.equal(tools[2].isConcurrencySafe({ id: 'fastq-qc' }), false)
  assert.equal(tools[3].isConcurrencySafe({ id: 'custom', name: 'Custom', summary: 'Draft' }), false)

  const search = JSON.parse(await tools[0].execute({ query: 'fastq' }))
  const validation = JSON.parse(await tools[1].execute({ id: 'fastq-qc' }))
  const install = JSON.parse(await tools[2].execute({
    id: search.workflows[0].id,
    version: search.workflows[0].version,
    expectedDigest: search.workflows[0].digest,
  }))
  assert.equal(search.count, 3)
  assert.equal(validation.validation.level, 'structural')
  assert.equal(install.error.code, 'store_writes_disabled')

  const nextDecision = { kind: 'allow' }
  const foreign = await listeners.get('tools/pre-execute')(
    { name: 'foreign', arguments: {} },
    async () => nextDecision,
  )
  const disabledMutation = await listeners.get('tools/pre-execute')(
    {
      name: STORE_INSTALL_TOOL_NAME,
      arguments: {
        id: search.workflows[0].id,
        version: search.workflows[0].version,
        expectedDigest: search.workflows[0].digest,
      },
    },
    async () => assert.fail('mutation approval gate delegated'),
  )
  assert.equal(foreign, nextDecision)
  assert.equal(disabledMutation.kind, 'deny')
  assert.match(disabledMutation.reason, /disabled/)

  const enabledListeners = new Map()
  const enabledStore = createWorkflowStore({
    root: '/tmp/dsh-bio-workflows-store-tools-test',
    writeEnabled: true,
  })
  const enabledCtx = {
    tools: {
      register: () => {},
      get: (name) => tools.find((tool) => tool.name === name),
    },
    on: (event, listener) => enabledListeners.set(event, listener),
  }
  registerStoreApprovalGate(enabledCtx, tools, enabledStore)
  const enabledMutation = await enabledListeners.get('tools/pre-execute')(
    {
      name: STORE_SCAFFOLD_TOOL_NAME,
      arguments: { id: 'custom', version: '0.1.0', name: 'Custom', summary: 'Draft' },
    },
    async () => assert.fail('enabled mutation approval gate delegated'),
  )
  assert.equal(enabledMutation.kind, 'ask')
  assert.match(enabledMutation.reason, /custom@0\.1\.0/)
  assert.match(enabledMutation.reason, /sha256:[a-f0-9]{64}/)

  const fastq = (await enabledStore.search({ query: 'fastq', source: 'builtin' })).workflows[0]
  const enabledInstall = await enabledListeners.get('tools/pre-execute')(
    {
      name: STORE_INSTALL_TOOL_NAME,
      arguments: {
        id: fastq.id,
        version: fastq.version,
        expectedDigest: fastq.digest,
      },
    },
    async () => assert.fail('enabled mutation approval gate delegated'),
  )
  assert.equal(enabledInstall.kind, 'ask')
  assert.match(enabledInstall.reason, new RegExp(fastq.digest))
})
