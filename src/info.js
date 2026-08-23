export const PACKAGE_NAME = 'dsh-bio-workflows'
export const PACKAGE_VERSION = '0.3.1'
export const TOOL_NAME = 'bio_workflows_info'

export function getPackageInfo(workflowCount = 0, declaredEngineCount = 0) {
  return {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    status: 'preflight',
    readOnly: true,
    workflowCount,
    declaredEngineCount,
    capabilities: {
      workflowCatalog: true,
      manifestValidation: true,
      preflightValidation: true,
      workflowExecution: false,
      provenanceReporting: false,
    },
  }
}

export function createInfoTool(defineTool, workflowCount = 0, declaredEngineCount = 0) {
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
      getPackageInfo(workflowCount, declaredEngineCount),
      null,
      2,
    ),
  })
}

export function registerInfoTool(ctx, defineTool, workflowCount = 0, declaredEngineCount = 0) {
  const tool = createInfoTool(defineTool, workflowCount, declaredEngineCount)
  ctx.tools.register(tool)
  return tool
}
