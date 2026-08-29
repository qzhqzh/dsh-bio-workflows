import type { ToolViewBlock } from './types.ts'

const MAX_TOOL_CONTENT_BLOCKS = 128
const MAX_TOOL_RESULT_CHARACTERS = 4 * 1024 * 1024
const MAX_RUN_LIST_ITEMS = 50
const MAX_PRESENTED_RUNS = 20
const MAX_ARTIFACT_GROUPS = 1024
const MAX_ARTIFACT_ITEMS = 1024
const MAX_PRESENTED_ARTIFACT_GROUPS = 12
const MAX_PRESENTED_ARTIFACT_ITEMS = 3
const MAX_FASTQC_REPORTS = 1024
const MAX_PRESENTED_FASTQC_REPORTS = 12
const MAX_FASTQC_MODULES = 16_384
const MAX_RESULT_ARTIFACT_BYTES = 16n * 1024n * 1024n * 1024n
const MAX_TOTAL_RESULT_ARTIFACT_BYTES = 64n * 1024n * 1024n * 1024n

const RUN_ID = /^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const DIGEST = /^sha256:[a-f0-9]{64}$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/
const DISPLAY_BASENAME = /^(?!\.{1,2}$)[^/\\]+$/
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const UNSAFE_DISPLAY_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u

export const RUN_LIFECYCLE_STATUSES = [
  'prepared',
  'running',
  'stopping',
  'completed',
  'failed',
  'killed',
  'interrupted',
] as const

export type RunLifecycleStatus = typeof RUN_LIFECYCLE_STATUSES[number]

const RUN_STATUS_SET = new Set<string>(RUN_LIFECYCLE_STATUSES)
const TERMINAL_RUN_STATUS_SET = new Set<RunLifecycleStatus>(['completed', 'failed', 'killed', 'interrupted'])
const FASTQC_STATUS_SET = new Set(['pass', 'warn', 'fail'])

export interface RunWorkflowIdentity {
  id: string
  version: string
  bundleDigest: string
}

export interface RunArtifactItemProjection {
  relativePath: string
  sizeBytes: string
  sha256: string
}

export interface RunArtifactGroupProjection {
  outputId: string
  itemCount: number
  totalBytes: string
  examples: RunArtifactItemProjection[]
  examplesOmitted: number
}

export interface FastqcCounts {
  pass: number
  warn: number
  fail: number
}

export interface FastqcReportProjection {
  sample: string
  overallStatus: 'pass' | 'warn' | 'fail'
  counts: FastqcCounts
}

export interface FastqcSummaryProjection {
  reportCount: number
  moduleCounts: FastqcCounts
  reports: FastqcReportProjection[]
  reportsOmitted: number
}

export interface RunNormalizedResultProjection {
  generatedAt: string
  artifactCount: number
  totalBytes: string
  artifactGroups: RunArtifactGroupProjection[]
  artifactGroupsOmitted: number
  fastqc?: FastqcSummaryProjection
  diagnostics: Array<{ code: string }>
  diagnosticsOmitted: number
}

export interface RunDetailsProjection {
  runId: string
  jobId?: string
  status: RunLifecycleStatus
  startedAt: string
  finishedAt?: string
  workflow: RunWorkflowIdentity
  planDigest?: string
  resultState: 'available' | 'missing' | 'invalid'
  result?: RunNormalizedResultProjection
  error?: { code: string }
}

export interface RunHistoryItemProjection {
  runId: string
  status: RunLifecycleStatus
  startedAt: string
  finishedAt?: string
  workflow: RunWorkflowIdentity
}

export interface RunHistoryProjection {
  runs: RunHistoryItemProjection[]
  hiddenCount: number
  hasNextPage: boolean
  incomplete: boolean
}

export type ToolProjection<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; value: T }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function boundedDisplayString(value: unknown, maximum: number): value is string {
  return boundedString(value, maximum) && !UNSAFE_DISPLAY_CHARACTERS.test(value)
}

function isoDate(value: unknown): value is string {
  if (!boundedString(value, 64) || !ISO_TIMESTAMP.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function validLifecycleTimes(status: RunLifecycleStatus, startedAt: string, finishedAt: unknown) {
  const terminal = TERMINAL_RUN_STATUS_SET.has(status)
  if (terminal !== (typeof finishedAt === 'string')) return false
  return typeof finishedAt !== 'string' || Date.parse(finishedAt) >= Date.parse(startedAt)
}

function lifecycleStatus(value: unknown): value is RunLifecycleStatus {
  return typeof value === 'string' && RUN_STATUS_SET.has(value)
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value)
}

function workflowIdentity(value: unknown): RunWorkflowIdentity | null {
  if (!isRecord(value)
    || !boundedString(value.id, 160) || !IDENTIFIER.test(value.id)
    || !boundedString(value.version, 96) || !SEMVER.test(value.version)
    || !digest(value.bundleDigest)
  ) return null
  return { id: value.id, version: value.version, bundleDigest: value.bundleDigest }
}

function sameWorkflow(left: RunWorkflowIdentity, right: RunWorkflowIdentity) {
  return left.id === right.id
    && left.version === right.version
    && left.bundleDigest === right.bundleDigest
}

function safeError(value: unknown): { code: string } | undefined {
  if (value === null || value === undefined) return undefined
  if (!isRecord(value)
    || !boundedString(value.code, 96) || !IDENTIFIER.test(value.code)
  ) return undefined
  return { code: value.code }
}

function toolPayload(block: ToolViewBlock): ToolProjection<Record<string, unknown>> {
  if (block.kind !== 'tool-result') return { state: 'loading' }
  if (!Array.isArray(block.content) || block.content.length > MAX_TOOL_CONTENT_BLOCKS) {
    return { state: 'error', message: 'The result exceeds the safe replay limit.' }
  }
  const parts: string[] = []
  let characters = 0
  for (const item of block.content) {
    if (item?.type !== 'text' || typeof item.text !== 'string') continue
    characters += item.text.length
    if (characters > MAX_TOOL_RESULT_CHARACTERS) {
      return { state: 'error', message: 'The result exceeds the safe replay limit.' }
    }
    parts.push(item.text)
  }
  const text = parts.join('\n')
  if (text.length === 0) return { state: 'loading' }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { state: 'error', message: 'The Agent returned an unreadable workflow result.' }
  }
  if (!isRecord(value)) {
    return { state: 'error', message: 'The Agent returned an invalid workflow result.' }
  }
  if (block.isError === true || value.ok === false || value.error !== null && value.error !== undefined) {
    const error = safeError(value.error)
    return {
      state: 'error',
      message: error === undefined
        ? 'The workflow result could not be retrieved. Ask the Agent to explain the failure.'
        : `The workflow result could not be retrieved (${error.code}). Ask the Agent to explain the failure.`,
    }
  }
  if (value.ok !== true) {
    return { state: 'error', message: 'The Agent returned an invalid workflow result.' }
  }
  return { state: 'ready', value }
}

function requestedRunId(block: ToolViewBlock): string | null | false {
  const raw = block.call?.argsRaw ?? block.argsRaw
  let args: unknown = raw
  if (typeof raw === 'string') {
    if (raw.length > 64 * 1024) return false
    try {
      args = JSON.parse(raw)
    } catch {
      return false
    }
  }
  if (!isRecord(args) || args.runId === undefined) return null
  return typeof args.runId === 'string' && RUN_ID.test(args.runId) ? args.runId : false
}

function byteCount(value: unknown, maximum: bigint): bigint | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value) || value.length > 20) return null
  const parsed = BigInt(value)
  return parsed <= maximum ? parsed : null
}

function fastqcCounts(value: unknown): FastqcCounts | null {
  if (!isRecord(value)) return null
  const counts = { pass: value.pass, warn: value.warn, fail: value.fail }
  if (!Object.values(counts).every((count) => Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= MAX_FASTQC_MODULES)) {
    return null
  }
  return counts as FastqcCounts
}

function sameCounts(left: FastqcCounts, right: FastqcCounts) {
  return left.pass === right.pass && left.warn === right.warn && left.fail === right.fail
}

function projectFastqcSummary(value: unknown, summaryArtifactReferences: Set<string>): FastqcSummaryProjection | null {
  if (!isRecord(value)
    || value.schemaVersion !== '1'
    || !Number.isSafeInteger(value.reportCount) || Number(value.reportCount) < 1 || Number(value.reportCount) > MAX_FASTQC_REPORTS
    || !Array.isArray(value.reports) || value.reports.length !== value.reportCount
  ) return null
  const moduleCounts = fastqcCounts(value.moduleCounts)
  if (moduleCounts === null) return null

  const aggregate: FastqcCounts = { pass: 0, warn: 0, fail: 0 }
  const reportArtifactReferences = new Set<string>()
  let totalModules = 0
  const reports: FastqcReportProjection[] = []
  for (const report of value.reports) {
    if (!isRecord(report)
      || !isRecord(report.artifact)
      || report.artifact.outputId !== 'summary_reports'
      || !Number.isSafeInteger(report.artifact.ordinal) || Number(report.artifact.ordinal) < 0 || Number(report.artifact.ordinal) > 1023
      || !summaryArtifactReferences.has(`${report.artifact.outputId}:${report.artifact.ordinal}`)
      || reportArtifactReferences.has(`${report.artifact.outputId}:${report.artifact.ordinal}`)
      || !boundedDisplayString(report.sample, 512) || !DISPLAY_BASENAME.test(report.sample)
      || typeof report.overallStatus !== 'string' || !FASTQC_STATUS_SET.has(report.overallStatus)
      || !Array.isArray(report.modules) || report.modules.length < 1 || report.modules.length > 512
    ) return null
    reportArtifactReferences.add(`${report.artifact.outputId}:${report.artifact.ordinal}`)
    const counts = fastqcCounts(report.counts)
    if (counts === null) return null
    const observed: FastqcCounts = { pass: 0, warn: 0, fail: 0 }
    const moduleNames = new Set<string>()
    for (const module of report.modules) {
      if (!isRecord(module)
        || !boundedDisplayString(module.name, 256) || moduleNames.has(module.name)
        || typeof module.status !== 'string' || !FASTQC_STATUS_SET.has(module.status)
      ) return null
      moduleNames.add(module.name)
      observed[module.status as keyof FastqcCounts] += 1
      totalModules += 1
      if (totalModules > MAX_FASTQC_MODULES) return null
    }
    if (!sameCounts(counts, observed)) return null
    const expectedOverall = counts.fail > 0 ? 'fail' : counts.warn > 0 ? 'warn' : 'pass'
    if (report.overallStatus !== expectedOverall) return null
    aggregate.pass += counts.pass
    aggregate.warn += counts.warn
    aggregate.fail += counts.fail
    if (reports.length < MAX_PRESENTED_FASTQC_REPORTS) {
      reports.push({
        sample: report.sample,
        overallStatus: report.overallStatus as FastqcReportProjection['overallStatus'],
        counts,
      })
    }
  }
  if (!sameCounts(moduleCounts, aggregate)
    || reportArtifactReferences.size !== summaryArtifactReferences.size
    || [...summaryArtifactReferences].some((reference) => !reportArtifactReferences.has(reference))
  ) return null
  return {
    reportCount: Number(value.reportCount),
    moduleCounts,
    reports,
    reportsOmitted: Number(value.reportCount) - reports.length,
  }
}

function projectNormalizedResult(
  value: unknown,
  workflow: RunWorkflowIdentity,
  planDigest: string,
): RunNormalizedResultProjection | null {
  if (!isRecord(value)
    || value.schemaVersion !== '1'
    || value.status !== 'completed'
    || !isoDate(value.generatedAt)
    || !digest(value.planDigest) || value.planDigest !== planDigest
    || !Array.isArray(value.artifacts) || value.artifacts.length > MAX_ARTIFACT_GROUPS
    || !isRecord(value.summaries)
    || !Array.isArray(value.diagnostics) || value.diagnostics.length > 32
  ) return null
  const resultWorkflow = workflowIdentity(value.workflow)
  if (resultWorkflow === null || !sameWorkflow(resultWorkflow, workflow)) return null

  let artifactCount = 0
  let totalBytes = 0n
  const artifactGroups: RunArtifactGroupProjection[] = []
  const outputIds = new Set<string>()
  const artifactReferences = new Set<string>()
  for (const group of value.artifacts) {
    if (!isRecord(group)
      || !boundedString(group.outputId, 160) || !IDENTIFIER.test(group.outputId) || outputIds.has(group.outputId)
      || group.type !== 'file'
      || group.cardinality !== 'one' && group.cardinality !== 'many'
      || !Array.isArray(group.items) || group.items.length > MAX_ARTIFACT_ITEMS
    ) return null
    outputIds.add(group.outputId)
    let groupBytes = 0n
    const ordinals = new Set<number>()
    const examples: RunArtifactItemProjection[] = []
    for (const [itemIndex, item] of group.items.entries()) {
      if (!isRecord(item)
        || !Number.isSafeInteger(item.ordinal) || Number(item.ordinal) !== itemIndex || ordinals.has(Number(item.ordinal))
        || !boundedDisplayString(item.relativePath, 4096) || !RELATIVE_PATH.test(item.relativePath)
        || !digest(item.sha256)
      ) return null
      const size = byteCount(item.sizeBytes, MAX_RESULT_ARTIFACT_BYTES)
      if (size === null) return null
      ordinals.add(Number(item.ordinal))
      if (group.outputId === 'summary_reports') artifactReferences.add(`${group.outputId}:${item.ordinal}`)
      artifactCount += 1
      if (artifactCount > MAX_ARTIFACT_ITEMS) return null
      groupBytes += size
      totalBytes += size
      if (totalBytes > MAX_TOTAL_RESULT_ARTIFACT_BYTES) return null
      if (examples.length < MAX_PRESENTED_ARTIFACT_ITEMS) {
        examples.push({ relativePath: item.relativePath, sizeBytes: size.toString(), sha256: item.sha256 })
      }
    }
    if (artifactGroups.length < MAX_PRESENTED_ARTIFACT_GROUPS) {
      artifactGroups.push({
        outputId: group.outputId,
        itemCount: group.items.length,
        totalBytes: groupBytes.toString(),
        examples,
        examplesOmitted: group.items.length - examples.length,
      })
    }
  }

  const summaryKeys = Object.keys(value.summaries)
  if (summaryKeys.some((key) => key !== 'fastqc')) return null
  let fastqc: FastqcSummaryProjection | undefined
  if (value.summaries.fastqc !== undefined) {
    const projectedFastqc = projectFastqcSummary(value.summaries.fastqc, artifactReferences)
    if (projectedFastqc === null) return null
    fastqc = projectedFastqc
  }

  const diagnostics: Array<{ code: string }> = []
  for (const diagnostic of value.diagnostics) {
    if (!isRecord(diagnostic)
      || !boundedString(diagnostic.code, 96) || !IDENTIFIER.test(diagnostic.code)
    ) return null
    if (diagnostics.length < 8) diagnostics.push({ code: diagnostic.code })
  }

  return {
    generatedAt: value.generatedAt,
    artifactCount,
    totalBytes: totalBytes.toString(),
    artifactGroups,
    artifactGroupsOmitted: value.artifacts.length - artifactGroups.length,
    ...(fastqc === undefined ? {} : { fastqc }),
    diagnostics,
    diagnosticsOmitted: value.diagnostics.length - diagnostics.length,
  }
}

function projectRunRecord(value: unknown): RunDetailsProjection | null {
  if (!isRecord(value)
    || value.schemaVersion !== '1'
    || !boundedString(value.runId, 64) || !RUN_ID.test(value.runId)
    || !lifecycleStatus(value.status)
    || !isoDate(value.startedAt)
    || value.finishedAt !== null && value.finishedAt !== undefined && !isoDate(value.finishedAt)
    || !validLifecycleTimes(value.status, value.startedAt, value.finishedAt)
    || !isRecord(value.plan)
    || !digest(value.planDigest)
    || value.jobId !== null && value.jobId !== undefined && (!boundedString(value.jobId, 160) || !JOB_ID.test(value.jobId))
  ) return null
  const workflow = workflowIdentity(value.plan.workflow)
  if (workflow === null) return null
  const error = safeError(value.error)
  if (value.error !== null && value.error !== undefined && error === undefined) return null
  const hasResult = value.result !== null && value.result !== undefined
  if (value.status === 'completed' && error !== undefined
    || value.status !== 'completed' && hasResult
    || !TERMINAL_RUN_STATUS_SET.has(value.status) && error !== undefined
    || (value.status === 'failed' || value.status === 'interrupted') && error === undefined
  ) return null

  let resultState: RunDetailsProjection['resultState'] = 'missing'
  let result: RunNormalizedResultProjection | undefined
  if (hasResult) {
    const projectedResult = projectNormalizedResult(value.result, workflow, value.planDigest)
    if (projectedResult !== null
      && typeof value.finishedAt === 'string'
      && Date.parse(projectedResult.generatedAt) >= Date.parse(value.startedAt)
      && Date.parse(projectedResult.generatedAt) <= Date.parse(value.finishedAt)
    ) result = projectedResult
    resultState = result === undefined ? 'invalid' : 'available'
  }
  return {
    runId: value.runId,
    ...(typeof value.jobId === 'string' ? { jobId: value.jobId } : {}),
    status: value.status,
    startedAt: value.startedAt,
    ...(typeof value.finishedAt === 'string' ? { finishedAt: value.finishedAt } : {}),
    workflow,
    planDigest: value.planDigest,
    resultState,
    ...(result === undefined || result === null ? {} : { result }),
    ...(error === undefined ? {} : { error }),
  }
}

export function projectRunGetToolResult(block: ToolViewBlock): ToolProjection<RunDetailsProjection> {
  const payload = toolPayload(block)
  if (payload.state !== 'ready') return payload
  const requested = requestedRunId(block)
  if (requested === false) {
    return { state: 'error', message: 'The requested run identity is invalid.' }
  }
  const run = projectRunRecord(payload.value.run)
  if (run === null || requested !== null && requested !== run.runId) {
    return { state: 'error', message: 'The run result does not match a valid requested workflow run.' }
  }
  return { state: 'ready', value: run }
}

function projectHistoryItem(value: unknown): RunHistoryItemProjection | null {
  if (!isRecord(value)
    || !boundedString(value.runId, 64) || !RUN_ID.test(value.runId)
    || !lifecycleStatus(value.status)
    || !isoDate(value.startedAt)
    || value.finishedAt !== null && value.finishedAt !== undefined && !isoDate(value.finishedAt)
    || !validLifecycleTimes(value.status, value.startedAt, value.finishedAt)
  ) return null
  const workflow = workflowIdentity(value.workflow)
  if (workflow === null) return null
  return {
    runId: value.runId,
    status: value.status,
    startedAt: value.startedAt,
    ...(typeof value.finishedAt === 'string' ? { finishedAt: value.finishedAt } : {}),
    workflow,
  }
}

export function projectRunListToolResult(block: ToolViewBlock): ToolProjection<RunHistoryProjection> {
  const payload = toolPayload(block)
  if (payload.state !== 'ready') return payload
  if (!Array.isArray(payload.value.runs) || payload.value.runs.length > MAX_RUN_LIST_ITEMS
    || !Number.isSafeInteger(payload.value.count) || Number(payload.value.count) !== payload.value.runs.length
    || typeof payload.value.truncated !== 'boolean'
    || !Array.isArray(payload.value.diagnostics) || payload.value.diagnostics.length > 32
    || payload.value.nextCursor !== null && (typeof payload.value.nextCursor !== 'string' || !RUN_ID.test(payload.value.nextCursor))
  ) return { state: 'error', message: 'The Agent returned an invalid run history.' }

  const projected: RunHistoryItemProjection[] = []
  const seen = new Set<string>()
  let previousStartedAt = Number.POSITIVE_INFINITY
  for (const candidate of payload.value.runs) {
    const run = projectHistoryItem(candidate)
    if (run === null || seen.has(run.runId)) {
      return { state: 'error', message: 'The Agent returned an invalid run history.' }
    }
    const startedAt = Date.parse(run.startedAt)
    if (startedAt > previousStartedAt) {
      return { state: 'error', message: 'The Agent returned an invalid run history.' }
    }
    previousStartedAt = startedAt
    seen.add(run.runId)
    if (projected.length < MAX_PRESENTED_RUNS) projected.push(run)
  }
  return {
    state: 'ready',
    value: {
      runs: projected,
      hiddenCount: payload.value.runs.length - projected.length,
      hasNextPage: payload.value.nextCursor !== null,
      incomplete: payload.value.truncated || payload.value.diagnostics.length > 0,
    },
  }
}
