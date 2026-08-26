import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from 'dsh-bio-workflows'
import { createWorkflowCatalog } from 'dsh-bio-workflows/catalog'
import { MANIFEST_SCHEMA_VERSION } from 'dsh-bio-workflows/manifest'
import metadata from 'dsh-bio-workflows/package.json' with { type: 'json' }
import { preflightWorkflow } from 'dsh-bio-workflows/preflight'
import { createWorkflowStore } from 'dsh-bio-workflows/store'
import { WDL_BUNDLE_SCHEMA_VERSION } from 'dsh-bio-workflows/wdl-bundle'
import schema from 'dsh-bio-workflows/schema/workflow-manifest.schema.json' with { type: 'json' }
import bundleSchema from 'dsh-bio-workflows/schema/wdl-bundle.schema.json' with { type: 'json' }

import { makeManifest } from './fixtures.mjs'

test('public self-references and the dependency-free root DSH apply entry work', async () => {
  assert.equal(plugin.name, 'dsh-bio-workflows')
  assert.equal(metadata.name, plugin.name)
  assert.equal(metadata.version, '0.7.0')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof createWorkflowCatalog, 'function')
  assert.equal(typeof preflightWorkflow, 'function')
  assert.equal(typeof createWorkflowStore, 'function')
  assert.equal(schema.properties.schemaVersion.const, MANIFEST_SCHEMA_VERSION)
  assert.equal(bundleSchema.properties.bundleVersion.const, WDL_BUNDLE_SCHEMA_VERSION)

  const registered = []
  const listeners = new Map()
  const waterfall = async (event, exec, terminal) => {
    const handlers = listeners.get(event) ?? []
    const dispatch = (index) => (
      index === handlers.length
        ? terminal()
        : handlers[index](exec, () => dispatch(index + 1))
    )
    return dispatch(0)
  }
  const ctx = {
    tools: {
      register: (tool) => registered.push(tool),
      get: (name) => registered.find((tool) => tool.name === name),
    },
    on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
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
      {
        name: 'bio_workflows_search',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional case-insensitive text query.' },
            language: { type: 'string', description: 'Optional exact language filter; currently wdl.' },
            tag: { type: 'string', description: 'Optional exact tag filter.' },
            source: { type: 'string', description: 'Optional source filter: builtin, installed, or draft.' },
          },
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_validate',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Exact workflow bundle id.' },
            version: { type: 'string', description: 'Optional exact semantic version; latest is selected when omitted.' },
            source: { type: 'string', description: 'Optional source; defaults to builtin.' },
          },
          required: ['id'],
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_install',
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
              description: 'Exact workflow bundle id.',
            },
            version: {
              type: 'string',
              pattern: '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$',
              description: 'Exact semantic version returned by search.',
            },
            expectedDigest: {
              type: 'string',
              pattern: '^sha256:[a-f0-9]{64}$',
              description: 'Exact sha256 bundle digest returned by search.',
            },
            source: {
              type: 'string',
              enum: ['builtin', 'installed', 'draft'],
              description: 'Optional source; defaults to builtin.',
            },
          },
          required: ['id', 'version', 'expectedDigest'],
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_scaffold',
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
              description: 'Lowercase workflow identifier.',
            },
            version: {
              type: 'string',
              pattern: '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$',
              description: 'Semantic version; defaults to 0.1.0.',
            },
            name: {
              type: 'string',
              minLength: 1,
              maxLength: 160,
              description: 'Human-readable workflow name.',
            },
            summary: {
              type: 'string',
              minLength: 1,
              maxLength: 1000,
              description: 'Short workflow purpose.',
            },
          },
          required: ['id', 'name', 'summary'],
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_plan',
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
              description: 'Exact built-in workflow bundle id.',
            },
            version: {
              type: 'string',
              pattern: '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$',
              description: 'Exact built-in workflow bundle version.',
            },
            expectedDigest: {
              type: 'string',
              pattern: '^sha256:[a-f0-9]{64}$',
              description: 'Exact bundle digest returned by bio_workflows_search.',
            },
            inputs: {
              type: 'object',
              additionalProperties: true,
              description: 'Workflow inputs; filesystem paths must be absolute and inside configured input roots.',
            },
          },
          required: ['id', 'version', 'expectedDigest', 'inputs'],
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_run',
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
              description: 'Exact built-in workflow bundle id.',
            },
            version: {
              type: 'string',
              pattern: '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$',
              description: 'Exact built-in workflow bundle version.',
            },
            expectedDigest: {
              type: 'string',
              pattern: '^sha256:[a-f0-9]{64}$',
              description: 'Exact bundle digest returned by bio_workflows_search.',
            },
            inputs: {
              type: 'object',
              additionalProperties: true,
              description: 'Workflow inputs; filesystem paths must be absolute and inside configured input roots.',
            },
            expectedPlanDigest: {
              type: 'string',
              pattern: '^sha256:[a-f0-9]{64}$',
              description: 'Exact plan digest returned by bio_workflows_plan.',
            },
          },
          required: ['id', 'version', 'expectedDigest', 'inputs', 'expectedPlanDigest'],
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_run_get',
        parameters: {
          type: 'object',
          properties: {
            runId: {
              type: 'string',
              pattern: '^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
              description: 'Run id returned by bio_workflows_run.',
            },
          },
          required: ['runId'],
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_run_list',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['prepared', 'running', 'stopping', 'completed', 'failed', 'killed', 'interrupted'],
              description: 'Optional exact lifecycle status filter.',
            },
            cursor: {
              type: 'string',
              pattern: '^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
              description: 'Last runId returned by the previous page for the same owner and status filter.',
            },
          },
        },
        output: { type: 'string' },
      },
    ],
  )

  const tool = registered.find((item) => item.name === 'bio_workflows_preflight')
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
  const guarded = await waterfall(
    'tools/execute',
    { name: 'bio_workflows_get', arguments: {} },
    async () => assert.fail('invalid arguments reached the tool body'),
  )
  assert.deepEqual(guarded.error.info, {
    name: 'ToolArgsError',
    code: 'INVALID_ARGS',
  })
  const search = registered.find((item) => item.name === 'bio_workflows_search')
  const searchResult = JSON.parse(await search.execute({ query: 'qc' }))
  const fastqStoreEntry = searchResult.workflows.find((workflow) => workflow.id === 'fastq-qc')
  const approval = await waterfall(
    'tools/pre-execute',
    {
      name: 'bio_workflows_install',
      arguments: {
        id: fastqStoreEntry.id,
        version: fastqStoreEntry.version,
        expectedDigest: fastqStoreEntry.digest,
      },
    },
    async () => assert.fail('mutating store tool bypassed approval'),
  )
  assert.equal(approval.kind, 'deny')

  assert.equal(searchResult.count, 4)
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

  const search = await runtime.execute({
    callId: 'store-search',
    name: 'bio_workflows_search',
    arguments: {},
    signal: new AbortController().signal,
  })
  assert.equal(search.isError, false)
  const searchValue = JSON.parse(search.value)
  assert.equal(searchValue.count, 4)
  const fastq = searchValue.workflows.find((workflow) => workflow.id === 'fastq-qc')

  const deniedInstall = await runtime.execute({
    callId: 'store-install',
    name: 'bio_workflows_install',
    arguments: {
      id: fastq.id,
      version: fastq.version,
      expectedDigest: fastq.digest,
    },
    signal: new AbortController().signal,
  })
  assert.equal(deniedInstall.isError, true)
  assert.match(deniedInstall.error.message, /writes are disabled/)
})

test('the real DSH ToolRuntime binds approved store writes to exact bundle digests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-store-'))
  try {
    const ctx = new Context()
    const approvalRequests = []
    let outcome = 'allowed-once'
    ctx.provide('systemPrompt', { tools: () => () => {} })
    ctx.provide('approval', {
      request: async (request) => {
        approvalRequests.push(request)
        return outcome
      },
    })
    const runtime = new ToolRuntime(ctx, { mode: 'native' })
    plugin.apply(ctx, { store: { root, writeEnabled: true } })
    const agent = { id: 'integration-agent' }
    const signal = new AbortController().signal

    for (const [callId, name, argumentsValue] of [
      ['invalid-enabled-install', 'bio_workflows_install', { id: 'fastq-qc', version: '1.0.0' }],
      [
        'malformed-enabled-install',
        'bio_workflows_install',
        { id: 'fastq-qc', version: '1.0.0', expectedDigest: 'sha256:bad' },
      ],
      [
        'invalid-enabled-scaffold',
        'bio_workflows_scaffold',
        { id: '../bad', name: 'Bad', summary: 'Must not be approved.' },
      ],
    ]) {
      const invalid = await runtime.execute({
        callId,
        name,
        arguments: argumentsValue,
        agent,
        signal,
      })
      assert.equal(invalid.isError, true)
      assert.deepEqual(invalid.error.info, {
        name: 'ToolArgsError',
        code: 'INVALID_ARGS',
      })
    }
    assert.equal(approvalRequests.length, 0)

    const search = await runtime.execute({
      callId: 'approved-search',
      name: 'bio_workflows_search',
      arguments: { source: 'builtin', query: 'fastq' },
      agent,
      signal,
    })
    const fastq = JSON.parse(search.value).workflows[0]
    const installArguments = {
      id: fastq.id,
      version: fastq.version,
      expectedDigest: fastq.digest,
    }
    const installed = await runtime.execute({
      callId: 'approved-install',
      name: 'bio_workflows_install',
      arguments: installArguments,
      agent,
      signal,
    })
    assert.equal(installed.isError, false)
    assert.equal(JSON.parse(installed.value).status, 'created')
    assert.match(approvalRequests[0].reason, new RegExp(fastq.digest))

    const validated = await runtime.execute({
      callId: 'installed-validate',
      name: 'bio_workflows_validate',
      arguments: { id: fastq.id, version: fastq.version, source: 'installed' },
      agent,
      signal,
    })
    assert.equal(JSON.parse(validated.value).validation.valid, true)

    const scaffoldArguments = {
      id: 'custom-runtime-qc',
      version: '0.1.0',
      name: 'Custom runtime QC',
      summary: 'Created through the real DSH approval path.',
    }
    const scaffolded = await runtime.execute({
      callId: 'approved-scaffold',
      name: 'bio_workflows_scaffold',
      arguments: scaffoldArguments,
      agent,
      signal,
    })
    assert.equal(scaffolded.isError, false)
    assert.equal(JSON.parse(scaffolded.value).status, 'created')
    assert.match(approvalRequests[1].reason, /custom-runtime-qc@0\.1\.0/)

    outcome = 'rejected'
    const rejected = await runtime.execute({
      callId: 'rejected-scaffold',
      name: 'bio_workflows_scaffold',
      arguments: { ...scaffoldArguments, id: 'rejected-runtime-qc' },
      agent,
      signal,
    })
    assert.equal(rejected.isError, true)
    assert.match(rejected.error.message, /user rejected/)
    await assert.rejects(access(join(root, 'drafts', 'rejected-runtime-qc')), /ENOENT/)

    outcome = 'unavailable'
    const unavailable = await runtime.execute({
      callId: 'unavailable-scaffold',
      name: 'bio_workflows_scaffold',
      arguments: { ...scaffoldArguments, id: 'unavailable-runtime-qc' },
      agent,
      signal,
    })
    assert.equal(unavailable.isError, true)
    assert.match(unavailable.error.message, /no approval channel/)
    await assert.rejects(access(join(root, 'drafts', 'unavailable-runtime-qc')), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
