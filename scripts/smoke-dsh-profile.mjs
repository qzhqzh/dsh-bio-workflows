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
  process.stdout.write(`DSH ${version} profile smoke passed: ${packResult[0].filename}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
