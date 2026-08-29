import { useId, useMemo } from 'react'

import { CheckIcon, RunsIcon, WarningIcon } from './icons.tsx'
import {
  projectRunGetToolResult,
  projectRunListToolResult,
  type FastqcCounts,
  type RunDetailsProjection,
  type RunHistoryItemProjection,
  type RunLifecycleStatus,
} from './run-result.ts'
import type { ToolViewProps } from './types.ts'

type ResultTone = 'success' | 'warning' | 'error' | 'neutral'

const STATUS_COPY: Record<RunLifecycleStatus, { label: string; heading: string; tone: ResultTone }> = {
  prepared: { label: 'Prepared', heading: 'Analysis is prepared', tone: 'neutral' },
  running: { label: 'Running', heading: 'Analysis is running', tone: 'neutral' },
  stopping: { label: 'Stopping', heading: 'Cancellation is in progress', tone: 'warning' },
  completed: { label: 'Completed', heading: 'Analysis completed', tone: 'success' },
  failed: { label: 'Failed', heading: 'Analysis did not complete', tone: 'error' },
  killed: { label: 'Cancelled', heading: 'Analysis was cancelled', tone: 'warning' },
  interrupted: { label: 'Interrupted', heading: 'Analysis was interrupted', tone: 'warning' },
}

const FAILURE_DETAIL_BY_CODE: Record<string, string> = {
  miniwdl_failed: 'The workflow engine reported a failure. Inspect bounded job output in the Agent task before preparing another run.',
  network_cleanup_failed: 'The isolation network could not be cleaned up safely, so no successful result is claimed.',
  output_collection_failed: 'Declared outputs could not be collected into a verified result. No output files are presented here.',
  result_collection_failed: 'Declared outputs did not satisfy the result contract. No output files are presented here.',
  run_interrupted: 'Runtime continuity was lost and no automatic retry occurred. Review provenance before deciding what to do next.',
  run_storage_budget_exceeded: 'The run exceeded its storage budget and was stopped. No successful result is claimed.',
  runner_lifecycle_failed: 'The isolated runner did not complete its lifecycle safely. No successful result is claimed.',
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatDate(value: string) {
  return DATE_FORMAT.format(new Date(value))
}

function formatBytes(value: string) {
  const bytes = Number(BigInt(value))
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let scaled = bytes
  let unit = -1
  do {
    scaled /= 1024
    unit += 1
  } while (scaled >= 1024 && unit < units.length - 1)
  return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unit]}`
}

function shortDigest(value: string) {
  return `${value.slice(0, 19)}…`
}

function outputLabel(value: string) {
  const known: Record<string, string> = {
    html_reports: 'HTML reports',
    zip_reports: 'ZIP reports',
    summary_reports: 'Summary reports',
  }
  if (known[value] !== undefined) return known[value]
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function workflowLabel(run: Pick<RunDetailsProjection, 'workflow'> | Pick<RunHistoryItemProjection, 'workflow'>) {
  return `${run.workflow.id}@${run.workflow.version}`
}

function ToolState({ error }: { error?: string }) {
  if (error !== undefined) {
    return <div className="dsh-bio-tool-state dsh-bio-tool-state--error" role="alert"><WarningIcon />{error}</div>
  }
  return <div className="dsh-bio-tool-state" aria-live="polite"><span className="dsh-bio-spinner" />Reading workflow result…</div>
}

function StatusBadge({ status }: { status: RunLifecycleStatus }) {
  const copy = STATUS_COPY[status]
  return <span className={`dsh-bio-badge dsh-bio-badge--${copy.tone}`}>{copy.label}</span>
}

function FastqcCountsView({ counts }: { counts: FastqcCounts }) {
  return (
    <dl className="dsh-bio-result__qc-counts" aria-label="FastQC module results">
      <div data-tone="success"><dt>Passed</dt><dd>{counts.pass}</dd></div>
      <div data-tone="warning"><dt>Warnings</dt><dd>{counts.warn}</dd></div>
      <div data-tone="error"><dt>Failed</dt><dd>{counts.fail}</dd></div>
    </dl>
  )
}

function outcomeCopy(run: RunDetailsProjection) {
  const status = STATUS_COPY[run.status]
  const result = run.result
  if (run.status !== 'completed') {
    const fallback = {
      prepared: 'The approved execution has not started yet. Progress remains in the Agent task.',
      running: 'The approved workflow is still running. Progress and bounded job output remain in the Agent task.',
      stopping: 'A cancellation request is settling. Partial outputs are not presented as results.',
      failed: 'No successful analysis result is claimed. Inspect the bounded failure evidence before preparing another run.',
      killed: 'The run stopped by request. Any partial files are not presented as completed outputs.',
      interrupted: 'Runtime continuity was lost and no automatic retry occurred. Review provenance before deciding what to do next.',
      completed: '',
    }[run.status]
    const detail = run.error === undefined
      ? fallback
      : FAILURE_DETAIL_BY_CODE[run.error.code] ?? fallback
    return { ...status, detail }
  }
  if (run.resultState === 'invalid') {
    return {
      ...status,
      tone: 'warning' as const,
      detail: 'The run reached completed state, but its normalized result could not be safely verified in this view.',
    }
  }
  if (run.resultState === 'missing' || result === undefined) {
    return {
      ...status,
      tone: 'warning' as const,
      detail: 'The run reached completed state, but this historical record has no BioWorkflowResult v1 summary.',
    }
  }
  const fastqc = result.fastqc
  if (fastqc !== undefined) {
    const { pass, warn, fail } = fastqc.moduleCounts
    const reports = `${fastqc.reportCount} ${fastqc.reportCount === 1 ? 'sample' : 'samples'}`
    if (fail > 0) {
      return {
        ...status,
        tone: 'warning' as const,
        detail: `FastQC finished for ${reports}. ${fail} checks failed and ${warn} warned; review the technical QC findings before downstream analysis.`,
      }
    }
    if (warn > 0) {
      return {
        ...status,
        tone: 'warning' as const,
        detail: `FastQC finished for ${reports}. ${pass} checks passed and ${warn} warned; review the warnings before downstream analysis.`,
      }
    }
    return {
      ...status,
      detail: `FastQC finished for ${reports}; all ${pass} published checks passed.`,
    }
  }
  return {
    ...status,
    detail: `The approved workflow finished and produced ${result.artifactCount} checksummed ${result.artifactCount === 1 ? 'file' : 'files'}. No structured biological summary is published for this workflow.`,
  }
}

function ResultIcon({ tone }: { tone: ResultTone }) {
  if (tone === 'success') return <CheckIcon />
  if (tone === 'neutral') return <RunsIcon />
  return <WarningIcon />
}

function RunTechnicalEvidence({ run }: { run: RunDetailsProjection }) {
  const result = run.result
  return (
    <details className="dsh-bio-result__evidence">
      <summary><span>Technical evidence</span><small>Provenance and checksums</small></summary>
      <div className="dsh-bio-result__evidence-body">
        <dl className="dsh-bio-result__facts">
          <div><dt>Run</dt><dd><code>{run.runId}</code></dd></div>
          <div><dt>Workflow</dt><dd>{workflowLabel(run)}</dd></div>
          <div><dt>Started</dt><dd>{formatDate(run.startedAt)}</dd></div>
          {run.finishedAt !== undefined ? <div><dt>Finished</dt><dd>{formatDate(run.finishedAt)}</dd></div> : null}
          {result !== undefined ? <div><dt>Result recorded</dt><dd>{formatDate(result.generatedAt)}</dd></div> : null}
          {run.jobId !== undefined ? <div><dt>DSH job</dt><dd><code>{run.jobId}</code></dd></div> : null}
          <div><dt>Bundle</dt><dd><code title={run.workflow.bundleDigest}>{shortDigest(run.workflow.bundleDigest)}</code></dd></div>
          {run.planDigest !== undefined ? <div><dt>Approved plan</dt><dd><code title={run.planDigest}>{shortDigest(run.planDigest)}</code></dd></div> : null}
          {run.error !== undefined ? <div><dt>Failure code</dt><dd><code>{run.error.code}</code></dd></div> : null}
        </dl>
        {result !== undefined && result.artifactGroups.some((group) => group.examples.length > 0) ? (
          <div className="dsh-bio-result__checksums">
            <h4>Checksummed files</h4>
            {result.artifactGroups.flatMap((group, groupIndex) => group.examples.map((item, itemIndex) => (
              <div key={`${group.outputId}:${groupIndex}:${itemIndex}`}>
                <span><strong>{item.relativePath}</strong><small>{formatBytes(item.sizeBytes)}</small></span>
                <code title={item.sha256}>{shortDigest(item.sha256)}</code>
              </div>
            )))}
            {result.artifactGroups.some((group) => group.examplesOmitted > 0) || result.artifactGroupsOmitted > 0
              ? <p>Additional files remain available through the owner-scoped Agent result.</p>
              : null}
          </div>
        ) : null}
        <p className="dsh-bio-result__privacy">Absolute host paths, owner identity, commands, environment values, and raw logs are intentionally not repeated here. Ask the Agent to inspect bounded DSH job output when needed.</p>
      </div>
    </details>
  )
}

function RunResult({ run }: { run: RunDetailsProjection }) {
  const resultId = useId().replace(/:/g, '')
  const outcome = outcomeCopy(run)
  const result = run.result
  const fastqc = result?.fastqc
  return (
    <section className="dsh-bio-result" data-tone={outcome.tone} aria-label={`${workflowLabel(run)} analysis result`}>
      <header className="dsh-bio-result__header">
        <div><RunsIcon /><span><strong>Workflow result</strong><small>{workflowLabel(run)}</small></span></div>
        <StatusBadge status={run.status} />
      </header>
      <div className="dsh-bio-result__outcome" role="status">
        <span className="dsh-bio-result__outcome-icon"><ResultIcon tone={outcome.tone} /></span>
        <div><h3>{outcome.heading}</h3><p>{outcome.detail}</p></div>
      </div>
      {fastqc !== undefined ? (
        <section className="dsh-bio-result__section" aria-labelledby={`${resultId}-fastqc-heading`}>
          <div className="dsh-bio-result__section-heading">
            <div><h4 id={`${resultId}-fastqc-heading`}>Technical quality summary</h4><p>{fastqc.reportCount} normalized FastQC {fastqc.reportCount === 1 ? 'report' : 'reports'}</p></div>
            <span>{fastqc.reportCount} {fastqc.reportCount === 1 ? 'sample' : 'samples'}</span>
          </div>
          <FastqcCountsView counts={fastqc.moduleCounts} />
          <ul className="dsh-bio-result__samples" aria-label="FastQC sample outcomes">
            {fastqc.reports.map((report, index) => (
              <li key={`${report.sample}:${index}`}>
                <span><strong>{report.sample}</strong><small>{report.counts.pass} passed · {report.counts.warn} warned · {report.counts.fail} failed</small></span>
                <span className={`dsh-bio-status dsh-bio-status--${report.overallStatus === 'pass' ? 'success' : report.overallStatus === 'fail' ? 'error' : 'warning'}`}>{report.overallStatus === 'pass' ? 'Pass' : report.overallStatus === 'fail' ? 'Fail' : 'Warn'}</span>
              </li>
            ))}
          </ul>
          {fastqc.reportsOmitted > 0 ? <p className="dsh-bio-result__bounded-note">{fastqc.reportsOmitted} additional sample reports remain in the owner-scoped Agent result.</p> : null}
        </section>
      ) : null}
      {result !== undefined ? (
        <section className="dsh-bio-result__section" aria-labelledby={`${resultId}-output-heading`}>
          <div className="dsh-bio-result__section-heading">
            <div><h4 id={`${resultId}-output-heading`}>Produced outputs</h4><p>Checksummed files collected from declared workflow outputs</p></div>
            <span>{result.artifactCount} files · {formatBytes(result.totalBytes)}</span>
          </div>
          <ul className="dsh-bio-result__outputs">
            {result.artifactGroups.map((group) => (
              <li key={group.outputId}>
                <span><strong>{outputLabel(group.outputId)}</strong><code>{group.outputId}</code></span>
                <span>{group.itemCount} {group.itemCount === 1 ? 'file' : 'files'} · {formatBytes(group.totalBytes)}</span>
              </li>
            ))}
          </ul>
          {result.artifactGroupsOmitted > 0 ? <p className="dsh-bio-result__bounded-note">{result.artifactGroupsOmitted} additional output groups remain in the owner-scoped Agent result.</p> : null}
          {result.diagnostics.length > 0 ? (
            <ul className="dsh-bio-result__diagnostics" aria-label="Result diagnostics">
              {result.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}:${index}`}><strong>{diagnostic.code}</strong><span>Detailed diagnostic text remains in the owner-scoped Agent result.</span></li>)}
            </ul>
          ) : null}
        </section>
      ) : null}
      {run.status === 'completed' ? <p className="dsh-bio-result__interpretation">Completion confirms execution and result collection, not biological significance. Interpret QC findings in the context of the study design.</p> : null}
      <RunTechnicalEvidence run={run} />
    </section>
  )
}

function historyDescription(run: RunHistoryItemProjection) {
  const copy: Record<RunLifecycleStatus, string> = {
    prepared: 'Prepared; execution has not started',
    running: 'Execution is still in progress',
    stopping: 'Cancellation is settling',
    completed: 'Completed; inspect for outputs and QC findings',
    failed: 'Failed; inspect evidence before another plan',
    killed: 'Cancelled; no completed result claimed',
    interrupted: 'Interrupted; no automatic retry occurred',
  }
  return copy[run.status]
}

function RunHistory({ runs, hiddenCount, hasNextPage, incomplete }: {
  runs: RunHistoryItemProjection[]
  hiddenCount: number
  hasNextPage: boolean
  incomplete: boolean
}) {
  return (
    <section className="dsh-bio-result dsh-bio-result--history" aria-label="Recent workflow analyses">
      <header className="dsh-bio-result__header">
        <div><RunsIcon /><span><strong>Recent analyses</strong><small>Newest owner-scoped workflow runs</small></span></div>
        <span className="dsh-bio-badge">{runs.length} shown</span>
      </header>
      {runs.length === 0 ? (
        <div className="dsh-bio-result__empty"><RunsIcon /><strong>No workflow runs yet</strong><p>Prepare an analysis first; starting it will still require a reviewed plan and explicit approval.</p></div>
      ) : (
        <ol className="dsh-bio-result__history">
          {runs.map((run) => (
            <li key={run.runId}>
              <span className="dsh-bio-result__history-track" />
              <div><strong>{workflowLabel(run)}</strong><p>{historyDescription(run)}</p><small>{formatDate(run.startedAt)} · run …{run.runId.slice(-8)}</small></div>
              <StatusBadge status={run.status} />
            </li>
          ))}
        </ol>
      )}
      {hiddenCount > 0 || hasNextPage || incomplete ? (
        <p className="dsh-bio-result__bounded-note">
          {hiddenCount > 0 ? `${hiddenCount} additional runs are hidden in this compact view. ` : ''}
          {hasNextPage ? 'Ask the Agent for the next owner-scoped page. ' : ''}
          {incomplete ? 'History diagnostics indicate that some records may be unavailable.' : ''}
        </p>
      ) : null}
      <p className="dsh-bio-result__interpretation">Ask the Agent to inspect a visible run when you need its outcome, outputs, or provenance. This list cannot start or retry an analysis.</p>
    </section>
  )
}

export function RunResultToolView({ block }: ToolViewProps) {
  const projection = useMemo(() => projectRunGetToolResult(block), [block])
  if (projection.state === 'loading') return <ToolState />
  if (projection.state === 'error') return <ToolState error={projection.message} />
  return <RunResult run={projection.value} />
}

export function RunListToolView({ block }: ToolViewProps) {
  const projection = useMemo(() => projectRunListToolResult(block), [block])
  if (projection.state === 'loading') return <ToolState />
  if (projection.state === 'error') return <ToolState error={projection.message} />
  return <RunHistory {...projection.value} />
}
