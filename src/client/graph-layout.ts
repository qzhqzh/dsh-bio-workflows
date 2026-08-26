import type { WorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode } from './types.ts'

export interface PositionedGraphNode extends WorkflowGraphNode {
  x: number
  y: number
  width: number
  height: number
}

export interface GraphLayout {
  nodes: PositionedGraphNode[]
  edges: WorkflowGraphEdge[]
  width: number
  height: number
}

const NODE_WIDTH = 178
const NODE_HEIGHT = 76
const COLUMN_GAP = 76
const ROW_GAP = 30
const PADDING = 26

export function layoutWorkflowGraph(graph: WorkflowGraph): GraphLayout {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const semanticEdges = graph.edges.filter((edge) => (
    edge.kind !== 'containment'
    && nodeById.has(edge.from.node)
    && nodeById.has(edge.to.node)
  ))
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of semanticEdges) {
    incoming.set(edge.to.node, (incoming.get(edge.to.node) ?? 0) + 1)
    outgoing.get(edge.from.node)?.push(edge.to.node)
  }
  const layer = new Map<string, number>()
  const queue = graph.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .sort((left, right) => left.range.start.offset - right.range.start.offset)
  for (const node of queue) layer.set(node.id, node.kind === 'workflow-input' ? 0 : 1)
  let head = 0
  while (head < queue.length) {
    const node = queue[head]
    head += 1
    for (const target of outgoing.get(node.id) ?? []) {
      layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(node.id) ?? 0) + 1))
      incoming.set(target, (incoming.get(target) ?? 1) - 1)
      if (incoming.get(target) === 0) queue.push(nodeById.get(target)!)
    }
  }
  let fallbackLayer = Math.max(0, ...layer.values())
  for (const node of graph.nodes) {
    if (!layer.has(node.id)) {
      fallbackLayer += 1
      layer.set(node.id, fallbackLayer)
    }
  }
  const finalLayer = Math.max(0, ...layer.values())
  for (const node of graph.nodes) {
    if (node.kind === 'workflow-output') layer.set(node.id, Math.max(finalLayer, layer.get(node.id) ?? 0))
  }
  const groups = new Map<number, WorkflowGraphNode[]>()
  for (const node of graph.nodes) {
    const column = layer.get(node.id) ?? 0
    groups.set(column, [...(groups.get(column) ?? []), node])
  }
  for (const values of groups.values()) {
    values.sort((left, right) => left.range.start.offset - right.range.start.offset)
  }
  const positioned: PositionedGraphNode[] = []
  for (const [column, values] of [...groups.entries()].sort(([left], [right]) => left - right)) {
    values.forEach((node, row) => {
      positioned.push({
        ...node,
        x: PADDING + column * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING + row * (NODE_HEIGHT + ROW_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })
    })
  }
  const columnCount = Math.max(1, ...groups.keys()) + 1
  const maxRows = Math.max(1, ...[...groups.values()].map((values) => values.length))
  return {
    nodes: positioned,
    edges: graph.edges,
    width: PADDING * 2 + columnCount * NODE_WIDTH + Math.max(0, columnCount - 1) * COLUMN_GAP,
    height: PADDING * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP,
  }
}

export function graphEdgePath(from: PositionedGraphNode, to: PositionedGraphNode) {
  const startX = from.x + from.width
  const startY = from.y + from.height / 2
  const endX = to.x
  const endY = to.y + to.height / 2
  const distance = Math.max(38, Math.abs(endX - startX) * 0.48)
  return `M ${startX} ${startY} C ${startX + distance} ${startY}, ${endX - distance} ${endY}, ${endX} ${endY}`
}
