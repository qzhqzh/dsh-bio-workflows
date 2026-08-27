import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { validateBioWorkflowResultSemantics } from '../src/execution.js'
import { DRAFT_LIMITS, DRAFT_SCHEMA_VERSION } from '../src/draft-store.js'
import { DRAFT_VALIDATION_SCHEMA_VERSION } from '../src/draft-validation.js'
import {
  FAILURE_EVIDENCE_SCHEMA_VERSION,
  MISSION_DEFAULT_LIMITS,
  MISSION_SCHEMA_VERSION,
  SOFTWARE_TRIAL_REPORT_SCHEMA_VERSION,
} from '../src/mission-store.js'
import { WORKFLOW_GRAPH_LIMITS, WORKFLOW_GRAPH_SCHEMA_VERSION } from '../src/workflow-graph.js'
import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  TOOL_NAME,
  getPackageInfo,
  registerInfoTool,
} from '../src/info.js'
import { defineTool } from '../src/tool-definition.js'

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)

test('package metadata matches the runtime identity', () => {
  assert.equal(packageJson.name, PACKAGE_NAME)
  assert.equal(packageJson.version, PACKAGE_VERSION)
  assert.equal(packageJson.dsh.engines.dsh, '>=0.1.1-rc.2 <0.2.0')
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.dependencies, undefined)
  assert.equal(packageJson.devDependencies['@deepseek-ai/cordis'], '4.0.1')
  assert.equal(packageJson.devDependencies['@deepseek-ai/dsh-tools'], '0.1.1-rc.2')
  assert.equal(packageJson.peerDependencies.react, '^18.2.0')
  assert.equal(packageJson.publishConfig.registry, 'https://registry.npmjs.org/')
  assert.equal(packageJson.exports['./catalog'], './src/catalog.js')
  assert.equal(packageJson.exports['./draft-store'], './src/draft-store.js')
  assert.equal(packageJson.exports['./draft-validation'], './src/draft-validation.js')
  assert.equal(packageJson.exports['./mission-store'], './src/mission-store.js')
  assert.equal(packageJson.exports['./workflow-graph'], './src/workflow-graph.js')
  assert.equal(packageJson.exports['./client'], './lib/client.js')
  assert.equal(packageJson.exports['./execution'], './src/execution.js')
  assert.equal(packageJson.exports['./manifest'], './src/manifest.js')
  assert.equal(packageJson.exports['./preflight'], './src/preflight.js')
  assert.equal(packageJson.exports['./store'], './src/workflow-store.js')
  assert.equal(packageJson.exports['./wdl-bundle'], './src/wdl-bundle.js')
  assert.equal(
    packageJson.exports['./schema/workflow-manifest.schema.json'],
    './schema/workflow-manifest.schema.json',
  )
  assert.equal(
    packageJson.exports['./schema/wdl-bundle.schema.json'],
    './schema/wdl-bundle.schema.json',
  )
  assert.equal(
    packageJson.exports['./schema/bio-workflow-result.schema.json'],
    './schema/bio-workflow-result.schema.json',
  )
  assert.equal(
    packageJson.exports['./schema/wdl-draft-revision.schema.json'],
    './schema/wdl-draft-revision.schema.json',
  )
  assert.equal(
    packageJson.exports['./schema/draft-validation-evidence.schema.json'],
    './schema/draft-validation-evidence.schema.json',
  )
  assert.equal(
    packageJson.exports['./schema/workflow-graph.schema.json'],
    './schema/workflow-graph.schema.json',
  )
  assert.equal(
    packageJson.exports['./schema/mission.schema.json'],
    './schema/mission.schema.json',
  )
  assert.equal(
    packageJson.exports['./schema/failure-evidence.schema.json'],
    './schema/failure-evidence.schema.json',
  )
  assert.equal(
    packageJson.exports['./schema/software-trial-report.schema.json'],
    './schema/software-trial-report.schema.json',
  )
  assert.ok(packageJson.files.includes('workflows/'))
  assert.ok(packageJson.files.includes('lib/'))
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.equal(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-tool'), true)
})

test('BioWorkflowResult v1 schema exposes checksummed artifacts and FastQC summaries', async () => {
  const schema = JSON.parse(await readFile(
    new URL('../schema/bio-workflow-result.schema.json', import.meta.url),
    'utf8',
  ))
  const example = JSON.parse(await readFile(
    new URL('../docs/examples/bio-workflow-result-v1.json', import.meta.url),
    'utf8',
  ))

  assert.equal(schema.properties.schemaVersion.const, '1')
  assert.equal(schema.properties.status.const, 'completed')
  assert.equal(schema.$defs.artifact.properties.sha256.$ref, '#/$defs/digest')
  assert.equal(schema.$defs.artifact.properties.sizeBytes.$ref, '#/$defs/byteCount')
  assert.deepEqual(schema.$defs.fastqcModule.properties.status.enum, ['pass', 'warn', 'fail'])
  assert.equal(schema.$defs.fastqcSummary.properties.reports.maxItems, 1024)
  assert.equal(example.schemaVersion, schema.properties.schemaVersion.const)
  assert.match(example.workflow.bundleDigest, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(example.artifacts.map((group) => group.outputId), [
    'html_reports',
    'zip_reports',
    'summary_reports',
  ])
  assert.equal(example.artifacts[0].items[0].ordinal, 0)
  assert.match(example.artifacts[0].items[0].sha256, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(example.summaries.fastqc.moduleCounts, { pass: 1, warn: 1, fail: 1 })
  assert.deepEqual(validateBioWorkflowResultSemantics(example), { valid: true, errors: [] })
})

test('draft revision and validation evidence schemas match runtime contract versions and limits', async () => {
  const revisionSchema = JSON.parse(await readFile(
    new URL('../schema/wdl-draft-revision.schema.json', import.meta.url),
    'utf8',
  ))
  const validationSchema = JSON.parse(await readFile(
    new URL('../schema/draft-validation-evidence.schema.json', import.meta.url),
    'utf8',
  ))

  assert.equal(revisionSchema.properties.schemaVersion.const, DRAFT_SCHEMA_VERSION)
  assert.equal(revisionSchema.properties.files.maxItems, DRAFT_LIMITS.maxFiles)
  assert.equal(revisionSchema.properties.files['x-maxAggregateUtf8Bytes'], DRAFT_LIMITS.maxTotalBytes)
  assert.equal(revisionSchema.properties.revision.maximum, DRAFT_LIMITS.maxRevisions)
  assert.equal(revisionSchema.$defs.file.properties.content['x-maxUtf8Bytes'], DRAFT_LIMITS.maxFileBytes)
  const safePath = new RegExp(revisionSchema.$defs.file.properties.path.pattern)
  assert.equal(safePath.test('tasks/qc.wdl'), true)
  for (const hostile of ['/absolute.wdl', '../escape.wdl', 'tasks/../escape.wdl', 'tasks\\qc.wdl', 'nul\0.wdl']) {
    assert.equal(safePath.test(hostile), false, hostile)
  }
  assert.match(revisionSchema.$comment, /UTF-8 byte budgets/)
  assert.equal(validationSchema.properties.schemaVersion.const, DRAFT_VALIDATION_SCHEMA_VERSION)
  assert.equal(validationSchema.properties.diagnostics.maxItems, 128)
  assert.equal(validationSchema.properties.containerImages.maxItems, 128)
  assert.equal(validationSchema.properties.containerImages.uniqueItems, true)
  assert.equal(validationSchema.properties.containerPolicy.additionalProperties, false)
  assert.equal(validationSchema.properties.executionAuthorized.const, false)
})

test('WorkflowGraph v1 schema matches runtime limits and keeps layout non-authoritative', async () => {
  const schema = JSON.parse(await readFile(
    new URL('../schema/workflow-graph.schema.json', import.meta.url),
    'utf8',
  ))

  assert.equal(schema.properties.schemaVersion.const, WORKFLOW_GRAPH_SCHEMA_VERSION)
  assert.equal(schema.properties.nodes.maxItems, WORKFLOW_GRAPH_LIMITS.maxNodes)
  assert.equal(schema.properties.edges.maxItems, WORKFLOW_GRAPH_LIMITS.maxEdges)
  assert.equal(schema.properties.diagnostics.maxItems, WORKFLOW_GRAPH_LIMITS.maxDiagnostics)
  assert.equal(schema.properties.executionAuthorized.const, false)
  assert.equal(schema.properties.layout, undefined)
})

test('Mission, failure evidence, and software trial report schemas preserve the authoring-only boundary', async () => {
  const mission = JSON.parse(await readFile(
    new URL('../schema/mission.schema.json', import.meta.url),
    'utf8',
  ))
  const failure = JSON.parse(await readFile(
    new URL('../schema/failure-evidence.schema.json', import.meta.url),
    'utf8',
  ))
  const report = JSON.parse(await readFile(
    new URL('../schema/software-trial-report.schema.json', import.meta.url),
    'utf8',
  ))

  assert.equal(mission.properties.schemaVersion.const, MISSION_SCHEMA_VERSION)
  assert.equal(mission.properties.status.enum.includes('ready'), true)
  assert.equal(
    mission.$defs.policy.properties.maxActions.maximum,
    64,
  )
  assert.equal(MISSION_DEFAULT_LIMITS.maxSameFailureFingerprint, 3)
  assert.equal(mission.properties.capabilities.properties.isolatedDraftTest.const, false)
  assert.equal(mission.properties.capabilities.properties.productionExecution.const, false)
  assert.equal(mission.properties.automaticRetryAfterRestart.const, false)
  assert.equal(failure.properties.schemaVersion.const, FAILURE_EVIDENCE_SCHEMA_VERSION)
  assert.equal(report.properties.schemaVersion.const, SOFTWARE_TRIAL_REPORT_SCHEMA_VERSION)
  assert.equal(report.properties.success.const, false)
  assert.equal(report.properties.readiness.properties.isolatedTestCompleted.const, false)
})

test('the foundation package has no install lifecycle scripts', () => {
  assert.equal(packageJson.scripts.preinstall, undefined)
  assert.equal(packageJson.scripts.install, undefined)
  assert.equal(packageJson.scripts.postinstall, undefined)
  assert.equal(packageJson.scripts.prepare, undefined)
  assert.equal(packageJson.scripts.prepack, 'npm run build')
})

test('the checked-in Client bundle source map matches every current Client source', async () => {
  const mapUrl = new URL('../lib/client.js.map', import.meta.url)
  const sourceMap = JSON.parse(await readFile(mapUrl, 'utf8'))

  assert.equal(sourceMap.sources.length, 7)
  assert.equal(sourceMap.sources.length, sourceMap.sourcesContent.length)
  for (const [index, source] of sourceMap.sources.entries()) {
    assert.match(source, /^\.\.\/src\/client\//)
    assert.equal(
      sourceMap.sourcesContent[index],
      await readFile(new URL(source, mapUrl), 'utf8'),
      source,
    )
  }
})

test('the bundle patch installs the expected package', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

  assert.match(patch, /id: bio-workflows/)
  assert.match(patch, /name: dsh-bio-workflows/)
  assert.match(patch, /manifests: \[\]/)
  assert.match(patch, /engines: \{\}/)
  assert.match(patch, /writeEnabled: false/)
  assert.match(patch, /authoring:/)
  assert.match(patch, /expectedVersion: 1\.15\.0/)
  assert.match(patch, /autonomy:/)
  assert.match(patch, /execution:/)
  assert.match(patch, /enabled: false/)
})

test('the info tool is read-only and registers once', async () => {
  const registered = []
  const ctx = {
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }
  const tool = registerInfoTool(ctx, defineTool, 3, 2)
  const result = JSON.parse(await tool.execute({}))

  assert.equal(registered.length, 1)
  assert.equal(registered[0], tool)
  assert.equal(tool.name, TOOL_NAME)
  assert.deepEqual(tool.parameters, { type: 'object', properties: {} })
  assert.deepEqual(tool.output.schema, { type: 'string' })
  assert.deepEqual(tool.output.render({}, 'ready'), [{ type: 'text', text: 'ready' }])
  assert.equal(tool.isConcurrencySafe({}), true)
  assert.deepEqual(result, getPackageInfo(3, 2))
  assert.equal(result.readOnly, true)
  assert.equal(result.status, 'preview')
  assert.equal(result.phase, 'workflow-center')
  assert.equal(result.workflowCount, 3)
  assert.equal(result.declaredEngineCount, 2)
  assert.deepEqual(result.store, {
    builtinWorkflowCount: 0,
    localStoreConfigured: false,
    writesEnabled: false,
  })
  assert.deepEqual(result.execution, {
    enabled: false,
    configured: false,
    subprocessAvailable: false,
    jobsAvailable: false,
    supportedWorkflows: [],
  })
  assert.deepEqual(result.authoring, {
    configured: false,
    writesEnabled: false,
    ownerScope: 'session',
    validator: {
      configured: false,
      subprocessAvailable: false,
      expectedVersion: null,
      policyVersion: null,
    },
  })
  assert.deepEqual(result.autonomy, {
    configured: false,
    enabled: false,
    ownerScope: 'session',
    schemaVersion: null,
    capabilities: {},
    limits: {},
  })
  assert.equal(result.capabilities.workflowCatalog, true)
  assert.equal(result.capabilities.manifestValidation, true)
  assert.equal(result.capabilities.preflightValidation, true)
  assert.equal(result.capabilities.workflowStore, true)
  assert.equal(result.capabilities.wdlBundleValidation, true)
  assert.equal(result.capabilities.workflowInstallation, false)
  assert.equal(result.capabilities.workflowScaffolding, false)
  assert.equal(result.capabilities.revisionedDraftAuthoring, true)
  assert.equal(result.capabilities.draftCompareAndSwap, true)
  assert.equal(result.capabilities.deterministicDraftValidation, false)
  assert.equal(result.capabilities.deterministicWorkflowGraph, true)
  assert.equal(result.capabilities.boundedAutonomousDraftAuthoring, false)
  assert.equal(result.capabilities.autonomousWdlValidationRepair, false)
  assert.equal(result.capabilities.isolatedSoftwareTrial, false)
  assert.equal(result.capabilities.autonomousProductionExecution, false)
  assert.equal(result.capabilities.nativeWorkflowCenter, true)
  assert.equal(result.capabilities.workflowExecution, false)
  assert.equal(result.capabilities.liveExecutionPlanning, false)
  assert.equal(result.capabilities.backgroundJobLifecycle, false)
  assert.equal(result.capabilities.provenanceReporting, false)
  assert.equal(result.capabilities.durableRunHistory, false)
  assert.equal(result.capabilities.normalizedWorkflowResults, false)
  assert.equal(result.capabilities.outputChecksums, false)
  assert.equal(result.capabilities.fastqcSummaries, false)
})

test('the info tool reports explicitly enabled local store mutations', async () => {
  const info = getPackageInfo(0, 0, {
    builtinWorkflowCount: 2,
    localStoreConfigured: true,
    writesEnabled: true,
  })

  assert.equal(info.readOnly, false)
  assert.equal(info.store.builtinWorkflowCount, 2)
  assert.equal(info.capabilities.workflowInstallation, true)
  assert.equal(info.capabilities.workflowScaffolding, true)
  assert.equal(info.capabilities.workflowExecution, false)
})

test('the info tool separates execution configuration from live service readiness', () => {
  const info = getPackageInfo(0, 0, {}, {
    enabled: true,
    configured: true,
    subprocessAvailable: true,
    jobsAvailable: false,
    supportedWorkflows: ['fastq-qc@1.1.0', 'fastq-qc@1.2.0'],
  })

  assert.equal(info.readOnly, false)
  assert.equal(info.execution.enabled, true)
  assert.equal(info.execution.jobsAvailable, false)
  assert.deepEqual(info.execution.supportedWorkflows, ['fastq-qc@1.1.0', 'fastq-qc@1.2.0'])
  assert.equal(info.capabilities.liveExecutionPlanning, true)
  assert.equal(info.capabilities.workflowExecution, false)
  assert.equal(info.capabilities.provenanceReporting, true)
  assert.equal(info.capabilities.durableRunHistory, true)
  assert.equal(info.capabilities.normalizedWorkflowResults, true)
  assert.equal(info.capabilities.outputChecksums, true)
  assert.equal(info.capabilities.fastqcSummaries, true)
})

test('the info tool reports bounded Mission authoring without implying isolated execution', () => {
  const info = getPackageInfo(
    0,
    0,
    {},
    {},
    { validator: { subprocessAvailable: true } },
    {
      configured: true,
      enabled: true,
      ownerScope: 'session',
      schemaVersion: MISSION_SCHEMA_VERSION,
      capabilities: { boundedDraftAuthoring: true, isolatedDraftTest: false },
      limits: MISSION_DEFAULT_LIMITS,
    },
  )

  assert.equal(info.autonomy.enabled, true)
  assert.equal(info.capabilities.boundedAutonomousDraftAuthoring, true)
  assert.equal(info.capabilities.autonomousWdlValidationRepair, true)
  assert.equal(info.capabilities.isolatedSoftwareTrial, false)
  assert.equal(info.capabilities.autonomousProductionExecution, false)
})
