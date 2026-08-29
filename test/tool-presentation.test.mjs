import assert from 'node:assert/strict'
import test from 'node:test'

import { getDefaultToolPresentation } from '../src/tool-presentation.js'

function result(value) {
  return { isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] }
}

test('run-get fallback delegates all outcome claims to the validated result view', () => {
  const presentation = getDefaultToolPresentation('bio_workflows_run_get')
  const presented = presentation.presentResult({
    runId: 'run-11111111-1111-4111-8111-111111111111',
  }, result({
    ok: true,
    run: {
      runId: 'run-11111111-1111-4111-8111-111111111111',
      status: 'completed',
      result: {
        artifacts: [
          { items: [{}, {}] },
          { items: [{}] },
        ],
        summaries: { fastqc: { moduleCounts: { pass: 5, warn: 2, fail: 3 } } },
      },
    },
    error: null,
  }))

  assert.equal(presented.content[0].text, [
    'Workflow run evidence returned',
    'Open the result view for validated outputs and QC evidence.',
  ].join('\n'))
})

test('run-get fallback does not trust unknown schemas, contradictory lifecycle, outputs, QC, or private errors', () => {
  const presentation = getDefaultToolPresentation('bio_workflows_run_get')
  const unbound = presentation.presentResult({
    runId: 'run-22222222-2222-4222-8222-222222222222',
  }, result({
    ok: true,
    run: {
      schemaVersion: '2',
      runId: 'run-11111111-1111-4111-8111-111111111111',
      status: 'completed',
      error: { code: 'miniwdl_failed', message: 'failure' },
      result: {
        artifacts: [{ items: [{ path: '/private/run/result.txt' }] }],
        summaries: { fastqc: { moduleCounts: { pass: 99, warn: 0, fail: 0 } } },
      },
    },
    error: null,
  }))
  const failed = presentation.presentResult({}, result({
    ok: false,
    error: { code: 'output_collection_failed', message: 'Could not inspect /private/run/result.txt.' },
  }))

  assert.equal(unbound.content[0].text, [
    'Workflow run evidence returned',
    'Open the result view for validated outputs and QC evidence.',
  ].join('\n'))
  assert.equal(failed.content[0].text, 'Could not retrieve workflow run evidence (output_collection_failed). Ask the Agent to explain the failure.')
  assert.equal(JSON.stringify([unbound, failed]).includes('/private/run'), false)
  assert.equal(JSON.stringify(unbound).includes('99 pass'), false)

  const oversizedCode = presentation.presentResult({}, result({
    ok: false,
    error: { code: `a${'b'.repeat(4095)}`, message: 'failure' },
  }))
  assert.equal(oversizedCode.content[0].text, 'Could not retrieve workflow run evidence. Ask the Agent to explain the failure.')
})

test('run-list fallback delegates ordering and lifecycle claims to the validated history view', () => {
  const presentation = getDefaultToolPresentation('bio_workflows_run_list')
  const presented = presentation.presentResult({}, result({
    ok: true,
    count: 2,
    runs: [
      { workflow: { id: 'fastq-qc', version: '1.2.0' }, status: 'completed', startedAt: '2026-08-29T10:00:00.000Z' },
      { workflow: { id: 'fastq-qc', version: '1.2.0' }, status: 'running', startedAt: '2026-08-29T11:00:00.000Z' },
    ],
    error: null,
  }))

  assert.equal(presented.content[0].text, [
    'Workflow run history returned',
    'Open the history view for validated lifecycle evidence.',
  ].join('\n'))
})
