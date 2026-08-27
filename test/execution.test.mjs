import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, symlinkSync, unlinkSync } from 'node:fs'
import {
  access,
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  truncate,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as plugin from 'dsh-bio-workflows'
import {
  BIO_WORKFLOW_RESULT_LIMITS,
  BIO_WORKFLOW_RESULT_SCHEMA_VERSION,
  ExecutionConfigValidationError,
  createExecutionManager,
  parseExecutionConfig,
  validateBioWorkflowResultSemantics,
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
    this.network = null
    this.networkRemoveAttempts = 0
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
    if (spec.argv[1] === 'network' && spec.argv[2] === 'create') {
      const runLabel = spec.argv.find((value) => value.startsWith('dsh.bio-workflows.run-id='))
      this.network = {
        Id: 'a'.repeat(64),
        Name: spec.argv.at(-1),
        Driver: 'overlay',
        Scope: 'swarm',
        Internal: true,
        Attachable: false,
        Ingress: false,
        ConfigOnly: false,
        Labels: {
          'dsh.bio-workflows.managed': 'true',
          'dsh.bio-workflows.run-id': runLabel.split('=', 2)[1],
        },
        Services: {},
      }
      return makeHandle(Promise.resolve({ exitCode: 0, signal: null }), `${this.network.Id}\n`)
    }
    if (spec.argv[1] === 'network' && spec.argv[2] === 'inspect') {
      return makeHandle(
        Promise.resolve({ exitCode: 0, signal: null }),
        `${JSON.stringify(this.network)}\n`,
      )
    }
    if (spec.argv[1] === 'network' && spec.argv[2] === 'rm') {
      this.networkRemoveAttempts += 1
      if (this.networkRemoveAttempts <= (this.options.networkRemoveFailures ?? 0)) {
        return makeHandle(Promise.resolve({ exitCode: 1, signal: null }), '', 'network still in use\n')
      }
      this.network = null
      return makeHandle(Promise.resolve({ exitCode: 0, signal: null }), `${spec.argv[3]}\n`)
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
    const summaryDirectory = join(outputDirectory, 'sample_fastqc')
    const summary = join(summaryDirectory, 'summary.txt')
    await mkdir(summaryDirectory)
    await writeFile(html, '<html>ok</html>')
    await writeFile(zip, 'zip')
    await writeFile(summary, [
      'PASS\tBasic Statistics\tsample.fastq.gz',
      'WARN\tPer base sequence quality\tsample.fastq.gz',
      'FAIL\tAdapter Content\tsample.fastq.gz',
      '',
    ].join('\n'))
    const defaultOutputs = {
      'fastq_qc.html_reports': [html],
      'fastq_qc.zip_reports': [zip],
      'fastq_qc.summary_reports': [summary],
    }
    const outputs = await this.options.onOutputs?.({
      engineDirectory,
      outputDirectory,
      html,
      zip,
      summary,
      defaultOutputs,
    }) ?? defaultOutputs
    await writeFile(join(engineDirectory, 'outputs.json'), JSON.stringify(outputs))
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

  list(caller) {
    return [...this.records.values()]
      .filter((record) => record.owner === undefined || record.owner.id === caller?.id)
      .map((record) => this.get(record.id, caller))
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
  const workflow = search.workflows.find((item) => (
    item.version === (options.workflowVersion ?? '1.1.0')
  ))
  assert.notEqual(workflow, undefined)
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
      ...(options.executionPolicy === undefined ? {} : { policy: options.executionPolicy }),
    },
    getSubprocess: () => subprocess,
    getJobs: () => jobs,
    createId: options.createId ?? (() => TEST_UUID),
    now: options.now ?? (() => new Date('2026-08-25T12:00:00.000Z')),
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
    store,
    workflow,
    subprocess,
    jobs,
    manager,
    request,
    miniwdlExecutable,
    dockerExecutable,
  }
}

function runIdFor(index) {
  return `run-00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function recreateManager(fixture, options = {}) {
  const jobs = options.jobs === null ? undefined : options.jobs ?? fixture.jobs
  return createExecutionManager({
    store: fixture.store,
    config: fixture.manager.config,
    getSubprocess: () => fixture.subprocess,
    getJobs: () => jobs,
    createId: options.createId ?? (() => TEST_UUID),
    now: options.now ?? (() => new Date('2026-08-25T12:30:00.000Z')),
    ...(options.persistRecord === undefined ? {} : { persistRecord: options.persistRecord }),
  })
}

async function writePersistedRun(fixture, overrides = {}) {
  const runId = overrides.runId ?? runIdFor(1)
  const runDirectory = join(fixture.runsRoot, runId)
  await mkdir(runDirectory, { mode: 0o700 })
  const status = overrides.status ?? 'completed'
  const startedAt = overrides.startedAt ?? '2026-08-25T12:00:00.000Z'
  const record = {
    schemaVersion: '1',
    runId,
    jobId: null,
    ownerSession: 'owner-session',
    status,
    startedAt,
    finishedAt: ['completed', 'failed', 'killed', 'interrupted'].includes(status) ? startedAt : null,
    runDirectory,
    planDigest: `sha256:${'2'.repeat(64)}`,
    plan: {
      workflow: {
        id: fixture.workflow.id,
        version: fixture.workflow.version,
        bundleDigest: fixture.workflow.digest,
      },
    },
    pid: null,
    exit: null,
    outputs: null,
    outputInventory: [],
    error: null,
    ...overrides,
  }
  await writeFile(join(runDirectory, 'run.json'), `${JSON.stringify(record, null, 2)}\n`)
  return { record, runDirectory, provenancePath: join(runDirectory, 'run.json') }
}

test('execution config is strict, disabled by default, and requires disjoint dedicated roots', () => {
  assert.equal(BIO_WORKFLOW_RESULT_SCHEMA_VERSION, '1')
  assert.deepEqual(BIO_WORKFLOW_RESULT_LIMITS, {
    maxArtifacts: 1024,
    maxArtifactBytes: '17179869184',
    maxTotalArtifactBytes: '68719476736',
    maxFastqcSummaryBytes: 1024 * 1024,
    maxTotalFastqcSummaryBytes: 8 * 1024 * 1024,
    maxFastqcSummaryLines: 512,
    maxTotalFastqcSummaryLines: 16 * 1024,
    maxFastqcSummaryLineBytes: 4096,
  })
  assert.deepEqual(parseExecutionConfig(), {
    enabled: false,
    runsRoot: null,
    inputRoots: [],
    runner: { executable: 'miniwdl', dockerExecutable: 'docker' },
    policy: {
      inputChecksum: 'metadata',
      networkIsolation: { mode: 'advisory' },
      budgets: {
        maxInputSnapshotBytes: 1024 ** 4,
        maxRunStorageBytes: 2 * (1024 ** 4),
        maxResultArtifactBytes: 16 * (1024 ** 3),
        maxTotalResultArtifactBytes: 64 * (1024 ** 3),
        maxJobOutputBytes: 256 * 1024,
        maxSpillBytes: 16 * 1024 * 1024,
      },
      retention: {
        enabled: false,
        minimumAgeDays: 30,
        retainLatest: 100,
        maxDeletesPerCall: 50,
      },
    },
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
      preApprovalIntegrity: 'metadata',
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

test('strict execution binds pre-approval input content and uses an ephemeral internal network', async () => {
  const fixture = await makeFixture({
    networkRemoveFailures: 1,
    executionPolicy: {
      inputChecksum: 'sha256',
      networkIsolation: { mode: 'ephemeral_internal' },
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    assert.equal(planned.ok, true)
    assert.equal(
      planned.plan.inputFileFacts[0].contentSha256,
      `sha256:${createHash('sha256').update('@read\nACGT\n+\n!!!!\n').digest('hex')}`,
    )
    assert.equal(planned.plan.inputSnapshotPolicy.preApprovalIntegrity, 'sha256')
    assert.equal(planned.plan.runner.securityPolicy.networkIsolation.mode, 'ephemeral_internal_overlay')
    assert.equal(planned.plan.limitations.includes('input_content_not_hashed'), false)
    assert.equal(planned.plan.limitations.includes('container_network_isolation_not_enforced'), false)

    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    assert.equal(started.ok, true)
    await fixture.jobs.records.get(started.jobId).settled

    const completed = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(completed.run.status, 'completed')
    assert.equal(completed.run.networkIsolation.mode, 'ephemeral_internal')
    assert.equal(completed.run.networkIsolation.network.internal, true)
    assert.equal(completed.run.networkIsolation.cleanup, 'removed')
    assert.equal(fixture.subprocess.network, null)
    assert.equal(fixture.subprocess.networkRemoveAttempts, 2)
    const config = await readFile(join(started.runDirectory, 'miniwdl.cfg'), 'utf8')
    assert.match(config, /allow_networks = \["dsh-bio-run-/)
    assert.match(config, /defaults = \{"docker_network":"dsh-bio-run-/)
    assert.equal(
      fixture.subprocess.spawns.some((spawn) => spawn.argv.slice(1, 3).join(' ') === 'network create'),
      true,
    )
    assert.equal(
      fixture.subprocess.spawns.some((spawn) => spawn.argv.slice(1, 3).join(' ') === 'network rm'),
      true,
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('configured execution budgets are plan-bound and fail closed on run storage overflow', async () => {
  const fixture = await makeFixture({
    executionPolicy: {
      budgets: {
        maxInputSnapshotBytes: 1024,
        maxRunStorageBytes: 4096,
        maxResultArtifactBytes: 1024,
        maxTotalResultArtifactBytes: 2048,
        maxJobOutputBytes: 1024,
        maxSpillBytes: 2048,
      },
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    assert.deepEqual(planned.plan.budgets, {
      maxInputSnapshotBytes: '1024',
      maxRunStorageBytes: '4096',
      runStorageEnforcement: 'periodic_allocated_bytes_scan',
      runStorageScanIntervalMs: 1000,
      maxResultArtifactBytes: '1024',
      maxTotalResultArtifactBytes: '2048',
      maxJobOutputBytes: 1024,
      maxSpillBytesPerStream: 2048,
    })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    assert.equal(started.ok, true)
    await fixture.jobs.records.get(started.jobId).settled
    const completed = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(completed.run.status, 'failed')
    assert.equal(completed.run.error.code, 'run_storage_budget_exceeded')
    assert.equal(completed.run.result, null)
    const runSpawn = fixture.subprocess.spawns.find((spawn) => spawn.argv[1] === 'run')
    assert.equal(runSpawn.stdio.stdout.maxBytes, 1024)
    assert.equal(runSpawn.stdio.stdout.spill.maxBytes, 2048)
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
    assert.equal(result.run.result.schemaVersion, '1')
    assert.equal(result.run.result.status, 'completed')
    assert.equal(result.run.result.planDigest, planned.planDigest)
    assert.deepEqual(result.run.result.artifacts.map((group) => group.outputId), [
      'html_reports',
      'zip_reports',
    ])
    assert.equal(
      result.run.result.artifacts[0].items[0].sha256,
      `sha256:${createHash('sha256').update('<html>ok</html>').digest('hex')}`,
    )
    assert.deepEqual(result.run.result.summaries, {})
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

test('fastq-qc 1.2.0 emits checksummed artifacts and a bounded FastQC summary', async () => {
  const fixture = await makeFixture({ workflowVersion: '1.2.0' })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    await fixture.jobs.records.get(started.jobId).settled

    const observed = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(observed.run.status, 'completed')
    assert.equal(observed.run.outputInventory.length, 3)
    assert.deepEqual(observed.run.result.artifacts.map((group) => group.outputId), [
      'html_reports',
      'zip_reports',
      'summary_reports',
    ])
    assert.equal(
      observed.run.result.artifacts.every((group) => (
        group.items.every((item) => /^sha256:[a-f0-9]{64}$/.test(item.sha256))
      )),
      true,
    )
    assert.deepEqual(observed.run.result.summaries.fastqc, {
      schemaVersion: '1',
      reportCount: 1,
      moduleCounts: { pass: 1, warn: 1, fail: 1 },
      reports: [{
        artifact: { outputId: 'summary_reports', ordinal: 0 },
        sample: 'sample.fastq.gz',
        overallStatus: 'fail',
        counts: { pass: 1, warn: 1, fail: 1 },
        modules: [
          { name: 'Basic Statistics', status: 'pass' },
          { name: 'Per base sequence quality', status: 'warn' },
          { name: 'Adapter Content', status: 'fail' },
        ],
      }],
    })
    assert.deepEqual(validateBioWorkflowResultSemantics(observed.run.result), {
      valid: true,
      errors: [],
    })
    const inconsistent = structuredClone(observed.run.result)
    inconsistent.summaries.fastqc.reportCount = 2
    inconsistent.summaries.fastqc.reports[0].overallStatus = 'pass'
    assert.deepEqual(
      validateBioWorkflowResultSemantics(inconsistent).errors.map((error) => error.code),
      ['count_mismatch', 'status_mismatch'],
    )
    const invalidReference = structuredClone(observed.run.result)
    invalidReference.summaries.fastqc.reports[0].artifact.outputId = 'html_reports'
    assert.equal(
      validateBioWorkflowResultSemantics(invalidReference).errors.some(
        (error) => error.code === 'missing_reference',
      ),
      true,
    )
    const duplicateOutput = structuredClone(observed.run.result)
    duplicateOutput.artifacts.push(structuredClone(duplicateOutput.artifacts.at(-1)))
    assert.equal(
      validateBioWorkflowResultSemantics(duplicateOutput).errors.some(
        (error) => error.code === 'duplicate_output',
      ),
      true,
    )
    const aggregateOverflow = structuredClone(observed.run.result)
    aggregateOverflow.summaries = {}
    aggregateOverflow.artifacts = ['first', 'second'].map((outputId) => ({
      outputId,
      type: 'file',
      cardinality: 'many',
      items: Array.from({ length: 600 }, (_, ordinal) => ({ ordinal })),
    }))
    assert.equal(
      validateBioWorkflowResultSemantics(aggregateOverflow).errors.some(
        (error) => error.code === 'aggregate_limit',
      ),
      true,
    )
    const persisted = JSON.parse(await readFile(join(started.runDirectory, 'run.json'), 'utf8'))
    assert.deepEqual(persisted.result, observed.run.result)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('result artifact groups preserve manifest order and many-output array order', async () => {
  const fixture = await makeFixture({
    async onOutputs({ outputDirectory, defaultOutputs }) {
      const first = join(outputDirectory, 'first.html')
      const second = join(outputDirectory, 'second.html')
      await writeFile(first, 'first')
      await writeFile(second, 'second')
      return { ...defaultOutputs, 'fastq_qc.html_reports': [second, first] }
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    await fixture.jobs.records.get(started.jobId).settled
    const observed = await fixture.manager.getRun(started.runId, { agent })
    assert.deepEqual(observed.run.result.artifacts.map((group) => group.outputId), [
      'html_reports',
      'zip_reports',
    ])
    assert.deepEqual(
      observed.run.result.artifacts[0].items.map((item) => [item.ordinal, item.path]),
      [
        [0, join(started.runDirectory, 'engine', 'call-fastqc', 'out', 'second.html')],
        [1, join(started.runDirectory, 'engine', 'call-fastqc', 'out', 'first.html')],
      ],
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('result collection hashes a stable confined miniwdl-style output symlink', async () => {
  const fixture = await makeFixture({
    async onOutputs({ html, outputDirectory }) {
      const target = join(outputDirectory, 'target.html')
      await writeFile(target, '<html>replacement</html>')
      await unlink(html)
      await symlink(target, html)
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    await fixture.jobs.records.get(started.jobId).settled
    const observed = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(observed.run.status, 'completed')
    assert.equal(
      observed.run.result.artifacts[0].items[0].sha256,
      `sha256:${createHash('sha256').update('<html>replacement</html>').digest('hex')}`,
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('result collection rejects an artifact changed while hashing', async () => {
  let keepMutating = true
  let mutation = Promise.resolve()
  const fixture = await makeFixture({
    async onOutputs({ html }) {
      await truncate(html, 256 * 1024 * 1024)
      mutation = (async () => {
        const handle = await open(html, 'r+')
        const byte = Buffer.alloc(1)
        try {
          await new Promise((resolve) => setTimeout(resolve, 25))
          while (keepMutating) {
            await new Promise((resolve) => setImmediate(resolve))
            byte[0] = (byte[0] + 1) % 256
            await handle.write(byte, 0, byte.length, 0)
          }
        } finally {
          await handle.close()
        }
      })()
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    await fixture.jobs.records.get(started.jobId).settled
    keepMutating = false
    await mutation
    const observed = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(observed.run.status, 'failed')
    assert.equal(observed.run.error.code, 'result_collection_failed')
    assert.match(observed.run.error.message, /changed while hashing/)
    assert.equal(observed.run.result, null)
  } finally {
    keepMutating = false
    await mutation.catch(() => {})
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('result collection rejects escaped and oversized declared artifacts', async () => {
  const outsideRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-result-outside-'))
  try {
    for (const unsafe of ['escaped', 'oversized']) {
      const fixture = await makeFixture({
        async onOutputs({ html }) {
          if (unsafe === 'escaped') {
            const target = join(outsideRoot, 'outside.html')
            await writeFile(target, '<html>outside</html>')
            await unlink(html)
            await symlink(target, html)
          } else {
            await truncate(html, Number(16n * 1024n * 1024n * 1024n + 1n))
          }
        },
      })
      const agent = { id: 'owner-session' }
      try {
        const planned = await fixture.manager.plan(fixture.request, { agent })
        const started = await fixture.manager.run({
          ...fixture.request,
          expectedPlanDigest: planned.planDigest,
        }, { agent })
        await fixture.jobs.records.get(started.jobId).settled
        const observed = await fixture.manager.getRun(started.runId, { agent })
        assert.equal(observed.run.status, 'failed', unsafe)
        assert.equal(observed.run.error.code, 'result_collection_failed')
        assert.equal(observed.run.result, null, unsafe)
      } finally {
        await rm(fixture.root, { recursive: true, force: true })
      }
    }
  } finally {
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('result collection rejects a declared FIFO without blocking', {
  skip: process.platform === 'win32',
}, async (context) => {
  let fifoUnavailable = false
  const fixture = await makeFixture({
    async onOutputs({ html }) {
      await unlink(html)
      try {
        execFileSync('mkfifo', [html])
      } catch (error) {
        if (error?.code === 'EPERM' || error?.code === 'ENOENT') {
          fifoUnavailable = true
          return
        }
        throw error
      }
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    await fixture.jobs.records.get(started.jobId).settled
    if (fifoUnavailable) {
      context.skip('mkfifo is unavailable in this environment')
      return
    }
    const observed = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(observed.run.status, 'failed')
    assert.equal(observed.run.error.code, 'result_collection_failed')
    assert.equal(observed.run.result, null)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('result collection rejects aggregate artifact bytes before hashing', async () => {
  const fixture = await makeFixture({
    async onOutputs({ outputDirectory, defaultOutputs }) {
      const htmlReports = []
      for (let index = 0; index < 5; index += 1) {
        const path = join(outputDirectory, `large-${index}.html`)
        await writeFile(path, '')
        await truncate(path, Number(14n * 1024n * 1024n * 1024n))
        htmlReports.push(path)
      }
      return { ...defaultOutputs, 'fastq_qc.html_reports': htmlReports }
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    await fixture.jobs.records.get(started.jobId).settled
    const observed = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(observed.run.status, 'failed')
    assert.equal(observed.run.error.code, 'result_collection_failed')
    assert.match(observed.run.error.message, /aggregate hashing limit/)
    assert.match(fixture.jobs.get(started.jobId, agent).detail, /^result_collection_failed:/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('FastQC parsing rejects aggregate summary bytes before capture', async () => {
  const fixture = await makeFixture({
    workflowVersion: '1.2.0',
    async onOutputs({ outputDirectory, defaultOutputs }) {
      const summaries = []
      for (let index = 0; index < 9; index += 1) {
        const path = join(outputDirectory, `summary-${index}.txt`)
        await writeFile(path, '')
        await truncate(path, 1024 * 1024)
        summaries.push(path)
      }
      return { ...defaultOutputs, 'fastq_qc.summary_reports': summaries }
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    await fixture.jobs.records.get(started.jobId).settled
    const observed = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(observed.run.status, 'failed')
    assert.equal(observed.run.error.code, 'result_collection_failed')
    assert.match(observed.run.error.message, /aggregate parser limit/)
    assert.equal(observed.run.result, null)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('result collection rejects more than 1024 declared artifacts', async () => {
  const fixture = await makeFixture({
    async onOutputs({ html, defaultOutputs }) {
      return { ...defaultOutputs, 'fastq_qc.html_reports': Array(1025).fill(html) }
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const planned = await fixture.manager.plan(fixture.request, { agent })
    const started = await fixture.manager.run({
      ...fixture.request,
      expectedPlanDigest: planned.planDigest,
    }, { agent })
    await fixture.jobs.records.get(started.jobId).settled
    const observed = await fixture.manager.getRun(started.runId, { agent })
    assert.equal(observed.run.status, 'failed')
    assert.equal(observed.run.error.code, 'result_collection_failed')
    assert.match(observed.run.error.message, /1024 artifact limit/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('FastQC summary parsing rejects malformed, control, non-UTF-8, and oversized text', async () => {
  for (const unsafe of ['malformed', 'control', 'invalid_utf8', 'oversized']) {
    const fixture = await makeFixture({
      workflowVersion: '1.2.0',
      async onOutputs({ summary }) {
        if (unsafe === 'malformed') await writeFile(summary, 'MAYBE\tBasic Statistics\tsample.fastq.gz\n')
        else if (unsafe === 'control') await writeFile(summary, 'PASS\tBasic\u0000 Statistics\tsample.fastq.gz\n')
        else if (unsafe === 'invalid_utf8') await writeFile(summary, Buffer.from([0xff]))
        else await truncate(summary, 1024 * 1024 + 1)
      },
    })
    const agent = { id: 'owner-session' }
    try {
      const planned = await fixture.manager.plan(fixture.request, { agent })
      const started = await fixture.manager.run({
        ...fixture.request,
        expectedPlanDigest: planned.planDigest,
      }, { agent })
      await fixture.jobs.records.get(started.jobId).settled
      const observed = await fixture.manager.getRun(started.runId, { agent })
      assert.equal(observed.run.status, 'failed', unsafe)
      assert.equal(observed.run.error.code, 'result_collection_failed', unsafe)
      assert.equal(observed.run.result, null, unsafe)
    } finally {
      await rm(fixture.root, { recursive: true, force: true })
    }
  }
})

test('retention cleanup previews and deletes only exact old owner-scoped terminal runs', async () => {
  const fixture = await makeFixture({
    executionPolicy: {
      retention: {
        enabled: true,
        minimumAgeDays: 30,
        retainLatest: 1,
        maxDeletesPerCall: 2,
      },
    },
  })
  const agent = { id: 'owner-session' }
  try {
    const newest = await writePersistedRun(fixture, {
      runId: runIdFor(30),
      startedAt: '2026-08-20T12:00:00.000Z',
      finishedAt: '2026-08-20T12:00:00.000Z',
    })
    const oldA = await writePersistedRun(fixture, {
      runId: runIdFor(31),
      startedAt: '2026-05-01T12:00:00.000Z',
      finishedAt: '2026-05-01T12:00:00.000Z',
    })
    const oldB = await writePersistedRun(fixture, {
      runId: runIdFor(32),
      startedAt: '2026-06-01T12:00:00.000Z',
      finishedAt: '2026-06-01T12:00:00.000Z',
    })
    const otherOwner = await writePersistedRun(fixture, {
      runId: runIdFor(33),
      ownerSession: 'other-owner',
      startedAt: '2026-04-01T12:00:00.000Z',
      finishedAt: '2026-04-01T12:00:00.000Z',
    })

    const planned = await fixture.manager.cleanupPlan({ agent })
    assert.equal(planned.ok, true)
    assert.deepEqual(
      planned.plan.candidates.map((candidate) => candidate.runId),
      [oldA.record.runId, oldB.record.runId],
    )
    assert.equal((await access(oldA.runDirectory).then(() => true)), true)

    const mismatched = await fixture.manager.cleanupRuns({
      expectedCleanupPlanDigest: `sha256:${'f'.repeat(64)}`,
    }, { agent })
    assert.equal(mismatched.error.code, 'cleanup_plan_digest_mismatch')

    const cleaned = await fixture.manager.cleanupRuns({
      expectedCleanupPlanDigest: planned.cleanupPlanDigest,
    }, { agent })
    assert.equal(cleaned.ok, true)
    assert.deepEqual(cleaned.removedRunIds, [oldA.record.runId, oldB.record.runId])
    await assert.rejects(access(oldA.runDirectory), /ENOENT/)
    await assert.rejects(access(oldB.runDirectory), /ENOENT/)
    await access(newest.runDirectory)
    await access(otherOwner.runDirectory)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('durable run history is owner-scoped, newest-first, filtered, and cursor-paginated', async () => {
  const fixture = await makeFixture()
  const owner = { id: 'owner-session' }
  const otherOwner = { id: 'other-session' }
  try {
    for (let index = 1; index <= 51; index += 1) {
      await writePersistedRun(fixture, {
        runId: runIdFor(index),
        startedAt: new Date(Date.parse('2026-08-25T12:00:00.000Z') + index * 1000).toISOString(),
      })
    }
    const otherRun = await writePersistedRun(fixture, {
      runId: runIdFor(999),
      ownerSession: otherOwner.id,
      startedAt: '2026-08-25T13:00:00.000Z',
    })

    const first = await fixture.manager.listRuns({ status: 'completed' }, { agent: owner })
    assert.equal(first.ok, true)
    assert.equal(first.count, 50)
    assert.equal(first.pageSize, 50)
    assert.equal(first.runs[0].runId, runIdFor(51))
    assert.equal(first.runs.some((run) => run.runId === otherRun.record.runId), false)
    assert.equal(first.nextCursor, runIdFor(2))
    assert.equal(first.truncated, false)

    const second = await fixture.manager.listRuns({
      status: 'completed',
      cursor: first.nextCursor,
    }, { agent: owner })
    assert.equal(second.count, 1)
    assert.equal(second.runs[0].runId, runIdFor(1))
    assert.equal(second.nextCursor, null)
    const historical = await fixture.manager.getRun(runIdFor(1), { agent: owner })
    assert.equal(historical.ok, true)
    assert.equal(Object.hasOwn(historical.run, 'result'), false)

    const isolated = await fixture.manager.listRuns({}, { agent: otherOwner })
    assert.deepEqual(isolated.runs.map((run) => run.runId), [otherRun.record.runId])
    const foreignCursor = await fixture.manager.listRuns({
      cursor: otherRun.record.runId,
    }, { agent: owner })
    assert.equal(foreignCursor.error.code, 'invalid_run_cursor')
    const invalid = await fixture.manager.listRuns({ unexpected: true }, { agent: owner })
    assert.equal(invalid.error.code, 'invalid_run_list_request')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('persisted non-terminal runs reconcile to interrupted without retrying or signaling a PID', async () => {
  const fixture = await makeFixture()
  const owner = { id: 'owner-session' }
  try {
    const persistedRun = await writePersistedRun(fixture, {
      runId: runIdFor(101),
      status: 'running',
      jobId: 'bio-77',
      pid: 987654,
    })
    const restarted = recreateManager(fixture)
    const result = await restarted.getRun(persistedRun.record.runId, { agent: owner })
    assert.equal(result.ok, true)
    assert.equal(result.run.status, 'interrupted')
    assert.equal(result.run.pid, 987654)
    assert.equal(result.run.error.code, 'run_interrupted')
    assert.equal(result.reconciliation.status, 'interrupted')
    assert.deepEqual(result.run.reconciliation, {
      status: 'interrupted',
      observedAt: '2026-08-25T12:30:00.000Z',
      previousStatus: 'running',
      reason: 'owner_job_missing_after_runtime_restart',
      automaticRetry: false,
      processSignalAttempted: false,
    })
    assert.equal(fixture.subprocess.terminated, false)

    const durable = JSON.parse(await readFile(persistedRun.provenancePath, 'utf8'))
    assert.equal(durable.status, 'interrupted')
    assert.equal(durable.finishedAt, '2026-08-25T12:30:00.000Z')
    const secondStaleRun = await writePersistedRun(fixture, {
      runId: runIdFor(102),
      status: 'stopping',
      jobId: 'bio-78',
    })
    const listed = await restarted.listRuns({ status: 'interrupted' }, { agent: owner })
    assert.equal(listed.reconciledCount, 1)
    assert.deepEqual(listed.runs.map((run) => run.runId), [
      secondStaleRun.record.runId,
      persistedRun.record.runId,
    ])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('restart reconciliation requires an exact owner job label and rejects a reused job id', async () => {
  const fixture = await makeFixture()
  const owner = { id: 'owner-session' }
  try {
    const liveRun = await writePersistedRun(fixture, {
      runId: runIdFor(201),
      status: 'running',
      jobId: 'bio-1',
    })
    const pending = new Promise(() => {})
    assert.equal(fixture.jobs.start({
      kind: 'bio',
      label: `${fixture.workflow.id}@${fixture.workflow.version} ${liveRun.record.runId}`,
      owner,
      run: () => ({ done: pending, cancel() {} }),
    }), 'bio-1')
    const restarted = recreateManager(fixture)
    const live = await restarted.getRun(liveRun.record.runId, { agent: owner })
    assert.equal(live.run.status, 'running')
    assert.equal(live.job.id, 'bio-1')
    assert.equal(live.reconciliation.status, 'live_job_found')

    const reusedId = await writePersistedRun(fixture, {
      runId: runIdFor(202),
      status: 'running',
      jobId: 'bio-1',
    })
    const interrupted = await restarted.getRun(reusedId.record.runId, { agent: owner })
    assert.equal(interrupted.run.status, 'interrupted')
    assert.equal(interrupted.job, null)
    assert.equal(interrupted.reconciliation.status, 'interrupted')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('unavailable job discovery leaves persisted non-terminal provenance unchanged', async () => {
  const fixture = await makeFixture()
  const owner = { id: 'owner-session' }
  try {
    const persistedRun = await writePersistedRun(fixture, {
      runId: runIdFor(301),
      status: 'prepared',
      jobId: null,
    })
    const restarted = recreateManager(fixture, { jobs: null })
    const result = await restarted.getRun(persistedRun.record.runId, { agent: owner })
    assert.equal(result.run.status, 'prepared')
    assert.deepEqual(result.reconciliation, {
      status: 'unavailable',
      reason: 'jobs_service_unavailable',
    })
    const unchanged = JSON.parse(await readFile(persistedRun.provenancePath, 'utf8'))
    assert.equal(unchanged.status, 'prepared')
    assert.equal(Object.hasOwn(unchanged, 'reconciliation'), false)
    const listed = await restarted.listRuns({}, { agent: owner })
    assert.equal(listed.reconciliationUnavailable, true)
    assert.equal(listed.runs[0].reconciliationStatus, 'unavailable')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('reconciliation persistence failures never report an in-memory interrupted state as durable', async () => {
  const fixture = await makeFixture()
  const owner = { id: 'owner-session' }
  try {
    const persistedRun = await writePersistedRun(fixture, {
      runId: runIdFor(302),
      status: 'running',
      jobId: 'bio-99',
    })
    const restarted = recreateManager(fixture, {
      persistRecord: async () => { throw new Error('simulated read-only filesystem') },
    })
    const result = await restarted.getRun(persistedRun.record.runId, { agent: owner })
    assert.equal(result.error.code, 'run_reconciliation_failed')
    const listed = await restarted.listRuns({}, { agent: owner })
    assert.equal(listed.runs[0].status, 'running')
    assert.equal(listed.runs[0].reconciliationStatus, 'failed')
    assert.ok(listed.diagnostics.some((item) => item.code === 'run_reconciliation_failed'))
    const unchanged = JSON.parse(await readFile(persistedRun.provenancePath, 'utf8'))
    assert.equal(unchanged.status, 'running')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('run discovery skips unsafe and oversized records with bounded diagnostics', async () => {
  const fixture = await makeFixture()
  const outsideRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-run-list-outside-'))
  const owner = { id: 'owner-session' }
  try {
    const valid = await writePersistedRun(fixture, { runId: runIdFor(401) })
    const oversized = await writePersistedRun(fixture, { runId: runIdFor(402) })
    await truncate(oversized.provenancePath, 32 * 1024 * 1024 + 1)
    await symlink(outsideRoot, join(fixture.runsRoot, runIdFor(403)), 'dir')
    const withinBudget = await writePersistedRun(fixture, {
      runId: runIdFor(404),
      acceptancePadding: 'x'.repeat(17 * 1024 * 1024),
    })
    await writePersistedRun(fixture, {
      runId: runIdFor(405),
      acceptancePadding: 'x'.repeat(17 * 1024 * 1024),
    })

    const result = await fixture.manager.listRuns({}, { agent: owner })
    assert.equal(result.ok, true)
    assert.deepEqual(result.runs.map((run) => run.runId), [
      withinBudget.record.runId,
      valid.record.runId,
    ])
    assert.equal(result.truncated, true)
    assert.ok(result.diagnostics.some((item) => (
      item.code === 'run_record_unreadable' && item.count === 2
    )))
    assert.ok(result.diagnostics.some((item) => item.code === 'run_discovery_budget_exceeded'))
    assert.equal(result.diagnostics.some((item) => JSON.stringify(item).includes(outsideRoot)), false)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('plan changes are rejected and DSH job cancellation terminates the runner tree', async () => {
  const fixture = await makeFixture({ holdRun: true })
  const agent = { id: 'owner-session' }
  try {
    const historical = await writePersistedRun(fixture, {
      runId: runIdFor(500),
      startedAt: '2026-08-25T11:00:00.000Z',
    })
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
    const active = await fixture.manager.listRuns({}, { agent })
    assert.equal(active.reconciledCount, 0)
    assert.equal(active.runs[0].runId, started.runId)
    assert.equal(active.runs[0].reconciliationStatus, 'active')
    assert.equal(active.runs[1].runId, historical.record.runId)
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
    const listResult = await runtime.execute({
      callId: 'execution-list',
      name: 'bio_workflows_run_list',
      arguments: { status: 'completed' },
      agent,
      signal,
    })
    assert.equal(listResult.isError, false)
    const history = JSON.parse(listResult.value)
    assert.deepEqual(history.runs.map((run) => run.runId), [started.runId])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
