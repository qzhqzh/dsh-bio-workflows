import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, symlinkSync, unlinkSync } from 'node:fs'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from 'dsh-bio-workflows'
import {
  ExecutionConfigValidationError,
  createExecutionManager,
  parseExecutionConfig,
} from '../src/execution.js'
import { createWorkflowStore } from '../src/workflow-store.js'

const TEST_UUID = '123e4567-e89b-42d3-a456-426614174000'

class StaticReader {
  constructor(text) {
    this.text = text
  }

  readFrom(offset) {
    const buffer = Buffer.from(this.text, 'utf8')
    return {
      text: buffer.subarray(offset).toString('utf8'),
      nextOffset: buffer.length,
      lossy: false,
    }
  }
}

function makeHandle(done, stdout = '', stderr = '', terminate = () => {}) {
  return {
    pid: 4321,
    collected: {
      stdout: new StaticReader(stdout),
      stderr: new StaticReader(stderr),
    },
    done,
    terminate,
    waitForExit: async () => true,
  }
}

class FakeSubprocess {
  constructor(options = {}) {
    this.options = options
    this.miniwdlExecutable = options.miniwdlExecutable
    this.dockerExecutable = options.dockerExecutable
    this.spawns = []
    this.terminated = false
    this.finishHeldRun = null
  }

  async resolveExecutable(command) {
    if (command === this.miniwdlExecutable) return this.miniwdlExecutable
    if (command === this.dockerExecutable) return this.dockerExecutable
    throw new Error(`unexpected executable: ${command}`)
  }

  spawn(spec) {
    this.spawns.push(spec)
    this.options.onSpawn?.(spec, this.spawns.length)
    if (spec.argv[1] === '--version') {
      return makeHandle(Promise.resolve({ exitCode: 0, signal: null }), 'miniwdl v1.15.0\n')
    }
    if (spec.argv[1] === 'check') {
      return makeHandle(Promise.resolve({ exitCode: 0, signal: null }))
    }
    if (spec.argv[1] === 'version' && spec.argv[0].endsWith('/docker')) {
      return makeHandle(Promise.resolve({ exitCode: 0, signal: null }), '28.3.2\n')
    }
    if (spec.argv[1] === 'info' && spec.argv[0].endsWith('/docker')) {
      return makeHandle(
        Promise.resolve({ exitCode: 0, signal: null }),
        `fake-engine-id ${this.options.swarmState ?? 'active true'}\n`,
      )
    }
    if (spec.argv[1] !== 'run') throw new Error(`unexpected argv: ${spec.argv.join(' ')}`)

    let settle
    const held = this.options.holdRun === true
    const done = held
      ? new Promise((resolve) => { settle = resolve })
      : this.#completeRun(spec)
    if (held) {
      this.finishHeldRun = async (outcome = { exitCode: 0, signal: null }) => {
        if (outcome.exitCode === 0) await this.#writeOutputs(spec)
        settle(outcome)
      }
    }
    return makeHandle(done, '{"message":"workflow running"}\n', '', () => {
      this.terminated = true
      if (held) settle({ exitCode: null, signal: 'SIGTERM' })
    })
  }

  async #completeRun(spec) {
    await this.#writeOutputs(spec)
    return { exitCode: 0, signal: null }
  }

  async #writeOutputs(spec) {
    const directoryArgument = spec.argv[spec.argv.indexOf('--dir') + 1]
    const engineDirectory = directoryArgument.endsWith(`${sep}.`)
      ? directoryArgument.slice(0, -2)
      : directoryArgument
    const outputDirectory = join(engineDirectory, 'call-fastqc', 'out')
    await mkdir(outputDirectory, { recursive: true })
    const html = join(outputDirectory, 'sample_fastqc.html')
    const zip = join(outputDirectory, 'sample_fastqc.zip')
    await writeFile(html, '<html>ok</html>')
    await writeFile(zip, 'zip')
    await writeFile(join(engineDirectory, 'outputs.json'), JSON.stringify({
      'fastq_qc.html_reports': [html],
      'fastq_qc.zip_reports': [zip],
    }))
  }
}

class FakeJobs {
  constructor() {
    this.count = 0
    this.records = new Map()
  }

  start(spec) {
    const id = `${spec.kind}-${++this.count}`
    const hooks = spec.run()
    const record = {
      id,
      kind: spec.kind,
      label: spec.label,
      owner: spec.owner,
      hooks,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: undefined,
      detail: undefined,
    }
    this.records.set(id, record)
    record.settled = hooks.done.then((outcome) => {
      record.status = outcome.status
      record.detail = outcome.detail
      record.finishedAt = Date.now()
      return outcome
    })
    return id
  }

  #record(id, caller) {
    const record = this.records.get(id)
    if (record === undefined) throw new Error(`unknown job: ${id}`)
    if (record.owner !== undefined && record.owner.id !== caller?.id) {
      throw new Error('job belongs to another session')
    }
    return record
  }

  get(id, caller) {
    const record = this.#record(id, caller)
    return {
      id: record.id,
      kind: record.kind,
      label: record.label,
      ...(record.owner === undefined ? {} : { ownerSession: record.owner.id }),
      status: record.status,
      ...(record.detail === undefined ? {} : { detail: record.detail }),
      startedAt: record.startedAt,
      ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
      reported: false,
    }
  }

  read(id, caller) {
    const record = this.#record(id, caller)
    return { text: record.hooks.readOutput?.() ?? '', snapshot: this.get(id, caller) }
  }

  kill(id, caller) {
    const record = this.#record(id, caller)
    record.hooks.cancel('test cancellation')
    record.status = 'stopping'
    return 'requested'
  }
}

async function makeFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-execution-'))
  const inputRoot = join(root, 'inputs')
  const runsRoot = join(root, 'runs')
  await mkdir(inputRoot)
  await mkdir(runsRoot, { mode: 0o700 })
  const binRoot = join(root, 'bin')
  await mkdir(binRoot, { mode: 0o700 })
  const miniwdlExecutable = join(binRoot, 'miniwdl')
  const dockerExecutable = join(binRoot, 'docker')
  await writeFile(miniwdlExecutable, '#!/bin/sh\nexit 0\n')
  await writeFile(dockerExecutable, '#!/bin/sh\nexit 0\n')
  await chmod(miniwdlExecutable, 0o755)
  await chmod(dockerExecutable, 0o755)
  const input = join(inputRoot, 'sample.fastq.gz')
  await writeFile(input, '@read\nACGT\n+\n!!!!\n')
  const store = createWorkflowStore()
  const search = await store.search({ source: 'builtin', query: 'fastq' })
  const workflow = search.workflows[0]
  const subprocess = options.subprocess ?? new FakeSubprocess({
    ...options,
    miniwdlExecutable,
    dockerExecutable,
  })
  const jobs = options.jobs === null ? undefined : options.jobs ?? new FakeJobs()
  const manager = createExecutionManager({
    store,
    config: {
      enabled: true,
      runsRoot,
      inputRoots: [inputRoot],
      runner: { executable: miniwdlExecutable, dockerExecutable },
    },
    getSubprocess: () => subprocess,
    getJobs: () => jobs,
    createId: options.createId ?? (() => TEST_UUID),
    now: () => new Date('2026-08-25T12:00:00.000Z'),
    ...(options.persistRecord === undefined ? {} : { persistRecord: options.persistRecord }),
  })
  const request = {
    id: workflow.id,
    version: workflow.version,
    expectedDigest: workflow.digest,
    inputs: { reads: [input], threads: 2 },
  }
  return {
    root,
    inputRoot,
    runsRoot,
    input,
    workflow,
    subprocess,
    jobs,
    manager,
    request,
    miniwdlExecutable,
    dockerExecutable,
  }
}

test('execution config is strict, disabled by default, and requires disjoint dedicated roots', () => {
  assert.deepEqual(parseExecutionConfig(), {
    enabled: false,
    runsRoot: null,
    inputRoots: [],
    runner: { executable: 'miniwdl', dockerExecutable: 'docker' },
  })
  assert.throws(
    () => parseExecutionConfig({ enabled: true }),
    (error) => error instanceof ExecutionConfigValidationError && error.errors.length === 4,
  )
  assert.throws(
    () => parseExecutionConfig({
      enabled: true,
      runsRoot: '/data',
      inputRoots: ['/data/inputs'],
    }),
    /must not overlap/,
  )
  assert.throws(
    () => parseExecutionConfig({ runner: { executable: './miniwdl' } }),
    /absolute path or a bare executable name/,
  )
})

test('execution rejects replaceable runs-root and runner ancestors', async () => {
  const fixture = await makeFixture()
  try {
    await chmod(fixture.root, 0o770)
    const unsafeRoot = await fixture.manager.plan(fixture.request)
    assert.equal(unsafeRoot.error.code, 'runs_root_unsafe')

    await chmod(fixture.root, 0o700)
    await chmod(dirname(fixture.miniwdlExecutable), 0o770)
    const unsafeRunner = await fixture.manager.plan(fixture.request)
    assert.equal(unsafeRunner.error.code, 'miniwdl_executable_unsafe')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('planning binds a built-in bundle, canonical real inputs, and live runner facts', async () => {
  const fixture = await makeFixture()
  try {
    const first = await fixture.manager.plan(fixture.request)
    const second = await fixture.manager.plan(fixture.request)

    assert.equal(first.ok, true)
    assert.equal(first.planDigest, second.planDigest)
    assert.equal(first.plan.workflow.id, 'fastq-qc')
    assert.equal(first.plan.workflow.source, 'builtin')
    assert.equal(first.plan.workflow.bundleDigest, fixture.workflow.digest)
    assert.equal(first.plan.runner.version, '1.15.0')
    assert.equal(first.plan.runner.semanticCheck, 'pass')
    assert.equal(first.plan.runner.containerRuntime.serverVersion, '28.3.2')
    assert.equal(first.plan.inputs.reads[0], await realpath(fixture.input))
    assert.equal(first.plan.inputFileFacts[0].size, '18')
    assert.deepEqual(first.plan.inputSnapshotPolicy, {
      mode: 'run_owned_copy_after_approval',
      totalBytes: '18',
      maxTotalBytes: String(1024 ** 4),
      minimumFreeSpaceReserveBytes: String(512 * 1024 * 1024),
      rejectGrowthDuringCopy: true,
    })
    assert.equal(first.plan.authorization.binding, 'planDigest')
    assert.equal(first.plan.readyToRun, true)
    assert.ok(first.plan.limitations.includes('input_content_not_hashed'))
    assert.equal(fixture.subprocess.spawns.length, 8)

    await writeFile(fixture.input, '@read\nACGTACGT\n+\n!!!!!!!!\n')
    const changed = await fixture.manager.plan(fixture.request)
    assert.notEqual(changed.planDigest, first.planDigest)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('planning fails closed for disabled execution, unsupported workflows, and escaped inputs', async () => {
  const fixture = await makeFixture()
  const outsideRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-outside-'))
  try {
    const outside = join(outsideRoot, 'outside.fastq.gz')
    await writeFile(outside, 'outside')
    const escaped = await fixture.manager.plan({
      ...fixture.request,
      inputs: { ...fixture.request.inputs, reads: [outside] },
    })
    assert.equal(escaped.ok, false)
    assert.equal(escaped.error.code, 'input_path_outside_roots')

    const unsupported = await fixture.manager.plan({
      ...fixture.request,
      id: 'bam-qc',
    })
    assert.equal(unsupported.error.code, 'workflow_execution_unsupported')

    await truncate(fixture.input, (1024 ** 4) + 1)
    const oversized = await fixture.manager.plan(fixture.request)
    assert.equal(oversized.error.code, 'input_snapshot_limit_exceeded')

    const linkedRunId = `run-${TEST_UUID}`
    await symlink(outsideRoot, join(fixture.runsRoot, linkedRunId), 'dir')
    const unsafeRun = await fixture.manager.getRun(linkedRunId, { agent: { id: 'owner-session' } })
    assert.equal(unsafeRun.error.code, 'run_directory_unsafe')

    const disabled = createExecutionManager({ store: createWorkflowStore() })
    const disabledResult = await disabled.plan(fixture.request)
    assert.equal(disabledResult.error.code, 'execution_disabled')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('execution snapshots hostile input names and removes ambient miniwdl and Docker overrides', async () => {
  const fixture = await makeFixture()
  const agent = { id: 'owner-session' }
  const hostileInput = join(fixture.inputRoot, 'sample;$(touch injected).fastq.gz')
  const previousMiniwdlOverride = process.env.MINIWDL__TASK_RUNTIME__COMMAND_PREAMBLE
  const previousDockerHost = process.env.DOCKER_HOST
  const previousPythonPath = process.env.PYTHONPATH
  const previousHome = process.env.HOME
  process.env.MINIWDL__TASK_RUNTIME__COMMAND_PREAMBLE = 'touch /tmp/injected'
  process.env.DOCKER_HOST = 'tcp://unapproved.example:2375'
  process.env.PYTHONPATH = '/tmp/unapproved-python'
  process.env.HOME = '/tmp/unapproved-home'
  try {
    await writeFile(hostileInput, '@read\nACGT\n+\n!!!!\n')
    const request = {
      ...fixture.request,
      inputs: { ...fixture.request.inputs, reads: [hostileInput] },
    }
    const planned = await fixture.manager.plan(request, { agent })
    assert.equal(planned.ok, true)
    assert.deepEqual(planned.plan.runner.containerRuntime.swarm, {
      localNodeState: 'active',
      controlAvailable: true,
      autoInit: false,
    })
    assert.equal(planned.plan.runner.containerRuntime.host, 'unix:///var/run/docker.sock')
    assert.equal(planned.plan.runner.containerRuntime.engineId, 'fake-engine-id')
    assert.equal(planned.plan.runner.environmentPolicy.inheritAmbient, false)
    assert.equal(planned.plan.runner.environmentPolicy.removeAllAmbient, true)
    assert.ok(planned.plan.runner.environmentPolicy.removeAmbientPrefixes.includes('MINIWDL__'))

    const started = await fixture.manager.run({
      ...request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    assert.equal(started.ok, true)
    await fixture.jobs.records.get(started.jobId).settled

    const stagedInputs = await readFile(join(started.runDirectory, 'inputs.json'), 'utf8')
    const config = await readFile(join(started.runDirectory, 'miniwdl.cfg'), 'utf8')
    const stagedWdl = await readFile(join(started.runDirectory, 'wdl', 'main.wdl'), 'utf8')
    assert.doesNotMatch(stagedInputs, /sample;|touch injected/)
    assert.match(stagedInputs, /input-0000\.fastq\.gz/)
    assert.match(config, /auto_init = false/)
    assert.match(config, /memory_limit_multiplier = 1\.0/)
    assert.match(config, /placeholder_regex = \[A-Za-z0-9_/)
    assert.match(stagedWdl, /'~\{read\}'/)

    const runSpawn = fixture.subprocess.spawns.at(-1)
    assert.equal(runSpawn.env.MINIWDL__TASK_RUNTIME__COMMAND_PREAMBLE, undefined)
    assert.equal(runSpawn.env.DOCKER_HOST, 'unix:///var/run/docker.sock')
    assert.equal(runSpawn.env.PYTHONPATH, undefined)
    assert.equal(runSpawn.env.HOME, '/nonexistent')
    assert.equal(runSpawn.env.PATH, '/nonexistent')
    const result = await fixture.manager.getRun(started.runId, { agent })
    assert.match(result.run.inputSnapshots[0].sha256, /^[a-f0-9]{64}$/)
    assert.match(result.run.inputSnapshots[0].stagedPath, /input-0000\.fastq\.gz$/)
  } finally {
    if (previousMiniwdlOverride === undefined) delete process.env.MINIWDL__TASK_RUNTIME__COMMAND_PREAMBLE
    else process.env.MINIWDL__TASK_RUNTIME__COMMAND_PREAMBLE = previousMiniwdlOverride
    if (previousDockerHost === undefined) delete process.env.DOCKER_HOST
    else process.env.DOCKER_HOST = previousDockerHost
    if (previousPythonPath === undefined) delete process.env.PYTHONPATH
    else process.env.PYTHONPATH = previousPythonPath
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('execution rejects an input replaced after approval and requires a job owner', async () => {
  const outsideRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-race-outside-'))
  const outside = join(outsideRoot, 'outside.fastq.gz')
  let inputToReplace
  const fixture = await makeFixture({
    createId: () => {
      unlinkSync(inputToReplace)
      symlinkSync(outside, inputToReplace)
      return TEST_UUID
    },
  })
  const agent = { id: 'owner-session' }
  try {
    inputToReplace = fixture.input
    await writeFile(outside, 'outside')
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const unowned = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    })
    assert.equal(unowned.error.code, 'execution_owner_required')

    const raced = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    assert.equal(raced.error.code, 'input_changed_after_plan')
    assert.equal(fixture.jobs.count, 0)
    assert.deepEqual(await readdir(fixture.runsRoot), [])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('an approved input cannot escape through an intermediate symlink swap', async () => {
  const outsideRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-intermediate-swap-'))
  let nestedDirectory
  let movedDirectory
  const fixture = await makeFixture({
    createId: () => {
      renameSync(nestedDirectory, movedDirectory)
      symlinkSync(outsideRoot, nestedDirectory, 'dir')
      return TEST_UUID
    },
  })
  const agent = { id: 'owner-session' }
  try {
    nestedDirectory = join(fixture.inputRoot, 'nested')
    movedDirectory = join(fixture.inputRoot, 'nested-approved')
    await mkdir(nestedDirectory)
    const nestedInput = join(nestedDirectory, 'sample.fastq.gz')
    renameSync(fixture.input, nestedInput)
    await link(nestedInput, join(outsideRoot, 'sample.fastq.gz'))
    const request = {
      ...fixture.request,
      inputs: { ...fixture.request.inputs, reads: [nestedInput] },
    }
    const planned = await fixture.manager.plan(request, { agent })
    const raced = await fixture.manager.run({
      ...request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    assert.equal(raced.error.code, 'input_changed_after_plan')
    assert.deepEqual(await readdir(fixture.runsRoot), [])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('FIFO inputs and post-approval FIFO replacement fail without blocking', {
  skip: process.platform === 'win32',
}, async (context) => {
  const planningFixture = await makeFixture()
  try {
    const fifo = join(planningFixture.inputRoot, 'stream.fastq.gz')
    try {
      execFileSync('mkfifo', [fifo])
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'ENOENT') {
        context.skip('mkfifo is unavailable in this environment')
        return
      }
      throw error
    }
    const planned = await planningFixture.manager.plan({
      ...planningFixture.request,
      inputs: { ...planningFixture.request.inputs, reads: [fifo] },
    })
    assert.equal(planned.error.code, 'input_path_type')
  } finally {
    await rm(planningFixture.root, { recursive: true, force: true })
  }

  let inputToReplace
  const runFixture = await makeFixture({
    createId: () => {
      unlinkSync(inputToReplace)
      execFileSync('mkfifo', [inputToReplace])
      return TEST_UUID
    },
  })
  const agent = { id: 'owner-session' }
  try {
    inputToReplace = runFixture.input
    const planned = await runFixture.manager.plan(runFixture.request, { agent })
    const raced = await runFixture.manager.run({
      ...runFixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    assert.equal(raced.error.code, 'input_changed_after_plan')
    assert.deepEqual(await readdir(runFixture.runsRoot), [])
  } finally {
    await rm(runFixture.root, { recursive: true, force: true })
  }
})

test('execution requires an existing Swarm manager and never initializes one', async () => {
  const fixture = await makeFixture({ swarmState: 'inactive false' })
  try {
    const planned = await fixture.manager.plan(fixture.request)
    assert.equal(planned.error.code, 'docker_swarm_unavailable')
    assert.equal(
      fixture.subprocess.spawns.some((spawn) => spawn.argv.includes('swarm') && spawn.argv.includes('init')),
      false,
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('post-registration provenance failure cannot hide a live job id', async () => {
  let persistCalls = 0
  const fixture = await makeFixture({
    holdRun: true,
    persistRecord: async (path, value) => {
      persistCalls += 1
      if (persistCalls === 2) throw new Error('simulated full disk')
      await writeFile(path, `${JSON.stringify(value)}\n`)
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    assert.equal(started.ok, true)
    assert.equal(started.jobId, 'bio-1')
    assert.equal(fixture.jobs.get(started.jobId, agent).status, 'running')
    assert.equal(fixture.jobs.kill(started.jobId, agent), 'requested')
    await fixture.jobs.records.get(started.jobId).settled
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('cancellation after preparation prevents background job registration', async () => {
  const controller = new AbortController()
  const fixture = await makeFixture({
    persistRecord: async (path, value) => {
      await writeFile(path, `${JSON.stringify(value)}\n`)
      controller.abort(new Error('cancel before jobs.start'))
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    await assert.rejects(
      fixture.manager.run({
        ...fixture.request,
        expectedPlanDigest: planned.planDigest,
      }, { agent, signal: controller.signal }),
      /cancel before jobs\.start/,
    )
    assert.equal(fixture.jobs.count, 0)
    assert.deepEqual(await readdir(fixture.runsRoot), [])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('a synchronous background-job admission rejection removes all prepared artifacts', async () => {
  const jobs = {
    start() {
      throw new Error('background jobs unavailable: no job controller')
    },
  }
  const fixture = await makeFixture({ jobs })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const rejected = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    assert.equal(rejected.error.code, 'job_start_failed')
    assert.deepEqual(await readdir(fixture.runsRoot), [])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('run-directory replacement during the final runner probe is rejected before job start', async () => {
  const fixture = await makeFixture({
    onSpawn(spec, count) {
      if (count !== 9) return
      const runDirectory = dirname(spec.cwd)
      renameSync(runDirectory, `${runDirectory}.original`)
      mkdirSync(runDirectory, { mode: 0o700 })
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const raced = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    assert.equal(raced.error.code, 'run_directory_changed')
    assert.equal(fixture.jobs.count, 0)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('an approved plan starts a background run and persists terminal provenance', async () => {
  const fixture = await makeFixture()
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })

    assert.equal(started.ok, true)
    assert.equal(started.runId, `run-${TEST_UUID}`)
    assert.equal(started.jobId, 'bio-1')
    assert.deepEqual(
      fixture.subprocess.spawns.at(-1).argv.slice(0, 2),
      [fixture.miniwdlExecutable, 'run'],
    )
    assert.equal(fixture.subprocess.spawns.at(-1).argv.includes('--as-me'), true)
    assert.equal(fixture.subprocess.spawns.at(-1).argv.includes('--no-outside-imports'), true)

    const streamed = fixture.jobs.read(started.jobId, agent)
    assert.match(streamed.text, /workflow running/)
    await fixture.jobs.records.get(started.jobId).settled

    const result = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(result.ok, true)
    assert.equal(result.run.status, 'completed')
    assert.equal(result.run.ownerSession, agent.id)
    assert.equal(result.run.outputInventory.length, 2)
    assert.equal(result.run.outputInventory.every((item) => item.canonicalPath.startsWith(started.runDirectory)), true)
    assert.equal(result.job.status, 'completed')

    const provenancePath = join(started.runDirectory, 'run.json')
    const persisted = JSON.parse(await readFile(provenancePath, 'utf8'))
    assert.equal(persisted.planDigest, planned.planDigest)
    assert.equal(persisted.status, 'completed')
    assert.equal(persisted.command.argv.some((item) => item.includes('<run-directory>')), false)

    persisted.acceptancePadding = 'x'.repeat(3 * 1024 * 1024)
    await writeFile(provenancePath, `${JSON.stringify(persisted)}\n`)
    await rm(fixture.inputRoot, { recursive: true, force: true })
    const durable = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(durable.ok, true)
    assert.equal(durable.run.acceptancePadding.length, 3 * 1024 * 1024)

    const denied = await fixture.manager.getRun(started.runId, { agent: { id: 'another-session' } })
    assert.equal(denied.error.code, 'run_access_denied')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('plan changes are rejected and DSH job cancellation terminates the runner tree', async () => {
  const fixture = await makeFixture({ holdRun: true })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const mismatch = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: `sha256:${'0'.repeat(64)}`,
    }, { agent })
    assert.equal(mismatch.error.code, 'plan_digest_mismatch')

    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    assert.equal(started.ok, true)
    assert.equal(fixture.jobs.kill(started.jobId, agent), 'requested')
    await fixture.jobs.records.get(started.jobId).settled
    assert.equal(fixture.subprocess.terminated, true)

    const result = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(result.run.status, 'killed')
    assert.equal(result.run.exit.signal, 'SIGTERM')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('the real DSH ToolRuntime approves the exact plan and completes the starter lifecycle', async () => {
  const fixture = await makeFixture()
  const approvalRequests = []
  const agent = { id: 'runtime-owner' }
  try {
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {} })
    ctx.provide('subprocess', fixture.subprocess)
    ctx.provide('jobs', fixture.jobs)
    ctx.provide('approval', {
      request: async (requestValue) => {
        approvalRequests.push(requestValue)
        return 'allowed-once'
      },
    })
    const runtime = new ToolRuntime(ctx, { mode: 'native' })
    plugin.apply(ctx, {
      execution: {
        enabled: true,
        runsRoot: fixture.runsRoot,
        inputRoots: [fixture.inputRoot],
        runner: {
          executable: fixture.miniwdlExecutable,
          dockerExecutable: fixture.dockerExecutable,
        },
      },
    })
    const signal = new AbortController().signal
    const planResult = await runtime.execute({
      callId: 'execution-plan',
      name: 'bio_workflows_plan',
      arguments: fixture.request,
      agent,
      signal,
    })
    assert.equal(planResult.isError, false)
    const planned = JSON.parse(planResult.value)
    assert.equal(planned.ok, true)

    const runResult = await runtime.execute({
      callId: 'execution-run',
      name: 'bio_workflows_run',
      arguments: { ...fixture.request, expectedPlanDigest: planned.planDigest },
      agent,
      signal,
    })
    assert.equal(runResult.isError, false)
    const started = JSON.parse(runResult.value)
    assert.equal(started.ok, true)
    assert.equal(approvalRequests.length, 1)
    assert.match(approvalRequests[0].reason, new RegExp(fixture.workflow.digest))
    assert.match(approvalRequests[0].reason, new RegExp(planned.planDigest))

    await fixture.jobs.records.get(started.jobId).settled
    const getResult = await runtime.execute({
      callId: 'execution-get',
      name: 'bio_workflows_run_get',
      arguments: { runId: started.runId },
      agent,
      signal,
    })
    assert.equal(getResult.isError, false)
    const completed = JSON.parse(getResult.value)
    assert.equal(completed.run.status, 'completed')
    assert.equal(completed.run.outputInventory.length, 2)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
