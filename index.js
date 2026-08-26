import { createWorkflowCatalog } from './src/catalog.js'
import { registerCatalogTools } from './src/catalog-tools.js'
import { createExecutionManager } from './src/execution.js'
import {
  createExecutionTools,
  registerExecutionApprovalGate,
} from './src/execution-tools.js'
import { PACKAGE_NAME, registerInfoTool } from './src/info.js'
import { parsePreflightEnvironment } from './src/preflight.js'
import { registerPreflightTool } from './src/preflight-tool.js'
import { createStoreTools, registerStoreApprovalGate } from './src/store-tools.js'
import { defineTool, registerToolArgumentGuard } from './src/tool-definition.js'
import { createWorkflowStore } from './src/workflow-store.js'

export const name = PACKAGE_NAME
export const inject = ['tools']

function optionalService(ctx, name) {
  return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
}

export function apply(ctx, config = {}) {
  const catalog = createWorkflowCatalog(config?.manifests ?? [])
  const environment = parsePreflightEnvironment(config?.environment ?? {})
  const store = createWorkflowStore(config?.store ?? {})
  const storeTools = createStoreTools(defineTool, store)
  const execution = createExecutionManager({
    store,
    config: config?.execution ?? {},
    getSubprocess: () => optionalService(ctx, 'subprocess'),
    getJobs: () => optionalService(ctx, 'jobs'),
  })
  const executionTools = createExecutionTools(defineTool, execution)
  const tools = [
    registerInfoTool(
      ctx,
      defineTool,
      catalog.size,
      Object.keys(environment.engines).length,
      store.summary,
      () => execution.summary,
    ),
    ...registerCatalogTools(ctx, defineTool, catalog),
    registerPreflightTool(ctx, defineTool, catalog, environment),
    ...storeTools,
    ...executionTools,
  ]
  for (const tool of storeTools) ctx.tools.register(tool)
  for (const tool of executionTools) ctx.tools.register(tool)
  registerStoreApprovalGate(ctx, storeTools, store)
  registerExecutionApprovalGate(ctx, executionTools, execution)
  registerToolArgumentGuard(ctx, tools)
}
