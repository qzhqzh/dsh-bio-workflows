import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

import {
  DRAFT_TEST_DEFAULT_BUDGETS,
  DRAFT_TEST_EVIDENCE_SCHEMA_VERSION,
  DRAFT_TEST_ISOLATION_POLICY,
  DRAFT_TEST_PLAN_SCHEMA_VERSION,
  DraftTestConfigValidationError,
  computeDraftTestDigest,
  createDraftTestPlan,
  effectiveDraftTestBudgets,
  parseDraftTestConfig,
  sealDraftTestEvidence,
  validateDraftTestEvidence,
  validateDraftTestPlan,
} from '../src/draft-test-contract.js'
import { normalizeFixtureDescriptor } from '../src/fixture-bundle.js'

const SCHEMA_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../schema')
const [fixtureBundleSchema, draftTestPlanSchema, draftTestEvidenceSchema] = await Promise.all(
  ['fixture-bundle.schema.json', 'draft-test-plan.schema.json', 'draft-test-evidence.schema.json']
    .map(async (name) => JSON.parse(await readFile(join(SCHEMA_ROOT, name), 'utf8'))),
)
const schemaValidator = new Ajv2020({ allErrors: true, strict: false })
schemaValidator.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/)
schemaValidator.addSchema(fixtureBundleSchema)
schemaValidator.addSchema(draftTestPlanSchema)
schemaValidator.addSchema(draftTestEvidenceSchema)
const validateFixtureBundleSchema = schemaValidator.getSchema(fixtureBundleSchema.$id)
const validateDraftTestPlanSchema = schemaValidator.getSchema(draftTestPlanSchema.$id)
const validateDraftTestEvidenceSchema = schemaValidator.getSchema(draftTestEvidenceSchema.$id)

function assertSchemaAccepts(validate, value) {
  assert.equal(validate(value), true, JSON.stringify(validate.errors))
}

function assertSchemaRejects(validate, value) {
  assert.equal(validate(value), false, 'public JSON Schema unexpectedly accepted a malicious value')
}

const digest = (character) => `sha256:${character.repeat(64)}`

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function runnerDigest(value, domain) {
  return `sha256:${createHash('sha256').update(`dsh-bio-fixture-runner-${domain}-v1\n${stableStringify(value)}`).digest('hex')}`
}

function readyMission() {
  return {
    ok: true,
    missionId: 'mission-11111111-1111-4111-8111-111111111111',
    status: 'ready',
    phase: 'validated',
    planDigest: digest('1'),
    goal: {
      software: {
        name: 'copy-tool',
        version: '1.0.0',
        containerImage: `example.invalid/copy@${digest('a')}`,
      },
      objective: 'Copy one exact fixture.',
      acceptanceCriteria: ['The copied file digest matches.'],
    },
    draft: {
      draftId: 'draft-22222222-2222-4222-8222-222222222222',
      revision: 3,
      contentDigest: digest('2'),
    },
    lastValidation: {
      revision: 3,
      contentDigest: digest('2'),
      validationDigest: digest('3'),
      valid: true,
    },
  }
}

function draft() {
  return {
    metadata: { draftId: 'draft-22222222-2222-4222-8222-222222222222' },
    snapshot: { revision: 3, contentDigest: digest('2') },
  }
}

function fixture() {
  return {
    fixtureDigest: digest('4'),
    totalFileBytes: 12,
    descriptor: {
      schemaVersion: '1',
      id: 'copy',
      version: '1.0.0',
      name: 'Copy fixture',
      summary: 'One exact file and one deterministic digest assertion.',
      files: [{ path: 'input.txt', sizeBytes: 12, sha256: digest('5') }],
      inputs: { 'copy.source': { $fixture: 'input.txt' } },
      assertions: [{
        id: 'copy-digest',
        kind: 'file_digest',
        output: 'copy.result',
        sizeBytes: 12,
        sha256: digest('5'),
      }],
    },
  }
}

test('draft testing is default-off and enabled configuration requires explicit absolute identities', () => {
  assert.deepEqual(parseDraftTestConfig(), {
    enabled: false,
    runsRoot: null,
    fixtureRoots: [],
    runner: {
      pythonExecutable: 'python3',
      dockerExecutable: 'docker',
      expectedMiniwdlVersion: '1.15.0',
      supportImage: null,
    },
    budgets: DRAFT_TEST_DEFAULT_BUDGETS,
  })

  assert.throws(
    () => parseDraftTestConfig({ enabled: true }),
    DraftTestConfigValidationError,
  )
  const enabled = parseDraftTestConfig({
    enabled: true,
    runsRoot: '/data/05_workspace/Miniwdl/dsh-draft-tests',
    fixtureRoots: ['/opt/dsh/fixtures'],
    runner: {
      pythonExecutable: '/opt/miniwdl/bin/python',
      dockerExecutable: '/usr/bin/docker',
      expectedMiniwdlVersion: '1.15.0',
      supportImage: `python@${digest('a')}`,
    },
  })
  assert.equal(enabled.enabled, true)
  assert.equal(enabled.runner.supportImage, `python@${digest('a')}`)
  assert.equal(enabled.budgets.taskCount, 16)
})

test('per-test budgets can only reduce configured maxima and preserve cross-limit invariants', () => {
  const budgets = effectiveDraftTestBudgets(
    { cpu: 1, wallTimeMs: 60_000, taskTimeMs: 30_000 },
    DRAFT_TEST_DEFAULT_BUDGETS,
  )
  assert.equal(budgets.cpu, 1)
  assert.equal(budgets.wallTimeMs, 60_000)
  assert.equal(budgets.memoryBytes, DRAFT_TEST_DEFAULT_BUDGETS.memoryBytes)
  assert.throws(
    () => effectiveDraftTestBudgets({ cpu: 2 }, { ...DRAFT_TEST_DEFAULT_BUDGETS, cpu: 1 }),
    /budgets.cpu/,
  )
  assert.throws(
    () => effectiveDraftTestBudgets(
      { artifactBytes: 8192, totalOutputBytes: 4096 },
      DRAFT_TEST_DEFAULT_BUDGETS,
    ),
    /artifactBytes/,
  )
})

test('Draft Test Plan v1 binds exact Mission, draft, validation, fixture, runner, isolation, and budgets', () => {
  const executable = {
    launchPathDigest: digest('6'),
    canonicalPathDigest: digest('7'),
    launchDevice: '1',
    launchInode: '2',
    launchMode: '755',
    launchSizeBytes: 1,
    launchMtimeNs: '3',
    launchCtimeNs: '4',
    sha256: digest('8'),
    sizeBytes: 1,
    device: '1',
    inode: '2',
    uid: '1000',
    mode: '755',
    mtimeNs: '3',
    ctimeNs: '4',
  }
  const networkBasis = {
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
  const distributions = [{ name: 'miniwdl', version: '1.15.0', fileCount: 1, sizeBytes: 1, digest: digest('9') }]
  const startupPolicy = {
    mode: 'python_isolated_no_site',
    ignoreEnvironment: true,
    noUserSite: true,
    pthFilesExecuted: false,
    sitecustomizeImported: false,
    usercustomizeImported: false,
    sitePackagesPathDigest: digest('e'),
  }
  const runner = {
    backend: 'dsh_fixture_docker',
    policyVersion: '1',
    miniwdlVersion: '1.15.0',
    pythonVersion: '3.11.9',
    controller: {
      uid: 1000,
      gid: 1000,
      network: { ...networkBasis, filterDigest: runnerDigest(networkBasis, 'controller-network-filter') },
      environment: {
        policy: 'exact_allowlist',
        allowedKeys: ['HOME', 'LANG', 'LC_ALL', 'TMPDIR'],
        nonEmptyKeys: ['HOME', 'LANG', 'LC_ALL', 'TMPDIR'],
        credentialLikeKeys: [],
        environmentDigest: `sha256:${'f'.repeat(64)}`,
      },
      limits: {
        residentMemoryBytes: DRAFT_TEST_DEFAULT_BUDGETS.memoryBytes,
        virtualAddressSpaceBytes: DRAFT_TEST_DEFAULT_BUDGETS.memoryBytes,
        cpuSeconds: Math.ceil(DRAFT_TEST_DEFAULT_BUDGETS.wallTimeMs / 1000),
        additionalProcesses: DRAFT_TEST_DEFAULT_BUDGETS.pids,
        openFiles: 256,
        fileBytes: DRAFT_TEST_DEFAULT_BUDGETS.totalOutputBytes,
        wallTimeMs: DRAFT_TEST_DEFAULT_BUDGETS.wallTimeMs,
      },
      dockerBroker: {
        networkFilterDigest: runnerDigest(networkBasis, 'controller-network-filter'),
        kernelEnforced: true,
        threadSynchronized: true,
        limits: {
          virtualAddressSpaceBytes: 4 * 1024 * 1024 * 1024,
          cpuSeconds: Math.ceil(DRAFT_TEST_DEFAULT_BUDGETS.wallTimeMs / 1000),
          additionalProcesses: 128,
          openFiles: 256,
          fileBytes: DRAFT_TEST_DEFAULT_BUDGETS.totalOutputBytes,
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
      engineId: 'engine-id',
      serverVersion: '29.0.0',
      cgroupVersion: '2',
      securityOptions: ['name=apparmor', 'name=seccomp,profile=builtin'],
    },
    taskImage: { reference: readyMission().goal.software.containerImage, imageId: digest('b') },
    supportImage: { reference: `python@${digest('c')}`, imageId: digest('c') },
    supportContainerLimits: { cpu: 1, memoryBytesMaximum: 128 * 1024 * 1024, pidsMaximum: 16 },
    storage: {
      runsRoot: { device: '1', inode: '2', uid: '1000', mode: '700' },
      fixtureSourceIdentityDigest: digest('d'),
    },
  }
  const created = createDraftTestPlan({
    mission: readyMission(),
    draft: draft(),
    fixture: fixture(),
    runner,
    budgets: DRAFT_TEST_DEFAULT_BUDGETS,
  })
  assertSchemaAccepts(validateFixtureBundleSchema, fixture().descriptor)
  assertSchemaAccepts(validateDraftTestPlanSchema, created.plan)
  const oversizedFixtureId = { ...fixture().descriptor, id: 'a'.repeat(65) }
  assert.throws(() => normalizeFixtureDescriptor(oversizedFixtureId), /id/)
  assertSchemaRejects(validateFixtureBundleSchema, oversizedFixtureId)
  const oversizedAssertionId = structuredClone(fixture().descriptor)
  oversizedAssertionId.assertions[0].id = 'a'.repeat(129)
  assert.throws(() => normalizeFixtureDescriptor(oversizedAssertionId), /assertions\[0\]\.id/)
  assertSchemaRejects(validateFixtureBundleSchema, oversizedAssertionId)

  assert.equal(created.plan.schemaVersion, DRAFT_TEST_PLAN_SCHEMA_VERSION)
  assert.equal(created.plan.draft.validationDigest, digest('3'))
  assert.equal(created.plan.fixture.fixtureDigest, digest('4'))
  assert.equal(created.plan.runner.runnerDigest, computeDraftTestDigest(runner, 'runner'))
  assert.equal(created.plan.isolation.policy.network, 'none')
  assert.equal(created.plan.isolation.policy.productionRunnerReuse, false)
  assert.equal(created.plan.authorization.productionExecution, false)
  assert.equal(created.plan.authorization.workflowPromotion, false)
  assert.equal(
    created.planDigest,
    'sha256:e7fa35c94159ff03ce723c4aac5de0e72b9ef9931c0628313282b1e6ceee1912',
  )

  const stale = readyMission()
  stale.draft.revision = 2
  assert.throws(
    () => createDraftTestPlan({
      mission: stale,
      draft: draft(),
      fixture: fixture(),
      runner,
      budgets: DRAFT_TEST_DEFAULT_BUDGETS,
    }),
    /identity do not match/,
  )
  const staleValidation = readyMission()
  staleValidation.lastValidation.contentDigest = digest('9')
  assert.throws(
    () => createDraftTestPlan({
      mission: staleValidation,
      draft: draft(),
      fixture: fixture(),
      runner,
      budgets: DRAFT_TEST_DEFAULT_BUDGETS,
    }),
    /validation evidence/,
  )
  assert.equal(DRAFT_TEST_ISOLATION_POLICY.registryPulls, false)

  const malformedId = structuredClone(created.plan)
  malformedId.mission.missionId = 'mission-------------------------------------'
  assert.throws(() => validateDraftTestPlan(malformedId), /missionId/)
  assertSchemaRejects(validateDraftTestPlanSchema, malformedId)
  const nonJsonAssertion = structuredClone(created.plan)
  nonJsonAssertion.fixture.assertions = [{ id: 'invalid', kind: 'value_equals', output: 'copy.value', expected: null }]
  nonJsonAssertion.fixture.assertions[0].expected = Number.POSITIVE_INFINITY
  assert.throws(() => validateDraftTestPlan(nonJsonAssertion), /finite JSON numbers/)
  const networkDrift = structuredClone(created.plan)
  networkDrift.runner.identity.controller.network.socketSyscall = 198
  assert.throws(() => validateDraftTestPlan(networkDrift), /controller.network/)
  assertSchemaRejects(validateDraftTestPlanSchema, networkDrift)
  const startupDrift = structuredClone(created.plan)
  startupDrift.runner.identity.pythonEnvironment.startupPolicy.pthFilesExecuted = true
  assert.throws(() => validateDraftTestPlan(startupDrift), /startupPolicy/)
  assertSchemaRejects(validateDraftTestPlanSchema, startupDrift)
  const environmentDrift = structuredClone(created.plan)
  environmentDrift.runner.identity.pythonEnvironment.distributions[0].version = '1.15.1'
  assert.throws(() => validateDraftTestPlan(environmentDrift), /environmentDigest/)
})

test('Draft Test Evidence v1 sealing excludes any supplied digest and is deterministic', () => {
  const cleanupBasis = {
    cleanupVerified: true,
    cleanupMode: 'exact_labels_and_absence_probe',
    containersRemaining: 0,
    volumesRemaining: 0,
    removedContainers: 0,
    removedVolumes: 0,
    controllerTerminationVerified: true,
    controllerTerminationMode: 'live_handle_exit_verified',
  }
  const probes = [{ id: 'controller_failed', status: 'failed', expected: true, observed: false }]
  const basis = {
    schemaVersion: DRAFT_TEST_EVIDENCE_SCHEMA_VERSION,
    testId: 'test-33333333-3333-4333-8333-333333333333',
    planDigest: digest('7'),
    status: 'failed',
    startedAt: '2026-08-27T12:00:00.000Z',
    finishedAt: '2026-08-27T12:01:00.000Z',
    identities: {
      missionId: 'mission-11111111-1111-4111-8111-111111111111',
      draftId: 'draft-22222222-2222-4222-8222-222222222222',
      revision: 3,
      contentDigest: digest('2'),
      validationDigest: digest('3'),
      fixtureDigest: digest('4'),
      runnerDigest: digest('5'),
      isolationPolicyDigest: digest('6'),
      containerImages: [`python@${digest('a')}`],
    },
    budgets: DRAFT_TEST_DEFAULT_BUDGETS,
    isolation: {
      verified: false,
      probeDigest: computeDraftTestDigest({ code: 'controller_failed', probes }, 'synthetic-isolation'),
      probes,
      containers: [],
      controller: null,
    },
    exit: { exitCode: 2, signal: null, timedOut: false, cancelled: false, ambiguous: false },
    logs: {
      stdout: { captured: '', capturedBytes: 0, observedBytes: 0, sha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', truncated: false },
      stderr: { captured: '', capturedBytes: 0, observedBytes: 0, sha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', truncated: false },
    },
    artifacts: [],
    assertionEvidence: { schemaVersion: '1', passed: false, assertions: [], executableAssertions: false },
    resources: { ...cleanupBasis, cleanupDigest: computeDraftTestDigest(cleanupBasis, 'resource-cleanup') },
    failure: { code: 'controller_failed', message: 'controller failed closed', failureFingerprint: digest('8'), automaticRetry: false },
    passed: false,
    capabilities: { isolatedDraftTest: true, productionExecution: false, workflowPromotion: false, productionAllowlistMutation: false },
  }
  const first = sealDraftTestEvidence({ ...basis, evidenceDigest: digest('0') })
  const second = sealDraftTestEvidence(basis)
  assert.equal(first.evidenceDigest, second.evidenceDigest)
  assert.equal(first.evidenceDigest, 'sha256:91be42a01f3a8ca84a34396b42d4a2f769ca85465330682969176126594949aa')
  assert.deepEqual(validateDraftTestEvidence(structuredClone(first)), first)
  assertSchemaAccepts(validateDraftTestEvidenceSchema, first)
  assert.throws(() => validateDraftTestEvidence(structuredClone(basis)), /evidenceDigest/)
  assert.throws(
    () => validateDraftTestEvidence({ ...structuredClone(first), evidenceDigest: digest('f') }),
    /evidenceDigest is invalid/,
  )
  const inconsistentPass = structuredClone(first)
  inconsistentPass.passed = true
  inconsistentPass.evidenceDigest = computeDraftTestDigest(
    Object.fromEntries(Object.entries(inconsistentPass).filter(([key]) => key !== 'evidenceDigest')),
    'evidence',
  )
  assert.throws(() => validateDraftTestEvidence(inconsistentPass), /passing draft test evidence/)
  assertSchemaRejects(validateDraftTestEvidenceSchema, inconsistentPass)
  assert.throws(
    () => sealDraftTestEvidence({ ...basis, leakedSecret: 'do-not-retain' }),
    /exactly/,
  )
  const maliciousEnvironment = structuredClone(basis)
  maliciousEnvironment.isolation = {
    verified: true,
    probeDigest: digest('9'),
    probes,
    containers: [{
      task: 'task',
      image: `python@${digest('a')}`,
      imageId: digest('b'),
      containerConfigDigest: digest('c'),
      containerControlsDigest: digest('d'),
      outputManifestDigest: digest('e'),
      containerControls: {
        networkMode: 'none', readonlyRootfs: true, capDrop: ['ALL'],
        securityOpt: ['apparmor=docker-default', 'no-new-privileges=true', 'seccomp=builtin'],
        pidsLimit: 8, nanoCpus: 1_000_000_000, memory: 67_108_864, memorySwap: 67_108_864,
        ipcMode: 'none', pidMode: '', cgroupnsMode: 'private', devices: 0, deviceRequests: 0,
        supplementaryGroups: 0, logDriver: 'none', apparmorProfile: 'docker-default',
        environment: { HOME: '/tmp/home', TMPDIR: '/tmp', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', TOKEN: 'secret' },
        tmpfs: { '/tmp': 'bounded' },
        ulimits: [{ name: 'fsize', soft: 4096, hard: 4096 }, { name: 'nofile', soft: 256, hard: 256 }],
        mounts: [{ type: 'bind', destination: '/mnt/miniwdl_task_container/command', rw: false, propagation: 'rprivate' }, { type: 'volume', destination: '/mnt/miniwdl_task_container', rw: true, propagation: '' }],
        outputStorageDigest: digest('f'),
      },
    }],
    controller: null,
  }
  assert.throws(() => sealDraftTestEvidence(maliciousEnvironment), /unapproved value|requires controller/)
  assertSchemaRejects(validateDraftTestEvidenceSchema, {
    ...maliciousEnvironment,
    evidenceDigest: digest('0'),
  })
})
