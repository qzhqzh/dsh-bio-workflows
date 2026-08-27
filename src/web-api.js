import { PACKAGE_NAME, PACKAGE_VERSION, getPackageInfo } from './info.js'

export const WORKFLOW_CENTER_API_PATH = '/api/bio-workflows/v1/bootstrap'
export const WORKFLOW_CENTER_SCHEMA_VERSION = '1'

const PUBLIC_CATALOG_DIAGNOSTICS = Object.freeze({
  diagnostics_limit: 'Additional catalog diagnostics were omitted.',
  invalid_bundle: 'A local workflow bundle could not be loaded.',
  store_byte_limit: 'The local workflow catalog exceeded its read budget.',
  store_path_unsafe: 'The configured local workflow store is unavailable.',
})

function publicCatalogDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) return []
  return diagnostics.slice(0, 32).map((diagnostic) => {
    const requestedCode = typeof diagnostic?.code === 'string' ? diagnostic.code : ''
    const message = Object.hasOwn(PUBLIC_CATALOG_DIAGNOSTICS, requestedCode)
      ? PUBLIC_CATALOG_DIAGNOSTICS[requestedCode]
      : undefined
    return message === undefined
      ? { code: 'catalog_diagnostic', message: 'A catalog entry could not be loaded.' }
      : { code: requestedCode, message }
  })
}

function writeJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(value))
}

function sameOrigin(request) {
  const fetchSite = request.headers?.['sec-fetch-site']
  if (fetchSite !== undefined && fetchSite !== 'same-origin') return false
  const origin = request.headers?.origin
  const host = request.headers?.host
  if (origin === undefined) return fetchSite === 'same-origin'
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export async function createWorkflowCenterBootstrap(options) {
  const execution = options.execution()
  const authoring = options.authoring()
  const autonomy = options.autonomy ?? {}
  const info = getPackageInfo(
    options.workflowCount,
    options.declaredEngineCount,
    options.store.summary,
    execution,
    authoring,
    autonomy,
  )
  const catalog = await options.store.search({})
  const supportedWorkflows = new Set(
    Array.isArray(execution.supportedWorkflows)
      ? execution.supportedWorkflows.filter((value) => typeof value === 'string')
      : [],
  )
  const workflows = catalog.workflows
    .filter((workflow) => workflow.source === 'builtin')
    .map((workflow) => ({
      ...workflow,
      executionSupported: supportedWorkflows.has(`${workflow.id}@${workflow.version}`),
    }))
  return {
    schemaVersion: WORKFLOW_CENTER_SCHEMA_VERSION,
    package: { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    workflows,
    diagnostics: publicCatalogDiagnostics(catalog.diagnostics),
    capabilities: info.capabilities,
    readiness: {
      workflowStore: true,
      localStoreConfigured: info.store.localStoreConfigured,
      storeWritesEnabled: info.store.writesEnabled,
      draftAuthoringConfigured: info.authoring.configured,
      draftWritesEnabled: info.authoring.writesEnabled,
      miniwdlValidator: info.authoring.validator.subprocessAvailable,
      autonomousMissionAuthoring: info.autonomy.enabled,
      isolatedSoftwareTrial: false,
      executionConfigured: info.execution.configured,
      executionEnabled: info.execution.enabled,
      jobsAvailable: info.execution.jobsAvailable,
      workflowGraph: true,
      workflowCenter: true,
    },
    privacy: {
      ownerScopedDraftsViaAgent: true,
      ownerScopedMissionsViaAgent: true,
      ownerScopedRunsViaAgent: true,
    },
  }
}

export function registerWorkflowCenterApi(ctx, options) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], (scope) => {
    if (typeof scope.effect !== 'function' || typeof scope.webServer?.register !== 'function') return
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: WORKFLOW_CENTER_API_PATH,
      async handler(request, response) {
        if (request.method !== 'GET') {
          writeJson(response, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Use GET.' } })
          return
        }
        if (!sameOrigin(request)) {
          writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'Same-origin access is required.' } })
          return
        }
        try {
          writeJson(response, 200, await createWorkflowCenterBootstrap(options))
        } catch {
          writeJson(response, 500, {
            ok: false,
            error: {
              code: 'bootstrap_failed',
              message: 'Workflow Center bootstrap is temporarily unavailable.',
            },
          })
        }
      },
    }), 'bio-workflows: read-only Workflow Center bootstrap')
  })
}
