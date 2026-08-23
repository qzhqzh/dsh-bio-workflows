import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PreflightEnvironmentValidationError,
  parsePreflightEnvironment,
  preflightWorkflow,
} from '../src/preflight.js'
import { makeManifest } from './fixtures.mjs'

const declaredEnvironment = {
  engines: {
    nextflow: {
      available: true,
      version: '24.04',
    },
  },
}

test('preflight passes declared inputs and an exact engine declaration', () => {
  const result = preflightWorkflow(
    makeManifest(),
    { reads: ['sample_R1.fastq.gz', 'sample_R2.fastq.gz'] },
    declaredEnvironment,
  )

  assert.equal(result.status, 'pass')
  assert.equal(result.executionReady, false)
  assert.equal(result.checks.inputs.status, 'pass')
  assert.equal(result.checks.environment.status, 'pass')
  assert.deepEqual(result.limitations, [
    'filesystem_not_checked',
    'engine_not_probed',
    'execution_not_enabled',
  ])
})

test('preflight rejects missing, unknown, and incorrectly shaped inputs', () => {
  const missing = preflightWorkflow(makeManifest(), {}, declaredEnvironment)
  const invalid = preflightWorkflow(
    makeManifest(),
    { reads: 'sample.fastq.gz', extra: true },
    declaredEnvironment,
  )

  assert.equal(missing.status, 'fail')
  assert.ok(missing.checks.inputs.errors.some((error) => error.code === 'required'))
  assert.equal(invalid.status, 'fail')
  assert.ok(invalid.checks.inputs.errors.some((error) => error.code === 'unknown_input'))
  assert.ok(invalid.checks.inputs.errors.some((error) => error.code === 'type'))
})

test('preflight validates scalar input types and required collections', () => {
  const manifest = makeManifest({
    inputs: [
      { id: 'threads', type: 'integer', required: true },
      { id: 'threshold', type: 'number', required: true },
      { id: 'enabled', type: 'boolean', required: true },
      { id: 'labels', type: 'string', required: true, cardinality: 'many' },
    ],
  })

  const result = preflightWorkflow(
    manifest,
    { threads: 1.5, threshold: Number.POSITIVE_INFINITY, enabled: 'yes', labels: [] },
    declaredEnvironment,
  )

  assert.equal(result.status, 'fail')
  assert.equal(result.checks.inputs.errors.length, 4)
})

test('an undeclared engine makes preflight incomplete, not successful', () => {
  const result = preflightWorkflow(makeManifest(), { reads: ['sample.fastq.gz'] }, {})

  assert.equal(result.status, 'incomplete')
  assert.equal(result.checks.environment.errors[0].code, 'engine_not_declared')
})

test('an engine name inherited from Object.prototype is still undeclared', () => {
  const manifest = makeManifest({ engine: { name: 'constructor' } })
  const result = preflightWorkflow(manifest, { reads: ['sample.fastq.gz'] }, {})

  assert.equal(result.status, 'incomplete')
  assert.equal(result.checks.environment.declared, null)
  assert.equal(result.checks.environment.errors[0].code, 'engine_not_declared')
})

test('an unavailable or mismatched engine fails preflight', () => {
  const unavailable = preflightWorkflow(
    makeManifest(),
    { reads: ['sample.fastq.gz'] },
    { engines: { nextflow: { available: false } } },
  )
  const mismatch = preflightWorkflow(
    makeManifest(),
    { reads: ['sample.fastq.gz'] },
    { engines: { nextflow: { available: true, version: '25.01' } } },
  )

  assert.equal(unavailable.status, 'fail')
  assert.equal(unavailable.checks.environment.errors[0].code, 'engine_unavailable')
  assert.equal(mismatch.status, 'fail')
  assert.equal(mismatch.checks.environment.errors[0].code, 'engine_version_mismatch')
})

test('a missing required engine version makes preflight incomplete', () => {
  const result = preflightWorkflow(
    makeManifest(),
    { reads: ['sample.fastq.gz'] },
    { engines: { nextflow: { available: true } } },
  )

  assert.equal(result.status, 'incomplete')
  assert.equal(result.checks.environment.errors[0].code, 'engine_version_not_declared')
})

test('environment declarations are validated, sorted, and frozen', () => {
  const parsed = parsePreflightEnvironment({
    engines: {
      wdl: { available: false },
      nextflow: { available: true, version: '24.04' },
    },
  })

  assert.deepEqual(Object.keys(parsed.engines), ['nextflow', 'wdl'])
  assert.equal(Object.isFrozen(parsed.engines.nextflow), true)
  assert.throws(
    () => parsePreflightEnvironment({ engines: { Nextflow: { available: 'yes' } } }),
    PreflightEnvironmentValidationError,
  )
  assert.throws(
    () => parsePreflightEnvironment({ engines: {}, probePath: true }),
    PreflightEnvironmentValidationError,
  )
})
