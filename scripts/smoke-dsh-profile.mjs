import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
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
  const packResult = JSON.parse(execFileSync(
    npmCommand,
    ['pack', '--json', '--pack-destination', temporaryRoot, '--cache', cache],
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
  assert.equal(installedPlugin.name, 'dsh-bio-workflows')
  assert.equal(typeof installedPlugin.apply, 'function')
  const registered = []
  const listeners = new Map()
  installedPlugin.apply({
    tools: {
      register: (tool) => registered.push(tool),
      get: (name) => registered.find((tool) => tool.name === name),
    },
    on: (event, listener) => listeners.set(event, listener),
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
    ],
  )
  const guarded = await listeners.get('tools/execute')(
    { name: 'bio_workflows_get', arguments: {} },
    async () => assert.fail('invalid arguments reached the tool body'),
  )
  assert.deepEqual(guarded.error.info, {
    name: 'ToolArgsError',
    code: 'INVALID_ARGS',
  })
  const approval = await listeners.get('tools/pre-execute')(
    {
      name: 'bio_workflows_scaffold',
      arguments: { id: 'custom', name: 'Custom', summary: 'Smoke test draft.' },
    },
    async () => assert.fail('mutating store tool bypassed approval'),
  )
  assert.equal(approval.kind, 'deny')
  const search = registered.find((tool) => tool.name === 'bio_workflows_search')
  const searchResult = JSON.parse(await search.execute({ source: 'builtin' }))
  assert.deepEqual(searchResult.workflows.map((workflow) => workflow.id), ['bam-qc', 'fastq-qc'])
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
  process.stdout.write(`DSH ${version} profile smoke passed: ${packResult[0].filename}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
