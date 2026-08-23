import { defineTool } from '@deepseek-ai/dsh-tools'
import { createWorkflowCatalog } from './src/catalog.js'
import { registerCatalogTools } from './src/catalog-tools.js'
import { PACKAGE_NAME, registerInfoTool } from './src/info.js'

export const name = PACKAGE_NAME
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const catalog = createWorkflowCatalog(config?.manifests ?? [])
  registerInfoTool(ctx, defineTool, catalog.size)
  registerCatalogTools(ctx, defineTool, catalog)
}
