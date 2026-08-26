import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import * as plugin from '../index.js'

const DSH_VERSION = '0.1.1-rc.2'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
assert.equal(process.platform, 'linux', 'the execution preview and this lifecycle smoke require Linux')

async function loadDshRuntime() {
  const globalRoot = execFileSync(npmCommand, ['root', '--global'], {
    encoding: 'utf8',
  }).trim()
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
  assert.fail('scripted model did not receive the expected tool result')
}

function toolCallChunks(id, name, args) {
  const argumentsText = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'tool-call-delta',
      index: 0,
      id,
      name,
      argumentsDelta: argumentsText,
    },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name, arguments: argumentsText },
    },
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

async function waitForFile(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await delay(25)
  }
  assert.fail(`timed out waiting for ${path}`)
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

const runtime = await loadDshRuntime()
const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-agent-loop-'))
let ctx
let handle

try {
  const inputRoot = join(temporaryRoot, 'inputs')
  const runsRoot = join(temporaryRoot, 'runs')
  const binRoot = join(temporaryRoot, 'bin')
  await mkdir(inputRoot, { mode: 0o700 })
  await mkdir(runsRoot, { mode: 0o700 })
  await mkdir(binRoot, { mode: 0o700 })

  const input = join(inputRoot, 'tiny.fastq.gz')
  await writeFile(
    input,
    gzipSync('@tiny-read\nACGTACGTACGT\n+\nFFFFFFFFFFFF\n'),
    { mode: 0o600 },
  )

  const miniwdlExecutable = join(binRoot, 'miniwdl')
  await writeFile(miniwdlExecutable, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'miniwdl v1.15.0'
  exit 0
fi
if [ "$1" = "check" ]; then
  exit 0
fi
if [ "$1" = "run" ]; then
  trap 'exit 143' TERM INT HUP
  /bin/sleep 300 &
  child_pid=$!
  printf '%s %s\\n' "$$" "$child_pid" > runner.pids
  wait "$child_pid"
fi
exit 2
`, { mode: 0o700 })
  await chmod(miniwdlExecutable, 0o700)

  const dockerExecutable = join(binRoot, 'docker')
  await writeFile(dockerExecutable, `#!/bin/sh
if [ "$1" = "version" ]; then
  printf '%s\\n' '29.3.1'
  exit 0
fi
if [ "$1" = "info" ]; then
  printf '%s\\n' 'agent-loop-engine active true'
  exit 0
fi
exit 2
`, { mode: 0o700 })
  await chmod(dockerExecutable, 0o700)

  ctx = new runtime.Context()
  const sessions = new runtime.SessionStore(ctx)
  const agents = new runtime.AgentRegistry(ctx)
  const llm = new runtime.LlmRuntime(ctx)
  new runtime.SystemPrompt(ctx, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    persona: 'Use the bioinformatics workflow tools exactly as requested.',
  })
  new runtime.ToolRuntime(ctx, { mode: 'native' })
  new runtime.LocalSubprocessRuntime(ctx)
  const jobs = new runtime.LocalJobRegistry(ctx, { maxConcurrentJobsPerOwner: 1 })
  jobs.attachController('dsh-bio-workflows-agent-loop-acceptance')
  new runtime.ApprovalService(ctx, { policy: 'ask' })

  const approvalRequests = []
  ctx.on('approval/request', async (request, next) => {
    if (request.toolName !== 'bio_workflows_run') return next()
    approvalRequests.push(request)
    return 'allowed-once'
  })

  plugin.apply(ctx, {
    execution: {
      enabled: true,
      runsRoot,
      inputRoots: [inputRoot],
      runner: { executable: miniwdlExecutable, dockerExecutable },
    },
  })

  class ScriptedWorkflowAdapter extends runtime.LlmAdapter {
    calls = []
    selectedWorkflow = null
    startedRun = null

    async *stream(options) {
      this.calls.push(options)
      assert.equal(options.provider, 'acceptance')
      assert.equal(options.model, 'workflow-agent')
      assert.ok(options.tools.some((tool) => tool.name === 'bio_workflows_search'))
      assert.ok(options.tools.some((tool) => tool.name === 'bio_workflows_plan'))
      assert.ok(options.tools.some((tool) => tool.name === 'bio_workflows_run'))

      let chunks
      if (this.calls.length === 1) {
        chunks = toolCallChunks('call-search', 'bio_workflows_search', {
          query: 'fastq',
          source: 'builtin',
        })
      } else if (this.calls.length === 2) {
        const search = latestToolValue(options.messages)
        this.selectedWorkflow = search.workflows.find(
          (workflow) => workflow.id === 'fastq-qc' && workflow.version === '1.1.0',
        )
        assert.ok(this.selectedWorkflow)
        chunks = toolCallChunks('call-plan', 'bio_workflows_plan', {
          id: this.selectedWorkflow.id,
          version: this.selectedWorkflow.version,
          expectedDigest: this.selectedWorkflow.digest,
          inputs: { reads: [input], threads: 1 },
        })
      } else if (this.calls.length === 3) {
        const plan = latestToolValue(options.messages)
        assert.equal(plan.ok, true)
        chunks = toolCallChunks('call-run', 'bio_workflows_run', {
          id: this.selectedWorkflow.id,
          version: this.selectedWorkflow.version,
          expectedDigest: this.selectedWorkflow.digest,
          inputs: { reads: [input], threads: 1 },
          expectedPlanDigest: plan.planDigest,
        })
      } else if (this.calls.length === 4) {
        this.startedRun = latestToolValue(options.messages)
        assert.equal(this.startedRun.ok, true)
        chunks = textChunks(`Started ${this.startedRun.runId}`)
      } else {
        assert.fail(`unexpected scripted model call ${this.calls.length}`)
      }

      for (const chunk of chunks) yield chunk
    }
  }

  const adapter = new ScriptedWorkflowAdapter()
  llm.registerAdapter(['acceptance'], adapter)
  new runtime.AgentLoop(ctx, { agents: [], maxParallelToolCalls: 1 })

  const sessionId = runtime.SessionId('bio-workflow-owner-disposal')
  handle = await agents.create({
    sessionId,
    meta: { cwd: packageRoot },
    agentOptions: {
      provider: 'acceptance',
      model: 'workflow-agent',
      maxTokens: 1_024,
    },
  })
  const agentErrors = []
  handle.agent.ctx.on('agent/error', ({ error }) => agentErrors.push(error))
  handle.agent.followup(runtime.createUserMessage({
    content: [{ type: 'text', text: 'Find, plan, and start the built-in FASTQ QC workflow.' }],
    source: { kind: 'user' },
  }))
  await handle.agent.whenIdle()

  assert.deepEqual(agentErrors, [])
  assert.equal(adapter.calls.length, 4)
  assert.equal(approvalRequests.length, 1)
  assert.match(approvalRequests[0].reason, /fastq-qc@1\.1\.0/)
  assert.match(approvalRequests[0].reason, /sha256:[a-f0-9]{64}/)

  const started = adapter.startedRun
  assert.ok(started)
  const ownerAgent = handle.agent
  const beforeDispose = jobs.get(started.jobId, ownerAgent)
  assert.equal(beforeDispose.status, 'running')
  assert.equal(beforeDispose.ownerSession, sessionId)
  const [runnerPid, childPid] = (await waitForFile(join(started.runDirectory, 'runner.pids')))
    .trim()
    .split(' ')
    .map(Number)
  assert.equal(Number.isSafeInteger(runnerPid), true)
  assert.equal(Number.isSafeInteger(childPid), true)
  assert.equal(processExists(runnerPid), true)
  assert.equal(processExists(childPid), true)

  const sessionEvents = [...handle.agent.session.events]
  const approvalAsked = sessionEvents.filter((event) => event.type === 'approval/asked')
  const approvalDecided = sessionEvents.filter((event) => event.type === 'approval/decided')
  assert.equal(approvalAsked.length, 1)
  assert.equal(approvalDecided.length, 1)
  assert.equal(approvalDecided[0].data.outcome, 'allowed-once')
  assert.equal(approvalDecided[0].data.id, approvalAsked[0].data.id)
  assert.equal(
    sessionEvents.filter((event) => event.type === 'tool/call').length,
    3,
  )
  assert.equal(
    sessionEvents.filter((event) => event.type === 'tool/result').length,
    3,
  )

  await handle.dispose()
  handle = undefined

  assert.equal(agents.get(sessionId), undefined)
  assert.equal(sessions.get(sessionId), undefined)
  assert.deepEqual(jobs.list(ownerAgent), [])
  assert.equal(processExists(runnerPid), false)
  assert.equal(processExists(childPid), false)

  const provenance = JSON.parse(await readFile(join(started.runDirectory, 'run.json'), 'utf8'))
  assert.equal(provenance.runId, started.runId)
  assert.equal(provenance.jobId, started.jobId)
  assert.equal(provenance.ownerSession, sessionId)
  assert.equal(provenance.status, 'killed')
  assert.equal(provenance.finishedAt === null, false)

  process.stdout.write(`${JSON.stringify({
    dshVersion: DSH_VERSION,
    workflow: {
      key: `${adapter.selectedWorkflow.id}@${adapter.selectedWorkflow.version}`,
      bundleDigest: adapter.selectedWorkflow.digest,
      planDigest: started.planDigest,
    },
    modelCalls: adapter.calls.length,
    toolCalls: ['bio_workflows_search', 'bio_workflows_plan', 'bio_workflows_run'],
    approval: {
      requests: approvalRequests.length,
      auditPairs: approvalAsked.length,
    },
    owner: {
      sessionId,
      disposed: true,
      agentRemoved: agents.get(sessionId) === undefined,
      sessionRemoved: sessions.get(sessionId) === undefined,
    },
    job: {
      id: started.jobId,
      statusBeforeDispose: beforeDispose.status,
      removedAfterDispose: jobs.list(ownerAgent).length === 0,
    },
    run: {
      id: started.runId,
      statusAfterDispose: provenance.status,
      exit: provenance.exit,
      runnerProcessStopped: !processExists(runnerPid),
      childProcessStopped: !processExists(childPid),
    },
  }, null, 2)}\n`)
} finally {
  if (handle !== undefined) await handle.dispose().catch(() => {})
  if (ctx !== undefined) await ctx.fiber.dispose().catch(() => {})
  await rm(temporaryRoot, { recursive: true, force: true })
}
