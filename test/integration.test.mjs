import assert from 'node:assert/strict'
import test from 'node:test'

import * as plugin from 'dsh-bio-workflows'
import { createWorkflowCatalog } from 'dsh-bio-workflows/catalog'
import { MANIFEST_SCHEMA_VERSION } from 'dsh-bio-workflows/manifest'
import { preflightWorkflow } from 'dsh-bio-workflows/preflight'
import schema from 'dsh-bio-workflows/schema/workflow-manifest.schema.json' with { type: 'json' }

import { makeManifest } from './fixtures.mjs'

test('public self-references and the root DSH apply entry work with the real peer', async () => {
  assert.equal(plugin.name, 'dsh-bio-workflows')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof createWorkflowCatalog, 'function')
  assert.equal(typeof preflightWorkflow, 'function')
  assert.equal(schema.properties.schemaVersion.const, MANIFEST_SCHEMA_VERSION)

  const registered = []
  const ctx = { tools: { register: (tool) => registered.push(tool) } }
  plugin.apply(ctx, {
    manifests: [makeManifest()],
    environment: {
      engines: { nextflow: { available: true, version: '24.04' } },
    },
  })

  assert.deepEqual(
    registered.map((tool) => tool.name),
    [
      'bio_workflows_info',
      'bio_workflows_list',
      'bio_workflows_get',
      'bio_workflows_preflight',
    ],
  )

  const tool = registered.at(-1)
  assert.equal(tool.parameters.type, 'object')
  assert.equal(tool.parameters.properties.inputs.type, 'object')
  assert.equal(tool.parameters.properties.inputs.additionalProperties, true)

  const result = JSON.parse(await tool.execute(
    { id: 'fastq-qc', inputs: { reads: ['sample.fastq.gz'] } },
    { signal: new AbortController().signal },
  ))
  assert.equal(result.preflight.status, 'pass')
  assert.equal(result.preflight.executionReady, false)
})
