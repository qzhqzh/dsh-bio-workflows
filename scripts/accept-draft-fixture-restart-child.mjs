import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createDraftStore } from '../src/draft-store.js'
import { createDraftTestManager } from '../src/draft-test-manager.js'
import { createMissionStore } from '../src/mission-store.js'

const DSH_VERSION = '0.1.1-rc.2'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

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

const configPath = resolve(process.argv[2] ?? '')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const runtime = await loadDshRuntime()
let ctx
let handle

try {
  ctx = new runtime.Context()
  new runtime.SessionStore(ctx)
  const agents = new runtime.AgentRegistry(ctx)
  new runtime.LlmRuntime(ctx)
  new runtime.SystemPrompt(ctx, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    persona: 'Real fixture-runner restart acceptance owner.',
  })
  new runtime.LocalSubprocessRuntime(ctx)
  const jobs = new runtime.LocalJobRegistry(ctx, { maxConcurrentJobsPerOwner: 1 })
  jobs.attachController('dsh-bio-workflows-fixture-restart-acceptance')
  new runtime.AgentLoop(ctx, { agents: [], maxParallelToolCalls: 1 })
  handle = await agents.create({
    sessionId: runtime.SessionId(config.ownerSession),
    meta: { cwd: packageRoot },
    agentOptions: { provider: 'acceptance', model: 'fixture-runner-restart', maxTokens: 1_024 },
  })
  const owner = handle.agent
  assert.equal(owner.id, config.ownerSession)
  const draftStore = createDraftStore({ root: config.storeRoot, writeEnabled: true })
  const missionStore = createMissionStore(
    { root: config.storeRoot, writeEnabled: true },
    { enabled: true },
    { runtimeId: config.missionRuntimeId },
  )
  const manager = createDraftTestManager({
    missionStore,
    draftStore,
    config: config.draftTestConfig,
    getSubprocess: () => ctx.get('subprocess'),
    getJobs: () => jobs,
    runtimeId: config.controllerRuntimeId,
  })
  const operation = { ownerSession: owner.id, agent: owner, environment: {} }
  const prepared = await manager.prepare(config.request, operation)
  assert.equal(prepared.ok, true, JSON.stringify(prepared))
  const started = await manager.start({
    ...config.request,
    expectedPlanDigest: prepared.planDigest,
  }, operation)
  assert.equal(started.ok, true, JSON.stringify(started))
  process.send?.({
    type: 'controller-started',
    testId: started.testId,
    planDigest: prepared.planDigest,
  })
  setInterval(() => {}, 60_000)
} catch (error) {
  process.send?.({
    type: 'controller-failed',
    message: String(error?.message ?? error).slice(0, 2_000),
  })
  if (handle !== undefined) await handle.dispose().catch(() => {})
  if (ctx !== undefined) await ctx.fiber.dispose().catch(() => {})
  process.exitCode = 1
}
