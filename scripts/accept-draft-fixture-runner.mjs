import assert from 'node:assert/strict'
import { execFileSync, fork, spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createDraftStore } from '../src/draft-store.js'
import { computeDraftTestDigest } from '../src/draft-test-contract.js'
import { createDraftTestManager } from '../src/draft-test-manager.js'
import { createDraftValidator } from '../src/draft-validation.js'
import { createMissionStore } from '../src/mission-store.js'

const DSH_VERSION = '0.1.1-rc.2'
const IMAGE_PATTERN = /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = join(packageRoot, 'fixtures')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const sentinelName = 'DSH_BIO_ACCEPTANCE_SECRET_SENTINEL'
const sentinelValue = `must-not-cross-${randomUUID()}`
let lastValidatorProbe = null
process.env[sentinelName] = sentinelValue
assert.equal(process.platform, 'linux', 'real fixture-runner acceptance requires Linux')
assert.notEqual(process.getuid?.(), 0, 'real fixture-runner acceptance requires a non-root controller')

function requiredAbsolute(name) {
  const value = process.env[name]
  assert.equal(typeof value, 'string', `${name} must contain an absolute path`)
  assert.equal(isAbsolute(value), true, `${name} must contain an absolute path`)
  return resolve(value)
}

function requiredImage(name) {
  const value = process.env[name]
  assert.equal(typeof value, 'string', `${name} must contain an exact digest-pinned image`)
  assert.match(value, IMAGE_PATTERN, `${name} must contain an exact digest-pinned image`)
  return value
}

async function sourceHashes(paths) {
  const entries = await Promise.all(paths.map(async (path) => [
    path,
    createHash('sha256').update(await readFile(join(packageRoot, path))).digest('hex'),
  ]))
  return Object.fromEntries(entries)
}

async function loadDshRuntime() {
  const globalRoot = execFileSync(npmCommand, ['root', '--global'], { encoding: 'utf8' }).trim()
  const dshRoot = join(globalRoot, '@deepseek-ai', 'dsh')
  const metadata = JSON.parse(await readFile(join(dshRoot, 'package.json'), 'utf8'))
  assert.equal(metadata.version, DSH_VERSION)
  const dshRequire = createRequire(join(dshRoot, 'package.json'))
  const moduleUrl = (name) => pathToFileURL(dshRequire.resolve(`@deepseek-ai/${name}`)).href
  const [cordis, agent, agentLoop, jobsLocal, llm, session, subprocessLocal, systemPrompt] = await Promise.all([
    import(moduleUrl('cordis')),
    import(moduleUrl('dsh-agent')),
    import(moduleUrl('dsh-agent-loop')),
    import(moduleUrl('dsh-jobs-local')),
    import(moduleUrl('dsh-llm')),
    import(moduleUrl('dsh-session')),
    import(moduleUrl('dsh-subprocess-local')),
    import(moduleUrl('dsh-system-prompt')),
  ])
  return {
    Context: cordis.Context,
    AgentLoop: agentLoop.AgentLoop,
    AgentRegistry: agent.AgentRegistry,
    LlmRuntime: llm.LlmRuntime,
    LocalJobRegistry: jobsLocal.LocalJobRegistry,
    LocalSubprocessRuntime: subprocessLocal.LocalSubprocessRuntime,
    SessionId: session.SessionId,
    SessionStore: session.SessionStore,
    SystemPrompt: systemPrompt.SystemPrompt,
  }
}

function dockerResourceSnapshot(docker) {
  const containers = execFileSync(
    docker,
    ['container', 'ls', '--all', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  ).split('\n').filter((name) => name.startsWith('dshbio-')).sort()
  const volumes = execFileSync(
    docker,
    ['volume', 'ls', '--format', '{{.Name}}'],
    { encoding: 'utf8' },
  ).split('\n').filter((name) => name.startsWith('dshbio-')).sort()
  return { containers, volumes }
}

async function waitForDockerResourceDelta(docker, baseline, timeoutMs = 20_000) {
  const baselineContainers = new Set(baseline.containers)
  const baselineVolumes = new Set(baseline.volumes)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snapshot = dockerResourceSnapshot(docker)
    const containers = snapshot.containers.filter((name) => !baselineContainers.has(name))
    const volumes = snapshot.volumes.filter((name) => !baselineVolumes.has(name))
    if (containers.length > 0 && volumes.length > 0) return { containers, volumes }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error('restart acceptance controller did not create bounded Docker resources in time')
}

function waitForChildExit(child, timeoutMs = 10_000) {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      rejectExit(new Error('restart acceptance child did not exit in time'))
    }, timeoutMs)
    timer.unref?.()
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    })
  })
}

async function makeTreeRemovable(root) {
  async function visit(path) {
    const metadata = await lstat(path).catch(() => null)
    if (metadata === null || metadata.isSymbolicLink() || !metadata.isDirectory()) return
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(join(path, entry.name))
    }
    await chmod(path, 0o700)
  }
  await visit(root)
}

async function writeAdversarialFixture(root, { id, inputs, assertions }) {
  const directory = join(root, id, '1.0.0')
  await mkdir(join(directory, 'data'), { recursive: true, mode: 0o700 })
  const bytes = Buffer.from('fixture input\n', 'utf8')
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  await writeFile(join(directory, 'data', 'dummy.txt'), bytes, { mode: 0o400, flag: 'wx' })
  await writeFile(join(directory, 'fixture.json'), `${JSON.stringify({
    schemaVersion: '1',
    id,
    version: '1.0.0',
    name: id,
    summary: `Adversarial ${id} acceptance fixture.`,
    files: [{ path: 'data/dummy.txt', sizeBytes: bytes.length, sha256, mediaType: 'text/plain' }],
    inputs,
    assertions: assertions(sha256, bytes.length),
  }, null, 2)}\n`, { mode: 0o400, flag: 'wx' })
}

async function runBoundedChild(executable, args, options = {}) {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks = { stdout: [], stderr: [] }
    let bytes = 0
    const collect = (stream, chunk) => {
      bytes += chunk.length
      if (bytes > 512 * 1024) {
        child.kill('SIGKILL')
        rejectChild(new Error('direct runner probe exceeded its output bound'))
        return
      }
      chunks[stream].push(chunk)
    }
    child.stdout.on('data', (chunk) => collect('stdout', chunk))
    child.stderr.on('data', (chunk) => collect('stderr', chunk))
    child.once('error', rejectChild)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectChild(new Error('direct runner probe exceeded its time bound'))
    }, options.timeoutMs ?? 20_000)
    timer.unref?.()
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolveChild({
        exitCode: code,
        signal,
        stdout: Buffer.concat(chunks.stdout).toString('utf8'),
        stderr: Buffer.concat(chunks.stderr).toString('utf8'),
      })
    })
  })
}

function tracedValidatorSubprocess(subprocess) {
  return {
    resolveExecutable: (...args) => subprocess.resolveExecutable(...args),
    spawn(spec) {
      const handle = subprocess.spawn(spec)
      if (spec.argv.length !== 2 || spec.argv[1] !== '--version') return handle
      const sanitize = (value) => value
        .replaceAll(spec.cwd, '$VALIDATION')
        .replaceAll(spec.argv[0], '$VALIDATOR')
        .slice(0, 4096)
      lastValidatorProbe = { status: 'running' }
      const done = handle.done.then(async (outcome) => {
        await handle.waitForExit()
        const read = (reader) => {
          if (reader === undefined) return { text: '', lossy: false }
          const result = reader.readFrom(0)
          return { text: sanitize(result.text), lossy: result.lossy }
        }
        lastValidatorProbe = {
          status: 'completed',
          outcome,
          stdout: read(handle.collected?.stdout),
          stderr: read(handle.collected?.stderr),
        }
        return outcome
      })
      return {
        pid: handle.pid,
        stdin: handle.stdin,
        stdout: handle.stdout,
        stderr: handle.stderr,
        collected: handle.collected,
        done,
        terminate: () => handle.terminate(),
        waitForExit: (signal) => handle.waitForExit(signal),
      }
    },
  }
}

async function runControllerImportProbe({
  root,
  name,
  importUri,
  prepareWdlRoot,
  pythonExecutable,
  dockerExecutable,
  supportImage,
  taskImage,
  plan,
}) {
  const testId = `test-${randomUUID()}`
  const testRoot = join(root, name)
  const wdlRoot = join(testRoot, 'wdl')
  const fixtureRoot = join(testRoot, 'fixture')
  const fixtureDataRoot = join(fixtureRoot, 'data')
  const engineRoot = join(fixtureRoot, 'engine')
  const home = join(testRoot, 'controller-home')
  await mkdir(wdlRoot, { recursive: true, mode: 0o700 })
  await mkdir(fixtureDataRoot, { recursive: true, mode: 0o700 })
  await mkdir(home, { recursive: true, mode: 0o700 })
  await prepareWdlRoot?.({ testRoot, wdlRoot })
  const entrypoint = join(wdlRoot, 'main.wdl')
  const inputsPath = join(testRoot, 'inputs.json')
  const evidencePath = join(testRoot, 'runner-evidence.jsonl')
  const launchGatePath = join(testRoot, 'launch-gate.bin')
  const canaryPath = join(testRoot, 'isolation-canary.bin')
  const configPath = join(testRoot, 'miniwdl.cfg')
  const canary = randomBytes(32)
  const canaryDigest = `sha256:${createHash('sha256').update(canary).digest('hex')}`
  const launchGate = randomBytes(32)
  const launchGateDigest = `sha256:${createHash('sha256').update(launchGate).digest('hex')}`
  await writeFile(entrypoint, `version 1.0\nimport ${JSON.stringify(importUri)}\nworkflow guarded {}\n`, { mode: 0o400, flag: 'wx' })
  await writeFile(inputsPath, '{}\n', { mode: 0o400, flag: 'wx' })
  await writeFile(evidencePath, '', { mode: 0o600, flag: 'wx' })
  await writeFile(launchGatePath, launchGate, { mode: 0o400, flag: 'wx' })
  await writeFile(canaryPath, canary, { mode: 0o400, flag: 'wx' })
  const budgets = plan.budgets
  await writeFile(configPath, `[scheduler]
container_backend = dsh_fixture_docker
task_concurrency = 1
fail_fast = true

[file_io]
root = ${fixtureRoot}
allow_any_input = false
copy_input_files = false
chown = false

[task_runtime]
cpu_max = ${budgets.cpu}
memory_max = ${budgets.memoryBytes}
memory_limit_multiplier = 1.0
defaults = ${JSON.stringify({ cpu: budgets.cpu, memory: `${budgets.memoryBytes}B` })}
as_user = true
allow_privileged = false
command_shell = /bin/bash
placeholder_regex = [A-Za-z0-9_./:@+=,-]+
env = {}

[call_cache]
get = false
put = false

[dsh_fixture_docker]
docker_executable = ${dockerExecutable}
test_id = ${testId}
plan_digest = ${computeDraftTestDigest(plan, 'plan')}
test_root = ${testRoot}
wdl_root = ${wdlRoot}
fixture_root = ${fixtureRoot}
fixture_data_root = ${fixtureDataRoot}
inputs_path = ${inputsPath}
runtime_environment_digest = ${plan.runner.identity.pythonEnvironment.environmentDigest}
wrapper_digest = ${plan.runner.identity.executables.wrapper.sha256}
controller_environment_digest = ${plan.runner.identity.controller.environment.environmentDigest}
controller_network_filter_digest = ${plan.runner.identity.controller.network.filterDigest}
support_image = ${supportImage}
allowed_images = ${JSON.stringify([taskImage])}
evidence_path = ${evidencePath}
launch_gate_path = ${launchGatePath}
launch_gate_digest = ${launchGateDigest}
probe_canary_path = ${canaryPath}
probe_canary_digest = ${canaryDigest}
cpu = ${budgets.cpu}
memory_bytes = ${budgets.memoryBytes}
pids = ${budgets.pids}
wall_time_ms = ${budgets.wallTimeMs}
task_time_ms = ${budgets.taskTimeMs}
log_bytes = ${budgets.logBytes}
artifact_count = ${budgets.artifactCount}
artifact_bytes = ${budgets.artifactBytes}
total_output_bytes = ${budgets.totalOutputBytes}
task_count = ${budgets.taskCount}
`, { mode: 0o400, flag: 'wx' })
  const wrapper = join(packageRoot, 'runner', 'dsh_fixture_runner.py')
  const outcome = await runBoundedChild(pythonExecutable, [
    '-B', '-I', '-S', wrapper, 'run', '--input', inputsPath, '--dir', `${engineRoot}/.`, '--cfg', configPath,
    '--error-json', '--log-json', '--no-color', '--no-cache', '--no-outside-imports', '--as-me', entrypoint,
  ], {
    cwd: wdlRoot,
    env: { HOME: home, TMPDIR: '/tmp', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
  })
  assert.notEqual(outcome.exitCode, 0, `${name} unexpectedly succeeded`)
  const events = (await readFile(evidencePath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
  const controller = events.find((event) => event.type === 'controller_guard')
  assert.equal(controller.network.outboundDenied, true)
  assert.equal(controller.network.nameResolutionDenied, true)
  assert.equal(controller.network.kernelEnforced, true)
  assert.equal(controller.network.filterDigest, plan.runner.identity.controller.network.filterDigest)
  assert.equal(events.some((event) => event.type === 'isolation_probe'), false)
  assert.equal(events.some((event) => event.type === 'task'), false)
  assert.equal(events.some((event) => event.type === 'task_failure'), false)
  return { controller, events, outcome }
}

async function proveControllerRemoteImportDenied(options) {
  let connections = 0
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('version 1.0\nworkflow imported {}\n')
  })
  server.on('connection', () => { connections += 1 })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  try {
    const address = server.address()
    assert.equal(typeof address, 'object')
    const probe = await runControllerImportProbe({
      ...options,
      name: 'remote-import-guard',
      importUri: `http://127.0.0.1:${address.port}/evil.wdl`,
    })
    assert.equal(connections, 0, 'remote import reached the host canary')
    assert.equal(requests, 0, 'remote import issued an HTTP request')
    return {
      connections,
      requests,
      controllerGuardDigest: probe.controller.controllerGuardDigest,
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose))
  }
}

async function proveControllerLocalImportEscapeDenied(options) {
  const secret = `local-import-secret-${randomUUID()}`
  const importedSource = `version 1.0\n# ${secret}\ntask stolen { command <<<true>>> }\n`
  const traversal = await runControllerImportProbe({
    ...options,
    name: 'traversal-import-guard',
    importUri: '../outside-secret.wdl',
    prepareWdlRoot: async ({ testRoot }) => {
      await writeFile(join(testRoot, 'outside-secret.wdl'), importedSource, {
        mode: 0o400,
        flag: 'wx',
      })
    },
  })
  const linked = await runControllerImportProbe({
    ...options,
    name: 'symlink-import-guard',
    importUri: 'linked-secret.wdl',
    prepareWdlRoot: async ({ testRoot, wdlRoot }) => {
      const outside = join(testRoot, 'outside-secret.wdl')
      await writeFile(outside, importedSource, { mode: 0o400, flag: 'wx' })
      await symlink(outside, join(wdlRoot, 'linked-secret.wdl'))
    },
  })
  for (const probe of [traversal, linked]) {
    assert.equal(probe.outcome.stdout.includes(secret), false)
    assert.equal(probe.outcome.stderr.includes(secret), false)
  }
  return {
    traversalDeniedBeforeContainer: true,
    symlinkDeniedBeforeContainer: true,
    secretLeaked: false,
  }
}

function wdlSource(taskImage, command) {
  return `version 1.0

task copy_file {
  input { File source }
  command <<<
    ${command}
  >>>
  output { File copy = "result.txt" }
  runtime {
    docker: "${taskImage}"
  }
}

workflow roundtrip {
  input { File source }
  call copy_file { input: source = source }
  output { File copy = copy_file.copy }
}
`
}

async function createReadyTrial({
  missionStore,
  draftStore,
  validator,
  operation,
  taskImage,
  name,
  command,
  source,
}) {
  const missionRequest = {
    software: { name, version: '1.0.0', containerImage: taskImage },
    objective: `Run the ${name} draft against one immutable text fixture.`,
    acceptanceCriteria: ['The exact fixture assertion returns deterministic evidence.'],
  }
  const preparedMission = await missionStore.prepare(missionRequest)
  assert.equal(preparedMission.ok, true, JSON.stringify(preparedMission))
  const mission = await missionStore.start({
    ...missionRequest,
    expectedPlanDigest: preparedMission.planDigest,
  }, operation)
  assert.equal(mission.ok, true, JSON.stringify(mission))

  const createRequest = {
    id: name,
    version: '0.1.0',
    name,
    summary: `Real isolated ${name} acceptance draft.`,
  }
  const createReservation = await missionStore.reserveAction(
    mission.missionId,
    'draft_create',
    createRequest,
    operation,
  )
  assert.equal(createReservation.ok, true, JSON.stringify(createReservation))
  const draft = await draftStore.create(createRequest, operation)
  assert.equal(draft.ok, true, JSON.stringify(draft))
  const createdMission = await missionStore.recordDraftResult(
    mission.missionId,
    'draft_create',
    createReservation.reservation,
    draft,
    operation,
  )
  assert.equal(createdMission.ok, true, JSON.stringify(createdMission))

  const updateRequest = {
    draftId: draft.draftId,
    expectedRevision: draft.revision,
    expectedContentDigest: draft.contentDigest,
    replacements: [{
      path: 'main.wdl',
      role: 'workflow',
      content: source ?? wdlSource(taskImage, command),
    }],
  }
  const updateReservation = await missionStore.reserveAction(
    mission.missionId,
    'draft_update',
    updateRequest,
    operation,
  )
  assert.equal(updateReservation.ok, true, JSON.stringify(updateReservation))
  const updated = await draftStore.update(updateRequest, operation)
  assert.equal(updated.ok, true, JSON.stringify(updated))
  const updatedMission = await missionStore.recordDraftResult(
    mission.missionId,
    'draft_update',
    updateReservation.reservation,
    updated,
    operation,
  )
  assert.equal(updatedMission.ok, true, JSON.stringify(updatedMission))

  const validationRequest = { draftId: draft.draftId, revision: updated.revision }
  const validationReservation = await missionStore.reserveAction(
    mission.missionId,
    'draft_validate',
    validationRequest,
    operation,
  )
  assert.equal(validationReservation.ok, true, JSON.stringify(validationReservation))
  const validation = await validator.validate(validationRequest, operation)
  assert.equal(validation.ok, true, JSON.stringify({ validation, lastValidatorProbe }))
  assert.equal(validation.validation.valid, true, JSON.stringify(validation.validation.diagnostics))
  const ready = await missionStore.recordValidationResult(
    mission.missionId,
    validationReservation.reservation,
    validation,
    operation,
  )
  assert.equal(ready.status, 'ready', JSON.stringify(ready))
  assert.equal(ready.phase, 'validated')
  return ready
}

async function startTrial(
  manager,
  jobs,
  owner,
  missionId,
  budgets,
  fixtureId = 'text-roundtrip',
  fixtureVersion = '1.0.0',
) {
  const request = {
    missionId,
    fixtureId,
    fixtureVersion,
    budgets,
  }
  const prepared = await manager.prepare(request, { ownerSession: owner.id, agent: owner })
  assert.equal(prepared.ok, true, JSON.stringify(prepared))
  assert.equal(prepared.plan.authorization.productionExecution, false)
  assert.equal(prepared.plan.authorization.workflowPromotion, false)
  const started = await manager.start({
    ...request,
    expectedPlanDigest: prepared.planDigest,
  }, { ownerSession: owner.id, agent: owner })
  assert.equal(started.ok, true, JSON.stringify(started))
  return { prepared, started, jobs }
}

const pythonExecutable = requiredAbsolute('DSH_BIO_FIXTURE_PYTHON')
const miniwdlExecutable = join(dirname(pythonExecutable), 'miniwdl')
const dockerExecutable = requiredAbsolute('DSH_BIO_DOCKER_EXECUTABLE')
const supportImage = requiredImage('DSH_BIO_FIXTURE_SUPPORT_IMAGE')
const taskImage = requiredImage('DSH_BIO_FIXTURE_TASK_IMAGE')
const acceptanceRoot = requiredAbsolute('DSH_BIO_DRAFT_TEST_ROOT')
assert.equal(await realpath(acceptanceRoot), acceptanceRoot, 'DSH_BIO_DRAFT_TEST_ROOT must be canonical')

const runtime = await loadDshRuntime()
const temporaryRoot = await mkdtemp(join(acceptanceRoot, 'dsh-bio-fixture-acceptance-'))
await chmod(temporaryRoot, 0o700)
let ctx
let handle
let acceptanceResult
let restartChild = null
let restartNeedsRecovery = false
let recoverInterruptedRuns = null

try {
  const storeRoot = join(temporaryRoot, 'store')
  const runsRoot = join(temporaryRoot, 'runs')
  const adversarialFixtureRoot = join(temporaryRoot, 'fixtures')
  await mkdir(storeRoot, { mode: 0o700 })
  await mkdir(runsRoot, { mode: 0o700 })
  await mkdir(adversarialFixtureRoot, { mode: 0o700 })
  await writeAdversarialFixture(adversarialFixtureRoot, {
    id: 'relative-file-input',
    inputs: { 'roundtrip.source': '.' },
    assertions: (sha256, sizeBytes) => [{
      id: 'must-not-read-wdl-root',
      kind: 'file_digest',
      output: 'roundtrip.copy',
      sha256,
      sizeBytes,
    }],
  })
  await writeAdversarialFixture(adversarialFixtureRoot, {
    id: 'controller-memory-bomb',
    inputs: {},
    assertions: () => [{
      id: 'must-not-complete',
      kind: 'value_equals',
      output: 'bomb.count',
      expected: 1,
    }],
  })
  const beforeResources = dockerResourceSnapshot(dockerExecutable)

  ctx = new runtime.Context()
  new runtime.SessionStore(ctx)
  const agents = new runtime.AgentRegistry(ctx)
  new runtime.LlmRuntime(ctx)
  new runtime.SystemPrompt(ctx, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    persona: 'Real isolated fixture-runner acceptance owner.',
  })
  new runtime.LocalSubprocessRuntime(ctx)
  const validatorSubprocess = tracedValidatorSubprocess(ctx.get('subprocess'))
  const jobs = new runtime.LocalJobRegistry(ctx, { maxConcurrentJobsPerOwner: 1 })
  jobs.attachController('dsh-bio-workflows-fixture-acceptance')
  new runtime.AgentLoop(ctx, { agents: [], maxParallelToolCalls: 1 })
  handle = await agents.create({
    sessionId: runtime.SessionId('bio-workflow-fixture-acceptance'),
    meta: { cwd: packageRoot },
    agentOptions: { provider: 'acceptance', model: 'fixture-runner', maxTokens: 1_024 },
  })
  const owner = handle.agent
  const operation = { ownerSession: owner.id, agent: owner, environment: {} }
  const draftStore = createDraftStore({ root: storeRoot, writeEnabled: true })
  const missionStore = createMissionStore(
    { root: storeRoot, writeEnabled: true },
    { enabled: true },
    { runtimeId: 'fixture-acceptance-runtime' },
  )
  const validator = createDraftValidator({
    store: draftStore,
    config: {
      validator: { executable: miniwdlExecutable, expectedVersion: '1.15.0' },
    },
    getSubprocess: () => validatorSubprocess,
    getEnvironment: () => ({}),
  })
  const draftTestConfig = {
    enabled: true,
    runsRoot,
    fixtureRoots: [fixtureRoot, adversarialFixtureRoot],
    runner: {
      pythonExecutable,
      dockerExecutable,
      expectedMiniwdlVersion: '1.15.0',
      supportImage,
    },
    budgets: {
      cpu: 1,
      memoryBytes: 512 * 1024 * 1024,
      pids: 32,
      wallTimeMs: 90_000,
      taskTimeMs: 60_000,
      logBytes: 16 * 1024,
      artifactCount: 8,
      artifactBytes: 16 * 1024,
      totalOutputBytes: 32 * 1024,
      fixtureBytes: 1024,
      taskCount: 1,
    },
  }
  const managerOptions = (runtimeId) => ({
    missionStore,
    draftStore,
    config: draftTestConfig,
    getSubprocess: () => ctx.get('subprocess'),
    getJobs: () => jobs,
    runtimeId,
  })
  const manager = createDraftTestManager(managerOptions('fixture-acceptance-runtime'))
  recoverInterruptedRuns = async () => {
    const recoveryManager = createDraftTestManager(
      managerOptions(`fixture-acceptance-recovery-${randomUUID()}`),
    )
    const initialization = await recoveryManager.initialize()
    return { recoveryManager, initialization }
  }

  const passMission = await createReadyTrial({
    missionStore,
    draftStore,
    validator,
    operation,
    taskImage,
    name: 'fixture-pass',
    command: 'cat "~{source}" > result.txt',
  })
  const passing = await startTrial(manager, jobs, owner, passMission.missionId, {
    wallTimeMs: 60_000,
    taskTimeMs: 30_000,
    logBytes: 16 * 1024,
    artifactCount: 4,
    artifactBytes: 8 * 1024,
    totalOutputBytes: 16 * 1024,
  })
  const passJob = await jobs.wait(passing.started.jobId, 90_000, owner)
  assert.equal(passJob.status, 'completed', JSON.stringify(jobs.read(passing.started.jobId, owner)))
  const passed = await manager.get(passing.started.testId, operation)
  assert.equal(passed.ok, true)
  assert.equal(passed.test.status, 'completed')
  assert.equal(passed.test.evidence.passed, true, JSON.stringify(passed.test.evidence.failure))
  assert.equal(passed.test.evidence.isolation.verified, true)
  assert.equal(passed.test.evidence.isolation.probes.length, 17)
  assert.equal(passed.test.evidence.artifacts.length, 1)
  assert.equal(
    passed.test.evidence.artifacts[0].sha256,
    `sha256:${createHash('sha256').update('fixture input\n').digest('hex')}`,
  )
  assert.equal(passed.test.evidence.assertionEvidence.passed, true)
  assert.equal(passed.test.evidence.resources.cleanupVerified, true)
  assert.equal(JSON.stringify(passed.test.evidence).includes(temporaryRoot), false)
  const controllerEnvironment = passed.test.evidence.isolation.controller.environment
  const environmentScrubbed = (
    JSON.stringify(controllerEnvironment.keys) === JSON.stringify(['HOME', 'LANG', 'LC_ALL', 'TMPDIR'])
    && JSON.stringify(controllerEnvironment.nonEmptyKeys) === JSON.stringify(['HOME', 'LANG', 'LC_ALL', 'TMPDIR'])
    && controllerEnvironment.credentialLikeKeys.length === 0
    && controllerEnvironment.environmentDigest
      === passing.prepared.plan.runner.identity.controller.environment.environmentDigest
    && !JSON.stringify(passed.test.evidence).includes(sentinelName)
    && !JSON.stringify(passed.test.evidence).includes(sentinelValue)
  )
  assert.equal(environmentScrubbed, true, 'controller environment scrub evidence did not match runtime facts')

  const remoteImport = await proveControllerRemoteImportDenied({
    root: temporaryRoot,
    pythonExecutable,
    dockerExecutable,
    supportImage,
    taskImage,
    plan: passing.prepared.plan,
  })
  const localImport = await proveControllerLocalImportEscapeDenied({
    root: temporaryRoot,
    pythonExecutable,
    dockerExecutable,
    supportImage,
    taskImage,
    plan: passing.prepared.plan,
  })

  const relativeMission = await createReadyTrial({
    missionStore,
    draftStore,
    validator,
    operation,
    taskImage,
    name: 'relative-file-input',
    command: 'cat "~{source}" > result.txt',
  })
  const relativeTrial = await startTrial(
    manager,
    jobs,
    owner,
    relativeMission.missionId,
    {
      wallTimeMs: 30_000,
      taskTimeMs: 20_000,
      logBytes: 4 * 1024,
      artifactCount: 2,
      artifactBytes: 4 * 1024,
      totalOutputBytes: 8 * 1024,
    },
    'relative-file-input',
  )
  await jobs.wait(relativeTrial.started.jobId, 60_000, owner)
  const relativeDenied = await manager.get(relativeTrial.started.testId, operation)
  assert.equal(relativeDenied.test.evidence.passed, false)
  assert.equal(relativeDenied.test.evidence.isolation.containers.length, 0)
  assert.equal(relativeDenied.test.evidence.resources.cleanupVerified, true)

  const memoryMission = await createReadyTrial({
    missionStore,
    draftStore,
    validator,
    operation,
    taskImage,
    name: 'controller-memory-bomb',
    command: '',
    source: `version 1.0

task identity {
  command <<<true>>>
  runtime { docker: "${taskImage}" }
}

workflow bomb {
  Array[Int] xs = range(100000000)
  call identity
  output { Int count = length(xs) }
}
`,
  })
  const memoryTrial = await startTrial(
    manager,
    jobs,
    owner,
    memoryMission.missionId,
    {
      memoryBytes: 256 * 1024 * 1024,
      wallTimeMs: 30_000,
      taskTimeMs: 20_000,
      logBytes: 4 * 1024,
      artifactCount: 2,
      artifactBytes: 4 * 1024,
      totalOutputBytes: 8 * 1024,
    },
    'controller-memory-bomb',
  )
  await jobs.wait(memoryTrial.started.jobId, 60_000, owner)
  const memoryLimited = await manager.get(memoryTrial.started.testId, operation)
  assert.equal(memoryLimited.test.evidence.passed, false)
  assert.equal(
    memoryLimited.test.evidence.exit.timedOut,
    false,
    JSON.stringify(memoryLimited.test.evidence.exit),
  )
  assert.equal(memoryLimited.test.evidence.resources.cleanupVerified, true)
  assert.equal(memoryLimited.test.evidence.failure.code, 'runner_evidence_invalid')
  assert.equal(
    memoryLimited.test.evidence.exit.signal !== null
      || (memoryLimited.test.evidence.exit.exitCode ?? 0) !== 0,
    true,
    JSON.stringify(memoryLimited.test.evidence.exit),
  )

  const timeoutMission = await createReadyTrial({
    missionStore,
    draftStore,
    validator,
    operation,
    taskImage,
    name: 'fixture-timeout',
    command: 'sleep 30\ncat "~{source}" > result.txt',
  })
  const timeoutTrial = await startTrial(manager, jobs, owner, timeoutMission.missionId, {
    wallTimeMs: 60_000,
    taskTimeMs: 5_000,
    logBytes: 4 * 1024,
    artifactCount: 2,
    artifactBytes: 4 * 1024,
    totalOutputBytes: 8 * 1024,
  })
  await jobs.wait(timeoutTrial.started.jobId, 60_000, owner)
  const timedOut = await manager.get(timeoutTrial.started.testId, operation)
  assert.equal(timedOut.test.status, 'failed')
  assert.equal(timedOut.test.evidence.passed, false)
  assert.equal(
    timedOut.test.evidence.exit.timedOut,
    true,
    JSON.stringify(timedOut.test.evidence),
  )
  assert.equal(timedOut.test.evidence.failure.code, 'task_time_exceeded')

  const cancelMission = await createReadyTrial({
    missionStore,
    draftStore,
    validator,
    operation,
    taskImage,
    name: 'fixture-cancel',
    command: 'sleep 30\ncat "~{source}" > result.txt',
  })
  const cancelTrial = await startTrial(manager, jobs, owner, cancelMission.missionId, {
    wallTimeMs: 60_000,
    taskTimeMs: 45_000,
    logBytes: 4 * 1024,
    artifactCount: 2,
    artifactBytes: 4 * 1024,
    totalOutputBytes: 8 * 1024,
  })
  const cancellation = await manager.cancel(cancelTrial.started.testId, operation)
  assert.equal(cancellation.ok, true)
  await jobs.wait(cancelTrial.started.jobId, 60_000, owner)
  const cancelled = await manager.get(cancelTrial.started.testId, operation)
  assert.equal(cancelled.test.status, 'cancelled')
  assert.equal(cancelled.test.evidence.passed, false)
  assert.equal(cancelled.test.evidence.failure.code, 'draft_test_cancelled')
  assert.equal(cancelled.test.evidence.failure.automaticRetry, false)

  const limitMission = await createReadyTrial({
    missionStore,
    draftStore,
    validator,
    operation,
    taskImage,
    name: 'fixture-limits',
    command: `python3 -c 'print("x" * 8192)'\npython3 -c 'open("result.txt", "wb").write(b"x" * 8192)'`,
  })
  const limitTrial = await startTrial(manager, jobs, owner, limitMission.missionId, {
    wallTimeMs: 30_000,
    taskTimeMs: 20_000,
    logBytes: 4 * 1024,
    artifactCount: 1,
    artifactBytes: 4 * 1024,
    totalOutputBytes: 4 * 1024,
  })
  await jobs.wait(limitTrial.started.jobId, 60_000, owner)
  const limited = await manager.get(limitTrial.started.testId, operation)
  assert.equal(limited.test.evidence.passed, false)
  assert.notEqual(limited.test.evidence.failure, null)
  assert.equal(limited.test.evidence.logs.stdout.capturedBytes <= 2 * 1024, true)
  assert.equal(limited.test.evidence.logs.stderr.capturedBytes <= 2 * 1024, true)
  assert.equal(limited.test.evidence.artifacts.length, 0)

  const restartMission = await createReadyTrial({
    missionStore,
    draftStore,
    validator,
    operation,
    taskImage,
    name: 'fixture-real-runtime-restart',
    command: 'sleep 300\ncat "~{source}" > result.txt',
  })
  const restartRequest = {
    missionId: restartMission.missionId,
    fixtureId: 'text-roundtrip',
    fixtureVersion: '1.0.0',
    budgets: {
      wallTimeMs: 90_000,
      taskTimeMs: 60_000,
      logBytes: 4 * 1024,
      artifactCount: 2,
      artifactBytes: 4 * 1024,
      totalOutputBytes: 8 * 1024,
    },
  }
  const restartConfigPath = join(temporaryRoot, 'restart-child.json')
  await writeFile(restartConfigPath, `${JSON.stringify({
    ownerSession: owner.id,
    storeRoot,
    missionRuntimeId: 'fixture-acceptance-runtime',
    controllerRuntimeId: 'fixture-acceptance-orphan-runtime',
    draftTestConfig,
    request: restartRequest,
  })}\n`, { mode: 0o600, flag: 'wx' })
  let restartStderr = ''
  restartChild = fork(
    join(packageRoot, 'scripts', 'accept-draft-fixture-restart-child.mjs'),
    [restartConfigPath],
    { cwd: packageRoot, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  )
  restartNeedsRecovery = true
  restartChild.stderr.on('data', (chunk) => {
    restartStderr = `${restartStderr}${chunk.toString('utf8')}`.slice(-32 * 1024)
  })
  const restartStarted = await new Promise((resolveStart, rejectStart) => {
    const timer = setTimeout(() => {
      rejectStart(new Error(`restart acceptance child timed out: ${restartStderr}`))
    }, 30_000)
    timer.unref?.()
    const finish = (callback, value) => {
      clearTimeout(timer)
      restartChild.off('message', onMessage)
      restartChild.off('error', onError)
      restartChild.off('exit', onExit)
      callback(value)
    }
    const onMessage = (message) => {
      if (message?.type === 'controller-started') finish(resolveStart, message)
      if (message?.type === 'controller-failed') {
        finish(rejectStart, new Error(`restart acceptance child failed: ${message.message}`))
      }
    }
    const onError = (error) => finish(rejectStart, error)
    const onExit = (code, signal) => {
      finish(rejectStart, new Error(
        `restart acceptance child exited before launch (${code ?? signal}): ${restartStderr}`,
      ))
    }
    restartChild.on('message', onMessage)
    restartChild.once('error', onError)
    restartChild.once('exit', onExit)
  })
  const ownerDirectory = join(
    runsRoot,
    `owner-${createHash('sha256').update(owner.id, 'utf8').digest('hex')}`,
  )
  const restartRecord = JSON.parse(await readFile(
    join(ownerDirectory, restartStarted.testId, 'test.json'),
    'utf8',
  ))
  assert.equal(restartRecord.status, 'running')
  assert.equal(restartRecord.launchReleased, true)
  assert.equal(restartRecord.controllerIdentity.pid, restartRecord.pid)
  process.kill(restartRecord.pid, 0)
  const restartResources = await waitForDockerResourceDelta(
    dockerExecutable,
    beforeResources,
  )
  const restartChildExit = waitForChildExit(restartChild)
  assert.equal(restartChild.kill('SIGKILL'), true)
  assert.deepEqual(await restartChildExit, { code: null, signal: 'SIGKILL' })
  restartChild = null
  process.kill(restartRecord.pid, 0)
  const { recoveryManager, initialization } = await recoverInterruptedRuns()
  assert.equal(initialization.failed, false)
  assert.equal(initialization.reconciledCount, 1)
  const restartReconciled = await recoveryManager.get(restartStarted.testId, operation)
  assert.equal(restartReconciled.ok, true, JSON.stringify(restartReconciled))
  assert.equal(restartReconciled.test.status, 'interrupted')
  assert.equal(restartReconciled.test.evidence.failure.code, 'runtime_restart_interrupted')
  assert.equal(restartReconciled.test.evidence.resources.cleanupVerified, true)
  assert.equal(restartReconciled.test.evidence.resources.controllerTerminationVerified, true)
  assert.match(
    restartReconciled.test.evidence.resources.controllerTerminationMode,
    /^exact_identity_(?:terminated|killed)$/,
  )
  restartNeedsRecovery = false

  const foreign = await manager.get(passing.started.testId, {
    ownerSession: 'foreign-session',
    agent: { id: 'foreign-session', session: { id: 'foreign-session' } },
  })
  assert.deepEqual(foreign, {
    ok: false,
    error: { code: 'draft_test_not_found', message: 'draft test was not found' },
  })
  const missionReport = await missionStore.report(passMission.missionId, operation)
  assert.equal(missionReport.report.success, false)
  assert.equal(missionReport.report.readiness.isolatedTestCompleted, false)

  const afterResources = dockerResourceSnapshot(dockerExecutable)
  assert.deepEqual(afterResources, beforeResources, 'isolated runner left Docker containers or volumes behind')
  const report = await manager.report(passing.started.testId, operation)
  acceptanceResult = {
    schemaVersion: '1',
    scope: 'real-isolated-fixture-runner-acceptance',
    recordedAt: new Date().toISOString(),
    candidate: { package: 'dsh-bio-workflows@0.11.0+unreleased-fixture-runner', dsh: DSH_VERSION },
    identities: report.report.identities,
    planDigest: passing.prepared.planDigest,
    evidenceDigest: passed.test.evidence.evidenceDigest,
    assertions: {
      exactFixtureAndOutputDigest: true,
      isolationProbeCount: passed.test.evidence.isolation.probes.length,
      egressAndHostServiceDenial: true,
      controllerAndContainerEnvironmentScrubbed: environmentScrubbed,
      controllerRemoteImportConnections: remoteImport.connections,
      controllerRemoteImportRequests: remoteImport.requests,
      controllerTraversalImportDeniedBeforeContainer:
        localImport.traversalDeniedBeforeContainer,
      controllerSymlinkImportDeniedBeforeContainer:
        localImport.symlinkDeniedBeforeContainer,
      controllerLocalImportSecretLeaked: localImport.secretLeaked,
      controllerMemoryLimitFailsClosed: memoryLimited.test.evidence.failure.code,
      controllerMemoryProcessExit: memoryLimited.test.evidence.exit,
      controllerMemoryBudgetBytes: memoryTrial.prepared.plan.budgets.memoryBytes,
      relativeFileCoercionDenied: relativeDenied.test.evidence.failure.code,
      inspectedContainerControlsBound: passed.test.evidence.isolation.containers.every(
        (container) => container.containerControlsDigest.startsWith('sha256:'),
      ),
      timeoutFailsClosed: timedOut.test.evidence.failure.code,
      cancellationFailsClosed: cancelled.test.evidence.failure.code,
      outputAndLogLimitsFailClosed: limited.test.evidence.failure.code,
      crossOwnerReadDenied: true,
      dockerResourcesRestoredToBaseline: true,
      restartCleanupVerified: restartReconciled.test.evidence.resources.cleanupVerified,
      restartLiveControllerAndResources: {
        controllerPidPersisted: true,
        containers: restartResources.containers.length,
        volumes: restartResources.volumes.length,
      },
      restartControllerTerminationMode:
        restartReconciled.test.evidence.resources.controllerTerminationMode,
      productionExecutionAuthorized: false,
      workflowPromotionAuthorized: false,
      softwareTrialReportSuccess: missionReport.report.success,
    },
    sourceSha256: await sourceHashes([
      'fixtures/text-roundtrip/1.0.0/fixture.json',
      'fixtures/text-roundtrip/1.0.0/inputs/message.txt',
      'index.js',
      'requirements/miniwdl-1.15.0.txt',
      'runner/dsh_fixture_runner.py',
      'schema/draft-test-evidence.schema.json',
      'schema/draft-test-plan.schema.json',
      'schema/fixture-bundle.schema.json',
      'scripts/accept-draft-fixture-runner.mjs',
      'scripts/accept-draft-fixture-restart-child.mjs',
      'src/draft-test-contract.js',
      'src/draft-test-manager.js',
      'src/draft-test-tools.js',
      'src/fixture-assertions.js',
      'src/fixture-bundle.js',
    ]),
  }
  await new Promise((resolveWrite, rejectWrite) => {
    process.stderr.write(`${JSON.stringify(acceptanceResult, null, 2)}\n`, (error) => {
      if (error) rejectWrite(error)
      else resolveWrite()
    })
  })
} finally {
  if (
    restartChild !== null
    && restartChild.exitCode === null
    && restartChild.signalCode === null
  ) {
    const restartChildExit = waitForChildExit(restartChild).catch(() => null)
    restartChild.kill('SIGKILL')
    await restartChildExit
  }
  if (restartNeedsRecovery && recoverInterruptedRuns !== null) {
    await recoverInterruptedRuns()
    restartNeedsRecovery = false
  }
  if (handle !== undefined) await handle.dispose().catch(() => {})
  if (ctx !== undefined) await ctx.fiber.dispose().catch(() => {})
  await makeTreeRemovable(temporaryRoot)
  await rm(temporaryRoot, { recursive: true, force: true })
  delete process.env[sentinelName]
}
