import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { validateBioWorkflowResultSemantics } from '../src/execution.js'
import { DRAFT_LIMITS, DRAFT_SCHEMA_VERSION } from '../src/draft-store.js'
import {
  DRAFT_TEST_EVIDENCE_SCHEMA_VERSION,
  DRAFT_TEST_PLAN_SCHEMA_VERSION,
} from '../src/draft-test-contract.js'
import { DRAFT_VALIDATION_SCHEMA_VERSION } from '../src/draft-validation.js'
import { FIXTURE_BUNDLE_SCHEMA_VERSION } from '../src/fixture-bundle.js'
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
  assert.equal(packageJson.exports['./authoring-skill'], './src/authoring-skill.js')
  assert.equal(packageJson.exports['./catalog'], './src/catalog.js')
  assert.equal(packageJson.exports['./draft-store'], './src/draft-store.js')
  assert.equal(packageJson.exports['./draft-test-contract'], './src/draft-test-contract.js')
  assert.equal(packageJson.exports['./draft-test-manager'], './src/draft-test-manager.js')
  assert.equal(packageJson.exports['./draft-validation'], './src/draft-validation.js')
  assert.equal(packageJson.exports['./fixture-assertions'], './src/fixture-assertions.js')
  assert.equal(packageJson.exports['./fixture-bundle'], './src/fixture-bundle.js')
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
  assert.equal(
    packageJson.exports['./schema/fixture-bundle.schema.json'],
    './schema/fixture-bundle.schema.json',
  )
  assert.equal(
    packageJson.exports['./schema/draft-test-plan.schema.json'],
    './schema/draft-test-plan.schema.json',
  )
  assert.equal(
    packageJson.exports['./schema/draft-test-evidence.schema.json'],
    './schema/draft-test-evidence.schema.json',
  )
  assert.ok(packageJson.files.includes('workflows/'))
  assert.ok(packageJson.files.includes('fixtures/'))
  assert.ok(packageJson.files.includes('requirements/'))
  assert.ok(packageJson.files.includes('runner/dsh_fixture_runner.py'))
  assert.ok(packageJson.files.includes('skills/'))
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

test('isolated draft-test schemas and built-in fixture preserve separate false production authority', async () => {
  const [fixtureSchema, planSchema, evidenceSchema, fixture] = await Promise.all([
    readFile(new URL('../schema/fixture-bundle.schema.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../schema/draft-test-plan.schema.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../schema/draft-test-evidence.schema.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../fixtures/text-roundtrip/1.0.0/fixture.json', import.meta.url), 'utf8').then(JSON.parse),
  ])

  assert.equal(fixtureSchema.properties.schemaVersion.const, FIXTURE_BUNDLE_SCHEMA_VERSION)
  assert.match(fixtureSchema.$id, /dsh-bio-workflows@0\.12\.0/)
  assert.equal(fixtureSchema.$defs.jsonValue['x-maxDepth'], 16)
  assert.equal(fixtureSchema.$defs.jsonValue['x-maxNodes'], 4096)
  assert.deepEqual(fixtureSchema.properties.assertions.items.oneOf.map((item) => item.$ref), [
    '#/$defs/valueAssertion',
    '#/$defs/fileAssertion',
  ])
  assert.equal(planSchema.properties.schemaVersion.const, DRAFT_TEST_PLAN_SCHEMA_VERSION)
  assert.match(planSchema.$id, /dsh-bio-workflows@0\.12\.0/)
  assert.equal(planSchema.$defs.runnerIdentity.additionalProperties, false)
  assert.equal(planSchema.$defs.controllerNetwork.additionalProperties, false)
  assert.equal(planSchema.$defs.controllerNetwork.properties.policy.const, 'seccomp_deny_non_unix_sockets_before_wdl_load')
  assert.equal(planSchema.$defs.controllerNetwork.properties.noNewPrivileges.const, true)
  assert.equal(planSchema.$defs.authorization.properties.productionExecution.const, false)
  assert.equal(planSchema.$defs.authorization.properties.workflowPromotion.const, false)
  assert.equal(planSchema.$defs.authorization.properties.productionAllowlistMutation.const, false)
  assert.equal(evidenceSchema.properties.schemaVersion.const, DRAFT_TEST_EVIDENCE_SCHEMA_VERSION)
  assert.match(evidenceSchema.$id, /dsh-bio-workflows@0\.12\.0/)
  assert.equal(evidenceSchema.required.includes('resources'), true)
  assert.equal(evidenceSchema.required.includes('evidenceDigest'), true)
  assert.equal(evidenceSchema.$defs.capabilities.properties.productionExecution.const, false)
  assert.equal(evidenceSchema.$defs.capabilities.properties.workflowPromotion.const, false)
  assert.equal(evidenceSchema.$defs.containerFact.required.includes('imageId'), true)
  assert.equal(evidenceSchema.$defs.containerFact.required.includes('containerControls'), true)
  assert.equal(evidenceSchema.$defs.containerControls.properties.networkMode.const, 'none')
  assert.equal(evidenceSchema.$defs.containerControls.properties.readonlyRootfs.const, true)
  assert.equal(evidenceSchema.$defs.containerControls.properties.environment.maxProperties, 133)
  assert.equal(evidenceSchema.$defs.containerControls.properties.environment.additionalProperties.const, '')
  assert.equal(evidenceSchema.$defs.controllerEvidence.properties.network.properties.kernelEnforced.const, true)
  assert.equal(evidenceSchema.$defs.assertionResult.additionalProperties, false)
  assert.equal(evidenceSchema.$defs.assertionResult.allOf.length, 1)
  assert.equal(evidenceSchema.$defs.containerControls.properties.mounts.items.$ref, '#/$defs/mountControl')
  assert.equal(evidenceSchema.$defs.mountControl.properties.source, undefined)
  assert.equal(fixture.schemaVersion, FIXTURE_BUNDLE_SCHEMA_VERSION)
  assert.equal(fixture.assertions.every((assertion) => ['value_equals', 'file_digest'].includes(assertion.kind)), true)
})

test('retained fixture-runner evidence is bound to every current acceptance source', async () => {
  const evidence = JSON.parse(await readFile(
    new URL('../docs/evidence/dsh-bio-workflows-0.12.0-fixture-runner.json', import.meta.url),
    'utf8',
  ))
  const expectedSources = [
    'fixtures/text-roundtrip/1.0.0/fixture.json',
    'fixtures/text-roundtrip/1.0.0/inputs/message.txt',
    'index.js',
    'requirements/miniwdl-1.15.0.txt',
    'runner/dsh_fixture_runner.py',
    'schema/draft-test-evidence.schema.json',
    'schema/draft-test-plan.schema.json',
    'schema/fixture-bundle.schema.json',
    'scripts/accept-draft-fixture-restart-child.mjs',
    'scripts/accept-draft-fixture-runner.mjs',
    'src/draft-test-contract.js',
    'src/draft-test-manager.js',
    'src/draft-test-tools.js',
    'src/fixture-assertions.js',
    'src/fixture-bundle.js',
  ]

  assert.deepEqual(Object.keys(evidence.sourceSha256).sort(), expectedSources.toSorted())
  for (const path of expectedSources) {
    const source = await readFile(new URL(`../${path}`, import.meta.url))
    const actual = createHash('sha256').update(source).digest('hex')
    assert.equal(evidence.sourceSha256[path], actual, path)
  }
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
  assert.match(patch, /providers: \[\]/)
  assert.match(patch, /authoring:/)
  assert.match(patch, /expectedVersion: 1\.15\.0/)
  assert.match(patch, /autonomy:/)
  assert.match(patch, /draftTesting:/)
  assert.match(patch, /execution:/)
  assert.match(patch, /inputChecksum: metadata/)
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
    providers: [],
  })
  assert.deepEqual(result.execution, {
    enabled: false,
    configured: false,
    subprocessAvailable: false,
    jobsAvailable: false,
    supportedWorkflows: [],
    policy: {
      inputChecksum: 'metadata',
      networkIsolation: { mode: 'advisory' },
      budgets: {},
      retention: { enabled: false },
    },
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
  assert.equal(result.capabilities.readOnlyWorkflowProviders, false)
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
  assert.equal(result.capabilities.preApprovalInputChecksums, false)
  assert.equal(result.capabilities.containerEgressIsolation, false)
  assert.equal(result.capabilities.approvedRunRetentionCleanup, false)
})

test('the info tool reports read-only providers and enabled execution hardening', () => {
  const info = getPackageInfo(
    0,
    0,
    {
      providers: [{
        id: 'git-main',
        kind: 'git',
        revision: 'a'.repeat(40),
        root: '/private/provider',
        readOnly: true,
      }],
    },
    {
      enabled: true,
      policy: {
        inputChecksum: 'sha256',
        networkIsolation: { mode: 'ephemeral_internal' },
        budgets: { maxRunStorageBytes: 4096 },
        retention: { enabled: true, minimumAgeDays: 30 },
      },
    },
  )

  assert.deepEqual(info.store.providers, [{
    id: 'git-main',
    kind: 'git',
    revision: 'a'.repeat(40),
    readOnly: true,
  }])
  assert.equal(JSON.stringify(info).includes('/private/provider'), false)
  assert.equal(info.capabilities.readOnlyWorkflowProviders, true)
  assert.equal(info.capabilities.preApprovalInputChecksums, true)
  assert.equal(info.capabilities.containerEgressIsolation, true)
  assert.equal(info.capabilities.approvedRunRetentionCleanup, true)
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

test('the info tool reports isolated fixture readiness without implying production authority', () => {
  const info = getPackageInfo(
    0,
    0,
    {},
    {},
    {},
    {},
    {
      configured: true,
      enabled: true,
      subprocessAvailable: true,
      jobsAvailable: true,
      preflightVerified: true,
      ready: true,
      capabilities: {
        isolatedDraftTest: true,
        productionExecution: false,
        workflowPromotion: false,
      },
    },
  )

  assert.equal(info.draftTesting.ready, true)
  assert.equal(info.capabilities.isolatedSoftwareTrial, true)
  assert.equal(info.capabilities.autonomousProductionExecution, false)
  assert.equal(info.draftTesting.capabilities.productionExecution, false)
  assert.equal(info.draftTesting.capabilities.workflowPromotion, false)
})
