export const PACKAGE_NAME = 'dsh-bio-workflows'
export const PACKAGE_VERSION = '0.5.0'
export const TOOL_NAME = 'bio_workflows_info'

export function getPackageInfo(
  workflowCount = 0,
  declaredEngineCount = 0,
  store = {},
  execution = {},
) {
  const executionEnabled = execution.enabled === true
  const executionReady = executionEnabled
    && execution.subprocessAvailable === true
    && execution.jobsAvailable === true
  return {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    status: 'preflight',
    phase: 'miniwdl-execution-mvp',
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
    capabilities: {
      workflowCatalog: true,
      manifestValidation: true,
      preflightValidation: true,
      workflowStore: true,
      wdlBundleValidation: true,
      workflowInstallation: store.writesEnabled === true,
      workflowScaffolding: store.writesEnabled === true,
      liveExecutionPlanning: executionEnabled && execution.subprocessAvailable === true,
      workflowExecution: executionReady,
      backgroundJobLifecycle: executionReady,
      provenanceReporting: executionEnabled,
      durableRunHistory: executionEnabled,
    },
  }
}

export function createInfoTool(
  defineTool,
  workflowCount = 0,
  declaredEngineCount = 0,
  store = {},
  execution = {},
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
      return JSON.stringify(
        getPackageInfo(workflowCount, declaredEngineCount, store, executionSummary),
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
) {
  const tool = createInfoTool(
    defineTool,
    workflowCount,
    declaredEngineCount,
    store,
    execution,
  )
  ctx.tools.register(tool)
  return tool
}
