export const PACKAGE_NAME = 'dsh-bio-workflows'
export const PACKAGE_VERSION = '0.10.0'
export const TOOL_NAME = 'bio_workflows_info'

export function getPackageInfo(
  workflowCount = 0,
  declaredEngineCount = 0,
  store = {},
  execution = {},
  authoring = {},
) {
  const executionEnabled = execution.enabled === true
  const executionReady = executionEnabled
    && execution.subprocessAvailable === true
    && execution.jobsAvailable === true
  return {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    status: 'preview',
    phase: 'workflow-center',
    readOnly: store.writesEnabled !== true && !executionEnabled,
    workflowCount,
    declaredEngineCount,
    store: {
      builtinWorkflowCount: store.builtinWorkflowCount ?? 0,
      localStoreConfigured: store.localStoreConfigured ?? false,
      writesEnabled: store.writesEnabled ?? false,
    },
    execution: {
      enabled: executionEnabled,
      configured: execution.configured === true,
      subprocessAvailable: execution.subprocessAvailable === true,
      jobsAvailable: execution.jobsAvailable === true,
      supportedWorkflows: [...(execution.supportedWorkflows ?? [])],
    },
    authoring: {
      configured: authoring.configured === true,
      writesEnabled: authoring.writesEnabled === true,
      ownerScope: authoring.ownerScope ?? 'session',
      validator: {
        configured: authoring.validator?.configured === true,
        subprocessAvailable: authoring.validator?.subprocessAvailable === true,
        expectedVersion: authoring.validator?.expectedVersion ?? null,
        policyVersion: authoring.validator?.policyVersion ?? null,
      },
    },
    capabilities: {
      workflowCatalog: true,
      manifestValidation: true,
      preflightValidation: true,
      workflowStore: true,
      wdlBundleValidation: true,
      workflowInstallation: store.writesEnabled === true,
      workflowScaffolding: store.writesEnabled === true,
      revisionedDraftAuthoring: true,
      draftCompareAndSwap: true,
      deterministicDraftValidation: authoring.validator?.subprocessAvailable === true,
      deterministicWorkflowGraph: true,
      nativeWorkflowCenter: true,
      liveExecutionPlanning: executionEnabled && execution.subprocessAvailable === true,
      workflowExecution: executionReady,
      backgroundJobLifecycle: executionReady,
      provenanceReporting: executionEnabled,
      durableRunHistory: executionEnabled,
      normalizedWorkflowResults: executionEnabled,
      outputChecksums: executionEnabled,
      fastqcSummaries: executionEnabled
        && (execution.supportedWorkflows ?? []).includes('fastq-qc@1.2.0'),
    },
  }
}

export function createInfoTool(
  defineTool,
  workflowCount = 0,
  declaredEngineCount = 0,
  store = {},
  execution = {},
  authoring = {},
) {
  return defineTool({
    name: TOOL_NAME,
    description:
      'Report dsh-bio-workflows package, store, execution configuration, and optional DSH service availability without starting a workflow.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    execute: async () => {
      const executionSummary = typeof execution === 'function' ? execution() : execution
      const authoringSummary = typeof authoring === 'function' ? authoring() : authoring
      return JSON.stringify(
        getPackageInfo(
          workflowCount,
          declaredEngineCount,
          store,
          executionSummary,
          authoringSummary,
        ),
        null,
        2,
      )
    },
  })
}

export function registerInfoTool(
  ctx,
  defineTool,
  workflowCount = 0,
  declaredEngineCount = 0,
  store = {},
  execution = {},
  authoring = {},
) {
  const tool = createInfoTool(
    defineTool,
    workflowCount,
    declaredEngineCount,
    store,
    execution,
    authoring,
  )
  ctx.tools.register(tool)
  return tool
}
