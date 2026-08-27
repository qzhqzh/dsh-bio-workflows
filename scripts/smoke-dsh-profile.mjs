import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-workflows-profile-smoke-'))
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const dshCommand = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'

try {
  const cache = join(temporaryRoot, 'npm-cache')
  const dshHome = join(temporaryRoot, 'dsh-home')
  execFileSync(npmCommand, ['run', 'build'], {
    cwd: packageRoot,
    stdio: 'inherit',
  })
  const packResult = JSON.parse(execFileSync(
    npmCommand,
    ['pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot, '--cache', cache],
    { cwd: packageRoot, encoding: 'utf8' },
  ))
  const tarball = join(temporaryRoot, packResult[0].filename)
  const environment = { ...process.env, DSH_HOME: dshHome }

  const version = execFileSync(dshCommand, ['--version'], {
    cwd: packageRoot,
    env: environment,
    encoding: 'utf8',
  }).trim()
  execFileSync(
    dshCommand,
    ['plugin', '--profile', 'headless', 'add', tarball],
    { cwd: packageRoot, env: environment, encoding: 'utf8' },
  )
  const installedPlugin = await import(pathToFileURL(join(
    dshHome,
    'profiles',
    'headless',
    'node_modules',
    'dsh-bio-workflows',
    'index.js',
  )).href)
  await access(join(
    dshHome,
    'profiles',
    'headless',
    'node_modules',
    'dsh-bio-workflows',
    'lib',
    'client.js',
  ))
  await access(join(
    dshHome,
    'profiles',
    'headless',
    'node_modules',
    'dsh-bio-workflows',
    'fixtures',
    'text-roundtrip',
    '1.0.0',
    'fixture.json',
  ))
  await access(join(
    dshHome,
    'profiles',
    'headless',
    'node_modules',
    'dsh-bio-workflows',
    'requirements',
    'miniwdl-1.15.0.txt',
  ))
  await access(join(
    dshHome,
    'profiles',
    'headless',
    'node_modules',
    'dsh-bio-workflows',
    'runner',
    'dsh_fixture_runner.py',
  ))
  await access(join(
    dshHome,
    'profiles',
    'headless',
    'node_modules',
    'dsh-bio-workflows',
    'skills',
    'bio-wdl-authoring',
    'SKILL.md',
  ))
  assert.equal(installedPlugin.name, 'dsh-bio-workflows')
  assert.equal(typeof installedPlugin.apply, 'function')
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
  installedPlugin.apply({
    skills: {
      register: (skill) => registeredSkills.push(skill),
    },
    tools: {
      register: (tool) => registered.push(tool),
      get: (name) => registered.find((tool) => tool.name === name),
    },
    on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
  })
  assert.equal(registeredSkills.length, 1)
  assert.equal(registeredSkills[0].name, 'bio-wdl-authoring')
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
  assert.deepEqual(
    registered.filter((tool) => tool.name.startsWith('bio_workflows_mission_')).map((tool) => tool.name),
    ['bio_workflows_mission_prepare', 'bio_workflows_mission_start', 'bio_workflows_mission_get', 'bio_workflows_mission_cancel', 'bio_workflows_mission_report'],
  )
  assert.deepEqual(
    registered.filter((tool) => tool.name.startsWith('bio_workflows_draft_test_')).map((tool) => tool.name),
    ['bio_workflows_draft_test_prepare', 'bio_workflows_draft_test_start', 'bio_workflows_draft_test_get', 'bio_workflows_draft_test_cancel', 'bio_workflows_draft_test_report'],
  )
  assert.equal(registered.find((tool) => tool.name === 'bio_workflows_draft_create').parameters.properties.missionId.type, 'string')
  const guarded = await waterfall(
    'tools/execute',
    { name: 'bio_workflows_get', arguments: {} },
    async () => assert.fail('invalid arguments reached the tool body'),
  )
  assert.deepEqual(guarded.error.info, {
    name: 'ToolArgsError',
    code: 'INVALID_ARGS',
  })
  const approval = await waterfall(
    'tools/pre-execute',
    {
      name: 'bio_workflows_scaffold',
      arguments: { id: 'custom', name: 'Custom', summary: 'Smoke test draft.' },
    },
    async () => assert.fail('mutating store tool bypassed approval'),
  )
  assert.equal(approval.kind, 'deny')
  const search = registered.find((tool) => tool.name === 'bio_workflows_search')
  const searchResult = JSON.parse(await search.execute({ source: 'builtin' }))
  assert.deepEqual(
    searchResult.workflows.map((workflow) => `${workflow.id}@${workflow.version}`),
    ['bam-qc@1.0.0', 'fastq-qc@1.2.0', 'fastq-qc@1.1.0', 'fastq-qc@1.0.0'],
  )
  const help = execFileSync(
    dshCommand,
    ['--profile', 'headless', '--help'],
    { cwd: packageRoot, env: environment, encoding: 'utf8' },
  )
  assert.match(help, /Usage:/)

  const config = execFileSync(
    dshCommand,
    ['--profile', 'headless', '--dump-config'],
    { cwd: packageRoot, env: environment, encoding: 'utf8' },
  )

  assert.match(config, /# == dsh-bio-workflows/)
  assert.match(config, /id: bio-workflows/)
  assert.match(config, /name: dsh-bio-workflows/)
  assert.match(config, /manifests: \[\]/)
  assert.match(config, /engines: \{\}/)
  assert.match(config, /writeEnabled: false/)
  assert.match(config, /autonomy:/)
  assert.match(config, /draftTesting:/)
  assert.match(config, /execution:/)
  assert.match(config, /enabled: false/)
  process.stdout.write(`DSH ${version} profile smoke passed: ${packResult[0].filename}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
