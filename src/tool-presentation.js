const TOOL_PRESENTATIONS = Object.freeze({
  bio_workflows_info: { title: 'Inspect bio-workflow capabilities', kind: 'read' },
  bio_workflows_list: { title: 'List configured bio-workflows', kind: 'search' },
  bio_workflows_get: { title: 'Inspect configured bio-workflow', kind: 'read', fields: ['id'] },
  bio_workflows_preflight: { title: 'Preflight bio-workflow inputs', kind: 'read', fields: ['id'] },
  bio_workflows_search: { title: 'Search the workflow store', kind: 'search', fields: ['query', 'language', 'tag', 'source', 'provider'] },
  bio_workflows_validate: { title: 'Validate a workflow bundle', kind: 'read', fields: ['id', 'version', 'source', 'provider'] },
  bio_workflows_install: { title: 'Install a workflow bundle', kind: 'edit', fields: ['id', 'version', 'source', 'provider'] },
  bio_workflows_scaffold: { title: 'Scaffold a WDL workflow', kind: 'edit', fields: ['id', 'version', 'name'] },
  bio_workflows_mission_prepare: { title: 'Prepare an autonomous software trial', kind: 'read', fields: ['software', 'objective'] },
  bio_workflows_mission_start: { title: 'Start an autonomous software trial', kind: 'execute', fields: ['software', 'expectedPlanDigest'] },
  bio_workflows_mission_get: { title: 'Inspect an autonomous software trial', kind: 'read', fields: ['missionId'] },
  bio_workflows_mission_cancel: { title: 'Cancel an autonomous software trial', kind: 'edit', fields: ['missionId'] },
  bio_workflows_mission_report: { title: 'Report an autonomous software trial', kind: 'read', fields: ['missionId'] },
  bio_workflows_draft_create: { title: 'Create an AI WDL draft', kind: 'edit', fields: ['id', 'version', 'name', 'missionId'] },
  bio_workflows_draft_get: { title: 'Read an AI WDL draft', kind: 'read', fields: ['draftId', 'revision', 'path'] },
  bio_workflows_draft_update: { title: 'Update an AI WDL draft', kind: 'edit', fields: ['draftId', 'expectedRevision', 'expectedContentDigest', 'missionId'] },
  bio_workflows_draft_validate: { title: 'Validate an AI WDL draft', kind: 'read', fields: ['draftId', 'revision', 'missionId'] },
  bio_workflows_draft_graph: { title: 'Visualize an AI WDL draft', kind: 'read', fields: ['draftId', 'revision'] },
  bio_workflows_draft_test_prepare: { title: 'Prepare an isolated draft test', kind: 'read', fields: ['missionId', 'fixtureId', 'fixtureVersion'] },
  bio_workflows_draft_test_start: { title: 'Start an isolated draft test', kind: 'execute', fields: ['missionId', 'fixtureId', 'fixtureVersion', 'expectedPlanDigest'] },
  bio_workflows_draft_test_get: { title: 'Inspect an isolated draft test', kind: 'read', fields: ['testId'] },
  bio_workflows_draft_test_cancel: { title: 'Cancel an isolated draft test', kind: 'edit', fields: ['testId'] },
  bio_workflows_draft_test_report: { title: 'Report an isolated draft test', kind: 'read', fields: ['testId'] },
  bio_workflows_plan: { title: 'Plan a bio-workflow run', kind: 'execute', fields: ['id', 'version'] },
  bio_workflows_run: { title: 'Start a bio-workflow run', kind: 'execute', fields: ['id', 'version', 'expectedPlanDigest'] },
  bio_workflows_run_get: { title: 'Inspect a bio-workflow run', kind: 'read', fields: ['runId'] },
  bio_workflows_run_list: { title: 'List bio-workflow runs', kind: 'search', fields: ['status', 'cursor'] },
  bio_workflows_run_cleanup_plan: { title: 'Preview run cleanup', kind: 'search', fields: [] },
  bio_workflows_run_cleanup: { title: 'Clean up workflow runs', kind: 'edit', fields: ['expectedCleanupPlanDigest'] },
})

function salientInput(args, fields) {
  if (args === null || typeof args !== 'object' || Array.isArray(args) || fields === undefined) {
    return undefined
  }
  const value = {}
  for (const field of fields) {
    if (Object.hasOwn(args, field)) value[field] = args[field]
  }
  return Object.keys(value).length === 0 ? undefined : value
}

function parseTextPayload(result) {
  if (result?.isError === true) return null
  const text = result?.content
    ?.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
  if (typeof text !== 'string' || text.length === 0 || text.length > 4 * 1024 * 1024) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function errorMessage(result, payload) {
  if (payload?.error?.message) return String(payload.error.message)
  const firstText = result?.content?.find((block) => block?.type === 'text')?.text
  if (typeof firstText === 'string' && firstText.length > 0) return firstText.slice(0, 320)
  return 'The operation did not complete.'
}

function countFrom(payload) {
  if (Number.isSafeInteger(payload?.count)) return payload.count
  for (const field of ['workflows', 'runs', 'files', 'diagnostics', 'nodes']) {
    if (Array.isArray(payload?.[field])) return payload[field].length
  }
  if (Array.isArray(payload?.graph?.nodes)) return payload.graph.nodes.length
  return null
}

function summaryLines(name, payload) {
  if (payload === null || typeof payload !== 'object') return ['Completed.']
  if (payload.ok === false || payload.error) {
    const code = payload.error?.code ? ` (${payload.error.code})` : ''
    return [`Could not complete${code}: ${payload.error?.message ?? 'unknown error'}`]
  }

  const lines = []
  const count = countFrom(payload)
  if (name === 'bio_workflows_info') {
    lines.push(`Version ${payload.version ?? 'unknown'} · ${payload.workflowCount ?? 0} configured workflows`)
    const enabled = Object.values(payload.capabilities ?? {}).filter(Boolean).length
    lines.push(`${enabled} capabilities available`)
  } else if (name === 'bio_workflows_mission_prepare') {
    lines.push(`Plan ${payload.planDigest ?? 'unavailable'}`)
    lines.push('Draft authoring only · container execution disabled')
  } else if (name === 'bio_workflows_mission_report') {
    lines.push(`${payload.report?.missionId ?? 'Software trial'} · ${payload.report?.outcome ?? 'unknown'}`)
    lines.push(payload.report?.success === true ? 'Trial passed' : 'No isolated trial success claimed')
  } else if (
    name === 'bio_workflows_mission_start'
    || name === 'bio_workflows_mission_get'
    || name === 'bio_workflows_mission_cancel'
  ) {
    lines.push(`${payload.missionId ?? 'Software trial'} · ${payload.status ?? 'unknown'}`)
    lines.push(`${payload.phase ?? 'unknown phase'} · ${payload.budget?.remaining?.actions ?? 0} actions remaining`)
  } else if (name === 'bio_workflows_draft_graph') {
    lines.push(`${payload.workflow?.name ?? 'WDL workflow'} · revision ${payload.revision ?? 'unknown'}`)
    lines.push(`${payload.nodes?.length ?? 0} nodes · ${payload.edges?.length ?? 0} edges · ${payload.complete === false ? 'partial graph' : 'complete graph'}`)
  } else if (name === 'bio_workflows_draft_test_prepare') {
    lines.push(`Plan ${payload.planDigest ?? 'unavailable'}`)
    lines.push(`Fixture ${payload.plan?.fixture?.id ?? 'unknown'}@${payload.plan?.fixture?.version ?? 'unknown'} · isolated only`)
  } else if (name === 'bio_workflows_draft_test_report') {
    lines.push(`${payload.report?.testId ?? 'Isolated draft test'} · ${payload.report?.outcome ?? 'unknown'}`)
    lines.push(payload.report?.passed === true ? 'Fixture assertions passed' : 'No passing isolated result')
  } else if (
    name === 'bio_workflows_draft_test_start'
    || name === 'bio_workflows_draft_test_get'
    || name === 'bio_workflows_draft_test_cancel'
  ) {
    lines.push(`${payload.testId ?? payload.test?.testId ?? 'Isolated draft test'} · ${payload.status ?? payload.test?.status ?? 'unknown'}`)
    lines.push('No production or promotion authority')
  } else if (name === 'bio_workflows_run_cleanup_plan') {
    lines.push(`Cleanup plan ${payload.cleanupPlanDigest ?? 'unavailable'}`)
    lines.push(`${payload.plan?.candidates?.length ?? 0} owner-scoped terminal candidates · no data deleted`)
  } else if (name === 'bio_workflows_run_cleanup') {
    lines.push(`${payload.removedCount ?? 0} workflow run director${payload.removedCount === 1 ? 'y' : 'ies'} removed`)
    lines.push(`Cleanup plan ${payload.cleanupPlanDigest ?? 'unavailable'}`)
  } else if (name === 'bio_workflows_run_get' || name === 'bio_workflows_run') {
    lines.push(`${payload.runId ?? payload.run?.runId ?? 'Workflow run'} · ${payload.status ?? payload.run?.status ?? 'submitted'}`)
  } else if (name === 'bio_workflows_draft_create' || name === 'bio_workflows_draft_update' || name === 'bio_workflows_draft_get') {
    lines.push(`${payload.draftId ?? 'WDL draft'} · revision ${payload.revision ?? 'unknown'}`)
    if (payload.contentDigest) lines.push(payload.contentDigest)
  } else if (count !== null) {
    lines.push(`${count} ${count === 1 ? 'item' : 'items'}`)
  } else if (typeof payload.status === 'string') {
    lines.push(payload.status)
  } else if (typeof payload.valid === 'boolean') {
    lines.push(payload.valid ? 'Validation passed' : 'Validation failed')
  } else if (typeof payload.ok === 'boolean') {
    lines.push(payload.ok ? 'Completed successfully' : 'Could not complete')
  } else {
    lines.push('Completed.')
  }
  return lines.slice(0, 3)
}

export function getDefaultToolPresentation(name) {
  const presentation = TOOL_PRESENTATIONS[name]
  if (presentation === undefined) return Object.freeze({})
  return Object.freeze({
    presentCall(args) {
      return {
        card: 'generic',
        title: presentation.title,
        kind: presentation.kind,
        ...(salientInput(args, presentation.fields) === undefined
          ? {}
          : { rawInput: salientInput(args, presentation.fields) }),
      }
    },
    presentResult(_args, result) {
      const payload = parseTextPayload(result)
      const failed = result?.isError === true || payload?.ok === false || payload?.error
      const content = failed
        ? errorMessage(result, payload)
        : summaryLines(name, payload).join('\n')
      return {
        card: 'generic',
        title: failed ? `${presentation.title} failed` : presentation.title,
        content: [{ type: 'text', text: content }],
      }
    },
  })
}

export const PRESENTED_TOOL_NAMES = Object.freeze(Object.keys(TOOL_PRESENTATIONS))
