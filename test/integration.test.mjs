import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from 'dsh-bio-workflows'
import { createWorkflowCatalog } from 'dsh-bio-workflows/catalog'
import { MANIFEST_SCHEMA_VERSION } from 'dsh-bio-workflows/manifest'
import metadata from 'dsh-bio-workflows/package.json' with { type: 'json' }
import { preflightWorkflow } from 'dsh-bio-workflows/preflight'
import schema from 'dsh-bio-workflows/schema/workflow-manifest.schema.json' with { type: 'json' }

import { makeManifest } from './fixtures.mjs'

test('public self-references and the dependency-free root DSH apply entry work', async () => {
  assert.equal(plugin.name, 'dsh-bio-workflows')
  assert.equal(metadata.name, plugin.name)
  assert.equal(metadata.version, '0.3.1')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof createWorkflowCatalog, 'function')
  assert.equal(typeof preflightWorkflow, 'function')
  assert.equal(schema.properties.schemaVersion.const, MANIFEST_SCHEMA_VERSION)

  const registered = []
  const listeners = new Map()
  const ctx = {
    tools: {
      register: (tool) => registered.push(tool),
      get: (name) => registered.find((tool) => tool.name === name),
    },
    on: (event, listener) => listeners.set(event, listener),
  }
  plugin.apply(ctx, {
    manifests: [makeManifest()],
    environment: {
      engines: { nextflow: { available: true, version: '24.04' } },
    },
  })

  assert.deepEqual(
    registered.map((tool) => ({
      name: tool.name,
      parameters: tool.parameters,
      output: tool.output.schema,
    })),
    [
      {
        name: 'bio_workflows_info',
        parameters: { type: 'object', properties: {} },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_list',
        parameters: {
          type: 'object',
          properties: {
            engine: { type: 'string', description: 'Optional exact engine name filter.' },
            status: { type: 'string', description: 'Optional exact status filter.' },
            tag: { type: 'string', description: 'Optional exact tag filter.' },
          },
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_get',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Exact workflow manifest id.' },
          },
          required: ['id'],
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_preflight',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Exact workflow manifest id.' },
            inputs: {
              type: 'object',
              additionalProperties: true,
              description: 'Input values keyed by manifest input id.',
            },
          },
          required: ['id', 'inputs'],
        },
        output: { type: 'string' },
      },
    ],
  )

  const tool = registered.at(-1)
  assert.equal(tool.parameters.type, 'object')
  assert.equal(tool.parameters.properties.inputs.type, 'object')
  assert.equal(tool.parameters.properties.inputs.additionalProperties, true)

  const result = JSON.parse(await tool.execute(
    { id: 'fastq-qc', inputs: { reads: ['sample.fastq.gz'] } },
    { signal: new AbortController().signal },
  ))
  assert.equal(result.preflight.status, 'pass')
  assert.equal(result.preflight.executionReady, false)
  await assert.rejects(
    registered[1].execute(null),
    (error) => error.code === 'INVALID_ARGS',
  )
  await assert.rejects(
    registered[2].execute({}),
    (error) => error.code === 'INVALID_ARGS',
  )
  assert.equal(registered[2].isConcurrencySafe({}), false)
  assert.equal(tool.isConcurrencySafe({ id: 'fastq-qc', inputs: [] }), false)
  const guarded = await listeners.get('tools/execute')(
    { name: 'bio_workflows_get', arguments: {} },
    async () => assert.fail('invalid arguments reached the tool body'),
  )
  assert.deepEqual(guarded.error.info, {
    name: 'ToolArgsError',
    code: 'INVALID_ARGS',
  })
})

test('the real DSH ToolRuntime preserves structured invalid-argument identity', async () => {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools: () => () => {} })
  const runtime = new ToolRuntime(ctx, { mode: 'native' })
  plugin.apply(ctx)

  const result = await runtime.execute({
    callId: 'invalid-arguments',
    name: 'bio_workflows_get',
    arguments: {},
    signal: new AbortController().signal,
  })

  assert.equal(result.isError, true)
  assert.deepEqual(result.error.info, {
    name: 'ToolArgsError',
    code: 'INVALID_ARGS',
  })
})
