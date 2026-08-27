import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  FIXTURE_ASSERTION_LIMITS,
  FIXTURE_ASSERTION_SCHEMA_VERSION,
  evaluateFixtureAssertions,
} from '../src/fixture-assertions.js'

function digest(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

test('declarative assertions compare exact JSON values and checksummed isolated files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-assertions-'))
  try {
    const work = join(root, 'work')
    const out = join(root, 'out')
    await mkdir(work)
    await mkdir(out)
    const content = Buffer.from('bounded output\n')
    const resultPath = join(work, 'result.txt')
    await writeFile(resultPath, content)
    const linkedPath = join(out, 'result.txt')
    await symlink(resultPath, linkedPath)

    const result = await evaluateFixtureAssertions({
      engineRoot: root,
      outputs: {
        'roundtrip.label': { status: 'ok', count: 1 },
        'roundtrip.copy': linkedPath,
      },
      assertions: [
        {
          id: 'label-value',
          kind: 'value_equals',
          output: 'roundtrip.label',
          expected: { count: 1, status: 'ok' },
        },
        {
          id: 'copied-file',
          kind: 'file_digest',
          output: 'roundtrip.copy',
          sizeBytes: content.length,
          sha256: digest(content),
        },
      ],
    })

    assert.equal(result.schemaVersion, FIXTURE_ASSERTION_SCHEMA_VERSION)
    assert.equal(result.passed, true)
    assert.equal(result.executableAssertions, false)
    assert.deepEqual(result.assertions.map((item) => item.status), ['passed', 'passed'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('assertion evaluation fails closed on mismatch, missing indexes, and path escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-assertions-fail-'))
  const outside = join(tmpdir(), `dsh-bio-outside-${process.pid}.txt`)
  try {
    await writeFile(outside, 'outside\n')
    const result = await evaluateFixtureAssertions({
      engineRoot: root,
      outputs: {
        'trial.value': 'actual',
        'trial.files': [],
        'trial.escape': outside,
        'trial.relative': 'relative.txt',
        'trial.directory': root,
      },
      assertions: [
        { id: 'a-value', kind: 'value_equals', output: 'trial.value', expected: 'expected' },
        {
          id: 'b-index',
          kind: 'file_digest',
          output: 'trial.files',
          index: 0,
          sizeBytes: 0,
          sha256: digest(''),
        },
        {
          id: 'c-escape',
          kind: 'file_digest',
          output: 'trial.escape',
          sizeBytes: Buffer.byteLength('outside\n'),
          sha256: digest('outside\n'),
        },
        {
          id: 'd-relative',
          kind: 'file_digest',
          output: 'trial.relative',
          sizeBytes: 0,
          sha256: digest(''),
        },
        {
          id: 'e-directory',
          kind: 'file_digest',
          output: 'trial.directory',
          sizeBytes: 0,
          sha256: digest(''),
        },
        { id: 'f-missing', kind: 'value_equals', output: 'trial.missing', expected: null },
      ],
    })
    assert.equal(result.passed, false)
    assert.deepEqual(result.assertions.map((item) => item.code), [
      'value_mismatch',
      'output_index_missing',
      'file_inspection_failed',
      'file_inspection_failed',
      'file_inspection_failed',
      'output_missing',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { force: true })
  }
})

test('assertion evaluation distinguishes bounded file failures and array selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-assertions-bounded-'))
  try {
    const output = join(root, 'output.txt')
    const oversized = join(root, 'oversized.txt')
    await writeFile(output, 'actual\n')
    await writeFile(oversized, '')
    await truncate(oversized, FIXTURE_ASSERTION_LIMITS.maxArtifactBytes + 1)
    const result = await evaluateFixtureAssertions({
      engineRoot: root,
      outputs: {
        'trial.files': [output],
        'trial.size': output,
        'trial.digest': output,
        'trial.oversized': oversized,
      },
      assertions: [
        {
          id: 'array-index-required',
          kind: 'file_digest',
          output: 'trial.files',
          sizeBytes: Buffer.byteLength('actual\n'),
          sha256: digest('actual\n'),
        },
        {
          id: 'size-mismatch',
          kind: 'file_digest',
          output: 'trial.size',
          sizeBytes: 1,
          sha256: digest('a'),
        },
        {
          id: 'digest-mismatch',
          kind: 'file_digest',
          output: 'trial.digest',
          sizeBytes: Buffer.byteLength('actual\n'),
          sha256: digest('different\n'),
        },
        {
          id: 'oversized-file',
          kind: 'file_digest',
          output: 'trial.oversized',
          sizeBytes: 1,
          sha256: digest('a'),
        },
      ],
    })

    assert.equal(result.passed, false)
    assert.deepEqual(result.assertions.map((item) => item.code), [
      'output_index_required',
      'file_digest_mismatch',
      'file_inspection_failed',
      'file_size_mismatch',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('assertion evaluation rejects invalid bounds and propagates cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-assertions-validation-'))
  try {
    await assert.rejects(
      evaluateFixtureAssertions(null),
      /options must be an object/,
    )
    await assert.rejects(
      evaluateFixtureAssertions({
        engineRoot: root,
        outputs: {},
        assertions: Array.from(
          { length: FIXTURE_ASSERTION_LIMITS.maxAssertions + 1 },
          (_, index) => ({ id: String(index) }),
        ),
      }),
      /assertions exceed the evaluation limit/,
    )
    await assert.rejects(
      evaluateFixtureAssertions({ engineRoot: '.', outputs: {}, assertions: [] }),
      /engineRoot must be absolute/,
    )

    const cancelled = new AbortController()
    cancelled.abort('cancelled')
    await assert.rejects(
      evaluateFixtureAssertions({
        engineRoot: root,
        outputs: {},
        assertions: [{ id: 'cancelled', kind: 'value_equals', output: 'x', expected: null }],
        signal: cancelled.signal,
      }),
      { name: 'AbortError', message: 'fixture assertion evaluation was aborted' },
    )

    const reason = new Error('deadline reached')
    const timedOut = new AbortController()
    timedOut.abort(reason)
    await assert.rejects(
      evaluateFixtureAssertions({
        engineRoot: root,
        outputs: {},
        assertions: [{ id: 'timed-out', kind: 'value_equals', output: 'x', expected: null }],
        signal: timedOut.signal,
      }),
      reason,
    )

    const longName = 'x'.repeat(FIXTURE_ASSERTION_LIMITS.maxEvidenceMessageBytes + 32)
    const bounded = await evaluateFixtureAssertions({
      engineRoot: root,
      outputs: {},
      assertions: [{ id: 'bounded-message', kind: 'value_equals', output: longName, expected: null }],
    })
    assert.equal(Buffer.byteLength(bounded.assertions[0].message, 'utf8') <= 515, true)
    assert.equal(bounded.assertions[0].message.endsWith('…'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
