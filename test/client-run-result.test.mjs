import assert from 'node:assert/strict'
import test from 'node:test'

import {
  projectRunGetToolResult,
  projectRunListToolResult,
} from '../src/client/run-result.ts'

const runId = 'run-11111111-1111-4111-8111-111111111111'
const workflow = {
  id: 'fastq-qc',
  version: '1.2.0',
  bundleDigest: `sha256:${'a'.repeat(64)}`,
}
const planDigest = `sha256:${'b'.repeat(64)}`

function block(payload, args = { runId }) {
  return {
    kind: 'tool-result',
    call: { argsRaw: args },
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

function artifact(ordinal) {
  return {
    ordinal,
    path: `/private/run/output-${ordinal}.txt`,
    relativePath: `outputs/output-${ordinal}.txt`,
    sizeBytes: String(100 + ordinal),
    sha256: `sha256:${String(ordinal).padStart(64, '0')}`,
  }
}

function completedPayload() {
  const items = [0, 1, 2, 3].map(artifact)
  return {
    ok: true,
    run: {
      schemaVersion: '1',
      runId,
      ownerSession: 'must-not-project',
      runDirectory: '/private/run',
      command: { argv: ['/private/miniwdl'], environmentPolicy: 'must-not-project' },
      jobId: 'bio-17',
      status: 'completed',
      startedAt: '2026-08-29T10:00:00.000Z',
      finishedAt: '2026-08-29T10:01:00.000Z',
      planDigest,
      plan: { workflow },
      error: null,
      result: {
        schemaVersion: '1',
        status: 'completed',
        generatedAt: '2026-08-29T10:01:00.000Z',
        workflow,
        planDigest,
        artifacts: [
          { outputId: 'html_reports', type: 'file', cardinality: 'many', items },
          { outputId: 'summary_reports', type: 'file', cardinality: 'many', items: [artifact(0)] },
        ],
        summaries: {
          fastqc: {
            schemaVersion: '1',
            reportCount: 1,
            moduleCounts: { pass: 1, warn: 1, fail: 1 },
            reports: [{
              artifact: { outputId: 'summary_reports', ordinal: 0 },
              sample: 'sample.fastq.gz',
              overallStatus: 'fail',
              counts: { pass: 1, warn: 1, fail: 1 },
              modules: [
                { name: 'Basic Statistics', status: 'pass' },
                { name: 'Adapter Content', status: 'warn' },
                { name: 'Per base quality', status: 'fail' },
              ],
            }],
          },
        },
        diagnostics: [],
      },
    },
    job: null,
    reconciliation: { status: 'not_needed' },
    error: null,
  }
}

function bamCompletedPayload() {
  const payload = completedPayload()
  const bamWorkflow = {
    id: 'bam-qc',
    version: '1.1.0',
    bundleDigest: `sha256:${'c'.repeat(64)}`,
  }
  payload.run.plan.workflow = bamWorkflow
  payload.run.result.workflow = bamWorkflow
  payload.run.result.artifacts = [
    { outputId: 'flagstat_report', type: 'file', cardinality: 'one', items: [artifact(0)] },
    { outputId: 'stats_report', type: 'file', cardinality: 'one', items: [artifact(0)] },
    { outputId: 'idxstats_report', type: 'file', cardinality: 'one', items: [artifact(0)] },
  ]
  payload.run.result.summaries = {
    samtools: {
      schemaVersion: '1',
      flagstat: {
        artifact: { outputId: 'flagstat_report', ordinal: 0 },
        totalReads: '4',
        mappedReads: '3',
        properlyPairedReads: '2',
        duplicateReads: '0',
      },
      idxstats: {
        artifact: { outputId: 'idxstats_report', ordinal: 0 },
        referenceCount: 1,
        mappedReads: '3',
        unmappedReads: '1',
      },
      statsArtifact: { outputId: 'stats_report', ordinal: 0 },
    },
  }
  return payload
}

test('run result projection keeps outcome evidence and omits Host-private fields', () => {
  const payload = completedPayload()
  payload.run.result.diagnostics = [{
    code: 'result_note',
    message: 'Collected from /private/run/call-fastqc/execution.',
  }]
  const projected = projectRunGetToolResult(block(payload))

  assert.equal(projected.state, 'ready')
  assert.equal(projected.value.status, 'completed')
  assert.equal(projected.value.resultState, 'available')
  assert.equal(projected.value.result.artifactCount, 5)
  assert.equal(projected.value.result.artifactGroups[0].examples.length, 3)
  assert.equal(projected.value.result.artifactGroups[0].examplesOmitted, 1)
  assert.deepEqual(projected.value.result.fastqc.moduleCounts, { pass: 1, warn: 1, fail: 1 })
  assert.deepEqual(projected.value.result.diagnostics, [{ code: 'result_note' }])
  assert.equal(JSON.stringify(projected).includes('ownerSession'), false)
  assert.equal(JSON.stringify(projected).includes('/private/run'), false)
  assert.equal(JSON.stringify(projected).includes('environmentPolicy'), false)
})

test('run result projection publishes bounded samtools counts and verifies artifact references', () => {
  const projected = projectRunGetToolResult(block(bamCompletedPayload()))

  assert.equal(projected.state, 'ready')
  assert.equal(projected.value.resultState, 'available')
  assert.deepEqual(projected.value.result.samtools, {
    totalReads: '4',
    mappedReads: '3',
    properlyPairedReads: '2',
    duplicateReads: '0',
    referenceCount: 1,
    indexMappedReads: '3',
    indexUnmappedReads: '1',
  })

  const invalidReference = bamCompletedPayload()
  invalidReference.run.result.summaries.samtools.statsArtifact.outputId = 'flagstat_report'
  assert.equal(projectRunGetToolResult(block(invalidReference)).value.resultState, 'invalid')

  const invalidCount = bamCompletedPayload()
  invalidCount.run.result.summaries.samtools.flagstat.mappedReads = '5'
  assert.equal(projectRunGetToolResult(block(invalidCount)).value.resultState, 'invalid')
})

test('run result projection rejects a result for a different requested run', () => {
  const projected = projectRunGetToolResult(block(completedPayload(), {
    runId: 'run-22222222-2222-4222-8222-222222222222',
  }))

  assert.deepEqual(projected, {
    state: 'error',
    message: 'The run result does not match a valid requested workflow run.',
  })
})

test('run result projection rejects non-canonical replay timestamps', () => {
  const payload = completedPayload()
  payload.run.startedAt = '0'

  assert.deepEqual(projectRunGetToolResult(block(payload)), {
    state: 'error',
    message: 'The run result does not match a valid requested workflow run.',
  })
})

test('run result projection rejects unknown versions and contradictory lifecycle facts', () => {
  const invalidRuns = [
    { schemaVersion: '2' },
    { status: 'completed', finishedAt: null },
    { status: 'completed', error: { code: 'miniwdl_failed', message: 'failure' } },
    { status: 'running', finishedAt: '2026-08-29T10:01:00.000Z', result: null },
    { status: 'failed', result: completedPayload().run.result, error: { code: 'miniwdl_failed', message: 'failure' } },
    { status: 'failed', finishedAt: '2026-08-29T09:59:00.000Z', result: null, error: { code: 'miniwdl_failed', message: 'failure' } },
  ]

  for (const changes of invalidRuns) {
    const payload = completedPayload()
    Object.assign(payload.run, changes)
    assert.equal(projectRunGetToolResult(block(payload)).state, 'error')
  }
})

test('run result projection rejects normalized evidence outside the run timeline', () => {
  const payload = completedPayload()
  payload.run.result.generatedAt = '2026-08-29T10:02:00.000Z'
  const projected = projectRunGetToolResult(block(payload))

  assert.equal(projected.state, 'ready')
  assert.equal(projected.value.status, 'completed')
  assert.equal(projected.value.resultState, 'invalid')
  assert.equal(projected.value.result, undefined)
})

test('run result projection keeps run status but fails closed on malformed normalized evidence', () => {
  const payload = completedPayload()
  payload.run.result.summaries.fastqc.moduleCounts.fail = 0
  const projected = projectRunGetToolResult(block(payload))

  assert.equal(projected.state, 'ready')
  assert.equal(projected.value.status, 'completed')
  assert.equal(projected.value.resultState, 'invalid')
  assert.equal(projected.value.result, undefined)
})

test('run result projection rejects path-shaped sample labels', () => {
  const payload = completedPayload()
  payload.run.result.summaries.fastqc.reports[0].sample = '/private/patient.fastq.gz'
  const projected = projectRunGetToolResult(block(payload))

  assert.equal(projected.state, 'ready')
  assert.equal(projected.value.resultState, 'invalid')
  assert.equal(JSON.stringify(projected).includes('/private'), false)
})

test('run result projection preserves bounded failure facts without claiming outputs', () => {
  const payload = completedPayload()
  payload.run.status = 'interrupted'
  payload.run.result = null
  payload.run.error = { code: 'run_interrupted', message: 'Owner job missing under /private/run after runtime restart.' }
  const projected = projectRunGetToolResult(block(payload))

  assert.equal(projected.state, 'ready')
  assert.equal(projected.value.status, 'interrupted')
  assert.equal(projected.value.resultState, 'missing')
  assert.deepEqual(projected.value.error, { code: 'run_interrupted' })
  assert.equal(JSON.stringify(projected).includes('/private/run'), false)
})

test('run result projection never repeats a top-level private error message', () => {
  const projected = projectRunGetToolResult(block({
    ok: false,
    error: {
      code: 'output_collection_failed',
      message: 'Could not inspect /private/run/call-fastqc/execution/outputs.json.',
    },
  }))

  assert.deepEqual(projected, {
    state: 'error',
    message: 'The workflow result could not be retrieved (output_collection_failed). Ask the Agent to explain the failure.',
  })
  assert.equal(JSON.stringify(projected).includes('/private/run'), false)
})

test('run history projection preserves newest-first order and caps visible rows', () => {
  const runs = Array.from({ length: 21 }, (_, index) => ({
    runId: `run-${String(index + 1).padStart(8, '0')}-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    jobId: `bio-${index + 1}`,
    workflow,
    status: index === 0 ? 'running' : 'completed',
    startedAt: new Date(Date.parse('2026-08-29T10:00:00.000Z') - index * 1000).toISOString(),
    finishedAt: index === 0 ? null : new Date(Date.parse('2026-08-29T10:00:30.000Z') - index * 1000).toISOString(),
    planDigest,
    jobStatus: null,
    reconciliationStatus: 'not_needed',
  }))
  const projected = projectRunListToolResult(block({
    ok: true,
    count: runs.length,
    runs,
    nextCursor: runs.at(-1).runId,
    truncated: false,
    diagnostics: [],
    error: null,
  }, {}))

  assert.equal(projected.state, 'ready')
  assert.equal(projected.value.runs.length, 20)
  assert.equal(projected.value.hiddenCount, 1)
  assert.equal(projected.value.hasNextPage, true)
  assert.equal(projected.value.runs[0].status, 'running')
})

test('run history projection rejects reordered or duplicate replay data', () => {
  const first = {
    runId,
    workflow,
    status: 'completed',
    startedAt: '2026-08-29T10:00:00.000Z',
    finishedAt: '2026-08-29T10:01:00.000Z',
  }
  const later = {
    ...first,
    runId: 'run-22222222-2222-4222-8222-222222222222',
    startedAt: '2026-08-29T11:00:00.000Z',
  }
  const projected = projectRunListToolResult(block({
    ok: true,
    count: 2,
    runs: [first, later],
    nextCursor: null,
    truncated: false,
    diagnostics: [],
    error: null,
  }, {}))

  assert.deepEqual(projected, { state: 'error', message: 'The Agent returned an invalid run history.' })
})
