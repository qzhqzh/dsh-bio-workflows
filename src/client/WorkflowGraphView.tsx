import { useId, useMemo, useState } from 'react'

import { graphEdgePath, layoutWorkflowGraph } from './graph-layout.ts'
import type { ToolViewProps, WorkflowGraph, WorkflowGraphNode } from './types.ts'

const DIGEST = /^sha256:[a-f0-9]{64}$/
const DRAFT_ID = /^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const NODE_KINDS = new Set(['workflow-input', 'workflow-output', 'declaration', 'call', 'scatter', 'conditional'])
const EDGE_KINDS = new Set(['data', 'control', 'containment'])
const MAX_GRAPH_RESULT_CHARACTERS = 4 * 1024 * 1024
const MAX_TOOL_CONTENT_BLOCKS = 128

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function isPosition(value: unknown) {
  return isRecord(value)
    && typeof value.line === 'number' && Number.isSafeInteger(value.line) && value.line >= 1
    && typeof value.column === 'number' && Number.isSafeInteger(value.column) && value.column >= 1
    && typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset >= 0
}

function isRange(value: unknown) {
  return isRecord(value)
    && value.path === 'main.wdl'
    && isPosition(value.start)
    && isPosition(value.end)
    && Number((value.end as Record<string, unknown>).offset) >= Number((value.start as Record<string, unknown>).offset)
}

function isPort(value: unknown) {
  return isRecord(value)
    && isBoundedString(value.id, 160)
    && isBoundedString(value.name, 160)
    && isBoundedString(value.type, 256)
}

function hasUniqueIds(values: unknown[]) {
  const ids = values.map((value) => isRecord(value) ? value.id : undefined)
  return ids.every((id) => typeof id === 'string') && new Set(ids).size === ids.length
}

function isNode(value: unknown) {
  if (!isRecord(value)
    || !isBoundedString(value.id, 240)
    || typeof value.kind !== 'string' || !NODE_KINDS.has(value.kind)
    || !isBoundedString(value.label, 240)
    || !isRange(value.range)
    || !Array.isArray(value.inputs) || value.inputs.length > 128 || !value.inputs.every(isPort) || !hasUniqueIds(value.inputs)
    || !Array.isArray(value.outputs) || value.outputs.length > 128 || !value.outputs.every(isPort) || !hasUniqueIds(value.outputs)
  ) return false
  if (value.target !== undefined && !isBoundedString(value.target, 240)) return false
  if (value.parentGroup !== undefined && !isBoundedString(value.parentGroup, 240)) return false
  return true
}

function isEndpoint(value: unknown) {
  return isRecord(value)
    && isBoundedString(value.node, 240)
    && isBoundedString(value.port, 160)
}

function isEdge(value: unknown) {
  return isRecord(value)
    && isBoundedString(value.id, 96)
    && typeof value.kind === 'string' && EDGE_KINDS.has(value.kind)
    && isEndpoint(value.from)
    && isEndpoint(value.to)
}

function isDiagnostic(value: unknown) {
  return isRecord(value)
    && isBoundedString(value.code, 96)
    && (value.severity === 'warning' || value.severity === 'error')
    && isBoundedString(value.message, 1000)
    && (value.range === undefined || isRange(value.range))
}

function isWorkflowGraph(value: unknown): value is WorkflowGraph {
  if (!isRecord(value)
    || value.schemaVersion !== '1'
    || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 256
    || typeof value.draftId !== 'string' || !DRAFT_ID.test(value.draftId)
    || typeof value.contentDigest !== 'string' || !DIGEST.test(value.contentDigest)
    || typeof value.graphDigest !== 'string' || !DIGEST.test(value.graphDigest)
    || value.sourcePath !== 'main.wdl'
    || !isBoundedString(value.languageVersion, 32)
    || typeof value.complete !== 'boolean'
    || !isRecord(value.workflow) || !isBoundedString(value.workflow.name, 128) || !isRange(value.workflow.range)
    || !Array.isArray(value.nodes) || value.nodes.length > 512 || !value.nodes.every(isNode) || !hasUniqueIds(value.nodes)
    || !Array.isArray(value.edges) || value.edges.length > 2048 || !value.edges.every(isEdge) || !hasUniqueIds(value.edges)
    || !Array.isArray(value.diagnostics) || value.diagnostics.length > 128 || !value.diagnostics.every(isDiagnostic)
    || value.executionAuthorized !== false
  ) return false

  const nodes = value.nodes as unknown as WorkflowGraphNode[]
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  for (const node of nodes) {
    if (node.parentGroup !== undefined) {
      const parent = nodeById.get(node.parentGroup)
      if (parent === undefined || (parent.kind !== 'scatter' && parent.kind !== 'conditional')) return false
    }
  }
  for (const edge of value.edges as unknown as WorkflowGraph['edges']) {
    const from = nodeById.get(edge.from.node)
    const to = nodeById.get(edge.to.node)
    if (from === undefined || to === undefined) return false
    if (edge.kind === 'containment') {
      if (edge.from.port !== 'group' || edge.to.port !== 'member' || to.parentGroup !== from.id) return false
    } else if (edge.kind === 'control') {
      if (edge.from.port !== 'complete' || edge.to.port !== 'after') return false
    } else if (
      !from.outputs.some((port) => port.id === edge.from.port)
      || !to.inputs.some((port) => port.id === edge.to.port)
    ) return false
  }
  return true
}

function rawArguments(block: ToolViewProps['block']): Record<string, unknown> | null {
  const value = block.call?.argsRaw ?? block.argsRaw
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string' || value.length > 64 * 1024) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function graphFromBlock(block: ToolViewProps['block']): { graph?: WorkflowGraph; error?: string } {
  if (!Array.isArray(block.content) || block.content.length > MAX_TOOL_CONTENT_BLOCKS) {
    return { error: 'The graph result exceeds the safe replay limit.' }
  }
  const parts: string[] = []
  let characters = 0
  for (const item of block.content) {
    if (item?.type !== 'text' || typeof item.text !== 'string') continue
    characters += item.text.length
    if (characters > MAX_GRAPH_RESULT_CHARACTERS) {
      return { error: 'The graph result exceeds the safe replay limit.' }
    }
    parts.push(item.text)
  }
  const text = parts.join('\n')
  if (!text) return { error: 'Waiting for the graph result…' }
  try {
    const value: unknown = JSON.parse(text)
    if (!isWorkflowGraph(value)) {
      const message = value !== null && typeof value === 'object' && 'error' in value
        ? (value as { error?: { message?: string } }).error?.message
        : undefined
      return { error: message ?? 'The tool returned an invalid WorkflowGraph v1 payload.' }
    }
    const args = rawArguments(block)
    if (
      args !== null
      && ((typeof args.draftId === 'string' && args.draftId !== value.draftId)
        || (typeof args.revision === 'number' && args.revision !== value.revision))
    ) {
      return { error: 'The graph result does not match the requested draft revision.' }
    }
    return { graph: value }
  } catch {
    return { error: 'The graph result is not valid JSON.' }
  }
}

function kindLabel(kind: WorkflowGraphNode['kind']) {
  return kind.replace('workflow-', '').replace('-', ' ').toUpperCase()
}

export function WorkflowGraphView({ graph, compact = false }: { graph: WorkflowGraph; compact?: boolean }) {
  const graphId = useId().replace(/:/g, '')
  const layout = useMemo(() => layoutWorkflowGraph(graph), [graph])
  const positioned = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = selectedId === null ? undefined : positioned.get(selectedId)

  return (
    <section className="dsh-bio-graph" data-compact={compact || undefined} aria-label={`${graph.workflow.name} workflow graph`}>
      <header className="dsh-bio-graph__bar">
        <div>
          <strong>{graph.workflow.name}</strong>
          <span>WDL {graph.languageVersion} · revision {graph.revision}</span>
        </div>
        <span className={`dsh-bio-badge dsh-bio-badge--${graph.complete ? 'success' : 'warning'}`}>
          {graph.complete ? 'Complete' : 'Partial'}
        </span>
      </header>
      <div className="dsh-bio-graph__viewport" tabIndex={0}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-labelledby={`${graphId}-title ${graphId}-description`}
          preserveAspectRatio="xMinYMin meet"
        >
          <title id={`${graphId}-title`}>{graph.workflow.name} WDL dependency graph</title>
          <desc id={`${graphId}-description`}>
            {graph.nodes.length} nodes and {graph.edges.length} proven edges. {graph.diagnostics.length} diagnostics.
          </desc>
          <defs>
            <marker id={`${graphId}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" className="dsh-bio-graph__arrow" />
            </marker>
          </defs>
          {layout.edges.filter((edge) => edge.kind !== 'containment').map((edge) => {
            const from = positioned.get(edge.from.node)
            const to = positioned.get(edge.to.node)
            if (!from || !to) return null
            return (
              <path
                key={edge.id}
                d={graphEdgePath(from, to)}
                className="dsh-bio-graph__edge"
                data-kind={edge.kind}
                markerEnd={`url(#${graphId}-arrow)`}
              />
            )
          })}
          {layout.nodes.map((node) => (
            <g
              key={node.id}
              className="dsh-bio-graph__node"
              data-kind={node.kind}
              data-selected={selectedId === node.id || undefined}
              role="button"
              tabIndex={0}
              aria-label={`${kindLabel(node.kind)} ${node.label}`}
              onClick={() => { setSelectedId(node.id) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedId(node.id)
                }
              }}
            >
              <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="7" />
              <text x={node.x + 14} y={node.y + 22} className="dsh-bio-graph__kind">{kindLabel(node.kind)}</text>
              <text x={node.x + 14} y={node.y + 47} className="dsh-bio-graph__label">{node.label}</text>
              <text x={node.x + 14} y={node.y + 64} className="dsh-bio-graph__ports">
                {node.inputs.length} in · {node.outputs.length} out
              </text>
            </g>
          ))}
        </svg>
      </div>
      <footer className="dsh-bio-graph__footer">
        <span>{graph.nodes.length} nodes · {graph.edges.length} edges</span>
        <code title={graph.contentDigest}>{graph.contentDigest.slice(0, 18)}…</code>
      </footer>
      {selected && (
        <div className="dsh-bio-graph__selection" aria-live="polite">
          <div>
            <span>{kindLabel(selected.kind)}</span>
            <strong>{selected.label}</strong>
          </div>
          <p>{selected.range.path}:{selected.range.start.line}:{selected.range.start.column}</p>
          <p>{selected.target ? `Target ${selected.target}` : `${selected.inputs.length} inputs · ${selected.outputs.length} outputs`}</p>
          <button type="button" onClick={() => { setSelectedId(null) }}>Clear selection</button>
        </div>
      )}
      {graph.diagnostics.length > 0 && (
        <ul className="dsh-bio-graph__diagnostics" aria-label="Graph diagnostics">
          {graph.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${index}`} data-severity={diagnostic.severity}>
              <strong>{diagnostic.code}</strong>
              <span>{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function DraftGraphToolView({ block }: ToolViewProps) {
  if (block.kind !== 'tool-result') {
    return <div className="dsh-bio-tool-state" aria-live="polite"><span className="dsh-bio-spinner" />Parsing WDL graph…</div>
  }
  const result = graphFromBlock(block)
  if (!result.graph) {
    return <div className="dsh-bio-tool-state dsh-bio-tool-state--error">{result.error}</div>
  }
  return <WorkflowGraphView graph={result.graph} compact />
}
