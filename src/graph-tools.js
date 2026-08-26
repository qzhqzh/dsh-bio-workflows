import { ownerSession } from './draft-tools.js'
import { createWorkflowGraph } from './workflow-graph.js'

export const DRAFT_GRAPH_TOOL_NAME = 'bio_workflows_draft_graph'

const DRAFT_ID_PATTERN = '^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

function stringify(value) {
  return JSON.stringify(value, null, 2)
}

export function createGraphTools(defineTool, store) {
  return [defineTool({
    name: DRAFT_GRAPH_TOOL_NAME,
    description:
      'Parse one exact owner-scoped WDL draft revision into deterministic WorkflowGraph v1 JSON. This is read-only, never runs tasks, and reports partial graphs instead of guessing unsupported topology.',
    parameters: {
      draftId: { type: 'string', pattern: DRAFT_ID_PATTERN, required: true, description: 'Opaque draft UUID returned by draft_create.' },
      revision: { type: 'integer', minimum: 1, maximum: 256, required: true, description: 'Exact immutable revision to visualize.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => false,
    execute: async (options, exec) => {
      const resolved = await store.resolve(options, {
        ownerSession: ownerSession(exec),
        signal: exec?.signal,
      })
      if (!resolved.ok) return stringify(resolved)
      const source = resolved.snapshot.files.find((file) => file.path === 'main.wdl')
      if (source === undefined) {
        return stringify({
          ok: false,
          error: { code: 'entrypoint_missing', message: 'Draft revision has no main.wdl entrypoint.' },
          draftId: options.draftId,
          revision: options.revision,
        })
      }
      return stringify(createWorkflowGraph({
        draftId: resolved.metadata.draftId,
        revision: resolved.snapshot.revision,
        contentDigest: resolved.snapshot.contentDigest,
        source: source.content,
      }))
    },
  })]
}
