import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { WorkflowCenter } from '../../src/client/WorkflowCenter.tsx'
import { DraftGraphToolView } from '../../src/client/WorkflowGraphView.tsx'
import { RunListToolView, RunResultToolView } from '../../src/client/RunResultView.tsx'
import { STYLE } from '../../src/client/styles.ts'
import type {
  SessionsFace,
  WorkflowCenterBootstrap,
  WorkflowGraph,
} from '../../src/client/types.ts'

declare global {
  interface Window { __BIO_PREVIEW__: { lastPrompt: string; closeCount: number } }
}

const style = document.createElement('style')
style.textContent = STYLE
document.head.append(style)

window.__BIO_PREVIEW__ = { lastPrompt: '', closeCount: 0 }
const query = new URLSearchParams(location.search)
const disconnected = query.get('session') === 'none'
const rejectPrompt = query.get('prompt') === 'reject'
const draftWritesEnabled = query.get('writes') !== 'off'
const isolatedTestReady = query.get('isolated') === 'on'
const catalogWarning = query.get('catalog') === 'warning'
const fitMode = query.get('fit')

const workflows = [
  {
    id: 'fastq-qc', version: '1.2.0', name: 'FASTQ quality control',
    summary: 'Run FastQC and return checksummed HTML, ZIP, and parsed summary reports.',
    inputs: [
      { id: 'reads', type: 'file', required: true, cardinality: 'many' as const, description: 'FASTQ files to inspect.' },
      { id: 'threads', type: 'integer', required: false, cardinality: 'one' as const, description: 'Threads allocated to each FastQC task.' },
    ],
    outputs: [
      { id: 'html_reports', type: 'file', cardinality: 'many' as const, description: 'FastQC HTML reports.' },
      { id: 'zip_reports', type: 'file', cardinality: 'many' as const, description: 'FastQC ZIP archives.' },
      { id: 'summary_reports', type: 'file', cardinality: 'many' as const, description: 'Parsed FastQC summary reports.' },
    ],
    status: 'ready', language: 'wdl', languageVersion: '1.0', source: 'builtin' as const,
    trust: 'builtin', installed: false, digest: `sha256:${'a'.repeat(64)}`,
    executionSupported: true,
    scientificFitStatus: 'available' as const,
    tags: ['fastq', 'qc', 'starter', 'wdl'],
    engines: [{ name: 'miniwdl', version: '1.15.0' }, { name: 'cromwell' }],
    verification: { status: 'verified', checks: ['miniwdl-check@1.15.0', 'container-digest-pinned'] },
  },
  {
    id: 'fastq-qc', version: '1.1.0', name: 'FASTQ quality control',
    summary: 'Run FastQC for one or more sequencing read files.',
    inputs: [{ id: 'reads', type: 'file', required: true, cardinality: 'many' as const }],
    outputs: [
      { id: 'html_reports', type: 'file', cardinality: 'many' as const },
      { id: 'zip_reports', type: 'file', cardinality: 'many' as const },
    ],
    status: 'ready', language: 'wdl', languageVersion: '1.0', source: 'builtin' as const,
    trust: 'builtin', installed: true, digest: `sha256:${'b'.repeat(64)}`,
    executionSupported: true,
    scientificFitStatus: 'available' as const,
    tags: ['fastq', 'qc', 'wdl'], engines: [{ name: 'miniwdl', version: '1.15.0' }],
    verification: { status: 'verified', checks: ['miniwdl-check@1.15.0'] },
  },
  {
    id: 'bam-qc', version: '1.0.0', name: 'BAM quality control',
    summary: 'Collect samtools flagstat and stats reports from an aligned BAM file.',
    inputs: [{ id: 'bam', type: 'file', required: true, cardinality: 'one' as const, description: 'Aligned BAM file to inspect.' }],
    outputs: [
      { id: 'flagstat_report', type: 'file', cardinality: 'one' as const },
      { id: 'stats_report', type: 'file', cardinality: 'one' as const },
    ],
    status: 'ready', language: 'wdl', languageVersion: '1.0', source: 'builtin' as const,
    trust: 'builtin', installed: false, digest: `sha256:${'c'.repeat(64)}`,
    executionSupported: false,
    scientificFitStatus: 'available' as const,
    tags: ['bam', 'alignment', 'qc', 'wdl'], engines: [{ name: 'miniwdl', version: '1.15.0' }],
    verification: { status: 'verified', checks: ['miniwdl-check@1.15.0'] },
  },
  {
    id: 'fastq-qc', version: '1.0.0', name: 'FASTQ quality control',
    summary: 'Run FastQC for one or more FASTQ files and collect HTML and ZIP reports.',
    inputs: [
      { id: 'reads', type: 'file', required: true, cardinality: 'many' as const, description: 'FASTQ files to inspect.' },
      { id: 'threads', type: 'integer', required: false, cardinality: 'one' as const, description: 'Threads allocated to each FastQC task.' },
    ],
    outputs: [
      { id: 'html_reports', type: 'file', cardinality: 'many' as const, description: 'FastQC HTML reports.' },
      { id: 'zip_reports', type: 'file', cardinality: 'many' as const, description: 'FastQC ZIP archives.' },
    ],
    status: 'draft', language: 'wdl', languageVersion: '1.0', source: 'builtin' as const,
    trust: 'builtin', installed: false, digest: `sha256:${'d'.repeat(64)}`,
    executionSupported: false,
    scientificFitStatus: 'available' as const,
    tags: ['fastq', 'qc', 'starter', 'wdl'], engines: [{ name: 'miniwdl', version: '1.15.0' }],
    verification: { status: 'structural', checks: ['wdl-source-shape'] },
  },
]

const bootstrap: WorkflowCenterBootstrap = {
  schemaVersion: '1',
  package: { name: 'dsh-bio-workflows', version: '0.12.0' },
  workflows,
  diagnostics: catalogWarning
    ? [{ code: 'store_path_unsafe', message: 'The configured local workflow store is unavailable.' }]
    : [],
  capabilities: { deterministicWorkflowGraph: true, nativeWorkflowCenter: true },
  readiness: {
    workflowCenter: true,
    workflowStore: true,
    localStoreConfigured: true,
    storeWritesEnabled: true,
    draftAuthoringConfigured: true,
    draftWritesEnabled,
    miniwdlValidator: true,
    autonomousMissionAuthoring: true,
    isolatedSoftwareTrialConfigured: isolatedTestReady,
    isolatedSoftwareTrialPreflightVerified: isolatedTestReady,
    isolatedSoftwareTrial: isolatedTestReady,
    workflowGraph: true,
    executionConfigured: true,
    executionEnabled: false,
    jobsAvailable: true,
  },
  privacy: {
    ownerScopedDraftsViaAgent: true,
    ownerScopedMissionsViaAgent: true,
    ownerScopedDraftTestsViaAgent: true,
    ownerScopedRunsViaAgent: true,
  },
}

const loadedBootstrap: unknown = fitMode === 'unavailable'
  ? {
      ...bootstrap,
      workflows: workflows.map((workflow) => ({
        ...workflow,
        inputs: [],
        outputs: [],
        scientificFitStatus: 'unavailable',
      })),
    }
  : fitMode === 'malformed'
    ? {
        ...bootstrap,
        workflows: [{ ...workflows[0], inputs: [null] }, ...workflows.slice(1)],
      }
    : fitMode === 'missing'
      ? {
          ...bootstrap,
          workflows: [
            Object.fromEntries(Object.entries(workflows[0]).filter(([key]) => key !== 'inputs' && key !== 'outputs')),
            ...workflows.slice(1),
          ],
        }
    : bootstrap

const sessions: SessionsFace = {
  list: {
    getSnapshot: () => disconnected ? {} : { current: 'preview-session' },
    subscribe: () => () => {},
  },
  binding: () => disconnected ? undefined : ({
    session: {
      async prompt(content) {
        window.__BIO_PREVIEW__.lastPrompt = content[0]?.text ?? ''
        if (rejectPrompt) {
          return { ok: false, error: { code: 'policy_denied', message: 'Agent request rejected.' } }
        }
        return { ok: true }
      },
    },
  }),
}

const range = (offset: number) => ({
  path: 'main.wdl' as const,
  start: { line: offset + 1, column: 1, offset },
  end: { line: offset + 1, column: 12, offset: offset + 11 },
})

const graph: WorkflowGraph = {
  schemaVersion: '1', draftId: 'draft-11111111-1111-4111-8111-111111111111', revision: 4,
  contentDigest: `sha256:${'e'.repeat(64)}`, sourcePath: 'main.wdl', languageVersion: '1.0',
  workflow: { name: 'rna_seq_qc', range: range(0) }, complete: true,
  graphDigest: `sha256:${'f'.repeat(64)}`, executionAuthorized: false, diagnostics: [],
  nodes: [
    { id: 'input:reads', kind: 'workflow-input', label: 'reads', range: range(1), inputs: [], outputs: [{ id: 'value', name: 'value', type: 'Array[File]+' }] },
    { id: 'input:threads', kind: 'workflow-input', label: 'threads', range: range(2), inputs: [], outputs: [{ id: 'value', name: 'value', type: 'Int' }] },
    { id: 'scatter:sample', kind: 'scatter', label: 'sample', range: range(3), inputs: [{ id: 'collection', name: 'collection', type: 'Array[Any]' }], outputs: [{ id: 'sample', name: 'sample', type: 'Any' }] },
    { id: 'call:fastqc', kind: 'call', label: 'fastqc', target: 'fastqc_one', parentGroup: 'scatter:sample', range: range(4), inputs: [{ id: 'read', name: 'read', type: 'File' }], outputs: [{ id: 'report', name: 'report', type: 'File' }] },
    { id: 'call:multiqc', kind: 'call', label: 'multiqc', target: 'multiqc', range: range(5), inputs: [{ id: 'reports', name: 'reports', type: 'Array[File]' }], outputs: [{ id: 'report', name: 'report', type: 'File' }] },
    { id: 'output:report', kind: 'workflow-output', label: 'qc_report', range: range(6), inputs: [{ id: 'value', name: 'value', type: 'File' }], outputs: [] },
  ],
  edges: [
    { id: 'e1', kind: 'data', from: { node: 'input:reads', port: 'value' }, to: { node: 'scatter:sample', port: 'collection' } },
    { id: 'e2', kind: 'containment', from: { node: 'scatter:sample', port: 'group' }, to: { node: 'call:fastqc', port: 'member' } },
    { id: 'e3', kind: 'data', from: { node: 'scatter:sample', port: 'sample' }, to: { node: 'call:fastqc', port: 'read' } },
    { id: 'e4', kind: 'data', from: { node: 'call:fastqc', port: 'report' }, to: { node: 'call:multiqc', port: 'reports' } },
    { id: 'e-control', kind: 'control', from: { node: 'call:fastqc', port: 'complete' }, to: { node: 'call:multiqc', port: 'after' } },
    { id: 'e5', kind: 'data', from: { node: 'call:multiqc', port: 'report' }, to: { node: 'output:report', port: 'value' } },
  ],
}

const previewRunId = 'run-11111111-1111-4111-8111-111111111111'
const previewWorkflow = {
  id: 'fastq-qc',
  version: '1.2.0',
  bundleDigest: `sha256:${'a'.repeat(64)}`,
}
const previewPlanDigest = `sha256:${'b'.repeat(64)}`
const resultArtifact = (outputId: string, ordinal: number, relativePath: string, sizeBytes: string, digestCharacter: string) => ({
  outputId,
  type: 'file',
  cardinality: 'many',
  items: [{
    ordinal,
    path: `/private/run/engine/${relativePath}`,
    relativePath,
    sizeBytes,
    sha256: `sha256:${digestCharacter.repeat(64)}`,
  }],
})

const runGetPayload = {
  ok: true,
  run: {
    schemaVersion: '1',
    runId: previewRunId,
    ownerSession: 'preview-session-private',
    jobId: 'bio-17',
    status: 'completed',
    startedAt: '2026-08-29T10:00:00.000Z',
    finishedAt: '2026-08-29T10:01:00.000Z',
    runDirectory: '/private/run',
    planDigest: previewPlanDigest,
    plan: { workflow: previewWorkflow },
    command: { argv: ['/private/miniwdl'], environmentPolicy: 'no-ambient-credentials' },
    error: null,
    result: {
      schemaVersion: '1',
      status: 'completed',
      generatedAt: '2026-08-29T10:01:00.000Z',
      workflow: previewWorkflow,
      planDigest: previewPlanDigest,
      artifacts: [
        resultArtifact('html_reports', 0, 'outputs/input-0000_fastqc.html', '377991', 'c'),
        resultArtifact('zip_reports', 0, 'outputs/input-0000_fastqc.zip', '288628', 'd'),
        resultArtifact('summary_reports', 0, 'outputs/input-0000_summary.txt', '489', 'e'),
      ],
      summaries: {
        fastqc: {
          schemaVersion: '1',
          reportCount: 1,
          moduleCounts: { pass: 5, warn: 2, fail: 3 },
          reports: [{
            artifact: { outputId: 'summary_reports', ordinal: 0 },
            sample: 'input-0000.fastq.gz',
            overallStatus: 'fail',
            counts: { pass: 5, warn: 2, fail: 3 },
            modules: [
              { name: 'Basic Statistics', status: 'pass' },
              { name: 'Per base sequence quality', status: 'pass' },
              { name: 'Per sequence quality scores', status: 'fail' },
              { name: 'Per base sequence content', status: 'fail' },
              { name: 'Per sequence GC content', status: 'warn' },
              { name: 'Per base N content', status: 'pass' },
              { name: 'Sequence Length Distribution', status: 'pass' },
              { name: 'Sequence Duplication Levels', status: 'pass' },
              { name: 'Overrepresented sequences', status: 'fail' },
              { name: 'Adapter Content', status: 'warn' },
            ],
          }],
        },
      },
      diagnostics: [],
    },
  },
  job: null,
  reconciliation: { status: 'not_needed' },
  error: null,
}

const runListPayload = {
  ok: true,
  count: 3,
  runs: [
    { runId: previewRunId, jobId: 'bio-17', workflow: previewWorkflow, status: 'completed', startedAt: '2026-08-29T10:00:00.000Z', finishedAt: '2026-08-29T10:01:00.000Z' },
    { runId: 'run-22222222-2222-4222-8222-222222222222', jobId: 'bio-16', workflow: previewWorkflow, status: 'running', startedAt: '2026-08-29T09:00:00.000Z', finishedAt: null },
    { runId: 'run-33333333-3333-4333-8333-333333333333', jobId: 'bio-15', workflow: previewWorkflow, status: 'interrupted', startedAt: '2026-08-29T08:00:00.000Z', finishedAt: '2026-08-29T08:04:00.000Z' },
  ],
  nextCursor: null,
  truncated: false,
  diagnostics: [],
  error: null,
}

function toolBlock(payload: unknown, argsRaw: unknown = { runId: previewRunId }) {
  return {
    kind: 'tool-result',
    call: { argsRaw },
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

const root = createRoot(document.getElementById('root')!)
if (query.get('view') === 'graph') {
  root.render(<div id="graph-root"><DraftGraphToolView block={{
    kind: 'tool-result',
    content: [{ type: 'text', text: JSON.stringify(graph) }],
  }} /></div>)
} else if (query.get('view') === 'graph-malformed') {
  const malformed = {
    ...graph,
    nodes: [{ ...graph.nodes[0], inputs: 'not-an-array' }],
  }
  root.render(<DraftGraphToolView block={{
    kind: 'tool-result',
    content: [{ type: 'text', text: JSON.stringify(malformed) }],
  }} />)
} else if (query.get('view') === 'result') {
  root.render(<div id="result-root"><RunResultToolView block={toolBlock(runGetPayload)} /></div>)
} else if (query.get('view') === 'result-failed') {
  const failed = {
    ...runGetPayload,
    run: {
      ...runGetPayload.run,
      status: 'failed',
      result: null,
      error: { code: 'miniwdl_failed', message: 'The approved workflow exited before result collection completed.' },
    },
  }
  root.render(<div id="result-root"><RunResultToolView block={toolBlock(failed)} /></div>)
} else if (query.get('view') === 'result-malformed') {
  const malformed = structuredClone(runGetPayload)
  malformed.run.result.artifacts[0].items[0].relativePath = '../private/output.html'
  root.render(<div id="result-root"><RunResultToolView block={toolBlock(malformed)} /></div>)
} else if (query.get('view') === 'runs') {
  root.render(<div id="result-root"><RunListToolView block={toolBlock(runListPayload, {})} /></div>)
} else if (query.get('view') === 'runs-empty') {
  root.render(<div id="result-root"><RunListToolView block={toolBlock({ ...runListPayload, count: 0, runs: [] }, {})} /></div>)
} else {
  function PreviewWorkflowCenter() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button type="button" onClick={() => { setOpen(true) }}>Open preview center</button>
        <WorkflowCenter
          sessions={sessions}
          open={open}
          onClose={() => {
            window.__BIO_PREVIEW__.closeCount += 1
            setOpen(false)
          }}
          loadBootstrap={async () => loadedBootstrap}
        />
      </>
    )
  }
  root.render(<PreviewWorkflowCenter />)
}
