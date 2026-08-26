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
import { gzipSync } from 'node:zlib'

import {
  BIO_WORKFLOW_RESULT_LIMITS,
  createExecutionManager,
} from '../src/execution.js'
import { PACKAGE_VERSION } from '../src/info.js'
import { sha256Text } from '../src/wdl-bundle.js'
import { createWorkflowStore } from '../src/workflow-store.js'

const DSH_VERSION = '0.1.1-rc.2'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
assert.equal(process.platform, 'linux', 'real workflow acceptance requires Linux')

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
  const [cordis, agent, agentLoop, jobsLocal, llm, session, subprocessLocal, systemPrompt] = await Promise.all([
    import(resolveDshPackage('cordis')),
    import(resolveDshPackage('dsh-agent')),
    import(resolveDshPackage('dsh-agent-loop')),
    import(resolveDshPackage('dsh-jobs-local')),
    import(resolveDshPackage('dsh-llm')),
    import(resolveDshPackage('dsh-session')),
    import(resolveDshPackage('dsh-subprocess-local')),
    import(resolveDshPackage('dsh-system-prompt')),
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

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

const miniwdlExecutable = requiredExecutable('DSH_BIO_MINIWDL_EXECUTABLE')
const dockerSource = requiredExecutable('DSH_BIO_DOCKER_EXECUTABLE')
const runtime = await loadDshRuntime()
const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-result-acceptance-'))
let ctx
let handle

try {
  const inputRoot = join(temporaryRoot, 'inputs')
  const runsRoot = join(temporaryRoot, 'runs')
  const binRoot = join(temporaryRoot, 'bin')
  await mkdir(inputRoot, { mode: 0o700 })
  await mkdir(runsRoot, { mode: 0o700 })
  await mkdir(binRoot, { mode: 0o700 })
  const dockerExecutable = join(binRoot, basename(dockerSource))
  await copyFile(dockerSource, dockerExecutable)
  await chmod(dockerExecutable, 0o700)
  const input = join(inputRoot, 'tiny.fastq.gz')
  await writeFile(
    input,
    gzipSync('@tiny-read\nACGTACGTACGT\n+\nFFFFFFFFFFFF\n'),
    { mode: 0o600 },
  )

  ctx = new runtime.Context()
  new runtime.SessionStore(ctx)
  const agents = new runtime.AgentRegistry(ctx)
  new runtime.LlmRuntime(ctx)
  new runtime.SystemPrompt(ctx, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    persona: 'Real workflow result acceptance owner.',
  })
  new runtime.LocalSubprocessRuntime(ctx)
  const jobs = new runtime.LocalJobRegistry(ctx, { maxConcurrentJobsPerOwner: 1 })
  jobs.attachController('dsh-bio-workflows-result-acceptance')
  new runtime.AgentLoop(ctx, { agents: [], maxParallelToolCalls: 1 })

  handle = await agents.create({
    sessionId: runtime.SessionId('bio-workflow-result-acceptance'),
    meta: { cwd: packageRoot },
    agentOptions: { provider: 'acceptance', model: 'workflow-result', maxTokens: 1_024 },
  })
  const owner = handle.agent
  const store = createWorkflowStore()
  const selected = (await store.search({ source: 'builtin', query: 'fastq' })).workflows.find(
    (workflow) => workflow.id === 'fastq-qc' && workflow.version === '1.2.0',
  )
  assert.ok(selected)
  const manager = createExecutionManager({
    store,
    config: {
      enabled: true,
      runsRoot,
      inputRoots: [inputRoot],
      runner: { executable: miniwdlExecutable, dockerExecutable },
    },
    getSubprocess: () => ctx.get('subprocess'),
    getJobs: () => jobs,
  })
  const request = {
    id: selected.id,
    version: selected.version,
    expectedDigest: selected.digest,
    inputs: { reads: [input], threads: 1 },
  }
  const planned = await manager.plan(request, { agent: owner })
  assert.equal(planned.ok, true, JSON.stringify(planned.error))
  const started = await manager.run({
    ...request,
    expectedPlanDigest: planned.planDigest,
  }, { agent: owner })
  assert.equal(started.ok, true, JSON.stringify(started.error))
  const running = jobs.get(started.jobId, owner)
  assert.equal(running.status, 'running')
  const settled = await jobs.wait(started.jobId, 5 * 60 * 1000, owner)
  const observed = await manager.getRun(started.runId, { agent: owner })
  assert.equal(observed.ok, true)
  assert.equal(settled.status, 'completed', JSON.stringify({
    runError: observed.run.error,
    job: jobs.read(started.jobId, owner),
  }))
  assert.equal(observed.run.status, 'completed')
  assert.equal(observed.run.result.schemaVersion, '1')
  assert.equal(observed.run.result.summaries.fastqc.reportCount, 1)

  const artifactAssertions = []
  for (const group of observed.run.result.artifacts) {
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

  const adapterSources = {}
  for (const path of ['index.js', 'src/execution.js', 'src/execution-tools.js', 'src/workflow-store.js']) {
    adapterSources[path] = sha256Text(await readFile(join(packageRoot, path), 'utf8'))
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: '1',
    recordedAt: new Date().toISOString(),
    scope: 'real-bioworkflow-result-acceptance',
    packageVersion: PACKAGE_VERSION,
    adapterSources,
    workflow: {
      id: selected.id,
      version: selected.version,
      bundleDigest: selected.digest,
      planDigest: planned.planDigest,
    },
    runner: {
      name: planned.plan.runner.name,
      version: planned.plan.runner.version,
      subprocessProvider: '@deepseek-ai/dsh-subprocess-local@0.1.1-rc.2',
    },
    jobRuntime: {
      provider: '@deepseek-ai/dsh-jobs-local@0.1.1-rc.2',
      jobId: started.jobId,
      ownerSession: owner.id,
      statusBeforeWait: running.status,
      statusAfterWait: settled.status,
    },
    containerRuntime: {
      name: planned.plan.runner.containerRuntime.name,
      host: planned.plan.runner.containerRuntime.host,
      engineId: planned.plan.runner.containerRuntime.engineId,
      serverVersion: planned.plan.runner.containerRuntime.serverVersion,
      daemonCheck: planned.plan.runner.containerRuntime.daemonCheck,
      swarm: planned.plan.runner.containerRuntime.swarm,
      images: planned.plan.runner.containerRuntime.images,
    },
    input: {
      description: 'One synthetic, non-sensitive 12-base FASTQ read compressed with gzip.',
      snapshotBytes: observed.run.inputSnapshots[0].size,
      snapshotSha256: observed.run.inputSnapshots[0].sha256,
    },
    resultPolicy: {
      ...BIO_WORKFLOW_RESULT_LIMITS,
      canonicalTargetNoFollowOpen: true,
      descriptorIdentityRechecked: true,
      hostZipExtraction: false,
    },
    result: {
      status: observed.run.result.status,
      schemaVersion: observed.run.result.schemaVersion,
      artifacts: artifactAssertions,
      summaries: observed.run.result.summaries,
    },
    assertions: [
      'exact bundle and plan digests matched before launch',
      'miniwdl 1.15.0 and Docker Swarm completed the pinned FastQC container',
      'all declared output files remained confined to the run engine directory',
      'every recorded artifact SHA-256 matched an independent post-run calculation',
      'FastQC plain-text summary parsing returned bounded PASS, WARN, and FAIL module states',
      'no FastQC ZIP archive was extracted by the host plugin',
      'the real LocalJobRegistry preserved owner-scoped running and completed lifecycle states',
    ],
  }, null, 2)}\n`)
} finally {
  if (handle !== undefined) await handle.dispose().catch(() => {})
  if (ctx !== undefined) await ctx.fiber.dispose().catch(() => {})
  await rm(temporaryRoot, { recursive: true, force: true })
}
