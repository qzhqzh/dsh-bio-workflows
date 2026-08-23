import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkflowCatalog } from '../src/catalog.js'
import {
  PREFLIGHT_TOOL_NAME,
  registerPreflightTool,
} from '../src/preflight-tool.js'
import { makeManifest } from './fixtures.mjs'

test('preflight tool registers a read-only dynamic input object', async () => {
  const registered = []
  const ctx = { tools: { register: (tool) => registered.push(tool) } }
  const defineTool = (definition) => definition
  const catalog = createWorkflowCatalog([makeManifest()])
  const environment = {
    engines: { nextflow: { available: true, version: '24.04' } },
  }

  const tool = registerPreflightTool(ctx, defineTool, catalog, environment)

  assert.equal(registered.length, 1)
  assert.equal(registered[0], tool)
  assert.equal(tool.name, PREFLIGHT_TOOL_NAME)
  assert.equal(tool.parameters.inputs.type, 'object')
  assert.equal(tool.parameters.inputs.additionalProperties, true)
  assert.equal(tool.parameters.inputs.required, true)
  assert.deepEqual(tool.output.schema, { type: 'string' })
  assert.equal(tool.isConcurrencySafe({}), true)

  const found = JSON.parse(await tool.execute({
    id: 'fastq-qc',
    inputs: { reads: ['sample.fastq.gz'] },
  }))
  const missing = JSON.parse(await tool.execute({ id: 'missing', inputs: {} }))

  assert.equal(found.found, true)
  assert.equal(found.preflight.status, 'pass')
  assert.equal(found.preflight.executionReady, false)
  assert.deepEqual(missing, {
    found: false,
    preflight: null,
    error: {
      code: 'workflow_not_found',
      message: 'workflow not found: missing',
    },
  })
})
