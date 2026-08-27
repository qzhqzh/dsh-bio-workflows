import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

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
import { prompts } from './prompts.ts'
import type { SessionsFace, WorkflowCenterBootstrap, WorkflowSummary } from './types.ts'

type Area = 'workflows' | 'drafts' | 'runs' | 'setup'
type Notice = { tone: 'success' | 'error'; message: string }

const AREAS: Array<{ id: Area; label: string; icon: typeof WorkflowIcon }> = [
  { id: 'workflows', label: 'Workflows', icon: WorkflowIcon },
  { id: 'drafts', label: 'AI Drafts', icon: DraftIcon },
  { id: 'runs', label: 'Runs', icon: RunsIcon },
  { id: 'setup', label: 'Setup', icon: SetupIcon },
]

const EMPTY_BOOTSTRAP: WorkflowCenterBootstrap = {
  schemaVersion: '1',
  package: { name: 'dsh-bio-workflows', version: '0.11.0' },
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
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
}

async function defaultLoadBootstrap(signal: AbortSignal): Promise<WorkflowCenterBootstrap> {
  const response = await fetch('/api/bio-workflows/v1/bootstrap', {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`Workflow Center bootstrap failed (${response.status})`)
  const value: unknown = await response.json()
  if (
    value === null
    || typeof value !== 'object'
    || (value as Partial<WorkflowCenterBootstrap>).schemaVersion !== '1'
    || !Array.isArray((value as Partial<WorkflowCenterBootstrap>).workflows)
    || (value as Partial<WorkflowCenterBootstrap>).workflows?.some((workflow) => (
      workflow === null
      || typeof workflow !== 'object'
      || typeof workflow.executionSupported !== 'boolean'
    )) === true
  ) throw new Error('Workflow Center bootstrap returned an incompatible payload')
  return value as WorkflowCenterBootstrap
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

function WorkflowsArea({ workflows, selected, onSelect, ask, busy }: {
  workflows: WorkflowSummary[]
  selected?: WorkflowSummary
  onSelect(workflow: WorkflowSummary): void
  ask(text: string): void
  busy: boolean
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return workflows
    return workflows.filter((workflow) => (
      [workflow.id, workflow.name, workflow.summary, workflow.source, ...workflow.tags]
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
            <h2 id="dsh-bio-workflows-heading">Workflow catalog</h2>
            <p>Verified WDL bundles available to the current plugin host.</p>
          </div>
          <span className="dsh-bio-count">{workflows.length} releases</span>
        </div>
        <div className="dsh-bio-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
            placeholder="Search name, tag, or source"
            aria-label="Search workflow catalog"
          />
        </div>
        <div className="dsh-bio-workflow-table" role="table" aria-label="Workflow catalog">
          <div className="dsh-bio-workflow-table__head" role="row">
            <span role="columnheader">Workflow</span>
            <span role="columnheader">Source</span>
            <span role="columnheader">WDL</span>
            <span role="columnheader">Status</span>
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
                <span role="cell"><span className="dsh-bio-source">{workflow.source}</span></span>
                <span role="cell">{workflow.languageVersion}</span>
                <span role="cell"><span className={`dsh-bio-status dsh-bio-status--${statusTone(workflow.status)}`}>{workflow.status}</span></span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="dsh-bio-empty"><SearchIcon /><strong>No matching workflows</strong><span>Try a workflow id such as fastq-qc or bam-qc.</span></div>
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
            <dl className="dsh-bio-facts">
              <div><dt>Trust</dt><dd>{selected.trust}</dd></div>
              <div><dt>Verification</dt><dd>{selected.verification.status}</dd></div>
              <div><dt>Execution</dt><dd>{selected.executionSupported ? 'Allowlisted' : 'Validation only'}</dd></div>
              <div><dt>Engine</dt><dd>{selected.engines.map((engine) => engine.name).join(', ')}</dd></div>
              <div><dt>Digest</dt><dd><code title={selected.digest}>{selected.digest.slice(0, 17)}…</code></dd></div>
            </dl>
            <div className="dsh-bio-tags">{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            <div className="dsh-bio-lane" aria-label="Safe workflow lifecycle">
              {(selected.executionSupported
                ? ['Select', 'Validate', 'Plan', 'Approve', 'Run']
                : ['Select', 'Validate', 'Graph', 'Review']
              ).map((step, index) => (
                <span key={step} data-active={index === 0 || undefined}>{step}</span>
              ))}
            </div>
            {!selected.executionSupported && (
              <div className="dsh-bio-trust-note">
                <WarningIcon />
                <div><strong>Not execution-allowlisted</strong><p>This bundle can be inspected and validated, but 0.11.0 will not plan or run it.</p></div>
              </div>
            )}
            <div className="dsh-bio-actions">
              <AgentButton disabled={busy} onClick={() => { ask(prompts.validateWorkflow(selected)) }}>Ask Agent to validate</AgentButton>
              <AgentButton secondary disabled={busy || !selected.executionSupported} onClick={() => { ask(prompts.prepareWorkflow(selected)) }}>Prepare a safe run</AgentButton>
            </div>
          </>
        ) : <div className="dsh-bio-empty"><WorkflowIcon /><strong>Select a workflow</strong><span>Details and safe next actions will appear here.</span></div>}
      </aside>
    </div>
  )
}

function DraftsArea({ ask, busy, draftWritesEnabled, isolatedTestConfigured }: {
  ask(text: string): void
  busy: boolean
  draftWritesEnabled: boolean
  isolatedTestConfigured: boolean
}) {
  const [draft, setDraft] = useState({ id: '', name: '', summary: '' })
  const [draftId, setDraftId] = useState('')
  const [revision, setRevision] = useState('1')
  const [missionId, setMissionId] = useState('')
  const [fixtureId, setFixtureId] = useState('text-roundtrip')
  const [fixtureVersion, setFixtureVersion] = useState('1.0.0')
  const [testId, setTestId] = useState('')
  const validCreate = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(draft.id) && draft.name.trim() !== '' && draft.summary.trim() !== ''
  const validExisting = /^draft-[0-9a-f-]{36}$/.test(draftId) && Number.isSafeInteger(Number(revision)) && Number(revision) > 0
  const validMission = /^mission-[0-9a-f-]{36}$/.test(missionId)
    && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(fixtureId)
    && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)/.test(fixtureVersion)
  const validTest = /^test-[0-9a-f-]{36}$/.test(testId)

  return (
    <div className="dsh-bio-area dsh-bio-area--single">
      <section className="dsh-bio-workbench" aria-labelledby="dsh-bio-drafts-heading">
        <div className="dsh-bio-area-heading">
          <div><h2 id="dsh-bio-drafts-heading">AI-assisted WDL drafts</h2><p>The Agent writes; deterministic tools own revisions, validation, and graph facts.</p></div>
          <span className={`dsh-bio-badge ${draftWritesEnabled ? '' : 'dsh-bio-badge--warning'}`}>{draftWritesEnabled ? 'Owner-scoped' : 'Writes off'}</span>
        </div>
        <div className="dsh-bio-workbench__split">
          <form onSubmit={(event) => { event.preventDefault(); if (validCreate && draftWritesEnabled) ask(prompts.createDraft(draft)) }}>
            <div className="dsh-bio-section-title"><DraftIcon /><div><h3>Start a draft</h3><p>Create revision 1 from a deterministic WDL template.</p></div></div>
            <Field label="Workflow id"><input value={draft.id} onChange={(event) => { setDraft({ ...draft, id: event.target.value }) }} placeholder="rna-seq-qc" /></Field>
            <Field label="Name"><input value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }} placeholder="RNA sequencing QC" /></Field>
            <Field label="Purpose"><textarea value={draft.summary} onChange={(event) => { setDraft({ ...draft, summary: event.target.value }) }} placeholder="Describe inputs, outputs, and the biological question." rows={4} /></Field>
            <button className="dsh-bio-button" type="submit" disabled={!validCreate || busy || !draftWritesEnabled} title={draftWritesEnabled ? undefined : 'Enable draft writes in the Host configuration first.'}>Create with Agent<ArrowIcon /></button>
          </form>
          <form onSubmit={(event) => { event.preventDefault(); if (validExisting) ask(prompts.graphDraft(draftId, Number(revision))) }}>
            <div className="dsh-bio-section-title"><WorkflowIcon /><div><h3>Inspect a revision</h3><p>Graph or validate one exact immutable revision.</p></div></div>
            <Field label="Draft id"><input value={draftId} onChange={(event) => { setDraftId(event.target.value) }} placeholder="draft-…" /></Field>
            <Field label="Exact revision"><input type="number" min="1" step="1" value={revision} onChange={(event) => { setRevision(event.target.value) }} /></Field>
            <div className="dsh-bio-actions dsh-bio-actions--inline">
              <button className="dsh-bio-button" type="submit" disabled={!validExisting || busy}>Show graph<ArrowIcon /></button>
              <button className="dsh-bio-button dsh-bio-button--secondary" type="button" disabled={!validExisting || busy} onClick={() => { ask(prompts.validateDraft(draftId, Number(revision))) }}>Validate revision</button>
            </div>
          </form>
        </div>
        <div className="dsh-bio-trust-note">
          <WarningIcon />
          <div><strong>Source is authoritative</strong><p>Every update requires both the current revision and content digest. A conflict stops the write; reload and merge explicitly.</p></div>
        </div>
        <div className="dsh-bio-workbench__split dsh-bio-workbench__split--runs">
          <form onSubmit={(event) => { event.preventDefault(); if (validMission && isolatedTestConfigured) ask(prompts.prepareDraftTest(missionId, fixtureId, fixtureVersion)) }}>
            <div className="dsh-bio-section-title"><SetupIcon /><div><h3>Prepare an isolated fixture test</h3><p>A new approval binds one ready Mission to exact fixture and runner identities.</p></div></div>
            <Field label="Ready Mission id"><input value={missionId} onChange={(event) => { setMissionId(event.target.value) }} placeholder="mission-…" /></Field>
            <Field label="Fixture id"><input value={fixtureId} onChange={(event) => { setFixtureId(event.target.value) }} /></Field>
            <Field label="Fixture version"><input value={fixtureVersion} onChange={(event) => { setFixtureVersion(event.target.value) }} /></Field>
            <button className="dsh-bio-button" type="submit" disabled={!validMission || busy || !isolatedTestConfigured} title={isolatedTestConfigured ? 'Runs the exact Mission-specific preflight before producing an approval plan.' : 'Enable and configure the isolated fixture runner first.'}>Prepare with Agent<ArrowIcon /></button>
          </form>
          <form onSubmit={(event) => { event.preventDefault(); if (validTest) ask(prompts.inspectDraftTest(testId)) }}>
            <div className="dsh-bio-section-title"><RunsIcon /><div><h3>Inspect isolated evidence</h3><p>Owner data stays behind the current Agent; bootstrap exposes readiness only.</p></div></div>
            <Field label="Test id"><input value={testId} onChange={(event) => { setTestId(event.target.value) }} placeholder="test-…" /></Field>
            <button className="dsh-bio-button dsh-bio-button--secondary" type="submit" disabled={!validTest || busy}>Inspect with Agent<ArrowIcon /></button>
          </form>
        </div>
      </section>
    </div>
  )
}

function RunsArea({ selected, ask, busy }: { selected?: WorkflowSummary; ask(text: string): void; busy: boolean }) {
  const [runId, setRunId] = useState('')
  const validRunId = /^run-[0-9a-f-]{36}$/.test(runId)
  return (
    <div className="dsh-bio-area dsh-bio-area--single">
      <section className="dsh-bio-workbench" aria-labelledby="dsh-bio-runs-heading">
        <div className="dsh-bio-area-heading">
          <div><h2 id="dsh-bio-runs-heading">Runs and provenance</h2><p>Owner-scoped history stays behind the current Agent and plugin tools.</p></div>
          <button className="dsh-bio-button dsh-bio-button--secondary" type="button" disabled={busy} onClick={() => { ask(prompts.listRuns()) }}><RefreshIcon />List my runs</button>
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
          <form onSubmit={(event) => { event.preventDefault(); if (validRunId) ask(prompts.inspectRun(runId)) }}>
            <div className="dsh-bio-section-title"><RunsIcon /><div><h3>Inspect a run</h3><p>Read status, provenance, and checksummed results.</p></div></div>
            <Field label="Run id"><input value={runId} onChange={(event) => { setRunId(event.target.value) }} placeholder="run-…" /></Field>
            <button className="dsh-bio-button" type="submit" disabled={!validRunId || busy}>Inspect with Agent<ArrowIcon /></button>
          </form>
          <div className="dsh-bio-run-plan">
            <div className="dsh-bio-section-title"><WorkflowIcon /><div><h3>Prepare selected workflow</h3><p>Planning never starts a task.</p></div></div>
            {selected ? <><strong>{selected.name}</strong><p>{selected.id}@{selected.version}</p><code>{selected.digest.slice(0, 26)}…</code>{!selected.executionSupported && <p>This release keeps this bundle validation-only.</p>}<AgentButton disabled={busy || !selected.executionSupported} onClick={() => { ask(prompts.prepareWorkflow(selected)) }}>{selected.executionSupported ? 'Ask Agent to plan' : 'Execution unavailable'}</AgentButton></> : <div className="dsh-bio-empty"><WorkflowIcon /><strong>No workflow selected</strong><span>Select one in Workflows first.</span></div>}
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

function SetupArea({ bootstrap, ask, busy }: { bootstrap: WorkflowCenterBootstrap; ask(text: string): void; busy: boolean }) {
  return (
    <div className="dsh-bio-area dsh-bio-area--single">
      <section className="dsh-bio-workbench" aria-labelledby="dsh-bio-setup-heading">
        <div className="dsh-bio-area-heading">
          <div><h2 id="dsh-bio-setup-heading">Environment readiness</h2><p>Read-only status from the loaded host plugin. Disabled features stay explicit.</p></div>
          <span className="dsh-bio-version">v{bootstrap.package.version}</span>
        </div>
        <div className="dsh-bio-readiness">
          {Object.entries(READINESS_COPY).map(([key, [label, description, onLabel = 'Ready', offLabel = 'Off']]) => {
            const ready = bootstrap.readiness[key] === true
            return (
              <div key={key}>
                <span className={`dsh-bio-readiness__icon dsh-bio-readiness__icon--${ready ? 'ready' : 'off'}`}>{ready ? <CheckIcon /> : <WarningIcon />}</span>
                <div><strong>{label}</strong><p>{description}</p></div>
                <span className={`dsh-bio-status dsh-bio-status--${ready ? 'success' : 'neutral'}`}>{ready ? onLabel : offLabel}</span>
              </div>
            )
          })}
        </div>
        <div className="dsh-bio-setup-footer">
          <div><strong>Need a complete check?</strong><p>The Agent can inspect miniwdl, Docker, jobs, roots, and policy without changing them.</p></div>
          <AgentButton disabled={busy} onClick={() => { ask(prompts.diagnoseSetup()) }}>Diagnose setup</AgentButton>
        </div>
      </section>
    </div>
  )
}

export function WorkflowCenter({ sessions, open, onClose, loadBootstrap = defaultLoadBootstrap }: {
  sessions: SessionsFace
  open: boolean
  onClose(): void
  loadBootstrap?: (signal: AbortSignal) => Promise<WorkflowCenterBootstrap>
}) {
  const [area, setArea] = useState<Area>('workflows')
  const [bootstrap, setBootstrap] = useState<WorkflowCenterBootstrap>(EMPTY_BOOTSTRAP)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedDigest, setSelectedDigest] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
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
    void loadBootstrap(controller.signal).then((value) => {
      setBootstrap(value)
      setSelectedDigest((current) => (
        current !== null && value.workflows.some((workflow) => workflow.digest === current)
          ? current
          : value.workflows.find((workflow) => workflow.executionSupported)?.digest
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
        onClose()
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
  }, [onClose, open])

  const selected = bootstrap.workflows.find((workflow) => workflow.digest === selectedDigest)
  const catalogDiagnostic = bootstrap.diagnostics[0]
  const catalogDiagnosticMessage = catalogDiagnostic?.message
    ?? catalogDiagnostic?.code
    ?? 'A local workflow catalog entry could not be loaded.'
  const ask = (text: string) => {
    if (!agentAvailable) {
      setNotice({ tone: 'error', message: 'Open a Harness task before asking the Agent.' })
      return
    }
    setBusy(true)
    setNotice(null)
    void sendToAgent(sessions, text).then(() => {
      setNotice({ tone: 'success', message: 'Request queued in the current Harness task.' })
      window.setTimeout(onClose, 350)
    }).catch((error) => {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    }).finally(() => { setBusy(false) })
  }

  return (
    <div ref={centerRef} className="dsh-bio-center" hidden={!open} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dsh-bio-center-title">
      <header className="dsh-bio-center__header">
        <div className="dsh-bio-center__identity"><WorkflowIcon /><div><h1 id="dsh-bio-center-title">Bio Workflows</h1><p>WDL authoring, graph review, and trusted execution</p></div></div>
        <div className="dsh-bio-center__header-meta">
          <span className={`dsh-bio-badge ${agentAvailable ? 'dsh-bio-badge--success' : 'dsh-bio-badge--warning'}`} aria-live="polite">{agentAvailable ? 'Agent connected' : 'Open a Harness task'}</span>
          <button data-initial-focus type="button" className="dsh-bio-icon-button" aria-label="Close Workflow Center" title="Close" onClick={onClose}><CloseIcon /></button>
        </div>
      </header>
      <div className="dsh-bio-center__body">
        <nav className="dsh-bio-nav" aria-label="Workflow Center areas">
          {AREAS.map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} data-active={area === id || undefined} aria-current={area === id ? 'page' : undefined} onClick={() => { setArea(id) }}>
              <Icon /><span>{label}</span>
            </button>
          ))}
          <div className="dsh-bio-nav__foot"><span>Control plane</span><strong>Harness Agent</strong><small>Tools remain authoritative</small></div>
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
            <div
              className={notice.tone === 'error' ? 'dsh-bio-banner dsh-bio-banner--error' : 'dsh-bio-banner'}
              role={notice.tone === 'error' ? 'alert' : 'status'}
            >
              {notice.tone === 'error' ? <WarningIcon /> : <CheckIcon />}
              <span>{notice.message}</span>
            </div>
          )}
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
