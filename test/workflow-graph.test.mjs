import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  WORKFLOW_GRAPH_LIMITS,
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  createWorkflowGraph,
} from '../src/workflow-graph.js'

const IDENTITY = Object.freeze({
  draftId: 'draft-11111111-1111-4111-8111-111111111111',
  revision: 7,
  contentDigest: `sha256:${'a'.repeat(64)}`,
})

test('WorkflowGraph v1 deterministically extracts the built-in scatter workflow', async () => {
  const source = await readFile(
    new URL('../workflows/fastq-qc/1.2.0/main.wdl', import.meta.url),
    'utf8',
  )
  const first = createWorkflowGraph({ ...IDENTITY, source })
  const replay = createWorkflowGraph({ ...IDENTITY, source })

  assert.equal(first.schemaVersion, WORKFLOW_GRAPH_SCHEMA_VERSION)
  assert.equal(first.complete, true)
  assert.equal(first.workflow.name, 'fastq_qc')
  assert.equal(first.revision, IDENTITY.revision)
  assert.equal(first.contentDigest, IDENTITY.contentDigest)
  assert.match(first.graphDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(first.graphDigest, replay.graphDigest)
  assert.deepEqual(first, replay)
  assert.deepEqual(
    first.nodes.map((node) => [node.kind, node.label]),
    [
      ['workflow-input', 'reads'],
      ['workflow-input', 'threads'],
      ['scatter', 'read'],
      ['call', 'fastqc_one'],
      ['workflow-output', 'html_reports'],
      ['workflow-output', 'zip_reports'],
      ['workflow-output', 'summary_reports'],
    ],
  )
  assert.equal(first.edges.some((edge) => edge.kind === 'containment'), true)
  assert.equal(first.edges.some((edge) => (
    edge.from.node === 'workflow-input:threads'
    && edge.to.node.startsWith('call:fastqc_one:')
    && edge.to.port === 'threads'
  )), true)
  assert.equal(first.executionAuthorized, false)
  assert.equal(Object.hasOwn(first, 'layout'), false)
})

test('WorkflowGraph v1 preserves a supported subgraph and never hides unsupported syntax', () => {
  const source = `version 1.0

import "remote.wdl"

task qc {
  input { File read }
  command <<< echo '~{read}' >>>
  output { File report = "report.txt" }
}

workflow partial {
  input { File read }
  call qc { input: read = read }
  while (true) { call qc as again { input: read = read } }
  output { File report = qc.report }
}
`
  const graph = createWorkflowGraph({ ...IDENTITY, source })

  assert.equal(graph.complete, false)
  assert.equal(graph.nodes.some((node) => node.kind === 'call' && node.label === 'qc'), true)
  assert.equal(graph.nodes.some((node) => node.label === 'again'), false)
  assert.equal(graph.diagnostics.some((item) => item.code === 'unsupported_import'), true)
  assert.equal(graph.diagnostics.some((item) => (
    item.code === 'unsupported_workflow_syntax' && item.message.includes('while')
  )), true)
  assert.equal(graph.nodes.length <= WORKFLOW_GRAPH_LIMITS.maxNodes, true)
  assert.equal(graph.edges.length <= WORKFLOW_GRAPH_LIMITS.maxEdges, true)
  assert.equal(graph.diagnostics.length <= WORKFLOW_GRAPH_LIMITS.maxDiagnostics, true)
})

test('WorkflowGraph v1 handles nested conditional containment and explicit call dependencies', () => {
  const source = `version 1.0

task prepare {
  input { File source }
  command <<< cp '~{source}' prepared.txt >>>
  output { File prepared = "prepared.txt" }
}

task inspect {
  input { File source }
  command <<< wc -c '~{source}' > count.txt >>>
  output { File count = "count.txt" }
}

workflow nested {
  input {
    File source
    Boolean enabled
  }
  call prepare { input: source = source }
  if (enabled) {
    call inspect after prepare { input: source = prepare.prepared }
  }
  output { File prepared = prepare.prepared }
}
`
  const graph = createWorkflowGraph({ ...IDENTITY, source })
  const conditional = graph.nodes.find((node) => node.kind === 'conditional')
  const inspect = graph.nodes.find((node) => node.kind === 'call' && node.label === 'inspect')

  assert.equal(graph.complete, true)
  assert.equal(inspect.parentGroup, conditional.id)
  assert.equal(graph.edges.some((edge) => (
    edge.kind === 'control'
    && edge.from.node.startsWith('call:prepare:')
    && edge.to.node === inspect.id
  )), true)
  assert.equal(graph.edges.some((edge) => (
    edge.kind === 'data'
    && edge.from.node.startsWith('call:prepare:')
    && edge.to.node === inspect.id
  )), true)
})

test('WorkflowGraph v1 distinguishes record labels from variables and resolves nested members', async () => {
  const source = await readFile(
    new URL('./fixtures/workflow-graph-references.wdl', import.meta.url),
    'utf8',
  )
  const graph = createWorkflowGraph({ ...IDENTITY, source })
  const payload = graph.nodes.find((node) => node.kind === 'declaration' && node.label === 'payload')
  const conditionalPayload = graph.nodes.find((node) => (
    node.kind === 'declaration' && node.label === 'conditional_payload'
  ))
  const bar = graph.nodes.find((node) => node.kind === 'workflow-input' && node.label === 'bar')
  const structValue = graph.nodes.find((node) => (
    node.kind === 'declaration' && node.label === 'struct_value'
  ))
  const nested = graph.nodes.find((node) => node.kind === 'declaration' && node.label === 'nested')

  assert.equal(graph.complete, true)
  assert.equal(graph.diagnostics.length, 0)
  assert.equal(graph.edges.some((edge) => (
    edge.from.node === 'workflow-input:foo' && edge.to.node === payload.id
  )), false)
  assert.equal(graph.edges.some((edge) => (
    edge.from.node === 'workflow-input:nested_pair' && edge.to.node === nested.id
  )), true)
  assert.equal(bar.inputs.some((item) => item.id === 'default'), true)
  assert.equal(graph.edges.some((edge) => (
    edge.from.node === 'workflow-input:foo'
    && edge.to.node === bar.id
    && edge.to.port === 'default'
  )), true)
  assert.equal(graph.nodes.some((node) => node.kind === 'workflow-input' && node.label === 'second'), true)
  assert.equal(graph.edges.some((edge) => (
    edge.from.node === 'workflow-input:first' && edge.to.node === structValue.id
  )), true)
  for (const input of ['cond', 'foo', 'bar']) {
    assert.equal(graph.edges.some((edge) => (
      edge.from.node === `workflow-input:${input}` && edge.to.node === conditionalPayload.id
    )), true, input)
  }
})

test('WorkflowGraph v1 never applies a local task signature to a qualified imported call', () => {
  const source = `version 1.0

import "remote.wdl" as remote

task qc {
  input { String local_name }
  command <<< true >>>
  output { String local_output = "local" }
}

workflow imported_call {
  input { String source }
  call remote.qc { input: remote_name = source }
}
`
  const graph = createWorkflowGraph({ ...IDENTITY, source })
  const call = graph.nodes.find((node) => node.kind === 'call')

  assert.equal(graph.complete, false)
  assert.deepEqual(call.inputs.map((item) => item.name), ['remote_name'])
  assert.deepEqual(call.outputs, [])
  assert.equal(graph.edges.some((edge) => (
    edge.from.node === 'workflow-input:source'
    && edge.to.node === call.id
    && edge.to.port === 'remote_name'
  )), true)
  assert.equal(graph.diagnostics.some((item) => item.code === 'unresolved_call_target'), true)
})

test('WorkflowGraph v1 marks unparsed string interpolation dependencies as partial', async () => {
  const source = await readFile(
    new URL('./fixtures/workflow-graph-interpolation.wdl', import.meta.url),
    'utf8',
  )
  const graph = createWorkflowGraph({ ...IDENTITY, source })

  assert.equal(graph.complete, false)
  assert.equal(graph.diagnostics.some((item) => item.code === 'unsupported_string_interpolation'), true)
})

test('WorkflowGraph v1 preserves declarations separated only by WDL whitespace', async () => {
  const source = await readFile(
    new URL('./fixtures/workflow-graph-single-line.wdl', import.meta.url),
    'utf8',
  )
  const graph = createWorkflowGraph({ ...IDENTITY, source })

  assert.equal(graph.complete, true)
  assert.deepEqual(
    graph.nodes.map((node) => [node.kind, node.label]),
    [
      ['workflow-input', 'a'],
      ['workflow-input', 'b'],
      ['workflow-output', 'x'],
      ['workflow-output', 'y'],
    ],
  )
  assert.equal(graph.edges.some((edge) => (
    edge.from.node === 'workflow-input:a' && edge.to.node === 'workflow-output:x'
  )), true)
  assert.equal(graph.edges.some((edge) => (
    edge.from.node === 'workflow-input:b' && edge.to.node === 'workflow-output:y'
  )), true)
})

test('WorkflowGraph v1 separates workflow statements and resolves forward DAG references', async () => {
  const source = await readFile(
    new URL('./fixtures/workflow-graph-forward.wdl', import.meta.url),
    'utf8',
  )
  const graph = createWorkflowGraph({ ...IDENTITY, source })
  const first = graph.nodes.find((node) => node.kind === 'declaration' && node.label === 'first')
  const later = graph.nodes.find((node) => node.kind === 'declaration' && node.label === 'later')
  const call = graph.nodes.find((node) => node.kind === 'call')
  const output = graph.nodes.find((node) => node.kind === 'workflow-output')

  assert.equal(graph.complete, true)
  assert.deepEqual(
    graph.nodes.map((node) => [node.kind, node.label]),
    [
      ['declaration', 'first'],
      ['call', 'echo_value'],
      ['declaration', 'later'],
      ['workflow-output', 'result'],
    ],
  )
  assert.equal(graph.edges.some((edge) => edge.from.node === later.id && edge.to.node === first.id), true)
  assert.equal(graph.edges.some((edge) => edge.from.node === first.id && edge.to.node === call.id), true)
  assert.equal(graph.edges.some((edge) => edge.from.node === call.id && edge.to.node === output.id), true)
})

test('WorkflowGraph v1 classifies legacy unbound workflow and task declarations as inputs', async () => {
  const source = await readFile(
    new URL('./fixtures/workflow-graph-legacy-inputs.wdl', import.meta.url),
    'utf8',
  )
  const graph = createWorkflowGraph({ ...IDENTITY, source })
  const input = graph.nodes.find((node) => node.label === 'value')
  const call = graph.nodes.find((node) => node.kind === 'call')

  assert.equal(graph.complete, true)
  assert.equal(input.kind, 'workflow-input')
  assert.deepEqual(input.inputs, [])
  assert.deepEqual(call.inputs.map((item) => [item.name, item.type]), [['value', 'String']])
  assert.equal(graph.edges.some((edge) => (
    edge.from.node === input.id && edge.to.node === call.id && edge.to.port === 'value'
  )), true)
})

test('WorkflowGraph v1 rejects invalid public identities and oversized source', () => {
  assert.throws(
    () => createWorkflowGraph({ ...IDENTITY, draftId: 'draft-invalid', source: 'version 1.0' }),
    /draftId is invalid/,
  )
  assert.throws(
    () => createWorkflowGraph({ ...IDENTITY, revision: 0, source: 'version 1.0' }),
    /revision is invalid/,
  )
  assert.throws(
    () => createWorkflowGraph({ ...IDENTITY, contentDigest: 'sha256:invalid', source: 'version 1.0' }),
    /contentDigest is invalid/,
  )
  assert.throws(
    () => createWorkflowGraph({
      ...IDENTITY,
      source: 'x'.repeat(WORKFLOW_GRAPH_LIMITS.maxSourceBytes + 1),
    }),
    /source exceeds/,
  )
})

test('WorkflowGraph v1 bounds schema fields and task ports without hiding truncation', () => {
  const deepType = `${'Array['.repeat(70)}String${']'.repeat(70)}`
  const declarations = [
    `${deepType} oversized`,
    ...Array.from(
      { length: WORKFLOW_GRAPH_LIMITS.maxPortsPerNode },
      (_, index) => `String input_${index}`,
    ),
  ].join('\n    ')
  const workflowName = 'w'.repeat(129)
  const source = `version 1.0

task many_inputs {
  input {
    ${declarations}
  }
  command <<< true >>>
  output { String report = "ok" }
}

workflow ${workflowName} {
  call many_inputs
}
`
  const graph = createWorkflowGraph({ ...IDENTITY, source })
  const call = graph.nodes.find((node) => node.kind === 'call')

  assert.equal(graph.complete, false)
  assert.equal(graph.workflow.name.length <= 128, true)
  assert.equal(call.inputs.length, WORKFLOW_GRAPH_LIMITS.maxPortsPerNode)
  assert.equal(call.inputs.every((item) => item.id.length <= 160), true)
  assert.equal(call.inputs.every((item) => item.name.length <= 160), true)
  assert.equal(call.inputs.every((item) => item.type.length <= 256), true)
  assert.equal(graph.nodes.every((node) => node.id.length <= 240), true)
  assert.equal(graph.diagnostics.some((item) => item.code === 'identifier_limit'), true)
  assert.equal(graph.diagnostics.some((item) => item.code === 'port_limit'), true)
  assert.equal(graph.diagnostics.some((item) => item.code === 'port_type_limit'), true)
})

test('WorkflowGraph v1 keeps bounded call edge endpoints attached to real ports', () => {
  const inputName = `input_${'i'.repeat(194)}`
  const outputName = `output_${'o'.repeat(193)}`
  const source = `version 1.0

task bounded_ports {
  input { String ${inputName} }
  command <<< true >>>
  output { String ${outputName} = "ok" }
}

workflow bounded_edges {
  input { String source }
  call bounded_ports { input: ${inputName} = source }
  output { String result = bounded_ports.${outputName} }
}
`
  const graph = createWorkflowGraph({ ...IDENTITY, source })
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))

  assert.equal(graph.complete, false)
  assert.equal(graph.diagnostics.some((item) => item.code === 'identifier_limit'), true)
  for (const edge of graph.edges.filter((item) => item.kind === 'data')) {
    assert.equal(nodes.get(edge.from.node).outputs.some((portValue) => portValue.id === edge.from.port), true)
    assert.equal(nodes.get(edge.to.node).inputs.some((portValue) => portValue.id === edge.to.port), true)
  }
})
