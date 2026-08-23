import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkflowCatalog } from '../src/catalog.js'
import {
  GET_TOOL_NAME,
  LIST_TOOL_NAME,
  registerCatalogTools,
} from '../src/catalog-tools.js'
import { makeManifest } from './fixtures.mjs'

test('catalog tools register once and expose mandatory DSH output declarations', async () => {
  const registered = []
  const ctx = { tools: { register: (tool) => registered.push(tool) } }
  const defineTool = (definition) => definition
  const catalog = createWorkflowCatalog([
    makeManifest(),
    makeManifest({ id: 'variant-calling', engine: { name: 'wdl' }, tags: ['variant'] }),
  ])

  const tools = registerCatalogTools(ctx, defineTool, catalog)
  const listTool = tools.find((tool) => tool.name === LIST_TOOL_NAME)
  const getTool = tools.find((tool) => tool.name === GET_TOOL_NAME)

  assert.equal(registered.length, 2)
  assert.deepEqual(registered, tools)
  assert.deepEqual(listTool.output.schema, { type: 'string' })
  assert.deepEqual(getTool.output.render({}, 'ready'), [{ type: 'text', text: 'ready' }])
  assert.equal(listTool.isConcurrencySafe({}), true)
  assert.equal(getTool.parameters.id.required, true)

  const listResult = JSON.parse(await listTool.execute({ engine: 'wdl' }))
  assert.equal(listResult.count, 1)
  assert.equal(listResult.workflows[0].id, 'variant-calling')

  const found = JSON.parse(await getTool.execute({ id: 'fastq-qc' }))
  const missing = JSON.parse(await getTool.execute({ id: 'missing' }))
  assert.equal(found.found, true)
  assert.equal(found.workflow.id, 'fastq-qc')
  assert.deepEqual(missing, { found: false, workflow: null })
})
