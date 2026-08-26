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

test('the local tool wrapper enforces string bounds, patterns, and enums', async () => {
  const tool = defineTool({
    name: 'constrained',
    description: 'Constrained tool.',
    parameters: {
      digest: {
        type: 'string',
        required: true,
        minLength: 3,
        maxLength: 8,
        pattern: '^ok-',
      },
      source: { type: 'string', enum: ['builtin', 'draft'] },
    },
    output: { schema: { type: 'string' }, render: () => [] },
    execute: async () => 'ok',
  })

  await assert.rejects(
    tool.execute({ digest: 'bad', source: 'remote' }),
    (error) => (
      error instanceof ToolArgsError
      && error.code === 'INVALID_ARGS'
      && error.violations.length === 2
    ),
  )
  await assert.rejects(tool.execute({ digest: 'ok-too-long' }), /at most 8/)
  assert.equal(await tool.execute({ digest: 'ok-one', source: 'builtin' }), 'ok')
})

test('the local tool wrapper validates integers and nested array objects', async () => {
  const tool = defineTool({
    name: 'patch',
    description: 'Patch tool.',
    parameters: {
      revision: { type: 'integer', required: true },
      replacements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
      },
    },
    output: { schema: { type: 'string' }, render: () => [] },
    execute: async () => 'ok',
  })

  await assert.rejects(
    tool.execute({
      revision: 1.5,
      replacements: [{ path: 'main.wdl', extra: true }],
    }),
    (error) => (
      error instanceof ToolArgsError
      && error.violations.some((item) => item.includes('must be an integer'))
      && error.violations.some((item) => item.includes('content is required'))
      && error.violations.some((item) => item.includes('extra is not supported'))
    ),
  )
  assert.equal(await tool.execute({
    revision: 2,
    replacements: [{ path: 'main.wdl', content: 'version 1.0\n' }],
  }), 'ok')
  await assert.rejects(
    tool.execute({
      revision: 3,
      replacements: Array.from({ length: 1025 }, () => ({ path: 'main.wdl', content: '' })),
    }),
    /at most 1024 validated item/,
  )
})

test('bio-workflow tools receive replay-safe call and result presentations', () => {
  const tool = defineTool({
    name: 'bio_workflows_search',
    description: 'Search workflows.',
    parameters: { query: { type: 'string' } },
    output: { schema: { type: 'string' }, render: () => [] },
    execute: async () => '{}',
  })

  assert.deepEqual(tool.presentCall({ query: 'fastq' }), {
    card: 'generic',
    title: 'Search the workflow store',
    kind: 'search',
    rawInput: { query: 'fastq' },
  })
  assert.deepEqual(tool.presentResult({ query: 'fastq' }, {
    content: [{ type: 'text', text: JSON.stringify({ count: 2, workflows: [{}, {}] }) }],
    isError: false,
  }), {
    card: 'generic',
    title: 'Search the workflow store',
    content: [{ type: 'text', text: '2 items' }],
  })
  assert.equal(tool.presentCall({ query: 3 }), undefined)
})
