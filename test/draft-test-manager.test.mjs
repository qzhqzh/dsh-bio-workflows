import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { computeDraftContentDigest } from '../src/draft-store.js'
import { computeDraftTestDigest } from '../src/draft-test-contract.js'
import { createDraftTestManager } from '../src/draft-test-manager.js'

const TASK_IMAGE = `python@sha256:${'a'.repeat(64)}`
const SUPPORT_IMAGE = `python@sha256:${'b'.repeat(64)}`
const MISSION_ID = 'mission-11111111-1111-4111-8111-111111111111'
const DRAFT_ID = 'draft-22222222-2222-4222-8222-222222222222'
const TEST_UUID = '33333333-3333-4333-8333-333333333333'
const RESTART_UUID = '44444444-4444-4444-8444-444444444444'
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures', import.meta.url))
const TRUE_BYTES = await readFile('/bin/true')
const TRUE_LAUNCH = await lstat('/bin/true', { bigint: true })
const TRUE_CANONICAL_PATH = await realpath('/bin/true')
const TRUE_CANONICAL = await lstat(TRUE_CANONICAL_PATH, { bigint: true })
const FIXTURE_RUNNER_PATH = fileURLToPath(new URL('../runner/dsh_fixture_runner.py', import.meta.url))
const FIXTURE_RUNNER_BYTES = await readFile(FIXTURE_RUNNER_PATH)

function digest(character) {
  return `sha256:${character.repeat(64)}`
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function runnerDigest(value, domain) {
  return `sha256:${createHash('sha256')
    .update(`dsh-bio-fixture-runner-${domain}-v1\n${stableStringify(value)}`, 'utf8')
    .digest('hex')}`
}

async function executableFixtureIdentity(path) {
  const bytes = await readFile(path)
  const launch = await lstat(path, { bigint: true })
  const canonicalPath = await realpath(path)
  const canonical = await lstat(canonicalPath, { bigint: true })
  return {
    launchPathDigest: `sha256:${createHash('sha256').update(path).digest('hex')}`,
    canonicalPathDigest: `sha256:${createHash('sha256').update(canonicalPath).digest('hex')}`,
    launchDevice: launch.dev.toString(),
    launchInode: launch.ino.toString(),
    launchMode: (launch.mode & 0o7777n).toString(8),
    launchSizeBytes: Number(launch.size),
    launchMtimeNs: launch.mtimeNs.toString(),
    launchCtimeNs: launch.ctimeNs.toString(),
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    sizeBytes: bytes.length,
    device: canonical.dev.toString(),
    inode: canonical.ino.toString(),
    uid: canonical.uid.toString(),
    mode: (canonical.mode & 0o777n).toString(8).padStart(3, '0'),
    mtimeNs: canonical.mtimeNs.toString(),
    ctimeNs: canonical.ctimeNs.toString(),
  }
}

function fakeControllerIdentity(pid = 4321) {
  return {
    schemaVersion: '1',
    pid,
    startTimeTicks: '123456',
    processGroupId: pid,
    sessionId: pid,
    uid: String(process.getuid()),
    bootIdDigest: digest('1'),
    executablePathDigest: digest('2'),
    commandLineDigest: digest('3'),
  }
}

class StaticReader {
  constructor(text = '') {
    this.text = text
  }

  readFrom(offset) {
    const bytes = Buffer.from(this.text, 'utf8')
    return {
      text: bytes.subarray(offset).toString('utf8'),
      nextOffset: bytes.length,
      lossy: false,
    }
  }
}

function makeRunnerIdentity() {
  const executable = {
    launchPathDigest: `sha256:${createHash('sha256').update('/bin/true').digest('hex')}`,
    canonicalPathDigest: `sha256:${createHash('sha256').update(TRUE_CANONICAL_PATH).digest('hex')}`,
    launchDevice: TRUE_LAUNCH.dev.toString(),
    launchInode: TRUE_LAUNCH.ino.toString(),
    launchMode: (TRUE_LAUNCH.mode & 0o7777n).toString(8),
    launchSizeBytes: Number(TRUE_LAUNCH.size),
    launchMtimeNs: TRUE_LAUNCH.mtimeNs.toString(),
    launchCtimeNs: TRUE_LAUNCH.ctimeNs.toString(),
    sha256: `sha256:${createHash('sha256').update(TRUE_BYTES).digest('hex')}`,
    sizeBytes: TRUE_BYTES.length,
    device: TRUE_CANONICAL.dev.toString(),
    inode: TRUE_CANONICAL.ino.toString(),
    uid: TRUE_CANONICAL.uid.toString(),
    mode: (TRUE_CANONICAL.mode & 0o777n).toString(8).padStart(3, '0'),
    mtimeNs: TRUE_CANONICAL.mtimeNs.toString(),
    ctimeNs: TRUE_CANONICAL.ctimeNs.toString(),
  }
  const controllerEnvironment = {
    HOME: '$RUN/controller-home',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  }
  const controllerNetworkBasis = {
    policy: 'seccomp_deny_non_unix_sockets_before_wdl_load',
    architecture: 'x86_64',
    auditArchitecture: '0xc000003e',
    socketSyscall: 41,
    seccompSyscall: 317,
    allowedSocketDomain: 'AF_UNIX',
    deniedAction: 'errno:EPERM',
    noNewPrivileges: true,
    threadSynchronization: 'SECCOMP_FILTER_FLAG_TSYNC',
  }
  const distributions = [{
    name: 'miniwdl',
    version: '1.15.0',
    fileCount: 1,
    sizeBytes: 1,
    digest: digest('6'),
  }]
  const startupPolicy = {
    mode: 'python_isolated_no_site',
    dontWriteBytecode: true,
    ignoreEnvironment: true,
    noUserSite: true,
    pthFilesExecuted: false,
    sitecustomizeImported: false,
    usercustomizeImported: false,
    sitePackagesPathDigest: digest('7'),
  }
  return {
    internal: {
      pythonPath: '/bin/true',
      dockerPath: '/bin/true',
      wrapperPath: '/bin/true',
    },
    public: {
      backend: 'dsh_fixture_docker',
      policyVersion: '1',
      miniwdlVersion: '1.15.0',
      pythonVersion: '3.13.0',
      controller: {
        uid: process.getuid(),
        gid: process.getgid(),
        network: {
          ...controllerNetworkBasis,
          filterDigest: runnerDigest(controllerNetworkBasis, 'controller-network-filter'),
        },
        environment: {
          policy: 'exact_allowlist',
          allowedKeys: ['HOME', 'LANG', 'LC_ALL', 'TMPDIR'],
          nonEmptyKeys: ['HOME', 'LANG', 'LC_ALL', 'TMPDIR'],
          credentialLikeKeys: [],
          environmentDigest: runnerDigest(controllerEnvironment, 'controller-environment'),
        },
        limits: {
          residentMemoryBytes: 512 * 1024 * 1024,
          virtualAddressSpaceBytes: 512 * 1024 * 1024,
          cpuSeconds: 300,
          additionalProcesses: 64,
          openFiles: 256,
          fileBytes: 64 * 1024 * 1024,
          wallTimeMs: 300_000,
        },
        dockerBroker: {
          networkFilterDigest: runnerDigest(controllerNetworkBasis, 'controller-network-filter'),
          kernelEnforced: true,
          threadSynchronized: true,
          limits: {
            virtualAddressSpaceBytes: 4 * 1024 * 1024 * 1024,
            cpuSeconds: 300,
            additionalProcesses: 128,
            openFiles: 256,
            fileBytes: 64 * 1024 * 1024,
          },
        },
      },
      pythonEnvironment: {
        startupPolicy,
        distributions,
        environmentDigest: runnerDigest({ startupPolicy, distributions }, 'python-environment'),
      },
      executables: { python: executable, docker: executable, wrapper: executable },
      docker: {
        engineId: 'test-engine',
        serverVersion: '29.3.1',
        cgroupVersion: '2',
        securityOptions: ['name=apparmor', 'name=seccomp,profile=builtin'],
      },
      taskImage: { reference: TASK_IMAGE, imageId: digest('d') },
      supportImage: { reference: SUPPORT_IMAGE, imageId: digest('e') },
      supportContainerLimits: { cpu: 1, memoryBytesMaximum: 134217728, pidsMaximum: 16 },
    },
  }
}

function sourceDraft() {
  const main = `version 1.0

task copy_file {
  input { File source }
  command <<<cp "~{source}" result.txt>>>
  output { File copy = "result.txt" }
  runtime { docker: "${TASK_IMAGE}" }
}

workflow roundtrip {
  input { File source }
  call copy_file { input: source = source }
  output { File copy = copy_file.copy }
}
`
  const files = [{ path: 'main.wdl', role: 'workflow', content: main }]
  const contentDigest = computeDraftContentDigest(files)
  return {
    ok: true,
    metadata: {
      schemaVersion: '1',
      draftId: DRAFT_ID,
      workflow: { id: 'roundtrip', version: '0.1.0', name: 'Round trip', summary: 'Copy fixture.' },
      entrypoint: 'main.wdl',
      languageVersion: '1.0',
      createdAt: '2026-08-27T12:00:00.000Z',
    },
    snapshot: {
      schemaVersion: '1',
      draftId: DRAFT_ID,
      revision: 1,
      contentDigest,
      files,
    },
    executionAuthorized: false,
  }
}

function stores() {
  const draft = sourceDraft()
  const mission = {
    ok: true,
    schemaVersion: '1',
    missionId: MISSION_ID,
    status: 'ready',
    phase: 'validated',
    planDigest: digest('1'),
    goal: {
      software: { name: 'copy', version: '1.0.0', containerImage: TASK_IMAGE },
      objective: 'Copy the exact fixture.',
      acceptanceCriteria: ['Output bytes match the fixture.'],
    },
    draft: { draftId: DRAFT_ID, revision: 1, contentDigest: draft.snapshot.contentDigest },
    lastValidation: {
      revision: 1,
      contentDigest: draft.snapshot.contentDigest,
      validationDigest: digest('2'),
      valid: true,
    },
  }
  return {
    missionStore: {
      async get(missionId, operation) {
        return missionId === MISSION_ID && operation.ownerSession === 'owner-session'
          ? structuredClone(mission)
          : { ok: false, error: { code: 'mission_not_found', message: 'not found' } }
      },
    },
    draftStore: {
      config: { root: null },
      async resolve(options, operation) {
        assert.deepEqual(options, { draftId: DRAFT_ID, revision: 1 })
        assert.equal(operation.ownerSession, 'owner-session')
        return structuredClone(draft)
      },
    },
  }
}

const PROBES = [
  ['ambient_credentials_absent', true],
  ['bridge_gateway', 101],
  ['cap_eff', '0000000000000000'],
  ['credential_paths_absent', true],
  ['docker_socket_absent', true],
  ['egress', 101],
  ['fixture_matches', true],
  ['fixture_sha256', digest('f')],
  ['host_canary_connections', 1],
  ['host_loopback', 111],
  ['interfaces', '["lo"]'],
  ['loopback_positive', true],
  ['no_new_privs', '1'],
  ['root_write', 30],
  ['tmpfs_write', true],
].map(([id, value]) => ({ id, status: 'passed', expected: value, observed: value }))

function taskContainerControls() {
  const uid = process.getuid()
  const gid = process.getgid()
  const storage = {
    driver: 'local',
    scope: 'local',
    type: 'tmpfs',
    device: 'tmpfs',
    sizeBytes: 64 * 1024 * 1024,
    uid,
    gid,
    mode: '0700',
  }
  return {
    networkMode: 'none',
    readonlyRootfs: true,
    capDrop: ['ALL'],
    securityOpt: ['apparmor=docker-default', 'no-new-privileges=true', 'seccomp=builtin'],
    pidsLimit: 64,
    nanoCpus: 1_000_000_000,
    memory: 512 * 1024 * 1024,
    memorySwap: 512 * 1024 * 1024,
    ipcMode: 'none',
    pidMode: '',
    cgroupnsMode: 'private',
    devices: 0,
    deviceRequests: 0,
    supplementaryGroups: 0,
    logDriver: 'none',
    apparmorProfile: 'docker-default',
    environment: {
      GPG_KEY: '',
      HOME: '/tmp/home',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      PYTHON_SHA256: '',
      PYTHON_VERSION: '',
      TMPDIR: '/tmp',
    },
    tmpfs: {
      '/tmp': `rw,nosuid,nodev,noexec,size=${16 * 1024 * 1024},uid=${uid},gid=${gid},mode=0700`,
    },
    ulimits: [
      { name: 'fsize', soft: 16 * 1024 * 1024, hard: 16 * 1024 * 1024 },
      { name: 'nofile', soft: 256, hard: 256 },
    ],
    mounts: [
      {
        type: 'bind',
        destination: '/mnt/miniwdl_task_container/command',
        rw: false,
        propagation: 'rprivate',
      },
      {
        type: 'bind',
        destination: '/mnt/miniwdl_task_container/inputs/message.txt',
        rw: false,
        propagation: 'rprivate',
      },
      {
        type: 'volume',
        destination: '/mnt/miniwdl_task_container',
        rw: true,
        propagation: '',
      },
    ],
    outputStorageDigest: runnerDigest(storage, 'output-storage'),
  }
}

class FakeSubprocess {
  constructor({ hold = false, evidenceMutator = null, evidenceText = null } = {}) {
    this.hold = hold
    this.evidenceMutator = evidenceMutator
    this.evidenceText = evidenceText
    this.spawns = []
  }

  async resolveExecutable(value) {
    return value
  }

  spawn(spec) {
    this.spawns.push(spec)
    if (['container', 'volume'].includes(spec.argv[1])) {
      return {
        pid: 4320,
        collected: { stdout: new StaticReader(''), stderr: new StaticReader('') },
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate() {},
        waitForExit: async () => true,
      }
    }
    let settle
    const done = this.hold
      ? new Promise((resolvePromise) => { settle = resolvePromise })
      : this.#complete(spec)
    return {
      pid: 4321,
      collected: {
        stdout: new StaticReader('{"message":"isolated"}\n'),
        stderr: new StaticReader(''),
      },
      done,
      terminate: () => {
        settle?.({ exitCode: null, signal: 'SIGTERM' })
      },
      waitForExit: async () => true,
    }
  }

  async #complete(spec) {
    const engineArgument = spec.argv[spec.argv.indexOf('--dir') + 1]
    const engine = resolve(engineArgument.endsWith(`${sep}.`) ? engineArgument.slice(0, -2) : engineArgument)
    const outputDirectory = join(engine, 'call-copy_file', 'work')
    await mkdir(outputDirectory, { recursive: true })
    const output = join(outputDirectory, 'result.txt')
    await writeFile(output, 'fixture input\n')
    await writeFile(join(engine, 'outputs.json'), JSON.stringify({ 'roundtrip.copy': output }))

    const daemon = {
      engineId: 'test-engine',
      serverVersion: '29.3.1',
      cgroupVersion: '2',
      securityOptions: ['name=apparmor', 'name=seccomp,profile=builtin'],
    }
    const probeBasis = {
      policyVersion: '1',
      daemon,
      supportImage: { reference: SUPPORT_IMAGE, imageId: digest('e') },
      containerConfigDigest: digest('3'),
      probes: PROBES,
    }
    const taskBasis = {
      type: 'task',
      task: 'call-copy_file',
      taskOrdinal: 1,
      image: TASK_IMAGE,
      imageId: digest('d'),
      containerConfigDigest: digest('4'),
      containerControls: taskContainerControls(),
      outputManifestDigest: digest('5'),
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      ambiguous: false,
    }
    const configPath = spec.argv[spec.argv.indexOf('--cfg') + 1]
    const configText = await readFile(configPath, 'utf8')
    const selected = (key) => configText.match(new RegExp(`^${key} = (.+)$`, 'm'))?.[1]
    const controllerBasis = {
      testId: selected('test_id'),
      planDigest: selected('plan_digest'),
      network: {
        policy: 'seccomp_deny_non_unix_sockets_before_wdl_load',
        architecture: 'x86_64',
        filterDigest: selected('controller_network_filter_digest'),
        kernelEnforced: true,
        threadSynchronized: true,
        outboundDenied: true,
        nameResolutionDenied: true,
        hostCanaryConnections: 1,
      },
      environment: {
        keys: ['HOME', 'LANG', 'LC_ALL', 'TMPDIR'],
        nonEmptyKeys: ['HOME', 'LANG', 'LC_ALL', 'TMPDIR'],
        credentialLikeKeys: [],
        environmentDigest: selected('controller_environment_digest'),
      },
      limits: {
        addressSpace: { soft: 512 * 1024 * 1024, hard: 512 * 1024 * 1024 },
        residentMemory: { maximumBytes: 512 * 1024 * 1024, enforcement: 'rlimit_as_hard_with_proc_rss_watchdog', intervalMs: 5 },
        cpuSeconds: { soft: 300, hard: 300 },
        processes: { soft: 164, hard: 164 },
        openFiles: { soft: 256, hard: 256 },
        fileBytes: { soft: 64 * 1024 * 1024, hard: 64 * 1024 * 1024 },
      },
      processBaseline: 100,
      runtimeEnvironmentDigest: selected('runtime_environment_digest'),
      wrapperDigest: selected('wrapper_digest'),
      dockerBroker: {
        networkFilterDigest: selected('controller_network_filter_digest'),
        kernelEnforced: true,
        threadSynchronized: true,
        limits: {
          addressSpace: { soft: 4 * 1024 * 1024 * 1024, hard: 4 * 1024 * 1024 * 1024 },
          cpuSeconds: { soft: 300, hard: 300 },
          processes: { soft: 229, hard: 229 },
          openFiles: { soft: 256, hard: 256 },
          fileBytes: { soft: 64 * 1024 * 1024, hard: 64 * 1024 * 1024 },
        },
        processBaseline: 101,
      },
    }
    this.evidenceMutator?.({ probe: probeBasis, task: taskBasis })
    taskBasis.containerControlsDigest = runnerDigest(taskBasis.containerControls, 'container-controls')
    const evidence = this.evidenceText ?? [
      JSON.stringify({ type: 'controller_guard', ...controllerBasis, controllerGuardDigest: runnerDigest(controllerBasis, 'controller-guard') }),
      JSON.stringify({ type: 'isolation_probe', ...probeBasis, probeDigest: runnerDigest(probeBasis, 'probe') }),
      JSON.stringify({ ...taskBasis, eventDigest: runnerDigest(taskBasis, 'task-event') }),
      '',
    ].join('\n')
    await writeFile(join(dirname(spec.cwd), 'runner-evidence.jsonl'), evidence)
    return { exitCode: 0, signal: null }
  }
}

class TransientCleanupSubprocess {
  constructor() {
    this.containerPresent = true
    this.volumePresent = true
    this.containerRemoveAttempts = 0
    this.volumeRemoveAttempts = 0
  }

  async resolveExecutable(value) {
    return value
  }

  spawn(spec) {
    const kind = spec.argv[1]
    const action = spec.argv[2]
    let stdout = ''
    let stderr = ''
    let exitCode = 0
    if (kind === 'container' && action === 'ls') {
      stdout = this.containerPresent ? `${'c'.repeat(12)}\n` : ''
    } else if (kind === 'container' && action === 'rm') {
      this.containerRemoveAttempts += 1
      if (this.containerRemoveAttempts === 1) {
        exitCode = 1
        stderr = 'transient container cleanup failure\n'
      } else {
        this.containerPresent = false
      }
    } else if (kind === 'volume' && action === 'ls') {
      stdout = this.volumePresent ? `dshbio-vol-${'d'.repeat(20)}\n` : ''
    } else if (kind === 'volume' && action === 'rm') {
      this.volumeRemoveAttempts += 1
      if (this.containerPresent) {
        exitCode = 1
        stderr = 'volume is still in use\n'
      } else {
        this.volumePresent = false
      }
    } else {
      throw new Error(`unexpected cleanup command: ${JSON.stringify(spec.argv)}`)
    }
    return {
      pid: 4400 + this.containerRemoveAttempts + this.volumeRemoveAttempts,
      collected: {
        stdout: new StaticReader(stdout),
        stderr: new StaticReader(stderr),
      },
      done: Promise.resolve({ exitCode, signal: null }),
      terminate() {},
      waitForExit: async () => true,
    }
  }
}

class IdentityProbeSubprocess {
  constructor() {
    this.spawns = []
  }

  async resolveExecutable(value) {
    return value
  }

  spawn(spec) {
    this.spawns.push(spec)
    const network = {
      policy: 'seccomp_deny_non_unix_sockets_before_wdl_load',
      architecture: 'x86_64',
      auditArchitecture: '0xc000003e',
      socketSyscall: 41,
      seccompSyscall: 317,
      allowedSocketDomain: 'AF_UNIX',
      deniedAction: 'errno:EPERM',
      noNewPrivileges: true,
      threadSynchronization: 'SECCOMP_FILTER_FLAG_TSYNC',
    }
    let stdout
    if (spec.argv.includes('--dsh-version')) {
      const startupPolicy = {
        mode: 'python_isolated_no_site',
        dontWriteBytecode: true,
        ignoreEnvironment: true,
        noUserSite: true,
        pthFilesExecuted: false,
        sitecustomizeImported: false,
        usercustomizeImported: false,
        sitePackagesPathDigest: digest('7'),
      }
      const distributions = [{
        name: 'miniwdl',
        version: '1.15.0',
        fileCount: 1,
        sizeBytes: 1,
        digest: digest('6'),
      }]
      stdout = JSON.stringify({
        backend: 'dsh_fixture_docker',
        policyVersion: '1',
        expectedMiniwdlVersion: '1.15.0',
        miniwdlVersion: '1.15.0',
        pythonVersion: '3.13.0',
        controllerNetwork: {
          ...network,
          filterDigest: runnerDigest(network, 'controller-network-filter'),
        },
        wrapper: {
          sha256: `sha256:${createHash('sha256').update(FIXTURE_RUNNER_BYTES).digest('hex')}`,
          sizeBytes: FIXTURE_RUNNER_BYTES.length,
        },
        pythonEnvironment: {
          startupPolicy,
          distributions,
          environmentDigest: runnerDigest({ startupPolicy, distributions }, 'python-environment'),
        },
      })
    } else if (spec.argv[1] === 'info') {
      stdout = 'test-engine\t29.3.1\t2\t["name=apparmor","name=seccomp,profile=builtin"]'
    } else if (spec.argv[1] === 'image') {
      const reference = spec.argv.at(-1)
      stdout = `${reference === TASK_IMAGE ? digest('d') : digest('e')}\t${JSON.stringify([reference])}`
    } else {
      throw new Error(`unexpected identity probe: ${JSON.stringify(spec.argv)}`)
    }
    return {
      pid: 4300 + this.spawns.length,
      collected: {
        stdout: new StaticReader(`${stdout}\n`),
        stderr: new StaticReader(''),
      },
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate() {},
      waitForExit: async () => true,
    }
  }
}

class FakeJobs {
  constructor({ startRun = true } = {}) {
    this.startRun = startRun
    this.count = 0
    this.records = new Map()
  }

  start(spec) {
    const id = `bio-draft-test-${++this.count}`
    const hooks = this.startRun ? spec.run() : null
    const record = { id, spec, hooks, status: this.startRun ? 'running' : 'queued' }
    if (hooks !== null) {
      record.settled = hooks.done.then((outcome) => {
        record.status = outcome.status
        return outcome
      })
    }
    this.records.set(id, record)
    return id
  }

  get(id, owner) {
    const record = this.records.get(id)
    if (record === undefined || record.spec.owner.id !== owner.id) throw new Error('not found')
    return { id, kind: record.spec.kind, label: record.spec.label, status: record.status }
  }
}

async function makeManager(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-draft-test-'))
  const runsRoot = join(root, 'runs')
  await mkdir(runsRoot, { mode: 0o700 })
  await chmod(runsRoot, 0o700)
  const runnerExecutable = options.runnerExecutable ?? (options.useDefaultProbe || options.createRunnerExecutable
    ? join(root, 'fixture-probe-executable')
    : '/bin/true')
  if (options.useDefaultProbe || options.createRunnerExecutable) {
    await writeFile(runnerExecutable, TRUE_BYTES, { mode: 0o700, flag: 'wx' })
  }
  const store = stores()
  const subprocess = options.subprocess ?? new FakeSubprocess(options)
  const jobs = options.jobs ?? new FakeJobs(options)
  const config = {
    enabled: true,
    runsRoot,
    fixtureRoots: [FIXTURE_ROOT],
    runner: {
      pythonExecutable: runnerExecutable,
      dockerExecutable: runnerExecutable,
      expectedMiniwdlVersion: '1.15.0',
      supportImage: SUPPORT_IMAGE,
    },
  }
  const manager = createDraftTestManager({
    ...store,
    config,
    getSubprocess: () => subprocess,
    getJobs: () => jobs,
    ...(options.useDefaultProbe
      ? {}
      : {
          probeRunnerIdentity: options.probeRunnerIdentity
            ?? (async () => structuredClone(makeRunnerIdentity())),
        }),
    cleanupDockerResources: options.cleanupDockerResources ?? (async () => {
      const basis = {
        cleanupVerified: true,
        cleanupMode: 'exact_labels_and_absence_probe',
        containersRemaining: 0,
        volumesRemaining: 0,
        removedContainers: 0,
        removedVolumes: 0,
      }
      return { ...basis, cleanupDigest: computeDraftTestDigest(basis, 'resource-cleanup') }
    }),
    ...(options.sealEvidence === undefined ? {} : { sealEvidence: options.sealEvidence }),
    captureControllerIdentity: options.captureControllerIdentity
      ?? (async (pid) => fakeControllerIdentity(pid)),
    terminateRecoveredController: options.terminateRecoveredController
      ?? (async () => ({ verified: true, mode: 'exact_identity_terminated' })),
    createId: options.createId ?? (() => TEST_UUID),
    runtimeId: options.runtimeId ?? 'runtime-one',
    now: options.now ?? (() => new Date('2026-08-27T12:00:00.000Z')),
  })
  return { root, runsRoot, config, store, subprocess, jobs, manager }
}

const request = {
  missionId: MISSION_ID,
  fixtureId: 'text-roundtrip',
  fixtureVersion: '1.0.0',
}
const operation = {
  ownerSession: 'owner-session',
  agent: { id: 'owner-session', session: { id: 'owner-session' } },
}

async function removeTestRoot(root) {
  async function restoreDirectoryPermissions(path) {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await restoreDirectoryPermissions(join(path, entry.name))
      }
    }
    await chmod(path, 0o700).catch(() => {})
  }
  await restoreDirectoryPermissions(root)
  await rm(root, { recursive: true, force: true })
}

test('draft-test prepare binds exact owner Mission, draft, fixture, runner, isolation, and budgets without spawning', async () => {
  const fixture = await makeManager()
  try {
    const prepared = await fixture.manager.prepare(request, operation)
    assert.equal(prepared.ok, true, JSON.stringify(prepared))
    assert.equal(prepared.readyToStart, true)
    assert.equal(prepared.plan.mission.missionId, MISSION_ID)
    assert.equal(prepared.plan.draft.draftId, DRAFT_ID)
    assert.equal(prepared.plan.fixture.id, 'text-roundtrip')
    assert.equal(prepared.plan.runner.identity.taskImage.reference, TASK_IMAGE)
    assert.equal(prepared.plan.isolation.policy.network, 'none')
    assert.equal(prepared.plan.authorization.productionExecution, false)
    assert.equal(fixture.subprocess.spawns.length, 0)
  } finally {
    await removeTestRoot(fixture.root)
  }
})

test('default runner preflight binds isolated Python startup, TSYNC seccomp, Docker, and broker identities', async () => {
  const subprocess = new IdentityProbeSubprocess()
  const fixture = await makeManager({ subprocess, useDefaultProbe: true })
  try {
    const prepared = await fixture.manager.prepare(request, operation)
    assert.equal(prepared.ok, true, JSON.stringify(prepared))
    assert.equal(prepared.plan.runner.identity.pythonEnvironment.startupPolicy.mode, 'python_isolated_no_site')
    assert.equal(prepared.plan.runner.identity.pythonEnvironment.startupPolicy.dontWriteBytecode, true)
    assert.equal(prepared.plan.runner.identity.pythonEnvironment.startupPolicy.pthFilesExecuted, false)
    assert.equal(
      prepared.plan.runner.identity.controller.network.threadSynchronization,
      'SECCOMP_FILTER_FLAG_TSYNC',
    )
    assert.equal(
      prepared.plan.runner.identity.controller.dockerBroker.limits.additionalProcesses,
      128,
    )
    assert.deepEqual(
      prepared.plan.runner.identity.docker.securityOptions,
      ['name=apparmor', 'name=seccomp,profile=builtin'],
    )
    assert.equal(subprocess.spawns.length, 4)
    assert.deepEqual(subprocess.spawns[0].argv.slice(1, 5), ['-B', '-I', '-S', FIXTURE_RUNNER_PATH])
    assert.equal(subprocess.spawns.every((spec) => spec.env.HOME === '/nonexistent'), true)
  } finally {
    await removeTestRoot(fixture.root)
  }
})

test('draft-test lifecycle seals passing isolation, artifact, and assertion evidence without production authority', async () => {
  const fixture = await makeManager()
  try {
    const prepared = await fixture.manager.prepare(request, operation)
    assert.equal(prepared.ok, true, JSON.stringify(prepared))
    const started = await fixture.manager.start({
      ...request,
      expectedPlanDigest: prepared.planDigest,
    }, operation)
    assert.equal(started.ok, true)
    await fixture.jobs.records.get(started.jobId).settled

    const result = await fixture.manager.get(started.testId, operation)
    assert.equal(result.ok, true)
    assert.equal(result.test.status, 'completed', JSON.stringify(result.test.evidence))
    assert.equal(result.test.evidence.passed, true)
    assert.equal(result.test.evidence.isolation.verified, true)
    assert.equal(result.test.evidence.isolation.probes.length, 17)
    assert.equal(result.test.evidence.resources.cleanupVerified, true)
    assert.equal(result.test.evidence.artifacts[0].sha256, `sha256:${createHash('sha256').update('fixture input\n').digest('hex')}`)
    assert.equal(result.test.evidence.assertionEvidence.passed, true)
    assert.equal(result.test.capabilities.productionExecution, false)
    assert.equal(JSON.stringify(result.test.evidence).includes(fixture.runsRoot), false)

    const report = await fixture.manager.report(started.testId, operation)
    assert.equal(report.report.passed, true)
    assert.equal(report.report.capabilities.workflowPromotion, false)
    assert.equal(report.report.limitations.includes('software_trial_report_v1_success_remains_false'), true)

    const crossOwner = await fixture.manager.get(started.testId, {
      ownerSession: 'another-session',
      agent: { id: 'another-session' },
    })
    assert.equal(crossOwner.ok, false)
    assert.equal(crossOwner.error.code, 'draft_test_not_found')
  } finally {
    await removeTestRoot(fixture.root)
  }
})

test('draft-test finalization persists a bounded failed terminal record when evidence sealing rejects', async () => {
  const fixture = await makeManager({
    sealEvidence() {
      throw new TypeError('injected evidence contract failure')
    },
  })
  try {
    const prepared = await fixture.manager.prepare(request, operation)
    const started = await fixture.manager.start({
      ...request,
      expectedPlanDigest: prepared.planDigest,
    }, operation)
    assert.equal(started.ok, true)
    const settled = await fixture.jobs.records.get(started.jobId).settled
    assert.equal(settled.status, 'failed')
    const result = await fixture.manager.get(started.testId, operation)
    assert.equal(result.ok, true)
    assert.equal(result.test.status, 'failed')
    assert.equal(result.test.evidence.passed, false)
    assert.equal(result.test.evidence.failure.code, 'evidence_contract_failed')
    assert.equal(result.test.evidence.exit.ambiguous, true)
  } finally {
    await removeTestRoot(fixture.root)
  }
})

test('draft-test evidence fails closed on control, image, support-image, host-path, or size drift', async () => {
  const scenarios = [
    {
      name: 'network control',
      options: {
        evidenceMutator: ({ task }) => { task.containerControls.networkMode = 'bridge' },
      },
      code: 'isolation_probe_failed',
    },
    {
      name: 'task image id',
      options: {
        evidenceMutator: ({ task }) => { task.imageId = digest('9') },
      },
      code: 'runner_evidence_invalid',
    },
    {
      name: 'support image id',
      options: {
        evidenceMutator: ({ probe }) => { probe.supportImage.imageId = digest('9') },
      },
      code: 'runner_evidence_invalid',
    },
    {
      name: 'host-sensitive mount field',
      options: {
        evidenceMutator: ({ task }) => { task.containerControls.mounts[0].source = '/private/fixture' },
      },
      code: 'runner_evidence_invalid',
      absent: '/private/fixture',
    },
    {
      name: 'aggregate evidence bytes',
      options: { evidenceText: 'x'.repeat(2 * 1024 * 1024 + 1) },
      code: 'runner_evidence_invalid',
    },
  ]

  for (const scenario of scenarios) {
    const fixture = await makeManager(scenario.options)
    try {
      const prepared = await fixture.manager.prepare(request, operation)
      assert.equal(prepared.ok, true, `${scenario.name}: ${JSON.stringify(prepared)}`)
      const started = await fixture.manager.start({
        ...request,
        expectedPlanDigest: prepared.planDigest,
      }, operation)
      assert.equal(started.ok, true, scenario.name)
      await fixture.jobs.records.get(started.jobId).settled
      const result = await fixture.manager.get(started.testId, operation)
      assert.equal(result.test.status, 'failed', scenario.name)
      assert.equal(result.test.evidence.passed, false, scenario.name)
      assert.equal(result.test.evidence.failure.code, scenario.code, scenario.name)
      if (scenario.absent !== undefined) {
        assert.equal(JSON.stringify(result.test.evidence).includes(scenario.absent), false, scenario.name)
      }
    } finally {
      await removeTestRoot(fixture.root)
    }
  }
})

test('draft-test cancellation fails closed and restart reconciliation never retries a prepared action', async () => {
  const held = await makeManager({ hold: true })
  try {
    const prepared = await held.manager.prepare(request, operation)
    assert.equal(prepared.ok, true, JSON.stringify(prepared))
    const started = await held.manager.start({ ...request, expectedPlanDigest: prepared.planDigest }, operation)
    const cancelled = await held.manager.cancel(started.testId, operation)
    assert.equal(cancelled.ok, true)
    await held.jobs.records.get(started.jobId).settled
    const terminal = await held.manager.get(started.testId, operation)
    assert.equal(terminal.test.status, 'cancelled')
    assert.equal(terminal.test.evidence.passed, false)
    assert.equal(terminal.test.evidence.failure.code, 'draft_test_cancelled')
    assert.equal(terminal.test.evidence.failure.automaticRetry, false)
  } finally {
    await removeTestRoot(held.root)
  }

  const queuedJobs = new FakeJobs({ startRun: false })
  const first = await makeManager({ jobs: queuedJobs, createId: () => RESTART_UUID })
  try {
    const prepared = await first.manager.prepare(request, operation)
    assert.equal(prepared.ok, true, JSON.stringify(prepared))
    const started = await first.manager.start({ ...request, expectedPlanDigest: prepared.planDigest }, operation)
    const restarted = createDraftTestManager({
      ...first.store,
      config: first.config,
      getSubprocess: () => first.subprocess,
      getJobs: () => queuedJobs,
      probeRunnerIdentity: async () => structuredClone(makeRunnerIdentity()),
      cleanupDockerResources: async () => {
        const basis = {
          cleanupVerified: true,
          cleanupMode: 'exact_labels_and_absence_probe',
          containersRemaining: 0,
          volumesRemaining: 0,
          removedContainers: 0,
          removedVolumes: 0,
        }
        return { ...basis, cleanupDigest: computeDraftTestDigest(basis, 'resource-cleanup') }
      },
      runtimeId: 'runtime-two',
      createId: () => '55555555-5555-4555-8555-555555555555',
      now: () => new Date('2026-08-27T12:05:00.000Z'),
    })
    const interrupted = await restarted.get(started.testId, operation)
    assert.equal(interrupted.ok, true, JSON.stringify(interrupted))
    assert.equal(interrupted.test.status, 'interrupted')
    assert.equal(interrupted.test.evidence.failure.code, 'runtime_restart_interrupted')
    assert.equal(queuedJobs.count, 1)
  } finally {
    await removeTestRoot(first.root)
  }
})

test('startup recovery terminates an exact persisted live controller before Docker cleanup without owner get', async () => {
  const first = await makeManager({ hold: true, createId: () => RESTART_UUID })
  try {
    const prepared = await first.manager.prepare(request, operation)
    const started = await first.manager.start({
      ...request,
      expectedPlanDigest: prepared.planDigest,
    }, operation)
    assert.equal(started.ok, true)
    const events = []
    const restarted = createDraftTestManager({
      ...first.store,
      config: first.config,
      getSubprocess: () => first.subprocess,
      getJobs: () => new FakeJobs(),
      probeRunnerIdentity: async () => structuredClone(makeRunnerIdentity()),
      terminateRecoveredController: async (identity) => {
        events.push('terminate-controller')
        assert.deepEqual(identity, fakeControllerIdentity(4321))
        return { verified: true, mode: 'exact_identity_terminated' }
      },
      cleanupDockerResources: async () => {
        events.push('cleanup-docker')
        const basis = {
          cleanupVerified: true,
          cleanupMode: 'exact_labels_and_absence_probe',
          containersRemaining: 0,
          volumesRemaining: 0,
          removedContainers: 1,
          removedVolumes: 1,
        }
        return { ...basis, cleanupDigest: computeDraftTestDigest(basis, 'resource-cleanup') }
      },
      runtimeId: 'runtime-restarted',
      now: () => new Date('2026-08-27T12:05:00.000Z'),
    })

    const initialized = await restarted.initialize()
    assert.equal(initialized.reconciledCount, 1)
    assert.deepEqual(events, ['terminate-controller', 'cleanup-docker'])
    assert.equal(restarted.summary.recoveryStatus, 'completed')
    const recovered = await restarted.get(started.testId, operation)
    assert.equal(recovered.test.status, 'interrupted')
    assert.equal(recovered.test.evidence.resources.controllerTerminationVerified, true)
    assert.equal(recovered.test.evidence.resources.controllerTerminationMode, 'exact_identity_terminated')
  } finally {
    await removeTestRoot(first.root)
  }
})

test('startup recovery retries transient exact-label cleanup failures before proving absence', async () => {
  let runnerIdentity
  const first = await makeManager({
    hold: true,
    createId: () => RESTART_UUID,
    createRunnerExecutable: true,
    probeRunnerIdentity: async () => structuredClone(runnerIdentity),
  })
  const runnerExecutable = first.config.runner.dockerExecutable
  runnerIdentity = makeRunnerIdentity()
  const executable = await executableFixtureIdentity(runnerExecutable)
  runnerIdentity.internal.pythonPath = runnerExecutable
  runnerIdentity.internal.dockerPath = runnerExecutable
  runnerIdentity.public.executables.python = executable
  runnerIdentity.public.executables.docker = executable
  try {
    const prepared = await first.manager.prepare(request, operation)
    const started = await first.manager.start({
      ...request,
      expectedPlanDigest: prepared.planDigest,
    }, operation)
    assert.equal(started.ok, true)
    const cleanupSubprocess = new TransientCleanupSubprocess()
    const restarted = createDraftTestManager({
      ...first.store,
      config: first.config,
      getSubprocess: () => cleanupSubprocess,
      getJobs: () => new FakeJobs(),
      probeRunnerIdentity: async () => structuredClone(runnerIdentity),
      terminateRecoveredController: async () => ({ verified: true, mode: 'exact_identity_terminated' }),
      runtimeId: 'runtime-cleanup-retry',
      now: () => new Date('2026-08-27T12:05:00.000Z'),
    })

    const initialized = await restarted.initialize()
    assert.equal(initialized.failed, false)
    assert.equal(initialized.reconciledCount, 1)
    const recovered = await restarted.get(started.testId, operation)
    assert.equal(
      recovered.test.evidence.failure.code,
      'runtime_restart_interrupted',
      JSON.stringify(recovered.test.evidence),
    )
    assert.equal(recovered.test.evidence.resources.cleanupVerified, true)
    assert.equal(recovered.test.evidence.resources.containersRemaining, 0)
    assert.equal(recovered.test.evidence.resources.volumesRemaining, 0)
    assert.equal(cleanupSubprocess.containerRemoveAttempts, 2)
    assert.equal(cleanupSubprocess.volumeRemoveAttempts, 2)
  } finally {
    await removeTestRoot(first.root)
  }
})

test('draft-test start rejects internal executable path drift and removes its partial snapshot', async () => {
  let probes = 0
  const fixture = await makeManager({
    probeRunnerIdentity: async () => {
      probes += 1
      const identity = structuredClone(makeRunnerIdentity())
      if (probes >= 3) identity.internal.pythonPath = '/usr/bin/true'
      return identity
    },
  })
  try {
    const prepared = await fixture.manager.prepare(request, operation)
    assert.equal(prepared.ok, true, JSON.stringify(prepared))
    const started = await fixture.manager.start({
      ...request,
      expectedPlanDigest: prepared.planDigest,
    }, operation)
    assert.equal(started.ok, false)
    assert.equal(started.error.code, 'draft_test_identity_drift')
    assert.equal(fixture.subprocess.spawns.length, 0)
    const ownerEntries = await readdir(fixture.runsRoot, { withFileTypes: true })
    assert.equal(ownerEntries.length, 1)
    assert.deepEqual(
      await readdir(join(fixture.runsRoot, ownerEntries[0].name)),
      [],
    )
  } finally {
    await removeTestRoot(fixture.root)
  }
})
