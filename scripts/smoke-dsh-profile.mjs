import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
