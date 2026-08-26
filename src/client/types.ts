export type WorkflowSource = 'builtin' | 'installed' | 'draft'

export interface WorkflowSummary {
  id: string
  version: string
  name: string
  summary: string
  status: string
  language: string
  languageVersion: string
  engines: Array<{ name: string; version?: string }>
  tags: string[]
  source: WorkflowSource
  trust: string
  verification: { status: string; checks: string[] }
  digest: string
  installed: boolean
  executionSupported: boolean
}

export interface WorkflowCenterBootstrap {
  schemaVersion: '1'
  package: { name: string; version: string }
  workflows: WorkflowSummary[]
  diagnostics: Array<{ code?: string; message?: string }>
  capabilities: Record<string, boolean>
  readiness: Record<string, boolean>
  privacy: {
    ownerScopedDraftsViaAgent: true
    ownerScopedRunsViaAgent: true
  }
}

export interface GraphPosition {
  line: number
  column: number
  offset: number
}

export interface GraphRange {
  path: 'main.wdl'
  start: GraphPosition
  end: GraphPosition
}

export interface GraphPort {
  id: string
  name: string
  type: string
}

export type WorkflowGraphNodeKind =
  | 'workflow-input'
  | 'workflow-output'
  | 'declaration'
  | 'call'
  | 'scatter'
  | 'conditional'

export interface WorkflowGraphNode {
  id: string
  kind: WorkflowGraphNodeKind
  label: string
  target?: string
  range: GraphRange
  parentGroup?: string
  inputs: GraphPort[]
  outputs: GraphPort[]
}

export interface WorkflowGraphEdge {
  id: string
  kind: 'data' | 'control' | 'containment'
  from: { node: string; port: string }
  to: { node: string; port: string }
}

export interface WorkflowGraphDiagnostic {
  code: string
  severity: 'warning' | 'error'
  message: string
  range?: GraphRange
}

export interface WorkflowGraph {
  schemaVersion: '1'
  draftId: string
  revision: number
  contentDigest: string
  sourcePath: 'main.wdl'
  languageVersion: string
  workflow: { name: string; range: GraphRange }
  complete: boolean
  graphDigest: string
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
  diagnostics: WorkflowGraphDiagnostic[]
  executionAuthorized: false
}

export interface SessionPromptResult {
  ok: boolean
  error?: { code: string; message: string }
}

export interface SessionsFace {
  list: {
    getSnapshot(): { current?: string }
    subscribe(listener: () => void): () => void
  }
  binding(id: string): {
    session: {
      prompt(content: Array<{ type: 'text'; text: string }>, mode: 'queue'): Promise<SessionPromptResult>
    }
  } | undefined
  open?(id: string): void
}

export interface SlotsFace {
  inject(name: string, factory: () => unknown): unknown
  register(
    options: { name: string; id?: string; key?: string; order?: number; inject?: () => object },
    component: unknown,
  ): unknown
}

export interface ClientPluginContext {
  get(name: string): unknown
  on(event: string, listener: () => void): unknown
}

export interface ToolContentBlock {
  type: string
  text?: string
}

export interface ToolViewBlock {
  kind?: string
  argsRaw?: unknown
  content?: ToolContentBlock[]
  isError?: boolean
  call?: { argsRaw?: unknown } | null
}

export interface ToolViewProps {
  toolName?: string
  block: ToolViewBlock
}
