import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ANALYSIS_BRIEF_LIMITS,
  analysisBriefIsValid,
  prompts,
} from '../src/client/prompts.ts'

function brief(overrides = {}) {
  return {
    biologicalQuestion: 'Which samples pass RNA-seq quality control?',
    inputData: 'Paired FASTQ files.',
    desiredOutputs: 'Checksummed HTML and summary reports.',
    constraints: '',
    acceptanceCriteria: 'Every input has a report.',
    ...overrides,
  }
}

test('analysis brief validation enforces required fields and per-field bounds', () => {
  assert.equal(analysisBriefIsValid(brief()), true)
  assert.equal(analysisBriefIsValid(brief({ biologicalQuestion: ' ' })), false)
  assert.equal(analysisBriefIsValid(brief({ inputData: 'x'.repeat(ANALYSIS_BRIEF_LIMITS.inputData) })), true)
  assert.equal(analysisBriefIsValid(brief({ inputData: 'x'.repeat(ANALYSIS_BRIEF_LIMITS.inputData + 1) })), false)
  assert.equal(analysisBriefIsValid({ ...brief(), constraints: 4 }), false)
})

test('draft prompt construction fails closed before interpolating an oversized brief', () => {
  const oversized = brief({ acceptanceCriteria: '/private/'.repeat(ANALYSIS_BRIEF_LIMITS.acceptanceCriteria) })

  assert.throws(
    () => prompts.createDraft(oversized),
    { name: 'RangeError', message: 'Analysis brief is incomplete or exceeds its bounded size.' },
  )
})

test('run prompts keep outcome review owner-scoped and avoid opaque-id work', () => {
  assert.match(prompts.listRuns(), /without asking me to copy its run id/)
  assert.match(prompts.listRuns(), /Do not start or retry a run/)
  const inspect = prompts.inspectRun('run-11111111-1111-4111-8111-111111111111')
  assert.match(inspect, /State first whether execution completed/)
  assert.match(inspect, /Distinguish execution completion, technical QC findings, and biological interpretation/)
  assert.match(inspect, /do not expose absolute host paths/)
})
