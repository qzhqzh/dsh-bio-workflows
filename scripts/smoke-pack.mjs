import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-workflows-pack-smoke-'))
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

try {
  const cache = join(temporaryRoot, 'npm-cache')
  execFileSync(npmCommand, ['run', 'build'], {
    cwd: packageRoot,
    stdio: 'inherit',
  })
  const packResult = JSON.parse(execFileSync(
    npmCommand,
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot, '--cache', cache],
    { cwd: packageRoot, encoding: 'utf8' },
  ))
  assert.equal(packResult.length, 1)

  const tarball = join(temporaryRoot, packResult[0].filename)
  const consumer = join(temporaryRoot, 'consumer')
  await mkdir(consumer)
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2),
  )
  execFileSync(
    npmCommand,
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache, tarball],
    { cwd: consumer, encoding: 'utf8' },
  )
  const installedRoot = join(consumer, 'node_modules', 'dsh-bio-workflows')
  const fixtureRoot = join(installedRoot, 'fixtures', 'text-roundtrip', '1.0.0')
  await access(join(installedRoot, 'lib', 'client.js'))
  await access(join(installedRoot, 'requirements', 'miniwdl-1.15.0.txt'))
  await access(join(installedRoot, 'runner', 'dsh_fixture_runner.py'))
  await access(join(installedRoot, 'skills', 'bio-wdl-authoring', 'SKILL.md'))
  const fixture = JSON.parse(await readFile(join(fixtureRoot, 'fixture.json'), 'utf8'))
  const fixtureInput = await readFile(join(fixtureRoot, 'inputs', 'message.txt'))
  assert.equal(fixtureInput.length, fixture.files[0].sizeBytes)
  assert.equal(
    `sha256:${createHash('sha256').update(fixtureInput).digest('hex')}`,
    fixture.files[0].sha256,
  )

  const smokeProgram = String.raw`
    import assert from 'node:assert/strict'
    import * as plugin from 'dsh-bio-workflows'
    import {
      BIO_WDL_AUTHORING_SKILL_NAME,
      registerBioWdlAuthoringSkill,
    } from 'dsh-bio-workflows/authoring-skill'
    import { createWorkflowCatalog } from 'dsh-bio-workflows/catalog'
    import { createDraftStore } from 'dsh-bio-workflows/draft-store'
    import {
      DRAFT_TEST_EVIDENCE_SCHEMA_VERSION,
      DRAFT_TEST_PLAN_SCHEMA_VERSION,
      parseDraftTestConfig,
    } from 'dsh-bio-workflows/draft-test-contract'
    import {
      DRAFT_TEST_RECORD_SCHEMA_VERSION,
      DRAFT_TEST_REPORT_SCHEMA_VERSION,
      createDraftTestManager,
    } from 'dsh-bio-workflows/draft-test-manager'
    import { createDraftValidator } from 'dsh-bio-workflows/draft-validation'
    import {
      FIXTURE_ASSERTION_SCHEMA_VERSION,
      evaluateFixtureAssertions,
    } from 'dsh-bio-workflows/fixture-assertions'
    import {
      FIXTURE_BUNDLE_SCHEMA_VERSION,
      loadFixtureBundle,
    } from 'dsh-bio-workflows/fixture-bundle'
    import { createWorkflowGraph, WORKFLOW_GRAPH_SCHEMA_VERSION } from 'dsh-bio-workflows/workflow-graph'
    import {
      BIO_WORKFLOW_RESULT_SCHEMA_VERSION,
      createExecutionManager,
      validateBioWorkflowResultSemantics,
    } from 'dsh-bio-workflows/execution'
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
    import resultSchema from 'dsh-bio-workflows/schema/bio-workflow-result.schema.json' with { type: 'json' }
    import missionSchema from 'dsh-bio-workflows/schema/mission.schema.json' with { type: 'json' }
    import failureEvidenceSchema from 'dsh-bio-workflows/schema/failure-evidence.schema.json' with { type: 'json' }
    import softwareTrialReportSchema from 'dsh-bio-workflows/schema/software-trial-report.schema.json' with { type: 'json' }
    import draftTestEvidenceSchema from 'dsh-bio-workflows/schema/draft-test-evidence.schema.json' with { type: 'json' }
    import draftTestPlanSchema from 'dsh-bio-workflows/schema/draft-test-plan.schema.json' with { type: 'json' }
    import fixtureBundleSchema from 'dsh-bio-workflows/schema/fixture-bundle.schema.json' with { type: 'json' }

    assert.equal(typeof createWorkflowCatalog, 'function')
    assert.equal(typeof registerBioWdlAuthoringSkill, 'function')
    assert.equal(typeof createDraftStore, 'function')
    assert.equal(typeof createDraftTestManager, 'function')
    assert.equal(typeof createDraftValidator, 'function')
    assert.equal(typeof evaluateFixtureAssertions, 'function')
    assert.equal(typeof loadFixtureBundle, 'function')
    assert.equal(typeof createMissionStore, 'function')
    assert.equal(typeof createWorkflowGraph, 'function')
    assert.equal(typeof createExecutionManager, 'function')
    assert.equal(typeof validateBioWorkflowResultSemantics, 'function')
    assert.equal(typeof preflightWorkflow, 'function')
    assert.equal(typeof createWorkflowStore, 'function')
    assert.equal(metadata.name, plugin.name)
    assert.equal(metadata.version, '0.11.0')
    assert.equal(schema.properties.schemaVersion.const, MANIFEST_SCHEMA_VERSION)
    assert.equal(bundleSchema.properties.bundleVersion.const, WDL_BUNDLE_SCHEMA_VERSION)
    assert.equal(resultSchema.properties.schemaVersion.const, BIO_WORKFLOW_RESULT_SCHEMA_VERSION)
    assert.equal(draftRevisionSchema.properties.schemaVersion.const, '1')
    assert.equal(draftValidationSchema.properties.schemaVersion.const, '1')
    assert.equal(workflowGraphSchema.properties.schemaVersion.const, WORKFLOW_GRAPH_SCHEMA_VERSION)
    assert.equal(missionSchema.properties.schemaVersion.const, MISSION_SCHEMA_VERSION)
    assert.equal(failureEvidenceSchema.properties.schemaVersion.const, '1')
    assert.equal(softwareTrialReportSchema.properties.success.const, false)
    assert.equal(draftTestEvidenceSchema.properties.schemaVersion.const, DRAFT_TEST_EVIDENCE_SCHEMA_VERSION)
    assert.equal(draftTestPlanSchema.properties.schemaVersion.const, DRAFT_TEST_PLAN_SCHEMA_VERSION)
    assert.equal(fixtureBundleSchema.properties.schemaVersion.const, FIXTURE_BUNDLE_SCHEMA_VERSION)
    assert.equal(DRAFT_TEST_RECORD_SCHEMA_VERSION, '1')
    assert.equal(DRAFT_TEST_REPORT_SCHEMA_VERSION, '1')
    assert.equal(FIXTURE_ASSERTION_SCHEMA_VERSION, '1')
    assert.equal(parseDraftTestConfig().enabled, false)
    assert.equal(typeof metadata.exports['./client'], 'string')

    const registered = []
    const registeredSkills = []
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
    plugin.apply({
      skills: {
        register: (skill) => registeredSkills.push(skill),
      },
      tools: {
        register: (tool) => registered.push(tool),
        get: (name) => registered.find((tool) => tool.name === name),
      },
      on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    }, {
      manifests: [{
        schemaVersion: '1',
        id: 'fastq-qc',
        version: '1.0.0',
        name: 'FASTQ quality control',
        summary: 'Collect FASTQ quality metrics.',
        status: 'ready',
        engine: { name: 'nextflow', version: '24.04' },
        inputs: [{ id: 'reads', type: 'file', required: true, cardinality: 'many' }],
      }],
      environment: { engines: { nextflow: { available: true, version: '24.04' } } },
    })
    assert.equal(registeredSkills.length, 1)
    assert.equal(registeredSkills[0].name, BIO_WDL_AUTHORING_SKILL_NAME)
    assert.match(registeredSkills[0].content, /ready_for_isolated_test/)
    assert.deepEqual(
      registered
        .filter((tool) => (
          !tool.name.startsWith('bio_workflows_mission_')
          && !tool.name.startsWith('bio_workflows_draft_test_')
        ))
        .map((tool) => {
          let parameters = tool.parameters
          if (['bio_workflows_draft_create', 'bio_workflows_draft_update', 'bio_workflows_draft_validate'].includes(tool.name)) {
            const { missionId: _missionId, ...properties } = parameters.properties
            parameters = { ...parameters, properties }
          }
          return { name: tool.name, parameters, output: tool.output.schema }
        }),
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
              source: { type: 'string', description: 'Optional source filter: builtin, installed, draft, git, or trs.' },
              provider: {
                type: 'string',
                pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
                description: 'Optional exact read-only Git/TRS provider id.',
              },
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
              provider: {
                type: 'string',
                pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
                description: 'Required exact provider id when source is git or trs.',
              },
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
                enum: ['builtin', 'installed', 'draft', 'git', 'trs'],
                description: 'Optional source; defaults to builtin.',
              },
              provider: {
                type: 'string',
                pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$',
                description: 'Required exact provider id when source is git or trs.',
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
        {
          name: 'bio_workflows_run_cleanup_plan',
          parameters: { type: 'object', properties: {} },
          output: { type: 'string' },
        },
        {
          name: 'bio_workflows_run_cleanup',
          parameters: {
            type: 'object',
            properties: {
              expectedCleanupPlanDigest: {
                type: 'string',
                pattern: '^sha256:[a-f0-9]{64}$',
                description: 'Exact cleanup plan digest returned by bio_workflows_run_cleanup_plan.',
              },
            },
            required: ['expectedCleanupPlanDigest'],
          },
          output: { type: 'string' },
        },
      ],
    )
    assert.deepEqual(
      registered.filter((tool) => tool.name.startsWith('bio_workflows_mission_')).map((tool) => tool.name),
      ['bio_workflows_mission_prepare', 'bio_workflows_mission_start', 'bio_workflows_mission_get', 'bio_workflows_mission_cancel', 'bio_workflows_mission_report'],
    )
    assert.deepEqual(
      registered.filter((tool) => tool.name.startsWith('bio_workflows_draft_test_')).map((tool) => tool.name),
      ['bio_workflows_draft_test_prepare', 'bio_workflows_draft_test_start', 'bio_workflows_draft_test_get', 'bio_workflows_draft_test_cancel', 'bio_workflows_draft_test_report'],
    )
    assert.equal(registered.find((tool) => tool.name === 'bio_workflows_draft_create').parameters.properties.missionId.type, 'string')
    const preflight = registered.find((tool) => tool.name === 'bio_workflows_preflight')
    const result = JSON.parse(await preflight.execute(
      { id: 'fastq-qc', inputs: { reads: ['sample.fastq.gz'] } },
      { signal: new AbortController().signal },
    ))
    assert.equal(result.preflight.status, 'pass')
    assert.equal(result.preflight.executionReady, false)
    const guarded = await waterfall(
      'tools/execute',
      { name: 'bio_workflows_get', arguments: {} },
      async () => assert.fail('invalid arguments reached the tool body'),
    )
    assert.deepEqual(guarded.error.info, {
      name: 'ToolArgsError',
      code: 'INVALID_ARGS',
    })
    const search = registered.find((tool) => tool.name === 'bio_workflows_search')
    const searchResult = JSON.parse(await search.execute({ query: 'qc' }))
    const fastq = searchResult.workflows.find((workflow) => workflow.id === 'fastq-qc')
    const approval = await waterfall(
      'tools/pre-execute',
      {
        name: 'bio_workflows_install',
        arguments: { id: fastq.id, version: fastq.version, expectedDigest: fastq.digest },
      },
      async () => assert.fail('mutating store tool bypassed approval'),
    )
    assert.equal(approval.kind, 'deny')
    assert.equal(searchResult.count, 4)
  `
  execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', smokeProgram],
    { cwd: consumer, encoding: 'utf8' },
  )

  process.stdout.write(`packed install smoke passed: ${packResult[0].filename}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
