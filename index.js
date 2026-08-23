import { createWorkflowCatalog } from './src/catalog.js'
import { registerCatalogTools } from './src/catalog-tools.js'
import { PACKAGE_NAME, registerInfoTool } from './src/info.js'
import { parsePreflightEnvironment } from './src/preflight.js'
import { registerPreflightTool } from './src/preflight-tool.js'
import { createStoreTools, registerStoreApprovalGate } from './src/store-tools.js'
import { defineTool, registerToolArgumentGuard } from './src/tool-definition.js'
import { createWorkflowStore } from './src/workflow-store.js'

export const name = PACKAGE_NAME
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const catalog = createWorkflowCatalog(config?.manifests ?? [])
  const environment = parsePreflightEnvironment(config?.environment ?? {})
  const store = createWorkflowStore(config?.store ?? {})
  const storeTools = createStoreTools(defineTool, store)
  const tools = [
    registerInfoTool(
      ctx,
      defineTool,
      catalog.size,
      Object.keys(environment.engines).length,
      store.summary,
    ),
    ...registerCatalogTools(ctx, defineTool, catalog),
    registerPreflightTool(ctx, defineTool, catalog, environment),
    ...storeTools,
  ]
  for (const tool of storeTools) ctx.tools.register(tool)
  registerStoreApprovalGate(ctx, storeTools, store)
  registerToolArgumentGuard(ctx, tools)
}
