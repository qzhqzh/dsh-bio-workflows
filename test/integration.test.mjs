import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from 'dsh-bio-workflows'
import { createWorkflowCatalog } from 'dsh-bio-workflows/catalog'
import { createDraftStore } from 'dsh-bio-workflows/draft-store'
import { createDraftValidator } from 'dsh-bio-workflows/draft-validation'
import { MANIFEST_SCHEMA_VERSION } from 'dsh-bio-workflows/manifest'
import { MISSION_SCHEMA_VERSION, createMissionStore } from 'dsh-bio-workflows/mission-store'
import metadata from 'dsh-bio-workflows/package.json' with { type: 'json' }
import { preflightWorkflow } from 'dsh-bio-workflows/preflight'
import { createWorkflowStore } from 'dsh-bio-workflows/store'
import { WDL_BUNDLE_SCHEMA_VERSION } from 'dsh-bio-workflows/wdl-bundle'
import schema from 'dsh-bio-workflows/schema/workflow-manifest.schema.json' with { type: 'json' }
import bundleSchema from 'dsh-bio-workflows/schema/wdl-bundle.schema.json' with { type: 'json' }
import draftValidationSchema from 'dsh-bio-workflows/schema/draft-validation-evidence.schema.json' with { type: 'json' }
import draftRevisionSchema from 'dsh-bio-workflows/schema/wdl-draft-revision.schema.json' with { type: 'json' }
import workflowGraphSchema from 'dsh-bio-workflows/schema/workflow-graph.schema.json' with { type: 'json' }
import missionSchema from 'dsh-bio-workflows/schema/mission.schema.json' with { type: 'json' }
import failureEvidenceSchema from 'dsh-bio-workflows/schema/failure-evidence.schema.json' with { type: 'json' }
import softwareTrialReportSchema from 'dsh-bio-workflows/schema/software-trial-report.schema.json' with { type: 'json' }
import { WORKFLOW_GRAPH_SCHEMA_VERSION } from 'dsh-bio-workflows/workflow-graph'

import { makeManifest } from './fixtures.mjs'

test('public self-references and the dependency-free root DSH apply entry work', async () => {
  assert.equal(plugin.name, 'dsh-bio-workflows')
  assert.equal(metadata.name, plugin.name)
  assert.equal(metadata.version, '0.11.0')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof createWorkflowCatalog, 'function')
  assert.equal(typeof createDraftStore, 'function')
  assert.equal(typeof createDraftValidator, 'function')
  assert.equal(typeof createMissionStore, 'function')
  assert.equal(typeof preflightWorkflow, 'function')
  assert.equal(typeof createWorkflowStore, 'function')
  assert.equal(schema.properties.schemaVersion.const, MANIFEST_SCHEMA_VERSION)
  assert.equal(bundleSchema.properties.bundleVersion.const, WDL_BUNDLE_SCHEMA_VERSION)
  assert.equal(draftRevisionSchema.properties.schemaVersion.const, '1')
  assert.equal(draftValidationSchema.properties.schemaVersion.const, '1')
  assert.equal(workflowGraphSchema.properties.schemaVersion.const, WORKFLOW_GRAPH_SCHEMA_VERSION)
  assert.equal(missionSchema.properties.schemaVersion.const, MISSION_SCHEMA_VERSION)
  assert.equal(failureEvidenceSchema.properties.schemaVersion.const, '1')
  assert.equal(softwareTrialReportSchema.properties.success.const, false)

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

  const missionToolNames = new Set([
    'bio_workflows_mission_prepare',
    'bio_workflows_mission_start',
    'bio_workflows_mission_get',
    'bio_workflows_mission_cancel',
    'bio_workflows_mission_report',
  ])
  const legacyRegistration = registered
    .filter((tool) => !missionToolNames.has(tool.name))
    .map((tool) => {
      let parameters = tool.parameters
      if ([
        'bio_workflows_draft_create',
        'bio_workflows_draft_update',
        'bio_workflows_draft_validate',
      ].includes(tool.name)) {
        const { missionId: _missionId, ...properties } = parameters.properties
        parameters = { ...parameters, properties }
      }
      return {
      name: tool.name,
      parameters,
      output: tool.output.schema,
      }
    })
  assert.deepEqual(
    legacyRegistration,
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
        name: 'bio_workflows_draft_create',
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              maxLength: 64,
              pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
              description: 'Lowercase workflow identifier.',
            },
            version: {
              type: 'string',
              maxLength: 128,
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
        name: 'bio_workflows_draft_get',
        parameters: {
          type: 'object',
          properties: {
            draftId: {
              type: 'string',
              pattern: '^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
              description: 'Opaque draft UUID returned by draft_create.',
            },
            revision: {
              type: 'integer',
              minimum: 1,
              maximum: 256,
              description: 'Optional exact positive revision; the current head is selected when omitted.',
            },
            path: {
              type: 'string',
              minLength: 1,
              maxLength: 240,
              pattern: '^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*\\\\)(?!.*\\u0000)[^/]+(?:/[^/]+)*$',
              description: 'Optional exact safe relative file path.',
            },
          },
          required: ['draftId'],
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_draft_update',
        parameters: {
          type: 'object',
          properties: {
            draftId: {
              type: 'string',
              pattern: '^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
              description: 'Opaque draft UUID returned by draft_create.',
            },
            expectedRevision: {
              type: 'integer',
              minimum: 1,
              maximum: 256,
              description: 'Exact current positive revision returned by draft_get.',
            },
            expectedContentDigest: {
              type: 'string',
              pattern: '^sha256:[a-f0-9]{64}$',
              description: 'Exact current sha256 content digest returned by draft_get.',
            },
            replacements: {
              type: 'array',
              minItems: 1,
              maxItems: 128,
              description: 'Complete replacement bodies for selected files.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 240,
                    pattern: '^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*\\\\)(?!.*\\u0000)[^/]+(?:/[^/]+)*$',
                    description: 'Safe relative POSIX path.',
                  },
                  role: {
                    type: 'string',
                    enum: ['workflow', 'task', 'example', 'documentation', 'license'],
                    description: 'Declared file role.',
                  },
                  content: {
                    type: 'string',
                    maxLength: 1048576,
                    description: 'Complete well-formed UTF-8 file body; runtime also enforces a 1 MiB UTF-8 byte limit.',
                  },
                },
                required: ['path', 'role', 'content'],
                additionalProperties: false,
              },
            },
            deletions: {
              type: 'array',
              minItems: 1,
              maxItems: 128,
              description: 'Exact safe relative paths to remove; main.wdl cannot be deleted.',
              items: {
                type: 'string',
                minLength: 1,
                maxLength: 240,
                pattern: '^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*\\\\)(?!.*\\u0000)[^/]+(?:/[^/]+)*$',
              },
            },
          },
          required: ['draftId', 'expectedRevision', 'expectedContentDigest'],
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_draft_validate',
        parameters: {
          type: 'object',
          properties: {
            draftId: {
              type: 'string',
              pattern: '^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
              description: 'Opaque draft UUID returned by draft_create.',
            },
            revision: {
              type: 'integer',
              minimum: 1,
              maximum: 256,
              description: 'Exact immutable revision to validate.',
            },
          },
          required: ['draftId', 'revision'],
        },
        output: { type: 'string' },
      },
      {
        name: 'bio_workflows_draft_graph',
        parameters: {
          type: 'object',
          properties: {
            draftId: {
              type: 'string',
              pattern: '^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
              description: 'Opaque draft UUID returned by draft_create.',
            },
            revision: {
              type: 'integer',
              minimum: 1,
              maximum: 256,
              description: 'Exact immutable revision to visualize.',
            },
          },
          required: ['draftId', 'revision'],
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
  const missionTools = registered.filter((tool) => missionToolNames.has(tool.name))
  assert.deepEqual(missionTools.map((tool) => tool.name), [...missionToolNames])
  assert.deepEqual(
    missionTools[0].parameters.required,
    ['software', 'objective', 'acceptanceCriteria'],
  )
  assert.deepEqual(
    missionTools[0].parameters.properties.software.required,
    ['name', 'version', 'containerImage'],
  )
  assert.equal(missionTools[1].parameters.required.includes('expectedPlanDigest'), true)
  for (const name of [
    'bio_workflows_draft_create',
    'bio_workflows_draft_update',
    'bio_workflows_draft_validate',
  ]) {
    assert.equal(registered.find((tool) => tool.name === name).parameters.properties.missionId.type, 'string')
  }
  assert.equal(registered.every((registeredTool) => (
    typeof registeredTool.presentCall === 'function'
    && typeof registeredTool.presentResult === 'function'
  )), true)

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

test('the real DSH ToolRuntime keeps revisioned drafts session-scoped and approval-bound', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-authoring-'))
  try {
    const ctx = new Context()
    const approvalRequests = []
    ctx.provide('systemPrompt', { tools: () => () => {} })
    ctx.provide('approval', {
      request: async (request) => {
        approvalRequests.push(request)
        return 'allowed-once'
      },
    })
    const runtime = new ToolRuntime(ctx, { mode: 'native' })
    plugin.apply(ctx, { store: { root, writeEnabled: true } })
    const signal = new AbortController().signal
    const agent = { id: 'authoring-session', session: { id: 'authoring-session' } }

    const createdResult = await runtime.execute({
      callId: 'draft-create',
      name: 'bio_workflows_draft_create',
      arguments: {
        id: 'rna-qc',
        name: 'RNA QC',
        summary: 'Session-scoped authoring integration.',
      },
      agent,
      signal,
    })
    assert.equal(createdResult.isError, false)
    const created = JSON.parse(createdResult.value)
    assert.equal(created.revision, 1)
    assert.match(approvalRequests[0].reason, new RegExp(created.contentDigest))

    const updatedResult = await runtime.execute({
      callId: 'draft-update',
      name: 'bio_workflows_draft_update',
      arguments: {
        draftId: created.draftId,
        expectedRevision: created.revision,
        expectedContentDigest: created.contentDigest,
        replacements: [{ path: 'README.md', role: 'documentation', content: 'updated\n' }],
      },
      agent,
      signal,
    })
    assert.equal(updatedResult.isError, false)
    const updated = JSON.parse(updatedResult.value)
    assert.equal(updated.revision, 2)
    assert.match(approvalRequests[1].reason, new RegExp(updated.contentDigest))

    const foreign = await runtime.execute({
      callId: 'draft-foreign-get',
      name: 'bio_workflows_draft_get',
      arguments: { draftId: created.draftId },
      agent: { id: 'other-session', session: { id: 'other-session' } },
      signal,
    })
    assert.equal(foreign.isError, false)
    assert.equal(JSON.parse(foreign.value).error.code, 'draft_not_found')

    const graphResult = await runtime.execute({
      callId: 'draft-graph',
      name: 'bio_workflows_draft_graph',
      arguments: { draftId: created.draftId, revision: 2 },
      agent,
      signal,
    })
    assert.equal(graphResult.isError, false)
    const graph = JSON.parse(graphResult.value)
    assert.equal(graph.revision, 2)
    assert.equal(graph.contentDigest, updated.contentDigest)
    assert.equal(graph.workflow.name, 'rna_qc')
    assert.equal(graph.executionAuthorized, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the real DSH ToolRuntime grants one bounded Mission approval and stops repeated validation failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-mission-'))
  try {
    const ctx = new Context()
    const approvalRequests = []
    ctx.provide('systemPrompt', { tools: () => () => {} })
    ctx.provide('approval', {
      request: async (request) => {
        approvalRequests.push(request)
        return 'allowed-once'
      },
    })
    const runtime = new ToolRuntime(ctx, { mode: 'native' })
    plugin.apply(ctx, {
      store: { root, writeEnabled: true },
      autonomy: { enabled: true, maxSameFailureFingerprint: 3 },
    })
    const signal = new AbortController().signal
    const agent = { id: 'mission-session', session: { id: 'mission-session' } }
    const request = {
      software: {
        name: 'FastQC',
        version: '0.12.1',
        containerImage: `quay.io/biocontainers/fastqc@sha256:${'f'.repeat(64)}`,
      },
      objective: 'Author a bounded FastQC WDL wrapper.',
      acceptanceCriteria: ['The exact WDL draft passes deterministic validation.'],
    }

    const preparedResult = await runtime.execute({
      callId: 'mission-prepare',
      name: 'bio_workflows_mission_prepare',
      arguments: request,
      agent,
      signal,
    })
    assert.equal(preparedResult.isError, false)
    const prepared = JSON.parse(preparedResult.value)
    assert.equal(prepared.plan.capabilities.isolatedDraftTest, false)

    const startedResult = await runtime.execute({
      callId: 'mission-start',
      name: 'bio_workflows_mission_start',
      arguments: { ...request, expectedPlanDigest: prepared.planDigest },
      agent,
      signal,
    })
    assert.equal(startedResult.isError, false)
    const mission = JSON.parse(startedResult.value)
    assert.equal(approvalRequests.length, 1)
    assert.match(approvalRequests[0].reason, new RegExp(prepared.planDigest))
    assert.match(approvalRequests[0].reason, /production execution remain disabled/)

    const createdResult = await runtime.execute({
      callId: 'mission-draft-create',
      name: 'bio_workflows_draft_create',
      arguments: {
        id: 'fastqc-mission',
        name: 'FastQC Mission',
        summary: 'Mission-bound integration draft.',
        missionId: mission.missionId,
      },
      agent,
      signal,
    })
    assert.equal(createdResult.isError, false)
    const created = JSON.parse(createdResult.value)
    assert.equal(created.missionRecorded, true)
    assert.equal(approvalRequests.length, 1)

    const updatedResult = await runtime.execute({
      callId: 'mission-draft-update',
      name: 'bio_workflows_draft_update',
      arguments: {
        draftId: created.draftId,
        expectedRevision: created.revision,
        expectedContentDigest: created.contentDigest,
        replacements: [{
          path: 'main.wdl',
          role: 'workflow',
          content: 'version 1.0\nimport "https://example.invalid/untrusted.wdl"\nworkflow fastqc_mission {}\n',
        }],
        missionId: mission.missionId,
      },
      agent,
      signal,
    })
    assert.equal(updatedResult.isError, false)
    const updated = JSON.parse(updatedResult.value)
    assert.equal(updated.revision, 2)
    assert.equal(approvalRequests.length, 1)

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const validationResult = await runtime.execute({
        callId: `mission-draft-validate-${attempt}`,
        name: 'bio_workflows_draft_validate',
        arguments: {
          draftId: created.draftId,
          revision: updated.revision,
          missionId: mission.missionId,
        },
        agent,
        signal,
      })
      assert.equal(validationResult.isError, false)
      const validation = JSON.parse(validationResult.value)
      assert.equal(validation.validation.valid, false)
      assert.equal(validation.mission.budget.used.validationFailures, attempt)
    }
    assert.equal(approvalRequests.length, 1)

    const reportResult = await runtime.execute({
      callId: 'mission-report',
      name: 'bio_workflows_mission_report',
      arguments: { missionId: mission.missionId },
      agent,
      signal,
    })
    const report = JSON.parse(reportResult.value).report
    assert.equal(report.outcome, 'exhausted')
    assert.equal(report.success, false)
    assert.equal(report.stop.code, 'repeated_failure')
    assert.equal(report.readiness.isolatedTestCompleted, false)

    const foreign = await runtime.execute({
      callId: 'mission-foreign-get',
      name: 'bio_workflows_mission_get',
      arguments: { missionId: mission.missionId },
      agent: { id: 'foreign-mission-session', session: { id: 'foreign-mission-session' } },
      signal,
    })
    assert.equal(JSON.parse(foreign.value).error.code, 'mission_not_found')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
