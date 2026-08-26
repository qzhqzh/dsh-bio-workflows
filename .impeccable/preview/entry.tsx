import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { WorkflowCenter } from '../../src/client/WorkflowCenter.tsx'
import { DraftGraphToolView } from '../../src/client/WorkflowGraphView.tsx'
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
const catalogWarning = query.get('catalog') === 'warning'

const workflows = [
  {
    id: 'fastq-qc', version: '1.2.0', name: 'FASTQ quality control',
    summary: 'Run FastQC and return checksummed HTML, ZIP, and parsed summary reports.',
    status: 'ready', language: 'wdl', languageVersion: '1.0', source: 'builtin' as const,
    trust: 'builtin', installed: false, digest: `sha256:${'a'.repeat(64)}`,
    executionSupported: true,
    tags: ['fastq', 'qc', 'starter', 'wdl'],
    engines: [{ name: 'miniwdl', version: '1.15.0' }, { name: 'cromwell' }],
    verification: { status: 'verified', checks: ['miniwdl-check@1.15.0', 'container-digest-pinned'] },
  },
  {
    id: 'fastq-qc', version: '1.1.0', name: 'FASTQ quality control',
    summary: 'Run FastQC for one or more sequencing read files.',
    status: 'ready', language: 'wdl', languageVersion: '1.0', source: 'builtin' as const,
    trust: 'builtin', installed: true, digest: `sha256:${'b'.repeat(64)}`,
    executionSupported: true,
    tags: ['fastq', 'qc', 'wdl'], engines: [{ name: 'miniwdl', version: '1.15.0' }],
    verification: { status: 'verified', checks: ['miniwdl-check@1.15.0'] },
  },
  {
    id: 'bam-qc', version: '1.0.0', name: 'BAM quality control',
    summary: 'Collect samtools flagstat and stats reports from an aligned BAM file.',
    status: 'ready', language: 'wdl', languageVersion: '1.0', source: 'builtin' as const,
    trust: 'builtin', installed: false, digest: `sha256:${'c'.repeat(64)}`,
    executionSupported: false,
    tags: ['bam', 'alignment', 'qc', 'wdl'], engines: [{ name: 'miniwdl', version: '1.15.0' }],
    verification: { status: 'verified', checks: ['miniwdl-check@1.15.0'] },
  },
  {
    id: 'rna-fusion', version: '0.1.0', name: 'RNA fusion discovery',
    summary: 'Local draft bundle for testing fusion-caller orchestration.',
    status: 'draft', language: 'wdl', languageVersion: '1.0', source: 'draft' as const,
    trust: 'local', installed: false, digest: `sha256:${'d'.repeat(64)}`,
    executionSupported: false,
    tags: ['rna', 'fusion', 'draft'], engines: [{ name: 'miniwdl' }],
    verification: { status: 'structural', checks: ['wdl-source-shape'] },
  },
]

const bootstrap: WorkflowCenterBootstrap = {
  schemaVersion: '1',
  package: { name: 'dsh-bio-workflows', version: '0.10.0' },
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
    workflowGraph: true,
    executionConfigured: true,
    executionEnabled: false,
    jobsAvailable: true,
  },
  privacy: { ownerScopedDraftsViaAgent: true, ownerScopedRunsViaAgent: true },
}

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
          loadBootstrap={async () => bootstrap}
        />
      </>
    )
  }
  root.render(<PreviewWorkflowCenter />)
}
