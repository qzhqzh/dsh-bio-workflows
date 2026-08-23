import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WorkflowCatalogValidationError,
  createWorkflowCatalog,
} from '../src/catalog.js'
import { makeManifest } from './fixtures.mjs'

test('catalog entries are sorted and can be filtered', () => {
  const catalog = createWorkflowCatalog([
    makeManifest({ id: 'rna-seq', name: 'RNA sequencing', tags: ['rna'] }),
    makeManifest({ id: 'fastq-qc', name: 'FASTQ quality control' }),
    makeManifest({
      id: 'variant-calling',
      name: 'Variant calling',
      status: 'draft',
      engine: { name: 'wdl' },
      tags: ['variant'],
    }),
  ])

  assert.equal(catalog.size, 3)
  assert.deepEqual(
    catalog.list().map((workflow) => workflow.id),
    ['fastq-qc', 'rna-seq', 'variant-calling'],
  )
  assert.deepEqual(
    catalog.list({ engine: 'wdl' }).map((workflow) => workflow.id),
    ['variant-calling'],
  )
  assert.deepEqual(
    catalog.list({ status: 'ready', tag: 'rna' }).map((workflow) => workflow.id),
    ['rna-seq'],
  )
})

test('catalog get returns an isolated copy', () => {
  const catalog = createWorkflowCatalog([makeManifest()])
  const first = catalog.get('fastq-qc')

  first.tags.push('mutated')

  assert.deepEqual(catalog.get('fastq-qc').tags, ['fastq', 'qc'])
  assert.equal(catalog.get('missing'), null)
})

test('catalog rejects duplicate workflow ids', () => {
  assert.throws(
    () => createWorkflowCatalog([makeManifest(), makeManifest({ version: '2.0.0' })]),
    (error) => {
      assert.ok(error instanceof WorkflowCatalogValidationError)
      assert.equal(error.errors[0].path, '$[1].id')
      assert.equal(error.errors[0].code, 'duplicate')
      return true
    },
  )
})

test('catalog prefixes manifest validation paths with the item index', () => {
  assert.throws(
    () => createWorkflowCatalog([makeManifest(), makeManifest({ id: 'Invalid ID' })]),
    (error) => {
      assert.ok(error instanceof WorkflowCatalogValidationError)
      assert.ok(error.errors.some((issue) => issue.path === '$[1].id'))
      return true
    },
  )
})

test('catalog requires an array of manifests', () => {
  assert.throws(() => createWorkflowCatalog({}), WorkflowCatalogValidationError)
})
