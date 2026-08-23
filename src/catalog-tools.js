export const LIST_TOOL_NAME = 'bio_workflows_list'
export const GET_TOOL_NAME = 'bio_workflows_get'

function textOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  }
}

export function createCatalogTools(defineTool, catalog) {
  const listTool = defineTool({
    name: LIST_TOOL_NAME,
    description:
      'List configured bioinformatics workflow manifests. This tool only reads the in-memory catalog and never runs a workflow.',
    parameters: {
      engine: { type: 'string', description: 'Optional exact engine name filter.' },
      status: { type: 'string', description: 'Optional exact status filter.' },
      tag: { type: 'string', description: 'Optional exact tag filter.' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async (filters) => {
      const workflows = catalog.list(filters)
      return JSON.stringify({ count: workflows.length, workflows }, null, 2)
    },
  })

  const getTool = defineTool({
    name: GET_TOOL_NAME,
    description:
      'Get one configured bioinformatics workflow manifest by id. This tool is read-only and does not resolve or execute workflow files.',
    parameters: {
      id: { type: 'string', required: true, description: 'Exact workflow manifest id.' },
    },
    output: textOutput(),
    isConcurrencySafe: () => true,
    execute: async ({ id }) => {
      const workflow = catalog.get(id)
      return JSON.stringify({ found: workflow !== null, workflow }, null, 2)
    },
  })

  return [listTool, getTool]
}

export function registerCatalogTools(ctx, defineTool, catalog) {
  const tools = createCatalogTools(defineTool, catalog)
  for (const tool of tools) ctx.tools.register(tool)
  return tools
}
