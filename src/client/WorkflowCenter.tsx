import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import {
  ArrowIcon,
  CheckIcon,
  CloseIcon,
  DraftIcon,
  RefreshIcon,
  RunsIcon,
  SearchIcon,
  SetupIcon,
  WarningIcon,
  WorkflowIcon,
} from './icons.tsx'
import { ANALYSIS_BRIEF_LIMITS, analysisBriefIsValid, prompts } from './prompts.ts'
import type {
  SessionsFace,
  WorkflowAnalysisBrief,
  WorkflowCenterBootstrap,
  WorkflowPortSummary,
  WorkflowSummary,
} from './types.ts'

type Area = 'workflows' | 'drafts' | 'runs' | 'setup'
type Notice = { message: string }
type AgentRequestContext = { action: string; subject: string; detail: string }
type AgentHandoff = AgentRequestContext & { state: 'sending' | 'queued' }
type AskAgent = (text: string, context: AgentRequestContext) => void

const PACKAGE_CHECK_DETAIL = 'Checks descriptor shape, SHA-256 file digests, local imports, WDL version declarations, example JSON, and container-image pin diagnostics. It does not run an engine.'
const ANALYSIS_PREPARATION_DETAIL = 'The Agent will collect missing input paths and prepare a plan for review. It will not start a run without your explicit approval.'

const PRIMARY_AREAS: Array<{ id: Exclude<Area, 'setup'>; label: string; icon: typeof WorkflowIcon }> = [
  { id: 'workflows', label: 'Analyze data', icon: WorkflowIcon },
  { id: 'drafts', label: 'Build workflow', icon: DraftIcon },
  { id: 'runs', label: 'Activity', icon: RunsIcon },
]

const EMPTY_BOOTSTRAP: WorkflowCenterBootstrap = {
  schemaVersion: '1',
  package: { name: 'dsh-bio-workflows', version: '0.12.0' },
  workflows: [],
  diagnostics: [],
  capabilities: {},
  readiness: {},
  privacy: {
    ownerScopedDraftsViaAgent: true,
    ownerScopedMissionsViaAgent: true,
    ownerScopedDraftTestsViaAgent: true,
    ownerScopedRunsViaAgent: true,
  },
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'summary',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function hiddenByClosedDisclosure(element: HTMLElement, root: HTMLElement) {
  let parent = element.parentElement
  while (parent !== null && parent !== root) {
    if (parent instanceof HTMLDetailsElement && !parent.open) {
      const summary = parent.querySelector<HTMLElement>(':scope > summary')
      if (summary === null || (element !== summary && !summary.contains(element))) return true
    }
    parent = parent.parentElement
  }
  return false
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => (
      !element.hidden
      && element.getAttribute('aria-hidden') !== 'true'
      && element.tabIndex >= 0
      && element.getClientRects().length > 0
      && !hiddenByClosedDisclosure(element, root)
    ))
}

const WORKFLOW_PORT_TYPES = new Set(['file', 'directory', 'string', 'integer', 'number', 'boolean'])
const MAX_BOOTSTRAP_WORKFLOWS = 256
const MAX_WORKFLOW_PORTS = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validString(value: unknown, maxLength = 1000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function validBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isRecord(value)
    && Object.keys(value).length <= 128
    && Object.entries(value).every(([key, item]) => validString(key, 128) && typeof item === 'boolean')
}

function validWorkflowPort(value: unknown): value is WorkflowPortSummary {
  if (!isRecord(value)) return false
  return validString(value.id, 128)
    && value.id.trim() === value.id
    && typeof value.type === 'string'
    && WORKFLOW_PORT_TYPES.has(value.type)
    && (value.required === undefined || typeof value.required === 'boolean')
    && (value.cardinality === undefined || value.cardinality === 'one' || value.cardinality === 'many')
    && (value.description === undefined || validString(value.description, 1000))
}

function validWorkflow(value: unknown): value is WorkflowSummary {
  if (!isRecord(value)) return false
  const source = value.source
  const verification = value.verification
  const engines = value.engines
  const inputs = value.inputs
  const outputs = value.outputs
  const fitStatus = value.scientificFitStatus
  const fitShapeValid = fitStatus === 'available'
    ? Array.isArray(inputs) && Array.isArray(outputs)
    : fitStatus === 'unavailable'
      ? Array.isArray(inputs) && inputs.length === 0 && Array.isArray(outputs) && outputs.length === 0
      : (inputs === undefined && outputs === undefined) || (Array.isArray(inputs) && Array.isArray(outputs))
  return [value.id, value.version, value.name, value.summary, value.status, value.language, value.languageVersion, value.trust]
    .every((item) => validString(item))
    && validString(value.digest, 160)
    && source === 'builtin'
    && typeof value.installed === 'boolean'
    && typeof value.executionSupported === 'boolean'
    && Array.isArray(value.tags)
    && value.tags.length <= 64
    && value.tags.every((tag) => validString(tag, 128))
    && Array.isArray(engines)
    && engines.length <= 16
    && engines.every((engine) => (
      isRecord(engine)
      && validString(engine.name, 128)
      && (engine.version === undefined || validString(engine.version, 128))
    ))
    && isRecord(verification)
    && validString(verification.status, 128)
    && Array.isArray(verification.checks)
    && verification.checks.length <= 128
    && verification.checks.every((check) => validString(check, 256))
    && fitShapeValid
    && (inputs === undefined || (Array.isArray(inputs) && inputs.length <= MAX_WORKFLOW_PORTS && inputs.every(validWorkflowPort)))
    && (outputs === undefined || (Array.isArray(outputs) && outputs.length <= MAX_WORKFLOW_PORTS && outputs.every(validWorkflowPort)))
    && (value.inputsTruncated === undefined || typeof value.inputsTruncated === 'boolean')
    && (value.outputsTruncated === undefined || typeof value.outputsTruncated === 'boolean')
    && (value.scientificFitStatus === undefined || value.scientificFitStatus === 'available' || value.scientificFitStatus === 'unavailable')
}

function normalizeBootstrap(value: unknown): WorkflowCenterBootstrap {
  if (!isRecord(value) || value.schemaVersion !== '1') {
    throw new Error('Workflow Center bootstrap returned an incompatible payload')
  }
  const packageInfo = value.package
  const workflows = value.workflows
  const diagnostics = value.diagnostics
  const privacy = value.privacy
  if (
    !isRecord(packageInfo)
    || !validString(packageInfo.name, 128)
    || !validString(packageInfo.version, 128)
    || !Array.isArray(workflows)
    || workflows.length > MAX_BOOTSTRAP_WORKFLOWS
    || !workflows.every(validWorkflow)
    || !Array.isArray(diagnostics)
    || diagnostics.length > 32
    || !diagnostics.every((diagnostic) => (
      isRecord(diagnostic)
      && (diagnostic.code === undefined || validString(diagnostic.code, 128))
      && (diagnostic.message === undefined || validString(diagnostic.message, 1000))
    ))
    || !validBooleanRecord(value.capabilities)
    || !validBooleanRecord(value.readiness)
    || !isRecord(privacy)
    || privacy.ownerScopedDraftsViaAgent !== true
    || privacy.ownerScopedMissionsViaAgent !== true
    || privacy.ownerScopedDraftTestsViaAgent !== true
    || privacy.ownerScopedRunsViaAgent !== true
  ) throw new Error('Workflow Center bootstrap returned an incompatible payload')

  return {
    ...(value as unknown as WorkflowCenterBootstrap),
    workflows: workflows.map((workflow) => ({
      ...workflow,
      scientificFitStatus: workflow.scientificFitStatus
        ?? (workflow.inputs !== undefined && workflow.outputs !== undefined ? 'available' : 'unavailable'),
    })),
  }
}

async function defaultLoadBootstrap(signal: AbortSignal): Promise<unknown> {
  const response = await fetch('/api/bio-workflows/v1/bootstrap', {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`Workflow Center bootstrap failed (${response.status})`)
  return response.json()
}

async function sendToAgent(sessions: SessionsFace, text: string): Promise<string> {
  const sessionId = sessions.list.getSnapshot().current
  if (!sessionId) throw new Error('Open a Harness task before asking the Agent.')
  const binding = sessions.binding(sessionId)
  if (!binding) throw new Error('The current Harness task is not available.')
  const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
  if (!result.ok) throw new Error(result.error ? `${result.error.code}: ${result.error.message}` : 'The Agent did not accept the request.')
  sessions.open?.(sessionId)
  return sessionId
}

function statusTone(value: string) {
  if (['ready', 'verified', 'completed', 'success'].includes(value.toLowerCase())) return 'success'
  if (['draft', 'partial', 'warning'].includes(value.toLowerCase())) return 'warning'
  return 'neutral'
}

function analysisEligible(workflow: WorkflowSummary) {
  return workflow.executionSupported && workflow.scientificFitStatus === 'available'
}

function analysisEligibilityLabel(workflow: WorkflowSummary) {
  if (analysisEligible(workflow)) return 'Execution eligible'
  if (workflow.executionSupported) return 'Fit unavailable'
  return 'Review only'
}

const PORT_TYPE_LABELS: Record<string, [string, string]> = {
  boolean: ['boolean', 'booleans'],
  directory: ['directory', 'directories'],
  file: ['file', 'files'],
  integer: ['integer', 'integers'],
  number: ['number', 'numbers'],
  string: ['string', 'strings'],
}

function portShape(port: WorkflowPortSummary) {
  const labels = PORT_TYPE_LABELS[port.type] ?? [port.type, port.type]
  const type = port.cardinality === 'many' ? `multiple ${labels[1]}` : labels[0]
  if (port.required === undefined) return type
  return `${type} · ${port.required ? 'required' : 'optional'}`
}

function compactPortSummary(ports: WorkflowPortSummary[] | undefined, status: WorkflowSummary['scientificFitStatus']) {
  if (status === 'unavailable') return 'Unavailable'
  if (ports === undefined || ports.length === 0) return 'Not declared'
  const first = ports[0]
  return `${first.id} · ${portShape(first)}${ports.length > 1 ? ` · +${ports.length - 1}` : ''}`
}

function WorkflowPortList({ label, ports, status, truncated = false }: {
  label: string
  ports: WorkflowPortSummary[] | undefined
  status: WorkflowSummary['scientificFitStatus']
  truncated?: boolean
}) {
  return (
    <div className="dsh-bio-port-list">
      <h4>{label}</h4>
      {status === 'unavailable' ? (
        <p>Exact built-in manifest details are temporarily unavailable.</p>
      ) : ports !== undefined && ports.length > 0 ? (
        <ul>
          {ports.map((port) => (
            <li key={port.id}>
              <div><strong>{port.id}</strong><span>{portShape(port)}</span></div>
              {port.description ? <p>{port.description}</p> : null}
            </li>
          ))}
        </ul>
      ) : <p>Not declared in the workflow manifest.</p>}
      {truncated ? <p>Additional declared items are omitted from this browser summary.</p> : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="dsh-bio-field"><span>{label}</span>{children}</label>
}

function AgentButton({ children, onClick, disabled = false, secondary = false }: {
  children: React.ReactNode
  onClick(): void
  disabled?: boolean
  secondary?: boolean
}) {
  return (
    <button
      type="button"
      className={secondary ? 'dsh-bio-button dsh-bio-button--secondary' : 'dsh-bio-button'}
      onClick={onClick}
      disabled={disabled}
    >
      {children}<ArrowIcon />
    </button>
  )
}

function AgentHandoffStatus({ handoff, onContinue }: {
  handoff: AgentHandoff
  onContinue(): void
}) {
  const queued = handoff.state === 'queued'
  return (
    <div className="dsh-bio-handoff" role="status" aria-live="polite" aria-atomic="true">
      <span className="dsh-bio-handoff__icon" aria-hidden="true">
        {queued ? <CheckIcon /> : <span className="dsh-bio-spinner" />}
      </span>
      <div className="dsh-bio-handoff__body">
        <div className="dsh-bio-handoff__heading">
          <strong>{handoff.action}</strong>
          <span className={`dsh-bio-status dsh-bio-status--${queued ? 'success' : 'neutral'}`}>{queued ? 'Queued' : 'Sending'}</span>
        </div>
        <p>{handoff.subject}</p>
        <small>{queued ? `Request accepted; progress continues in the Agent task. ${handoff.detail}` : handoff.detail}</small>
      </div>
      {queued && <button type="button" className="dsh-bio-handoff__action" onClick={onContinue}>Continue in Agent task</button>}
    </div>
  )
}

function WorkflowsArea({ workflows, selected, onSelect, ask, busy }: {
  workflows: WorkflowSummary[]
  selected?: WorkflowSummary
  onSelect(workflow: WorkflowSummary): void
  ask: AskAgent
  busy: boolean
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return workflows
    return workflows.filter((workflow) => (
      [
        workflow.id,
        workflow.name,
        workflow.summary,
        workflow.source,
        ...workflow.tags,
        ...(workflow.inputs ?? []).flatMap((port) => [port.id, port.type, port.description ?? '']),
        ...(workflow.outputs ?? []).flatMap((port) => [port.id, port.type, port.description ?? '']),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    ))
  }, [query, workflows])

  return (
    <div className="dsh-bio-area dsh-bio-area--workflows">
      <section className="dsh-bio-main-pane" aria-labelledby="dsh-bio-workflows-heading">
        <div className="dsh-bio-area-heading">
          <div>
            <h2 id="dsh-bio-workflows-heading">Analyze data</h2>
            <p>Choose a workflow by the data it accepts and the results it produces.</p>
          </div>
          <span className="dsh-bio-count">{workflows.length} releases</span>
        </div>
        <div className="dsh-bio-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
            placeholder="Search workflow, input, output, or tag"
            aria-label="Search workflow catalog"
          />
        </div>
        <div className="dsh-bio-workflow-table" role="table" aria-label="Workflow catalog">
          <div className="dsh-bio-workflow-table__head" role="row">
            <span role="columnheader">Workflow</span>
            <span role="columnheader">Inputs</span>
            <span role="columnheader">Outputs</span>
            <span role="columnheader">Execution</span>
          </div>
          <div className="dsh-bio-workflow-table__body">
            {filtered.map((workflow) => (
              <button
                type="button"
                role="row"
                key={`${workflow.id}@${workflow.version}:${workflow.source}`}
                data-selected={selected?.digest === workflow.digest || undefined}
                onClick={() => { onSelect(workflow) }}
              >
                <span role="cell" className="dsh-bio-workflow-name">
                  <strong>{workflow.name}</strong>
                  <small>{workflow.id}@{workflow.version}</small>
                </span>
                <span role="cell" className="dsh-bio-port-summary">{compactPortSummary(workflow.inputs, workflow.scientificFitStatus)}</span>
                <span role="cell" className="dsh-bio-port-summary">{compactPortSummary(workflow.outputs, workflow.scientificFitStatus)}</span>
                <span role="cell"><span className={`dsh-bio-status dsh-bio-status--${analysisEligible(workflow) ? 'success' : workflow.executionSupported ? 'warning' : statusTone(workflow.status)}`}>{analysisEligibilityLabel(workflow)}</span></span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="dsh-bio-empty"><SearchIcon /><strong>No matching workflows</strong><span>Try a data type such as FASTQ or BAM, or an analysis goal such as QC.</span></div>
            )}
          </div>
        </div>
      </section>
      <aside className="dsh-bio-inspector" aria-label="Selected workflow details">
        {selected ? (
          <>
            <div className="dsh-bio-inspector__title">
              <WorkflowIcon />
              <div><h3>{selected.name}</h3><p>{selected.id}@{selected.version}</p></div>
            </div>
            <p className="dsh-bio-summary">{selected.summary}</p>
            <section className="dsh-bio-fit" aria-labelledby="dsh-bio-fit-heading">
              <h4 id="dsh-bio-fit-heading">Scientific fit</h4>
              <div className="dsh-bio-fit__ports">
                <WorkflowPortList label="Accepted inputs" ports={selected.inputs} status={selected.scientificFitStatus} truncated={selected.inputsTruncated === true} />
                <WorkflowPortList label="Produced outputs" ports={selected.outputs} status={selected.scientificFitStatus} truncated={selected.outputsTruncated === true} />
              </div>
              {selected.scientificFitStatus === 'unavailable' ? <p className="dsh-bio-fit__warning">Scientific-fit metadata could not be verified. Package checking remains available, but analysis preparation is blocked.</p> : null}
              {selected.tags.length > 0 ? <div className="dsh-bio-tags" aria-label="Catalog tags">{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
            </section>
            <details className="dsh-bio-disclosure dsh-bio-disclosure--technical">
              <summary><span>Technical details</span><small>{selected.verification.status}</small></summary>
              <dl className="dsh-bio-facts">
                <div><dt>Trust</dt><dd>{selected.trust}</dd></div>
                <div><dt>Verification</dt><dd>{selected.verification.status}</dd></div>
                <div><dt>Execution</dt><dd>{selected.executionSupported ? 'Allowlisted' : 'Validation only'}</dd></div>
                <div><dt>Engine</dt><dd>{selected.engines.map((engine) => engine.name).join(', ')}</dd></div>
                <div><dt>WDL</dt><dd>{selected.languageVersion}</dd></div>
                <div><dt>Digest</dt><dd><code title={selected.digest}>{selected.digest.slice(0, 17)}…</code></dd></div>
              </dl>
            </details>
            <div className="dsh-bio-lane" aria-label="Safe workflow lifecycle">
              {(analysisEligible(selected)
                ? ['Select', 'Validate', 'Plan', 'Approve', 'Run']
                : ['Select', 'Validate', 'Graph', 'Review']
              ).map((step, index) => (
                <span key={step} data-active={index === 0 || undefined}>{step}</span>
              ))}
            </div>
            {!selected.executionSupported && (
              <div className="dsh-bio-trust-note">
                <WarningIcon />
                <div><strong>Not execution-allowlisted</strong><p>This bundle can be inspected and validated, but 0.12.0 will not plan or run it.</p></div>
              </div>
            )}
            <p className="dsh-bio-action-help"><strong>Package check:</strong> {PACKAGE_CHECK_DETAIL} The allowlist is shown under Technical details; analysis eligibility also requires verified scientific-fit metadata, and Host readiness can still block planning or execution.</p>
            <div className="dsh-bio-actions">
              {analysisEligible(selected) && (
                <AgentButton
                  disabled={busy}
                  onClick={() => {
                    ask(prompts.prepareWorkflow(selected), {
                      action: 'Analysis preparation',
                      subject: `${selected.name} · ${selected.id}@${selected.version}`,
                      detail: ANALYSIS_PREPARATION_DETAIL,
                    })
                  }}
                >Prepare analysis</AgentButton>
              )}
              <AgentButton
                secondary={analysisEligible(selected)}
                disabled={busy}
                onClick={() => {
                  ask(prompts.validateWorkflow(selected), {
                    action: 'Workflow package check',
                    subject: `${selected.name} · ${selected.id}@${selected.version}`,
                    detail: PACKAGE_CHECK_DETAIL,
                  })
                }}
              >Check workflow package</AgentButton>
              {!analysisEligible(selected) && <AgentButton secondary disabled onClick={() => undefined}>{selected.executionSupported ? 'Scientific fit unavailable' : 'Analysis unavailable'}</AgentButton>}
            </div>
          </>
        ) : <div className="dsh-bio-empty"><WorkflowIcon /><strong>Select a workflow</strong><span>Details and safe next actions will appear here.</span></div>}
      </aside>
    </div>
  )
}

function DraftsArea({ ask, busy, draftWritesEnabled, isolatedTestConfigured }: {
  ask: AskAgent
  busy: boolean
  draftWritesEnabled: boolean
  isolatedTestConfigured: boolean
}) {
  const [brief, setBrief] = useState<WorkflowAnalysisBrief>(() => ({
    biologicalQuestion: '',
    inputData: '',
    desiredOutputs: '',
    constraints: '',
    acceptanceCriteria: '',
  }))
  const [draftId, setDraftId] = useState('')
  const [revision, setRevision] = useState('1')
  const [missionId, setMissionId] = useState('')
  const [fixtureId, setFixtureId] = useState('text-roundtrip')
  const [fixtureVersion, setFixtureVersion] = useState('1.0.0')
  const [testId, setTestId] = useState('')
  const validCreate = analysisBriefIsValid(brief)
  const briefSubject = brief.biologicalQuestion.trim().slice(0, 80)
  const validExisting = /^draft-[0-9a-f-]{36}$/.test(draftId) && Number.isSafeInteger(Number(revision)) && Number(revision) > 0
  const validMission = /^mission-[0-9a-f-]{36}$/.test(missionId)
    && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(fixtureId)
    && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)/.test(fixtureVersion)
  const validTest = /^test-[0-9a-f-]{36}$/.test(testId)

  return (
    <div className="dsh-bio-area dsh-bio-area--single">
      <section className="dsh-bio-workbench" aria-labelledby="dsh-bio-drafts-heading">
        <div className="dsh-bio-area-heading">
          <div><h2 id="dsh-bio-drafts-heading">Build or repair a workflow</h2><p>Describe the analysis in your own terms. The Agent handles draft naming while deterministic tools keep every revision exact.</p></div>
          <span className={`dsh-bio-badge ${draftWritesEnabled ? '' : 'dsh-bio-badge--warning'}`}>{draftWritesEnabled ? 'Owner-scoped' : 'Writes off'}</span>
        </div>
        {!draftWritesEnabled ? (
          <div className="dsh-bio-trust-note dsh-bio-trust-note--blocker" role="status">
            <WarningIcon />
            <div><strong>Workflow drafting is unavailable</strong><p>Open Setup to inspect readiness, then enable draft writes in the Host configuration. The browser cannot change this setting.</p></div>
          </div>
        ) : null}
        <form className="dsh-bio-brief" onSubmit={(event) => {
          event.preventDefault()
          if (validCreate && draftWritesEnabled) {
            ask(prompts.createDraft(brief), {
              action: 'Workflow draft',
              subject: briefSubject || 'New workflow from analysis brief',
              detail: 'The Agent will propose a workflow id and name, create owner-scoped revision 1, and keep the draft untrusted and non-executable.',
            })
          }
        }}>
          <div className="dsh-bio-section-title"><DraftIcon /><div><h3>Analysis brief</h3><p>Describe the goal and evidence of success; no draft identifiers are required.</p></div></div>
          <div className="dsh-bio-brief__grid">
            <Field label="Biological question"><textarea required maxLength={ANALYSIS_BRIEF_LIMITS.biologicalQuestion} value={brief.biologicalQuestion} onChange={(event) => { setBrief((value) => ({ ...value, biologicalQuestion: event.target.value })) }} placeholder="What do you need to learn from these data?" rows={3} /></Field>
            <Field label="Input data and types"><textarea required maxLength={ANALYSIS_BRIEF_LIMITS.inputData} value={brief.inputData} onChange={(event) => { setBrief((value) => ({ ...value, inputData: event.target.value })) }} placeholder="Describe the files, formats, pairing, and local paths you already have." rows={3} /></Field>
            <Field label="Desired outputs"><textarea required maxLength={ANALYSIS_BRIEF_LIMITS.desiredOutputs} value={brief.desiredOutputs} onChange={(event) => { setBrief((value) => ({ ...value, desiredOutputs: event.target.value })) }} placeholder="Name the reports, tables, or files you need." rows={3} /></Field>
            <Field label="Constraints (optional)"><textarea maxLength={ANALYSIS_BRIEF_LIMITS.constraints} value={brief.constraints} onChange={(event) => { setBrief((value) => ({ ...value, constraints: event.target.value })) }} placeholder="Reference build, software, resource, privacy, or timing constraints." rows={3} /></Field>
            <Field label="Acceptance criteria"><textarea required maxLength={ANALYSIS_BRIEF_LIMITS.acceptanceCriteria} value={brief.acceptanceCriteria} onChange={(event) => { setBrief((value) => ({ ...value, acceptanceCriteria: event.target.value })) }} placeholder="What must be true for you to accept the workflow and its outputs?" rows={3} /></Field>
          </div>
          <div className="dsh-bio-brief__footer">
            <p>The Agent proposes the internal id and name. You review every mutation in the Harness task.</p>
            <button className="dsh-bio-button" type="submit" disabled={!validCreate || busy || !draftWritesEnabled} title={draftWritesEnabled ? undefined : 'Enable draft writes in the Host configuration first.'}>Build workflow draft<ArrowIcon /></button>
          </div>
        </form>
        <details className="dsh-bio-disclosure dsh-bio-disclosure--advanced">
          <summary><span>Advanced: exact draft and test identities</span><small>For existing lifecycle objects</small></summary>
          <div className="dsh-bio-disclosure__body">
            <div className="dsh-bio-workbench__split">
              <form onSubmit={(event) => {
                event.preventDefault()
                if (validExisting) {
                  ask(prompts.graphDraft(draftId, Number(revision)), {
                    action: 'Draft graph review',
                    subject: `${draftId} · revision ${revision}`,
                    detail: 'The Agent will retrieve and explain the read-only graph for this exact revision. It will not change the draft.',
                  })
                }
              }}>
                <div className="dsh-bio-section-title"><WorkflowIcon /><div><h3>Inspect a revision</h3><p>Graph or validate one exact immutable revision.</p></div></div>
                <Field label="Draft id"><input value={draftId} onChange={(event) => { setDraftId(event.target.value) }} placeholder="draft-…" /></Field>
                <Field label="Exact revision"><input type="number" min="1" step="1" value={revision} onChange={(event) => { setRevision(event.target.value) }} /></Field>
                <div className="dsh-bio-actions dsh-bio-actions--inline">
                  <button className="dsh-bio-button" type="submit" disabled={!validExisting || busy}>Show graph<ArrowIcon /></button>
                  <button
                    className="dsh-bio-button dsh-bio-button--secondary"
                    type="button"
                    disabled={!validExisting || busy}
                    onClick={() => {
                      ask(prompts.validateDraft(draftId, Number(revision)), {
                        action: 'Draft validation',
                        subject: `${draftId} · revision ${revision}`,
                        detail: 'The Agent will explain deterministic evidence for this exact revision. Any later repair remains compare-and-swap protected.',
                      })
                    }}
                  >Validate revision</button>
                </div>
              </form>
              <div className="dsh-bio-run-plan">
                <div className="dsh-bio-section-title"><WarningIcon /><div><h3>Exact revision safety</h3><p>Source and immutable revision evidence remain authoritative.</p></div></div>
                <p>Every update requires both the current revision and content digest. A conflict stops the write so you can reload and merge explicitly.</p>
              </div>
            </div>
            <div className="dsh-bio-workbench__split dsh-bio-workbench__split--runs">
              <form onSubmit={(event) => {
                event.preventDefault()
                if (validMission && isolatedTestConfigured) {
                  ask(prompts.prepareDraftTest(missionId, fixtureId, fixtureVersion), {
                    action: 'Fixture test preparation',
                    subject: `${missionId} · ${fixtureId}@${fixtureVersion}`,
                    detail: 'The Agent will prepare an exact isolated-test plan for review. It will not start the test, install, promote, allowlist, or production-run the draft.',
                  })
                }
              }}>
                <div className="dsh-bio-section-title"><SetupIcon /><div><h3>Prepare an isolated fixture test</h3><p>A new approval binds one ready Mission to exact fixture and runner identities.</p></div></div>
                <Field label="Ready Mission id"><input value={missionId} onChange={(event) => { setMissionId(event.target.value) }} placeholder="mission-…" /></Field>
                <Field label="Fixture id"><input value={fixtureId} onChange={(event) => { setFixtureId(event.target.value) }} /></Field>
                <Field label="Fixture version"><input value={fixtureVersion} onChange={(event) => { setFixtureVersion(event.target.value) }} /></Field>
                <button className="dsh-bio-button" type="submit" disabled={!validMission || busy || !isolatedTestConfigured} title={isolatedTestConfigured ? 'Runs the exact Mission-specific preflight before producing an approval plan.' : 'Enable and configure the isolated fixture runner first.'}>Prepare with Agent<ArrowIcon /></button>
              </form>
              <form onSubmit={(event) => {
                event.preventDefault()
                if (validTest) {
                  ask(prompts.inspectDraftTest(testId), {
                    action: 'Fixture evidence review',
                    subject: testId,
                    detail: 'The Agent will retrieve bounded isolation, log, artifact, assertion, and failure evidence. It will not retry or promote anything.',
                  })
                }
              }}>
                <div className="dsh-bio-section-title"><RunsIcon /><div><h3>Inspect isolated evidence</h3><p>Owner data stays behind the current Agent; bootstrap exposes readiness only.</p></div></div>
                <Field label="Test id"><input value={testId} onChange={(event) => { setTestId(event.target.value) }} placeholder="test-…" /></Field>
                <button className="dsh-bio-button dsh-bio-button--secondary" type="submit" disabled={!validTest || busy}>Inspect with Agent<ArrowIcon /></button>
              </form>
            </div>
          </div>
        </details>
      </section>
    </div>
  )
}

function RunsArea({ selected, ask, busy }: { selected?: WorkflowSummary; ask: AskAgent; busy: boolean }) {
  const [runId, setRunId] = useState('')
  const validRunId = /^run-[0-9a-f-]{36}$/.test(runId)
  return (
    <div className="dsh-bio-area dsh-bio-area--single">
      <section className="dsh-bio-workbench" aria-labelledby="dsh-bio-runs-heading">
        <div className="dsh-bio-area-heading">
          <div><h2 id="dsh-bio-runs-heading">Runs and results</h2><p>Review owner-scoped analyses as outcome-first cards in the Agent task; this panel never fetches run data through the browser bootstrap.</p></div>
          <button
            className="dsh-bio-button dsh-bio-button--secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              ask(prompts.listRuns(), {
                action: 'Run history',
                subject: 'Your owner-scoped workflow runs',
                detail: 'The Agent will show recent outcomes and let you inspect one by position without copying an id. It will not start or retry a run.',
              })
            }}
          ><RefreshIcon />Show recent runs</button>
        </div>
        <div className="dsh-bio-run-strip" aria-label="Execution contract">
          {[
            ['1', 'Plan', 'Inspect inputs and engine'],
            ['2', 'Review', 'Confirm digest-bound plan'],
            ['3', 'Approve', 'Harness asks explicitly'],
            ['4', 'Run', 'Track durable job state'],
          ].map(([number, label, detail]) => <div key={number}><span>{number}</span><strong>{label}</strong><small>{detail}</small></div>)}
        </div>
        <div className="dsh-bio-workbench__split dsh-bio-workbench__split--runs">
          <details className="dsh-bio-disclosure dsh-bio-disclosure--panel">
            <summary><span>Inspect a run by exact id</span><small>Advanced</small></summary>
            <form onSubmit={(event) => {
              event.preventDefault()
              if (validRunId) {
                ask(prompts.inspectRun(runId), {
                  action: 'Run inspection',
                  subject: runId,
                  detail: 'The Agent will retrieve status, provenance, checksummed outputs, and normalized results. It will not start or retry a run.',
                })
              }
            }}>
              <div className="dsh-bio-section-title"><RunsIcon /><div><h3>Exact run lookup</h3><p>Open an outcome-first result card with provenance and checksums on demand.</p></div></div>
              <Field label="Run id"><input value={runId} onChange={(event) => { setRunId(event.target.value) }} placeholder="run-…" /></Field>
              <button className="dsh-bio-button" type="submit" disabled={!validRunId || busy}>Inspect with Agent<ArrowIcon /></button>
            </form>
          </details>
          <div className="dsh-bio-run-plan">
            <div className="dsh-bio-section-title"><WorkflowIcon /><div><h3>Prepare selected workflow</h3><p>Planning never starts a task.</p></div></div>
            {selected ? <><strong>{selected.name}</strong><p>{selected.id}@{selected.version}</p><code>{selected.digest.slice(0, 26)}…</code>{!selected.executionSupported && <p>This release keeps this bundle validation-only.</p>}{selected.scientificFitStatus === 'unavailable' && <p>Scientific-fit metadata is unavailable, so preparation is blocked.</p>}<AgentButton disabled={busy || !analysisEligible(selected)} onClick={() => {
              ask(prompts.prepareWorkflow(selected), {
                action: 'Analysis preparation',
                subject: `${selected.name} · ${selected.id}@${selected.version}`,
                detail: ANALYSIS_PREPARATION_DETAIL,
              })
            }}>{analysisEligible(selected) ? 'Prepare analysis' : selected.executionSupported ? 'Scientific fit unavailable' : 'Analysis unavailable'}</AgentButton></> : <div className="dsh-bio-empty"><WorkflowIcon /><strong>No workflow selected</strong><span>Select one in Analyze data first.</span></div>}
          </div>
        </div>
      </section>
    </div>
  )
}

const READINESS_COPY: Record<string, [string, string, string?, string?]> = {
  workflowCenter: ['Workflow Center', 'Native browser surface is loaded.'],
  workflowStore: ['Workflow store', 'Built-ins are visible here; Agent tools can inspect configured local bundles.'],
  localStoreConfigured: ['Local store', 'Persistent install and draft root is configured.'],
  storeWritesEnabled: ['Store writes', 'Install and scaffold mutations are enabled.'],
  draftAuthoringConfigured: ['Draft authoring', 'Owner-scoped revision store is configured.'],
  draftWritesEnabled: ['Draft writes', 'Revisioned draft create and update mutations are enabled.'],
  miniwdlValidator: ['miniwdl validator bridge', 'DSH subprocess is available; validation still verifies the pinned executable.'],
  autonomousMissionAuthoring: ['Autonomous authoring Missions', 'One approval grants a bounded owner-session draft repair loop.'],
  isolatedSoftwareTrialConfigured: ['Fixture runner configuration', 'Dedicated storage, immutable fixtures, subprocess, and jobs are configured.', 'Configured', 'Off'],
  isolatedSoftwareTrialPreflightVerified: ['Exact trial preflight', 'miniwdl, Docker, images, controller identity, cgroup v2, AppArmor, and denial controls are verified per Mission plan.', 'Verified', 'Unverified'],
  isolatedSoftwareTrial: ['Isolated software trials', 'Ready is reported only for a fresh, exact Mission-specific preflight; prepare performs that check.', 'Ready', 'Not ready'],
  workflowGraph: ['WorkflowGraph v1', 'Deterministic read-only WDL graph extraction is available.'],
  executionConfigured: ['Execution adapter', 'Input roots, runs root, and work directory are configured.'],
  executionEnabled: ['Workflow execution', 'Opt-in miniwdl execution is enabled.'],
  jobsAvailable: ['DSH jobs', 'Background run lifecycle can be tracked.'],
}

const ANALYSIS_READINESS_BLOCKERS = [
  ['workflowStore', 'Workflow catalog is unavailable.', 'Reload the catalog or diagnose the configured workflow Store.'],
  ['miniwdlValidator', 'The miniwdl validation bridge is unavailable.', 'Configure DSH subprocess access and the pinned miniwdl 1.15.0 executable.'],
  ['executionConfigured', 'The execution adapter is not configured.', 'Configure the input roots, runs root, and work directory in the Host.'],
  ['jobsAvailable', 'DSH jobs are unavailable.', 'Enable the Host jobs service before workflow execution can be tracked.'],
  ['executionEnabled', 'Workflow execution is disabled.', 'Enable execution explicitly in Host configuration after reviewing its policy.'],
] as const

function SetupArea({ bootstrap, ask, busy }: { bootstrap: WorkflowCenterBootstrap; ask: AskAgent; busy: boolean }) {
  const blocker = ANALYSIS_READINESS_BLOCKERS.find(([key]) => bootstrap.readiness[key] !== true)
  const ready = blocker === undefined
  return (
    <div className="dsh-bio-area dsh-bio-area--single">
      <section className="dsh-bio-workbench" aria-labelledby="dsh-bio-setup-heading">
        <div className="dsh-bio-area-heading">
          <div><h2 id="dsh-bio-setup-heading">Environment readiness</h2><p>Read-only status from the loaded host plugin. Disabled features stay explicit.</p></div>
          <span className="dsh-bio-version">v{bootstrap.package.version}</span>
        </div>
        <div className={`dsh-bio-readiness-summary dsh-bio-readiness-summary--${ready ? 'ready' : 'blocked'}`} role="status">
          <span className={`dsh-bio-readiness__icon dsh-bio-readiness__icon--${ready ? 'ready' : 'off'}`}>{ready ? <CheckIcon /> : <WarningIcon />}</span>
          <div>
            <strong>{ready ? 'Ready for analysis' : 'Analysis execution is blocked'}</strong>
            <p>{ready
              ? 'Catalog, validation, execution adapter, jobs, and execution opt-in are ready. Every run still requires a reviewed plan and approval.'
              : <><b>{blocker[1]}</b> {blocker[2]}</>}</p>
          </div>
          <span className={`dsh-bio-status dsh-bio-status--${ready ? 'success' : 'warning'}`}>{ready ? 'Ready' : 'Blocked'}</span>
        </div>
        <p className="dsh-bio-readiness-context">Draft authoring and isolated fixture testing have separate readiness and authorization boundaries; they do not make production analysis executable.</p>
        <details className="dsh-bio-disclosure dsh-bio-disclosure--setup">
          <summary><span>Operator details</span><small>{Object.keys(READINESS_COPY).length} checks</small></summary>
          <div className="dsh-bio-readiness">
            {Object.entries(READINESS_COPY).map(([key, [label, description, onLabel = 'Ready', offLabel = 'Off']]) => {
              const itemReady = bootstrap.readiness[key] === true
              return (
                <div key={key}>
                  <span className={`dsh-bio-readiness__icon dsh-bio-readiness__icon--${itemReady ? 'ready' : 'off'}`}>{itemReady ? <CheckIcon /> : <WarningIcon />}</span>
                  <div><strong>{label}</strong><p>{description}</p></div>
                  <span className={`dsh-bio-status dsh-bio-status--${itemReady ? 'success' : 'neutral'}`}>{itemReady ? onLabel : offLabel}</span>
                </div>
              )
            })}
          </div>
        </details>
        <div className="dsh-bio-setup-footer">
          <div><strong>Need a complete check?</strong><p>The Agent can inspect miniwdl, Docker, jobs, roots, and policy without changing them.</p></div>
          <AgentButton disabled={busy} onClick={() => {
            ask(prompts.diagnoseSetup(), {
              action: 'Setup diagnosis',
              subject: 'dsh-bio-workflows environment',
              detail: 'The Agent will inspect workflow, validator, Docker, jobs, roots, and policy readiness. It will not change configuration.',
            })
          }}>Diagnose setup</AgentButton>
        </div>
      </section>
    </div>
  )
}

export function WorkflowCenter({ sessions, open, onClose, loadBootstrap = defaultLoadBootstrap }: {
  sessions: SessionsFace
  open: boolean
  onClose(): void
  loadBootstrap?: (signal: AbortSignal) => Promise<unknown>
}) {
  const [area, setArea] = useState<Area>('workflows')
  const [bootstrap, setBootstrap] = useState<WorkflowCenterBootstrap>(EMPTY_BOOTSTRAP)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedDigest, setSelectedDigest] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [handoff, setHandoff] = useState<AgentHandoff | null>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const handoffRequestRef = useRef(0)
  const dismissCenter = useCallback(() => {
    handoffRequestRef.current += 1
    setHandoff(null)
    setNotice(null)
    onClose()
  }, [onClose])
  const subscribeSessions = useMemo(
    () => (listener: () => void) => sessions.list.subscribe(listener),
    [sessions],
  )
  const currentSessionSnapshot = useMemo(
    () => () => sessions.list.getSnapshot().current,
    [sessions],
  )
  const currentSessionId = useSyncExternalStore(
    subscribeSessions,
    currentSessionSnapshot,
    currentSessionSnapshot,
  )
  const agentAvailable = currentSessionId !== undefined && sessions.binding(currentSessionId) !== undefined
  const actionsDisabled = busy || !agentAvailable

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError(null)
    void loadBootstrap(controller.signal).then((candidate) => {
      const value = normalizeBootstrap(candidate)
      setBootstrap(value)
      setSelectedDigest((current) => (
        current !== null && value.workflows.some((workflow) => workflow.digest === current)
          ? current
          : value.workflows.find(analysisEligible)?.digest
            ?? value.workflows[0]?.digest
            ?? null
      ))
      setLoading(false)
    }).catch((error) => {
      if (controller.signal.aborted) return
      setLoadError(error instanceof Error ? error.message : String(error))
      setLoading(false)
    })
    return () => { controller.abort() }
  }, [loadBootstrap, reloadKey])

  useEffect(() => {
    if (!open) return
    const center = centerRef.current
    if (center === null) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const initialFocus = center.querySelector<HTMLElement>('[data-initial-focus]') ?? center
    initialFocus.focus()
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissCenter()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements(center)
      if (focusable.length === 0) {
        event.preventDefault()
        center.focus()
        return
      }
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && (document.activeElement === first || !center.contains(document.activeElement))) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleDialogKeys)
    return () => {
      document.removeEventListener('keydown', handleDialogKeys)
      const previousFocus = previousFocusRef.current
      previousFocusRef.current = null
      if (previousFocus?.isConnected === true) previousFocus.focus()
    }
  }, [dismissCenter, open])

  const selected = bootstrap.workflows.find((workflow) => workflow.digest === selectedDigest)
  const catalogDiagnostic = bootstrap.diagnostics[0]
  const catalogDiagnosticMessage = catalogDiagnostic?.message
    ?? catalogDiagnostic?.code
    ?? 'A local workflow catalog entry could not be loaded.'
  const ask: AskAgent = (text, context) => {
    if (!agentAvailable) {
      setHandoff(null)
      setNotice({ message: 'Open a Harness task before asking the Agent.' })
      return
    }
    setBusy(true)
    setNotice(null)
    setHandoff({ ...context, state: 'sending' })
    const requestId = handoffRequestRef.current + 1
    handoffRequestRef.current = requestId
    void sendToAgent(sessions, text).then(() => {
      if (handoffRequestRef.current !== requestId) return
      setHandoff({ ...context, state: 'queued' })
    }).catch((error) => {
      if (handoffRequestRef.current !== requestId) return
      setHandoff(null)
      setNotice({ message: error instanceof Error ? error.message : String(error) })
    }).finally(() => { setBusy(false) })
  }

  return (
    <div ref={centerRef} className="dsh-bio-center" hidden={!open} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dsh-bio-center-title">
      <header className="dsh-bio-center__header">
        <div className="dsh-bio-center__identity"><WorkflowIcon /><div><h1 id="dsh-bio-center-title">Bio Workflows</h1><p>Biological intent to safe, reviewable analysis</p></div></div>
        <div className="dsh-bio-center__header-meta">
          <span className={`dsh-bio-badge ${agentAvailable ? 'dsh-bio-badge--success' : 'dsh-bio-badge--warning'}`} aria-label={agentAvailable ? 'Agent connected' : 'Open a Harness task'} aria-live="polite" data-compact-label={agentAvailable ? 'Agent ready' : 'Open task'}>{agentAvailable ? 'Agent connected' : 'Open a Harness task'}</span>
          <button data-initial-focus type="button" className="dsh-bio-icon-button" aria-label="Close Workflow Center" title="Close" onClick={dismissCenter}><CloseIcon /></button>
        </div>
      </header>
      <div className="dsh-bio-center__body">
        <nav className="dsh-bio-nav" aria-label="Workflow Center jobs">
          {PRIMARY_AREAS.map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} data-active={area === id || undefined} aria-current={area === id ? 'page' : undefined} onClick={() => { setArea(id) }}>
              <Icon /><span>{label}</span>
            </button>
          ))}
          <div className="dsh-bio-nav__utility">
            <button type="button" data-active={area === 'setup' || undefined} aria-current={area === 'setup' ? 'page' : undefined} onClick={() => { setArea('setup') }}>
              <SetupIcon /><span>Setup</span>
            </button>
          </div>
          <div className="dsh-bio-nav__foot"><span>Safety boundary</span><strong>Harness Agent</strong><small>Tools remain authoritative</small></div>
        </nav>
        <main className="dsh-bio-content">
          {loadError && (
            <div className="dsh-bio-banner dsh-bio-banner--error" role="alert"><WarningIcon /><span>{loadError}</span><button type="button" onClick={() => { setReloadKey((value) => value + 1) }}>Retry</button></div>
          )}
          {!loadError && catalogDiagnostic && (
            <div className="dsh-bio-banner dsh-bio-banner--error" role="alert">
              <WarningIcon />
              <span>{catalogDiagnosticMessage}{bootstrap.diagnostics.length > 1 ? ` (+${bootstrap.diagnostics.length - 1} more)` : ''}</span>
            </div>
          )}
          {notice && (
            <div className="dsh-bio-banner dsh-bio-banner--error" role="alert">
              <WarningIcon />
              <span>{notice.message}</span>
            </div>
          )}
          {handoff && <AgentHandoffStatus handoff={handoff} onContinue={dismissCenter} />}
          {loading && area === 'workflows' ? (
            <div className="dsh-bio-loading" aria-live="polite"><span className="dsh-bio-spinner" /><strong>Reading workflow catalog…</strong><p>The host is resolving verified bundles and readiness.</p></div>
          ) : (
            <>
              {area === 'workflows' && <WorkflowsArea workflows={bootstrap.workflows} selected={selected} onSelect={(workflow) => { setSelectedDigest(workflow.digest) }} ask={ask} busy={actionsDisabled} />}
              {area === 'drafts' && <DraftsArea ask={ask} busy={actionsDisabled} draftWritesEnabled={bootstrap.readiness.draftWritesEnabled === true} isolatedTestConfigured={bootstrap.readiness.isolatedSoftwareTrialConfigured === true} />}
              {area === 'runs' && <RunsArea selected={selected} ask={ask} busy={actionsDisabled} />}
              {area === 'setup' && <SetupArea bootstrap={bootstrap} ask={ask} busy={actionsDisabled} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
