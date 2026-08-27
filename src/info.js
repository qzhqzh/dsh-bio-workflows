export const PACKAGE_NAME = 'dsh-bio-workflows'
export const PACKAGE_VERSION = '0.12.0'
export const TOOL_NAME = 'bio_workflows_info'

export function getPackageInfo(
  workflowCount = 0,
  declaredEngineCount = 0,
  store = {},
  execution = {},
  authoring = {},
  autonomy = {},
  draftTesting = {},
) {
  const executionEnabled = execution.enabled === true
  const providers = Array.isArray(store.providers)
    ? store.providers
      .filter((provider) => provider && typeof provider === 'object')
      .map((provider) => ({
        id: provider.id ?? null,
        kind: provider.kind ?? null,
        revision: provider.revision ?? null,
        readOnly: provider.readOnly === true,
      }))
    : []
  const executionReady = executionEnabled
    && execution.subprocessAvailable === true
    && execution.jobsAvailable === true
  const draftTestingReady = draftTesting.enabled === true
    && draftTesting.subprocessAvailable === true
    && draftTesting.jobsAvailable === true
    && draftTesting.preflightVerified === true
    && draftTesting.ready === true
  return {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    status: 'preview',
    phase: 'workflow-center',
    readOnly: store.writesEnabled !== true && !executionEnabled && !draftTesting.enabled,
    workflowCount,
    declaredEngineCount,
    store: {
      builtinWorkflowCount: store.builtinWorkflowCount ?? 0,
      localStoreConfigured: store.localStoreConfigured ?? false,
      writesEnabled: store.writesEnabled ?? false,
      providers,
    },
    execution: {
      enabled: executionEnabled,
      configured: execution.configured === true,
      subprocessAvailable: execution.subprocessAvailable === true,
      jobsAvailable: execution.jobsAvailable === true,
      supportedWorkflows: [...(execution.supportedWorkflows ?? [])],
      policy: {
        inputChecksum: execution.policy?.inputChecksum ?? 'metadata',
        networkIsolation: { ...(execution.policy?.networkIsolation ?? { mode: 'advisory' }) },
        budgets: { ...(execution.policy?.budgets ?? {}) },
        retention: { ...(execution.policy?.retention ?? { enabled: false }) },
      },
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
    autonomy: {
      configured: autonomy.configured === true,
      enabled: autonomy.enabled === true,
      ownerScope: autonomy.ownerScope ?? 'session',
      schemaVersion: autonomy.schemaVersion ?? null,
      capabilities: { ...(autonomy.capabilities ?? {}) },
      limits: { ...(autonomy.limits ?? {}) },
    },
    draftTesting: {
      configured: draftTesting.configured === true,
      enabled: draftTesting.enabled === true,
      ready: draftTestingReady,
      preflightVerified: draftTesting.preflightVerified === true,
      preflightScope: draftTesting.preflightScope ?? 'exact_mission_plan_only',
      subprocessAvailable: draftTesting.subprocessAvailable === true,
      jobsAvailable: draftTesting.jobsAvailable === true,
      ownerScope: draftTesting.ownerScope ?? 'session',
      schemaVersions: { ...(draftTesting.schemaVersions ?? {}) },
      capabilities: { ...(draftTesting.capabilities ?? {}) },
      budgets: { ...(draftTesting.budgets ?? {}) },
    },
    capabilities: {
      workflowCatalog: true,
      manifestValidation: true,
      preflightValidation: true,
      workflowStore: true,
      readOnlyWorkflowProviders: providers.length > 0,
      wdlBundleValidation: true,
      workflowInstallation: store.writesEnabled === true,
      workflowScaffolding: store.writesEnabled === true,
      revisionedDraftAuthoring: true,
      draftCompareAndSwap: true,
      deterministicDraftValidation: authoring.validator?.subprocessAvailable === true,
      deterministicWorkflowGraph: true,
      boundedAutonomousDraftAuthoring: autonomy.enabled === true,
      autonomousWdlValidationRepair: autonomy.enabled === true
        && authoring.validator?.subprocessAvailable === true,
      isolatedSoftwareTrial: draftTestingReady,
      autonomousProductionExecution: false,
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
      preApprovalInputChecksums: executionEnabled
        && execution.policy?.inputChecksum === 'sha256',
      containerEgressIsolation: executionEnabled
        && execution.policy?.networkIsolation?.mode === 'ephemeral_internal',
      approvedRunRetentionCleanup: executionEnabled
        && execution.policy?.retention?.enabled === true,
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
  autonomy = {},
  draftTesting = {},
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
      const draftTestingSummary = typeof draftTesting === 'function' ? draftTesting() : draftTesting
      return JSON.stringify(
        getPackageInfo(
          workflowCount,
          declaredEngineCount,
          store,
          executionSummary,
          authoringSummary,
          autonomy,
          draftTestingSummary,
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
  autonomy = {},
  draftTesting = {},
) {
  const tool = createInfoTool(
    defineTool,
    workflowCount,
    declaredEngineCount,
    store,
    execution,
    authoring,
    autonomy,
    draftTesting,
  )
  ctx.tools.register(tool)
  return tool
}
