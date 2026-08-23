import assert from 'node:assert/strict'
import test from 'node:test'

import { ToolArgsError, defineTool } from '../src/tool-definition.js'

test('the local tool wrapper compiles schemas and rejects invalid arguments', async () => {
  const tool = defineTool({
    name: 'example',
    description: 'Example tool.',
    parameters: {
      id: { type: 'string', required: true, description: 'Identifier.' },
      inputs: { type: 'object', additionalProperties: true },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    execute: async ({ id }) => id,
  })

  assert.deepEqual(tool.parameters, {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Identifier.' },
      inputs: { type: 'object', additionalProperties: true },
    },
    required: ['id'],
  })
  await assert.rejects(
    tool.execute({ inputs: [] }),
    (error) => (
      error instanceof ToolArgsError
      && error.code === 'INVALID_ARGS'
      && error.violations.length === 2
    ),
  )
  assert.equal(tool.isConcurrencySafe({ inputs: [] }), false)
  assert.equal(await tool.execute({ id: 'ready', inputs: {}, extra: true }), 'ready')
  assert.equal(tool.isConcurrencySafe({ id: 'ready' }), true)
})

test('the local tool wrapper rejects unsupported parameter types at registration', () => {
  assert.throws(
    () => defineTool({
      name: 'unsupported',
      description: 'Unsupported tool.',
      parameters: { count: { type: 'number' } },
      output: { schema: { type: 'string' }, render: () => [] },
      execute: async () => '',
    }),
    /unsupported tool parameter type/,
  )
})
