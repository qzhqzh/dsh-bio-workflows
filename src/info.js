export const PACKAGE_NAME = 'dsh-bio-workflows'
export const PACKAGE_VERSION = '0.4.0'
export const TOOL_NAME = 'bio_workflows_info'

export function getPackageInfo(workflowCount = 0, declaredEngineCount = 0, store = {}) {
  return {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    status: 'preflight',
    phase: 'workflow-store-preview',
    readOnly: store.writesEnabled !== true,
    workflowCount,
    declaredEngineCount,
    store: {
      builtinWorkflowCount: store.builtinWorkflowCount ?? 0,
      localStoreConfigured: store.localStoreConfigured ?? false,
      writesEnabled: store.writesEnabled ?? false,
    },
    capabilities: {
      workflowCatalog: true,
      manifestValidation: true,
      preflightValidation: true,
      workflowStore: true,
      wdlBundleValidation: true,
      workflowInstallation: store.writesEnabled === true,
      workflowScaffolding: store.writesEnabled === true,
      workflowExecution: false,
      provenanceReporting: false,
    },
  }
}

export function createInfoTool(
  defineTool,
  workflowCount = 0,
  declaredEngineCount = 0,
  store = {},
) {
  return defineTool({
    name: TOOL_NAME,
    description:
      'Report the installed dsh-bio-workflows package status. This tool is read-only and does not run bioinformatics workflows.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    execute: async () => JSON.stringify(
      getPackageInfo(workflowCount, declaredEngineCount, store),
      null,
      2,
    ),
  })
}

export function registerInfoTool(
  ctx,
  defineTool,
  workflowCount = 0,
  declaredEngineCount = 0,
  store = {},
) {
  const tool = createInfoTool(defineTool, workflowCount, declaredEngineCount, store)
  ctx.tools.register(tool)
  return tool
}
