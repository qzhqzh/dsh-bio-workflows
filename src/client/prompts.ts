import type { WorkflowSummary } from './types.ts'

function workflowIdentity(workflow: WorkflowSummary) {
  return `${workflow.id}@${workflow.version} with bundle digest ${workflow.digest}`
}

export const prompts = {
  validateWorkflow(workflow: WorkflowSummary) {
    return `Use dsh-bio-workflows to validate the exact ${workflowIdentity(workflow)} bundle. Explain every diagnostic and do not run the workflow.`
  },
  prepareWorkflow(workflow: WorkflowSummary) {
    return `Help me prepare a safe run of ${workflowIdentity(workflow)}. First ask for any missing real input paths, then call bio_workflows_plan. Do not call bio_workflows_run until I review the plan and approve it.`
  },
  createDraft(value: { id: string; name: string; summary: string }) {
    return `Create an owner-scoped AI WDL draft using bio_workflows_draft_create with id ${JSON.stringify(value.id)}, name ${JSON.stringify(value.name)}, and summary ${JSON.stringify(value.summary)}. After creation, read revision 1 and propose the next source edit. Treat the draft as untrusted and non-executable.`
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
    return 'Use bio_workflows_run_list to list my owner-scoped workflow runs, newest first. Summarize status, workflow identity, and the next safe action for failures. Do not start a new run.'
  },
  inspectRun(runId: string) {
    return `Use bio_workflows_run_get to inspect owner-scoped run ${runId}. Summarize status, provenance, checksummed outputs, and any normalized bioinformatics results. Do not retry or start another run.`
  },
  diagnoseSetup() {
    return 'Inspect dsh-bio-workflows capabilities with bio_workflows_info. Diagnose the workflow store, miniwdl 1.15.0 validator, Docker, DSH jobs, and the configured input/run roots. Make no configuration changes unless I explicitly approve them.'
  },
}
