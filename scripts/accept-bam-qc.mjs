import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import * as plugin from '../index.js'
import { BIO_WORKFLOW_RESULT_LIMITS } from '../src/execution.js'
import { PACKAGE_VERSION } from '../src/info.js'
import { sha256Text } from '../src/wdl-bundle.js'

const DSH_VERSION = '0.1.1-rc.2'
const SAMTOOLS_IMAGE = 'quay.io/biocontainers/samtools:1.20--h50ea8bc_0@sha256:d0ebd10e887e3ddd02d071f1ca7b649dc90dc6fb99a5ffd0f5ebf8611a1f92cc'
if (process.env.DSH_BIO_SAMTOOLS_IMAGE !== undefined) {
  assert.equal(process.env.DSH_BIO_SAMTOOLS_IMAGE, SAMTOOLS_IMAGE)
}
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
assert.equal(process.platform, 'linux', 'real BAM acceptance requires Linux')
assert.notEqual(process.getuid?.(), 0, 'real BAM acceptance requires a non-root runner')

function requiredExecutable(name) {
  const value = process.env[name]
  assert.equal(typeof value, 'string', `${name} must contain an absolute executable path`)
  assert.equal(isAbsolute(value), true, `${name} must contain an absolute executable path`)
  return resolve(value)
}

async function loadDshRuntime() {
  const globalRoot = execFileSync(npmCommand, ['root', '--global'], { encoding: 'utf8' }).trim()
  const dshRoot = join(globalRoot, '@deepseek-ai', 'dsh')
  const metadata = JSON.parse(await readFile(join(dshRoot, 'package.json'), 'utf8'))
  assert.equal(metadata.version, DSH_VERSION)
  const dshRequire = createRequire(join(dshRoot, 'package.json'))
  const resolveDshPackage = (name) => pathToFileURL(
    dshRequire.resolve(`@deepseek-ai/${name}`),
  ).href
  const [
    cordis,
    agent,
    agentLoop,
    jobsLocal,
    llm,
    session,
    skill,
    subprocessLocal,
    systemPrompt,
    tools,
    userApproval,
  ] = await Promise.all([
    import(resolveDshPackage('cordis')),
    import(resolveDshPackage('dsh-agent')),
    import(resolveDshPackage('dsh-agent-loop')),
    import(resolveDshPackage('dsh-jobs-local')),
    import(resolveDshPackage('dsh-llm')),
    import(resolveDshPackage('dsh-session')),
    import(resolveDshPackage('dsh-skill')),
    import(resolveDshPackage('dsh-subprocess-local')),
    import(resolveDshPackage('dsh-system-prompt')),
    import(resolveDshPackage('dsh-tools')),
    import(resolveDshPackage('dsh-user-approval')),
  ])
  return {
    Context: cordis.Context,
    AgentLoop: agentLoop.AgentLoop,
    AgentRegistry: agent.AgentRegistry,
    ApprovalService: userApproval.ApprovalService,
    createUserMessage: llm.createUserMessage,
    LlmAdapter: llm.LlmAdapter,
    LlmRuntime: llm.LlmRuntime,
    LocalJobRegistry: jobsLocal.LocalJobRegistry,
    LocalSubprocessRuntime: subprocessLocal.LocalSubprocessRuntime,
    SessionId: session.SessionId,
    SessionStore: session.SessionStore,
    SkillRegistry: skill.SkillRegistry,
    SystemPrompt: systemPrompt.SystemPrompt,
    ToolRuntime: tools.ToolRuntime,
  }
}

function latestToolValue(messages) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const content = messages[messageIndex].content
    for (let blockIndex = content.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = content[blockIndex]
      if (block.type !== 'tool-result') continue
      const text = block.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('')
      return JSON.parse(text)
    }
  }
  assert.fail('scripted BAM acceptance model did not receive the expected tool result')
}

function toolCallChunks(id, name, args) {
  const argumentsText = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function generateBam(dockerExecutable, inputRoot, stem) {
  const uid = process.getuid()
  const gid = process.getgid()
  const common = [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '128',
    '--memory',
    '512m',
    '--cpus',
    '1',
    '--user',
    `${uid}:${gid}`,
    '--mount',
    `type=bind,src=${inputRoot},dst=/work`,
    SAMTOOLS_IMAGE,
  ]
  execFileSync(dockerExecutable, [
    ...common,
    'samtools',
    'view',
    '-b',
    '-o',
    `/work/${stem}.bam`,
    `/work/${stem}.sam`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  execFileSync(dockerExecutable, [
    ...common,
    'samtools',
    'index',
    `/work/${stem}.bam`,
    `/work/${stem}.bam.bai`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  return {
    bam: join(inputRoot, `${stem}.bam`),
    bai: join(inputRoot, `${stem}.bam.bai`),
  }
}

const miniwdlExecutable = requiredExecutable('DSH_BIO_MINIWDL_EXECUTABLE')
const dockerSource = requiredExecutable('DSH_BIO_DOCKER_EXECUTABLE')
execFileSync(dockerSource, ['image', 'inspect', SAMTOOLS_IMAGE], { stdio: ['ignore', 'pipe', 'pipe'] })
const runtime = await loadDshRuntime()
const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-bam-acceptance-'))
let ctx
let handle

try {
  const inputRoot = join(temporaryRoot, 'inputs')
  const runsRoot = join(temporaryRoot, 'runs')
  const storeRoot = join(temporaryRoot, 'store')
  const binRoot = join(temporaryRoot, 'bin')
  await mkdir(inputRoot, { mode: 0o700 })
  await mkdir(runsRoot, { mode: 0o700 })
  await mkdir(storeRoot, { mode: 0o700 })
  await mkdir(binRoot, { mode: 0o700 })
  const dockerExecutable = join(binRoot, basename(dockerSource))
  await copyFile(dockerSource, dockerExecutable)
  await chmod(dockerExecutable, 0o700)

  await writeFile(join(inputRoot, 'tiny.sam'), [
    '@HD\tVN:1.6\tSO:coordinate',
    '@SQ\tSN:chr1\tLN:1000',
    'read1\t99\tchr1\t1\t60\t4M\t=\t20\t23\tACGT\tFFFF',
    'read2\t147\tchr1\t20\t60\t4M\t=\t1\t-23\tTGCA\tFFFF',
    '',
  ].join('\n'), { mode: 0o600 })
  await writeFile(join(inputRoot, 'other.sam'), [
    '@HD\tVN:1.6\tSO:coordinate',
    '@SQ\tSN:chr2\tLN:2000',
    '@SQ\tSN:chr3\tLN:3000',
    'other1\t0\tchr2\t7\t60\t4M\t*\t0\t0\tAAAA\tFFFF',
    '',
  ].join('\n'), { mode: 0o600 })
  const primary = generateBam(dockerExecutable, inputRoot, 'tiny')
  const other = generateBam(dockerExecutable, inputRoot, 'other')
  const approvedBai = join(inputRoot, 'tiny.bam.bai.approved')
  await copyFile(primary.bai, approvedBai)

  ctx = new runtime.Context()
  new runtime.SessionStore(ctx)
  const agents = new runtime.AgentRegistry(ctx)
  new runtime.SkillRegistry(ctx)
  const llm = new runtime.LlmRuntime(ctx)
  new runtime.SystemPrompt(ctx, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    persona: 'Real BAM workflow acceptance owner.',
  })
  new runtime.ToolRuntime(ctx, { mode: 'native' })
  new runtime.LocalSubprocessRuntime(ctx)
  const jobs = new runtime.LocalJobRegistry(ctx, { maxConcurrentJobsPerOwner: 1 })
  jobs.attachController('dsh-bio-workflows-bam-acceptance')
  new runtime.ApprovalService(ctx, { policy: 'ask' })
  const approvalRequests = []
  ctx.on('approval/request', async (request, next) => {
    if (request.toolName !== 'bio_workflows_run') return next()
    approvalRequests.push(request)
    return 'allowed-once'
  })
  plugin.apply(ctx, {
    store: { root: storeRoot, writeEnabled: false },
    execution: {
      enabled: true,
      runsRoot,
      inputRoots: [inputRoot],
      runner: { executable: miniwdlExecutable, dockerExecutable },
      policy: {
        inputChecksum: 'sha256',
        networkIsolation: { mode: 'ephemeral_internal' },
        budgets: {
          maxInputSnapshotBytes: 1024 * 1024,
          maxRunStorageBytes: 2 * 1024 * 1024 * 1024,
          maxResultArtifactBytes: 32 * 1024 * 1024,
          maxTotalResultArtifactBytes: 64 * 1024 * 1024,
          maxJobOutputBytes: 256 * 1024,
          maxSpillBytes: 16 * 1024 * 1024,
        },
      },
    },
  })

  class ScriptedBamAcceptanceAdapter extends runtime.LlmAdapter {
    calls = []
    owner = null
    selected = null
    planned = null
    started = null
    successJob = null
    successRun = null
    cancellationPlan = null
    cancellationStart = null
    cancellationJob = null
    cancellationRun = null
    mismatchPlan = null
    mismatchStart = null
    mismatchJob = null
    mismatchRun = null

    request() {
      return {
        id: this.selected.id,
        version: this.selected.version,
        expectedDigest: this.selected.digest,
        inputs: { bam: primary.bam, bai: primary.bai },
      }
    }

    async *stream(options) {
      this.calls.push(options)
      assert.equal(options.provider, 'acceptance')
      assert.equal(options.model, 'bam-workflow')
      assert.ok(options.tools.some((tool) => tool.name === 'bio_workflows_search'))
      assert.ok(options.tools.some((tool) => tool.name === 'bio_workflows_plan'))
      assert.ok(options.tools.some((tool) => tool.name === 'bio_workflows_run'))
      assert.ok(options.tools.some((tool) => tool.name === 'bio_workflows_run_get'))

      let chunks
      if (this.calls.length === 1) {
        chunks = toolCallChunks('bam-search', 'bio_workflows_search', {
          source: 'builtin',
          query: 'bam',
        })
      } else if (this.calls.length === 2) {
        const search = latestToolValue(options.messages)
        this.selected = search.workflows.find(
          (workflow) => workflow.id === 'bam-qc' && workflow.version === '1.1.0',
        )
        assert.ok(this.selected)
        chunks = toolCallChunks('bam-success-plan', 'bio_workflows_plan', this.request())
      } else if (this.calls.length === 3) {
        this.planned = latestToolValue(options.messages)
        assert.equal(this.planned.ok, true, JSON.stringify(this.planned.error))
        chunks = toolCallChunks('bam-success-run', 'bio_workflows_run', {
          ...this.request(),
          expectedPlanDigest: this.planned.planDigest,
        })
      } else if (this.calls.length === 4) {
        this.started = latestToolValue(options.messages)
        assert.equal(this.started.ok, true, JSON.stringify(this.started.error))
        this.successJob = await jobs.wait(this.started.jobId, 5 * 60 * 1000, this.owner)
        chunks = toolCallChunks('bam-success-get', 'bio_workflows_run_get', {
          runId: this.started.runId,
        })
      } else if (this.calls.length === 5) {
        this.successRun = latestToolValue(options.messages)
        chunks = toolCallChunks('bam-cancellation-plan', 'bio_workflows_plan', this.request())
      } else if (this.calls.length === 6) {
        this.cancellationPlan = latestToolValue(options.messages)
        assert.equal(this.cancellationPlan.ok, true, JSON.stringify(this.cancellationPlan.error))
        chunks = toolCallChunks('bam-cancellation-run', 'bio_workflows_run', {
          ...this.request(),
          expectedPlanDigest: this.cancellationPlan.planDigest,
        })
      } else if (this.calls.length === 7) {
        this.cancellationStart = latestToolValue(options.messages)
        assert.equal(this.cancellationStart.ok, true, JSON.stringify(this.cancellationStart.error))
        assert.equal(
          jobs.kill(this.cancellationStart.jobId, this.owner, 'acceptance cancellation'),
          'requested',
        )
        this.cancellationJob = await jobs.wait(
          this.cancellationStart.jobId,
          5 * 60 * 1000,
          this.owner,
        )
        chunks = toolCallChunks('bam-cancellation-get', 'bio_workflows_run_get', {
          runId: this.cancellationStart.runId,
        })
      } else if (this.calls.length === 8) {
        this.cancellationRun = latestToolValue(options.messages)
        await copyFile(other.bai, primary.bai)
        chunks = toolCallChunks('bam-mismatch-plan', 'bio_workflows_plan', this.request())
      } else if (this.calls.length === 9) {
        this.mismatchPlan = latestToolValue(options.messages)
        assert.equal(this.mismatchPlan.ok, true, JSON.stringify(this.mismatchPlan.error))
        chunks = toolCallChunks('bam-mismatch-run', 'bio_workflows_run', {
          ...this.request(),
          expectedPlanDigest: this.mismatchPlan.planDigest,
        })
      } else if (this.calls.length === 10) {
        this.mismatchStart = latestToolValue(options.messages)
        assert.equal(this.mismatchStart.ok, true, JSON.stringify(this.mismatchStart.error))
        this.mismatchJob = await jobs.wait(
          this.mismatchStart.jobId,
          5 * 60 * 1000,
          this.owner,
        )
        chunks = toolCallChunks('bam-mismatch-get', 'bio_workflows_run_get', {
          runId: this.mismatchStart.runId,
        })
      } else if (this.calls.length === 11) {
        this.mismatchRun = latestToolValue(options.messages)
        await copyFile(approvedBai, primary.bai)
        chunks = textChunks('Completed BAM success, cancellation, and mismatched-index acceptance.')
      } else {
        assert.fail(`unexpected scripted BAM model call ${this.calls.length}`)
      }

      for (const chunk of chunks) yield chunk
    }
  }

  const adapter = new ScriptedBamAcceptanceAdapter()
  llm.registerAdapter(['acceptance'], adapter)
  new runtime.AgentLoop(ctx, { agents: [], maxParallelToolCalls: 1 })

  handle = await agents.create({
    sessionId: runtime.SessionId('bio-workflow-bam-acceptance'),
    meta: { cwd: packageRoot },
    agentOptions: { provider: 'acceptance', model: 'bam-workflow', maxTokens: 1_024 },
  })
  const owner = handle.agent
  adapter.owner = owner
  const agentErrors = []
  owner.ctx.on('agent/error', ({ error }) => agentErrors.push(error))
  owner.followup(runtime.createUserMessage({
    content: [{
      type: 'text',
      text: 'Run the exact built-in BAM QC acceptance through success, cancellation, and mismatched-index paths.',
    }],
    source: { kind: 'user' },
  }))
  await owner.whenIdle()
  assert.deepEqual(agentErrors, [])
  assert.equal(adapter.calls.length, 11)

  const {
    selected,
    planned,
    started,
    successJob,
    successRun,
    cancellationPlan,
    cancellationStart,
    cancellationJob,
    cancellationRun,
    mismatchPlan,
    mismatchStart,
    mismatchJob,
    mismatchRun,
  } = adapter
  assert.ok(selected)
  assert.equal(planned.ok, true, JSON.stringify(planned.error))
  assert.equal(planned.plan.inputContract.baiMagicHex, '42414901')
  assert.equal(planned.plan.inputContract.compatibilityValidation.matchClaim, 'runtime_only')
  assert.equal(planned.plan.runner.securityPolicy.networkIsolation.mode, 'ephemeral_internal_overlay')
  assert.equal(planned.plan.budgets.maxCpu, 2)
  assert.equal(planned.plan.budgets.maxMemoryBytes, String(4 * 1024 * 1024 * 1024))
  assert.equal(planned.plan.budgets.maxPids, 4096)
  assert.equal(planned.plan.budgets.maxWallTimeMs, 10 * 60 * 1000)

  assert.equal(started.ok, true, JSON.stringify(started.error))
  const taskStderr = successRun.run.error?.miniwdl?.cause?.stderr_file === undefined
    ? null
    : await readFile(successRun.run.error.miniwdl.cause.stderr_file, 'utf8').catch(() => null)
  assert.equal(successJob.status, 'completed', JSON.stringify({
    runError: successRun.run.error,
    taskStderr,
    job: jobs.read(started.jobId, owner),
  }))
  assert.equal(successRun.run.status, 'completed')
  assert.equal(successRun.run.networkIsolation.network.internal, true)
  assert.equal(successRun.run.networkIsolation.cleanup, 'removed')
  assert.equal(successRun.run.storageBudget.violation, null)
  assert.equal(successRun.run.wallTimeBudget.violation, null)
  assert.equal(successRun.run.result.summaries.samtools.flagstat.totalReads, '2')
  assert.equal(successRun.run.result.summaries.samtools.idxstats.referenceCount, 1)

  const artifactAssertions = []
  for (const group of successRun.run.result.artifacts) {
    for (const item of group.items) {
      const directSha256 = `sha256:${await sha256File(item.path)}`
      assert.equal(item.sha256, directSha256)
      artifactAssertions.push({
        outputId: group.outputId,
        ordinal: item.ordinal,
        sizeBytes: item.sizeBytes,
        sha256: item.sha256,
        directSha256,
      })
    }
  }

  assert.equal(cancellationStart.ok, true, JSON.stringify(cancellationStart.error))
  assert.equal(cancellationJob.status, 'killed')
  assert.equal(cancellationRun.run.status, 'killed')
  assert.equal(cancellationRun.run.result, null)
  assert.equal(cancellationRun.run.networkIsolation.cleanup, 'removed')

  assert.equal(mismatchPlan.ok, true, JSON.stringify(mismatchPlan.error))
  assert.equal(mismatchStart.ok, true, JSON.stringify(mismatchStart.error))
  assert.equal(mismatchJob.status, 'failed')
  assert.equal(mismatchRun.run.status, 'failed')
  assert.equal(mismatchRun.run.error.code, 'miniwdl_failed')
  assert.equal(mismatchRun.run.result, null)
  assert.equal(mismatchRun.run.networkIsolation.cleanup, 'removed')
  assert.equal(approvalRequests.length, 3)
  assert.equal(approvalRequests.every((requestValue) => requestValue.toolName === 'bio_workflows_run'), true)
  assert.equal(approvalRequests[0].reason.includes(selected.digest), true)
  assert.equal(approvalRequests[0].reason.includes(planned.planDigest), true)
  assert.equal(approvalRequests[1].reason.includes(cancellationPlan.planDigest), true)
  assert.equal(approvalRequests[2].reason.includes(mismatchPlan.planDigest), true)
  const approvalEvents = [...owner.session.events]
  const approvalAsked = approvalEvents.filter((event) => event.type === 'approval/asked')
  const approvalDecided = approvalEvents.filter((event) => event.type === 'approval/decided')
  assert.equal(approvalAsked.length, 3)
  assert.equal(approvalDecided.length, 3)
  assert.equal(approvalDecided.every((event) => event.data.outcome === 'allowed-once'), true)

  const sourceSha256 = {}
  for (const path of [
    'index.js',
    'src/execution.js',
    'src/execution-tools.js',
    'src/workflow-store.js',
    'schema/bio-workflow-result.schema.json',
    'workflows/bam-qc/1.1.0/main.wdl',
    'workflows/bam-qc/1.1.0/workflow.json',
    'scripts/accept-bam-qc.mjs',
  ]) {
    sourceSha256[path] = sha256Text(await readFile(join(packageRoot, path), 'utf8'))
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: '1',
    recordedAt: new Date().toISOString(),
    scope: 'real-bam-qc-admission-acceptance',
    packageVersion: PACKAGE_VERSION,
    sourceSha256,
    workflow: {
      id: selected.id,
      version: selected.version,
      bundleDigest: selected.digest,
      successPlanDigest: planned.planDigest,
      cancellationPlanDigest: cancellationPlan.planDigest,
      mismatchPlanDigest: mismatchPlan.planDigest,
    },
    runner: {
      name: planned.plan.runner.name,
      version: planned.plan.runner.version,
      containerImage: SAMTOOLS_IMAGE,
      subprocessProvider: '@deepseek-ai/dsh-subprocess-local@0.1.1-rc.2',
      jobsProvider: '@deepseek-ai/dsh-jobs-local@0.1.1-rc.2',
    },
    runtime: {
      realComponents: [
        'ApprovalService',
        'ToolRuntime',
        'bio_workflows_search',
        'bio_workflows_plan',
        'bio_workflows_run',
        'bio_workflows_run_get',
      ],
    },
    approval: {
      requests: approvalRequests.length,
      askedEvents: approvalAsked.length,
      decidedEvents: approvalDecided.length,
      outcome: 'allowed-once',
      bundleDigestBound: approvalRequests.every((item) => item.reason.includes(selected.digest)),
      planDigestsBound: [planned, cancellationPlan, mismatchPlan].every(
        (plan, index) => approvalRequests[index].reason.includes(plan.planDigest),
      ),
      ownerSession: owner.id,
    },
    input: {
      description: 'Two coordinate-sorted, synthetic, non-sensitive paired reads on one 1000-base reference plus an adjacent BAI.',
      contract: planned.plan.inputContract,
      preApprovalContentSha256: Object.fromEntries(
        planned.plan.inputFileFacts.map((fact) => [fact.input, fact.contentSha256]),
      ),
      snapshotSha256: Object.fromEntries(
        successRun.run.inputSnapshots.map((snapshot) => [snapshot.input, snapshot.sha256]),
      ),
    },
    executionPolicy: {
      networkIsolation: successRun.run.networkIsolation,
      budgets: planned.plan.budgets,
      storageBudget: successRun.run.storageBudget,
      wallTimeBudget: successRun.run.wallTimeBudget,
    },
    resultPolicy: {
      ...BIO_WORKFLOW_RESULT_LIMITS,
      canonicalTargetNoFollowOpen: true,
      descriptorIdentityRechecked: true,
    },
    success: {
      jobStatus: successJob.status,
      runStatus: successRun.run.status,
      artifacts: artifactAssertions,
      summaries: successRun.run.result.summaries,
    },
    cancellation: {
      jobStatus: cancellationJob.status,
      runStatus: cancellationRun.run.status,
      result: cancellationRun.run.result,
      networkCleanup: cancellationRun.run.networkIsolation.cleanup,
      exit: cancellationRun.run.exit,
    },
    mismatchedIndex: {
      fixture: 'valid BAI generated for a different reference dictionary',
      planningAcceptedMetadataShape: mismatchPlan.ok,
      jobStatus: mismatchJob.status,
      runStatus: mismatchRun.run.status,
      errorCode: mismatchRun.run.error.code,
      result: mismatchRun.run.result,
      networkCleanup: mismatchRun.run.networkIsolation.cleanup,
    },
    assertions: [
      'exact built-in bundle and plan digests matched before each launch',
      'all three launches traversed the real DSH ToolRuntime and one-time ApprovalService gate for the same owner session',
      'BAM and BAI canonical identities plus pre-approval SHA-256 digests were snapshot-bound',
      'the exact ephemeral internal Swarm network was verified and removed for every terminal path',
      'the WDL and miniwdl configuration fixed CPU, memory, PID, and wall-time ceilings',
      'pinned samtools quickcheck plus a rebuilt byte-identical BAI accepted the matching pair before idxstats and report generation',
      'all declared outputs stayed confined and every recorded SHA-256 matched an independent calculation',
      'bounded flagstat and idxstats parsing produced technical counts without biological interpretation',
      'an immediate real LocalJobRegistry cancellation killed the runner and retained no completed result',
      'a valid BAI for a different reference dictionary passed metadata admission but failed closed during containerized compatibility validation',
    ],
  }, null, 2)}\n`)
} finally {
  if (handle !== undefined) await handle.dispose().catch(() => {})
  if (ctx !== undefined) await ctx.fiber.dispose().catch(() => {})
  await rm(temporaryRoot, { recursive: true, force: true })
}
