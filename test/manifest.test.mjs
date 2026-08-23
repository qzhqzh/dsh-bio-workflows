import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  CARDINALITIES,
  MANIFEST_SCHEMA_VERSION,
  VALUE_TYPES,
  WORKFLOW_STATUSES,
  WorkflowManifestValidationError,
  parseWorkflowManifest,
  validateWorkflowManifest,
} from '../src/manifest.js'
import { PACKAGE_VERSION } from '../src/info.js'
import { makeManifest } from './fixtures.mjs'

test('a valid manifest is normalized and deeply frozen', () => {
  const parsed = parseWorkflowManifest(makeManifest())

  assert.equal(parsed.schemaVersion, MANIFEST_SCHEMA_VERSION)
  assert.equal(parsed.outputs[0].cardinality, 'one')
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen(parsed.inputs), true)
  assert.throws(() => parsed.tags.push('new-tag'), TypeError)
})

test('optional manifest collections normalize to empty arrays', () => {
  const manifest = makeManifest()
  delete manifest.inputs
  delete manifest.outputs
  delete manifest.tags

  const parsed = parseWorkflowManifest(manifest)

  assert.deepEqual(parsed.inputs, [])
  assert.deepEqual(parsed.outputs, [])
  assert.deepEqual(parsed.tags, [])
})

test('validation reports stable paths for unsupported and duplicate fields', () => {
  const manifest = makeManifest({ unsupported: true })
  manifest.inputs.push({ ...manifest.inputs[0] })

  const result = validateWorkflowManifest(manifest)

  assert.equal(result.valid, false)
  assert.ok(
    result.errors.some(
      (error) => error.path === '$.unsupported' && error.code === 'additional_property',
    ),
  )
  assert.ok(
    result.errors.some(
      (error) => error.path === '$.inputs[1].id' && error.code === 'duplicate',
    ),
  )
  assert.throws(() => parseWorkflowManifest(manifest), WorkflowManifestValidationError)
})

test('validation rejects malformed identifiers, versions, and port types', () => {
  const manifest = makeManifest({ id: 'FASTQ QC', version: 'latest' })
  manifest.outputs[0].type = 'archive'

  const result = validateWorkflowManifest(manifest)
  const paths = result.errors.map((error) => error.path)

  assert.equal(result.valid, false)
  assert.ok(paths.includes('$.id'))
  assert.ok(paths.includes('$.version'))
  assert.ok(paths.includes('$.outputs[0].type'))
})

test('the published JSON Schema matches runtime enums and version', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../schema/workflow-manifest.schema.json', import.meta.url), 'utf8'),
  )

  assert.equal(schema.properties.schemaVersion.const, MANIFEST_SCHEMA_VERSION)
  assert.ok(schema.$id.includes(`@${PACKAGE_VERSION}/`))
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.properties.status.enum, [...WORKFLOW_STATUSES])
  assert.deepEqual(schema.$defs.valueType.enum, [...VALUE_TYPES])
  assert.deepEqual(schema.$defs.cardinality.enum, [...CARDINALITIES])
})
