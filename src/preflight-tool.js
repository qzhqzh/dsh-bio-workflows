import { parsePreflightEnvironment, preflightWorkflow } from './preflight.js'

export const PREFLIGHT_TOOL_NAME = 'bio_workflows_preflight'

export function createPreflightTool(catalog, environmentValue = {}) {
  const environment = parsePreflightEnvironment(environmentValue)

  return {
    name: PREFLIGHT_TOOL_NAME,
    description:
      'Validate supplied workflow input values and a configured environment declaration. This tool does not inspect files, probe engines, or execute workflows.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Exact workflow manifest id.' },
        inputs: {
          type: 'object',
          additionalProperties: true,
          description: 'Input values keyed by manifest input id.',
        },
      },
      required: ['id', 'inputs'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    execute: async ({ id, inputs }) => {
      const workflow = catalog.get(id)
      if (workflow === null) {
        return JSON.stringify({
          found: false,
          preflight: null,
          error: {
            code: 'workflow_not_found',
            message: `workflow not found: ${id}`,
          },
        }, null, 2)
      }

      return JSON.stringify({
        found: true,
        preflight: preflightWorkflow(workflow, inputs, environment),
        error: null,
      }, null, 2)
    },
  }
}

export function registerPreflightTool(ctx, catalog, environmentValue = {}) {
  const tool = createPreflightTool(catalog, environmentValue)
  ctx.tools.register(tool)
  return tool
}
