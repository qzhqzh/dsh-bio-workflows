import type { WorkflowAnalysisBrief, WorkflowSummary } from './types.ts'

export const ANALYSIS_BRIEF_LIMITS = Object.freeze({
  biologicalQuestion: 2000,
  inputData: 3000,
  desiredOutputs: 1500,
  constraints: 1500,
  acceptanceCriteria: 2000,
  total: 10000,
})

const ANALYSIS_BRIEF_FIELDS = [
  'biologicalQuestion',
  'inputData',
  'desiredOutputs',
  'constraints',
  'acceptanceCriteria',
] as const

export function analysisBriefIsValid(value: unknown): value is WorkflowAnalysisBrief {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const brief = value as Record<string, unknown>
  let total = 0
  for (const field of ANALYSIS_BRIEF_FIELDS) {
    const content = brief[field]
    if (typeof content !== 'string' || content.length > ANALYSIS_BRIEF_LIMITS[field]) return false
    if (field !== 'constraints' && content.trim().length === 0) return false
    total += content.length
  }
  return total <= ANALYSIS_BRIEF_LIMITS.total
}

function workflowIdentity(workflow: WorkflowSummary) {
  return `${workflow.id}@${workflow.version} with bundle digest ${workflow.digest}`
}

export const prompts = {
  validateWorkflow(workflow: WorkflowSummary) {
    return `Call bio_workflows_validate for the exact ${workflowIdentity(workflow)} bundle. Summarize descriptor shape, SHA-256 file digests, local imports, WDL version declarations, example JSON, and container-image pin diagnostics. This is a read-only package check. Do not call planning or execution tools, and do not run the workflow.`
  },
  prepareWorkflow(workflow: WorkflowSummary) {
    return `Help me prepare a safe run of ${workflowIdentity(workflow)}. First ask for any missing real input paths, then call bio_workflows_plan. Do not call bio_workflows_run until I review the plan and approve it.`
  },
  createDraft(value: WorkflowAnalysisBrief) {
    if (!analysisBriefIsValid(value)) throw new RangeError('Analysis brief is incomplete or exceeds its bounded size.')
    return `Help me build an owner-scoped WDL workflow from this analysis brief. Biological question: ${JSON.stringify(value.biologicalQuestion)}. Input data and types: ${JSON.stringify(value.inputData)}. Desired outputs: ${JSON.stringify(value.desiredOutputs)}. Constraints: ${JSON.stringify(value.constraints.trim() || 'None specified')}. Acceptance criteria: ${JSON.stringify(value.acceptanceCriteria)}. First summarize the proposed workflow and any missing information. If the brief is sufficient, choose a concise lowercase workflow id and human-readable name, then call bio_workflows_draft_create with a summary grounded in the brief. After creation, read revision 1 and propose the next source edit. Treat the draft as untrusted and non-executable. Do not plan, execute, install, promote, or allowlist it.`
  },
  graphDraft(draftId: string, revision: number) {
    return `Call bio_workflows_draft_graph for draftId ${draftId} at exact revision ${revision}. Verify that its contentDigest is bound to that revision, then explain the read-only graph and every partial-graph diagnostic. Do not mutate the draft.`
  },
  validateDraft(draftId: string, revision: number) {
    return `Validate owner-scoped WDL draft ${draftId} at exact immutable revision ${revision} with bio_workflows_draft_validate. Explain the deterministic evidence. If a repair is needed, first read the exact source and content digest; any update must use both expectedRevision and expectedContentDigest, stop on conflict, and never use last-write-wins.`
  },
  prepareDraftTest(missionId: string, fixtureId: string, fixtureVersion: string) {
    return `Prepare a separately authorized isolated fixture test for ready Mission ${missionId} with exact fixture ${fixtureId}@${fixtureVersion} by calling bio_workflows_draft_test_prepare. Explain the bound draft, validation, fixture, container, runner, isolation, assertion, and budget digests. Do not call bio_workflows_draft_test_start until I review that exact plan and explicitly approve it. Never install, promote, allowlist, or production-run the draft.`
  },
  inspectDraftTest(testId: string) {
    return `Call bio_workflows_draft_test_get and bio_workflows_draft_test_report for owner-scoped isolated test ${testId}. Summarize isolation probes, exact identities, bounded logs and artifacts, assertion evidence, and failure facts. Do not retry, promote, allowlist, or production-run anything.`
  },
  listRuns() {
    return 'Use bio_workflows_run_list to list my owner-scoped workflow runs, newest first. Present each by workflow, time, outcome, and a short position label; offer to inspect one by position without asking me to copy its run id. For failures, explain the next safe diagnostic action. Do not start or retry a run.'
  },
  inspectRun(runId: string) {
    return `Use bio_workflows_run_get to inspect owner-scoped run ${runId}. State first whether execution completed, then summarize only checksummed outputs and normalized bioinformatics results that the tool actually returned. Distinguish execution completion, technical QC findings, and biological interpretation; do not expose absolute host paths, owner identity, commands, environment values, or raw logs in the summary. Do not retry or start another run.`
  },
  diagnoseSetup() {
    return 'Inspect dsh-bio-workflows capabilities with bio_workflows_info. Diagnose the workflow store, miniwdl 1.15.0 validator, Docker, DSH jobs, and the configured input/run roots. Make no configuration changes unless I explicitly approve them.'
  },
}
