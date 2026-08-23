import { createWorkflowCatalog } from './src/catalog.js'
import { registerCatalogTools } from './src/catalog-tools.js'
import { PACKAGE_NAME, registerInfoTool } from './src/info.js'
import { parsePreflightEnvironment } from './src/preflight.js'
import { registerPreflightTool } from './src/preflight-tool.js'

export const name = PACKAGE_NAME
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const catalog = createWorkflowCatalog(config?.manifests ?? [])
  const environment = parsePreflightEnvironment(config?.environment ?? {})
  registerInfoTool(ctx, catalog.size, Object.keys(environment.engines).length)
  registerCatalogTools(ctx, catalog)
  registerPreflightTool(ctx, catalog, environment)
}
