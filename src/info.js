export const PACKAGE_NAME = 'dsh-bio-workflows'
export const PACKAGE_VERSION = '0.2.0'
export const TOOL_NAME = 'bio_workflows_info'

export function getPackageInfo(workflowCount = 0) {
  return {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    status: 'catalog',
    readOnly: true,
    workflowCount,
    capabilities: {
      workflowCatalog: true,
      manifestValidation: true,
      preflightValidation: false,
      workflowExecution: false,
      provenanceReporting: false,
    },
  }
}

export function createInfoTool(defineTool, workflowCount = 0) {
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
    execute: async () => JSON.stringify(getPackageInfo(workflowCount), null, 2),
  })
}

export function registerInfoTool(ctx, defineTool, workflowCount = 0) {
  const tool = createInfoTool(defineTool, workflowCount)
  ctx.tools.register(tool)
  return tool
}
