import { validateToolArguments } from './tool-definition.js'

export const STORE_SEARCH_TOOL_NAME = 'bio_workflows_search'
export const STORE_VALIDATE_TOOL_NAME = 'bio_workflows_validate'
export const STORE_INSTALL_TOOL_NAME = 'bio_workflows_install'
export const STORE_SCAFFOLD_TOOL_NAME = 'bio_workflows_scaffold'

const IDENTIFIER_PATTERN = '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
const SEMVER_PATTERN = '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$'
const BUNDLE_DIGEST_PATTERN = '^sha256:[a-f0-9]{64}$'
const STORE_SOURCES = ['builtin', 'installed', 'draft', 'git', 'trs']

function textOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  }
}

function stringify(value) {
  return JSON.stringify(value, null, 2)
}

export function createStoreTools(defineTool, store) {
  const search = defineTool({
    name: STORE_SEARCH_TOOL_NAME,
    description:
      'Search built-in, local, and configured revision-pinned read-only Git/TRS snapshot bundles. This tool never downloads or executes a workflow.',
    parameters: {
      query: { type: 'string', description: 'Optional case-insensitive text query.' },
      language: { type: 'string', description: 'Optional exact language filter; currently wdl.' },
      tag: { type: 'string', description: 'Optional exact tag filter.' },
      source: { type: 'string', description: 'Optional source filter: builtin, installed, draft, git, or trs.' },
      provider: { type: 'string', pattern: IDENTIFIER_PATTERN, description: 'Optional exact read-only Git/TRS provider id.' },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (filters, exec) => stringify(await store.search(filters, { signal: exec?.signal })),
  })

  const validate = defineTool({
    name: STORE_VALIDATE_TOOL_NAME,
    description:
      'Perform bounded structural validation of one WDL bundle. This does not run an engine or authorize execution.',
    parameters: {
      id: { type: 'string', required: true, description: 'Exact workflow bundle id.' },
      version: { type: 'string', description: 'Optional exact semantic version; latest is selected when omitted.' },
      source: { type: 'string', description: 'Optional source; defaults to builtin.' },
      provider: { type: 'string', pattern: IDENTIFIER_PATTERN, description: 'Required exact provider id when source is git or trs.' },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (options, exec) => stringify(await store.validate(options, { signal: exec?.signal })),
  })

  const install = defineTool({
    name: STORE_INSTALL_TOOL_NAME,
    description:
      'Install one pinned WDL bundle into the configured local store. Writes must be enabled and DSH approval is required; installation never authorizes execution.',
    parameters: {
      id: { type: 'string', pattern: IDENTIFIER_PATTERN, required: true, description: 'Exact workflow bundle id.' },
      version: { type: 'string', pattern: SEMVER_PATTERN, required: true, description: 'Exact semantic version returned by search.' },
      expectedDigest: {
        type: 'string',
        pattern: BUNDLE_DIGEST_PATTERN,
        required: true,
        description: 'Exact sha256 bundle digest returned by search.',
      },
      source: { type: 'string', enum: STORE_SOURCES, description: 'Optional source; defaults to builtin.' },
      provider: { type: 'string', pattern: IDENTIFIER_PATTERN, description: 'Required exact provider id when source is git or trs.' },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (options, exec) => stringify(await store.install(options, { signal: exec?.signal })),
  })

  const scaffold = defineTool({
    name: STORE_SCAFFOLD_TOOL_NAME,
    description:
      'Create a non-executable WDL draft under the configured local store. Writes must be enabled and DSH approval is required.',
    parameters: {
      id: { type: 'string', pattern: IDENTIFIER_PATTERN, required: true, description: 'Lowercase workflow identifier.' },
      version: { type: 'string', pattern: SEMVER_PATTERN, description: 'Semantic version; defaults to 0.1.0.' },
      name: { type: 'string', minLength: 1, maxLength: 160, required: true, description: 'Human-readable workflow name.' },
      summary: { type: 'string', minLength: 1, maxLength: 1000, required: true, description: 'Short workflow purpose.' },
    },
    output: textOutput(),
    isConcurrencySafe: () => false,
    execute: async (options, exec) => stringify(await store.scaffold(options, { signal: exec?.signal })),
  })

  return [search, validate, install, scaffold]
}

export function registerStoreTools(ctx, defineTool, store) {
  const tools = createStoreTools(defineTool, store)
  for (const tool of tools) ctx.tools.register(tool)
  return tools
}

export function registerStoreApprovalGate(ctx, tools, store) {
  const mutationNames = new Set([STORE_INSTALL_TOOL_NAME, STORE_SCAFFOLD_TOOL_NAME])
  const mutationTools = new Set(tools.filter((tool) => mutationNames.has(tool.name)))

  ctx.on('tools/pre-execute', async (exec, next) => {
    const tool = ctx.tools.get(exec.name, exec.agent)
    if (!mutationTools.has(tool)) return next()
    if (validateToolArguments(tool, exec.arguments).length > 0) return next()
    if (!store.config.writeEnabled) {
      return {
        kind: 'deny',
        reason: 'workflow store writes are disabled by plugin configuration',
      }
    }
    if (exec.name === STORE_INSTALL_TOOL_NAME) {
      const prepared = await store.prepareInstall(exec.arguments, { signal: exec.signal })
      if (!prepared.ok) {
        return {
          kind: 'deny',
          reason: `workflow install preparation failed: ${prepared.error.code}`,
        }
      }
      return {
        kind: 'ask',
        reason: `Install ${prepared.id}@${prepared.version} from ${prepared.source}${prepared.provider === undefined ? '' : ` provider ${prepared.provider.id}@${prepared.provider.revision}`} with digest ${prepared.digest} into the configured workflow store`,
      }
    }
    const prepared = store.prepareScaffold(exec.arguments)
    return {
      kind: 'ask',
      reason: `Create draft ${prepared.id}@${prepared.version} with digest ${prepared.digest} inside the configured workflow store`,
    }
  })
}
