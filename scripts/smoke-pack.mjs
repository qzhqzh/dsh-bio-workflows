import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-workflows-pack-smoke-'))
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

try {
  const cache = join(temporaryRoot, 'npm-cache')
  const packResult = JSON.parse(execFileSync(
    npmCommand,
    ['pack', '--json', '--pack-destination', temporaryRoot, '--cache', cache],
    { cwd: packageRoot, encoding: 'utf8' },
  ))
  assert.equal(packResult.length, 1)

  const tarball = join(temporaryRoot, packResult[0].filename)
  const consumer = join(temporaryRoot, 'consumer')
  await mkdir(consumer)
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2),
  )
  execFileSync(
    npmCommand,
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache, tarball],
    { cwd: consumer, encoding: 'utf8' },
  )

  const smokeProgram = `
    import assert from 'node:assert/strict'
    import * as plugin from 'dsh-bio-workflows'
    import { createWorkflowCatalog } from 'dsh-bio-workflows/catalog'
    import { MANIFEST_SCHEMA_VERSION } from 'dsh-bio-workflows/manifest'
    import metadata from 'dsh-bio-workflows/package.json' with { type: 'json' }
    import { preflightWorkflow } from 'dsh-bio-workflows/preflight'
    import schema from 'dsh-bio-workflows/schema/workflow-manifest.schema.json' with { type: 'json' }

    assert.equal(typeof createWorkflowCatalog, 'function')
    assert.equal(typeof preflightWorkflow, 'function')
    assert.equal(metadata.name, plugin.name)
    assert.equal(metadata.version, '0.3.1')
    assert.equal(schema.properties.schemaVersion.const, MANIFEST_SCHEMA_VERSION)

    const registered = []
    plugin.apply({ tools: { register: (tool) => registered.push(tool) } }, {
      manifests: [{
        schemaVersion: '1',
        id: 'fastq-qc',
        version: '1.0.0',
        name: 'FASTQ quality control',
        summary: 'Collect FASTQ quality metrics.',
        status: 'ready',
        engine: { name: 'nextflow', version: '24.04' },
        inputs: [{ id: 'reads', type: 'file', required: true, cardinality: 'many' }],
      }],
      environment: { engines: { nextflow: { available: true, version: '24.04' } } },
    })
    assert.deepEqual(
      registered.map((tool) => ({
        name: tool.name,
        parameters: tool.parameters,
        output: tool.output.schema,
      })),
      [
        {
          name: 'bio_workflows_info',
          parameters: { type: 'object', properties: {} },
          output: { type: 'string' },
        },
        {
          name: 'bio_workflows_list',
          parameters: {
            type: 'object',
            properties: {
              engine: { type: 'string', description: 'Optional exact engine name filter.' },
              status: { type: 'string', description: 'Optional exact status filter.' },
              tag: { type: 'string', description: 'Optional exact tag filter.' },
            },
          },
          output: { type: 'string' },
        },
        {
          name: 'bio_workflows_get',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Exact workflow manifest id.' },
            },
            required: ['id'],
          },
          output: { type: 'string' },
        },
        {
          name: 'bio_workflows_preflight',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Exact workflow manifest id.' },
              inputs: {
                type: 'object',
                additionalProperties: true,
                description: 'Input values keyed by manifest input id.',
              },
            },
            required: ['id', 'inputs'],
          },
          output: { type: 'string' },
        },
      ],
    )
    const result = JSON.parse(await registered.at(-1).execute(
      { id: 'fastq-qc', inputs: { reads: ['sample.fastq.gz'] } },
      { signal: new AbortController().signal },
    ))
    assert.equal(result.preflight.status, 'pass')
    assert.equal(result.preflight.executionReady, false)
  `
  execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', smokeProgram],
    { cwd: consumer, encoding: 'utf8' },
  )

  process.stdout.write(`packed install smoke passed: ${packResult[0].filename}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
