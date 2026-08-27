import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkflowStore } from '../src/workflow-store.js'
import {
  WORKFLOW_CENTER_API_PATH,
  createWorkflowCenterBootstrap,
  registerWorkflowCenterApi,
} from '../src/web-api.js'

function options() {
  return {
    workflowCount: 0,
    declaredEngineCount: 0,
    store: createWorkflowStore(),
    execution: () => ({
      enabled: false,
      configured: true,
      subprocessAvailable: true,
      jobsAvailable: true,
      supportedWorkflows: ['fastq-qc@1.2.0'],
    }),
    authoring: () => ({
      configured: true,
      writesEnabled: false,
      ownerScope: 'session',
      validator: { configured: true, subprocessAvailable: true, expectedVersion: '1.15.0' },
    }),
    autonomy: {
      configured: true,
      enabled: true,
      ownerScope: 'session',
      schemaVersion: '1',
      capabilities: { boundedDraftAuthoring: true, isolatedDraftTest: false },
      limits: { maxActions: 32 },
    },
  }
}

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body = '') { this.body = body },
  }
}

test('Workflow Center bootstrap exposes bounded public catalog facts but no owner data', async () => {
  const value = await createWorkflowCenterBootstrap(options())

  assert.equal(value.schemaVersion, '1')
  assert.equal(value.package.version, '0.11.0')
  assert.equal(value.workflows.length, 4)
  assert.equal(value.workflows.every((workflow) => workflow.source === 'builtin'), true)
  assert.equal(value.workflows.find((workflow) => workflow.id === 'fastq-qc' && workflow.version === '1.2.0').executionSupported, true)
  assert.equal(value.workflows.find((workflow) => workflow.id === 'bam-qc').executionSupported, false)
  assert.equal(value.readiness.miniwdlValidator, true)
  assert.equal(value.readiness.autonomousMissionAuthoring, true)
  assert.equal(value.readiness.isolatedSoftwareTrial, false)
  assert.equal(value.readiness.executionEnabled, false)
  assert.equal(value.privacy.ownerScopedDraftsViaAgent, true)
  assert.equal(value.privacy.ownerScopedMissionsViaAgent, true)
  assert.equal(value.privacy.ownerScopedRunsViaAgent, true)
  const serialized = JSON.stringify(value)
  assert.doesNotMatch(serialized, /ownerSession|draftId|runId|runsRoot|inputRoots/)
})

test('Workflow Center bootstrap never exposes configured local or draft catalog summaries', async () => {
  const configured = options()
  const store = configured.store
  configured.store = {
    ...store,
    async search() {
      const catalog = await store.search({})
      return {
        ...catalog,
        workflows: [
          ...catalog.workflows,
          {
            ...catalog.workflows[0],
            id: 'private-analysis',
            name: 'Private cohort workflow',
            summary: 'Sensitive local project name',
            source: 'draft',
          },
        ],
      }
    },
  }

  const value = await createWorkflowCenterBootstrap(configured)

  assert.equal(value.workflows.every((workflow) => workflow.source === 'builtin'), true)
  assert.doesNotMatch(JSON.stringify(value), /private-analysis|Private cohort|Sensitive local/)
})

test('Workflow Center bootstrap allowlists diagnostics and never exposes store paths or validation details', async () => {
  const configured = options()
  configured.store = {
    ...configured.store,
    async search() {
      return {
        workflows: [],
        diagnostics: [
          {
            code: 'store_path_unsafe',
            directory: '/etc/passwd',
            source: 'local',
            errors: [{ path: '$.secret', code: 'required', message: 'private validator detail' }],
          },
          { code: '/tmp/attacker-controlled', message: 'private message' },
          { code: 'toString', message: 'prototype method' },
          { code: '__proto__', message: 'prototype object' },
        ],
      }
    },
  }

  const value = await createWorkflowCenterBootstrap(configured)

  assert.deepEqual(value.diagnostics, [
    { code: 'store_path_unsafe', message: 'The configured local workflow store is unavailable.' },
    { code: 'catalog_diagnostic', message: 'A catalog entry could not be loaded.' },
    { code: 'catalog_diagnostic', message: 'A catalog entry could not be loaded.' },
    { code: 'catalog_diagnostic', message: 'A catalog entry could not be loaded.' },
  ])
  assert.doesNotMatch(JSON.stringify(value), /etc\/passwd|private|attacker|prototype|toString|__proto__|\$\.secret/)
})

test('Workflow Center API is optional, GET-only, same-origin, and no-store', async () => {
  let route
  const ctx = {
    inject(dependencies, callback) {
      assert.deepEqual(dependencies, ['webServer'])
      callback({
        webServer: { register(value) { route = value; return () => {} } },
        effect(factory) { return factory() },
      })
    },
  }
  registerWorkflowCenterApi(ctx, options())
  assert.equal(route.path, WORKFLOW_CENTER_API_PATH)

  const response = responseRecorder()
  await route.handler({
    method: 'GET',
    headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' },
  }, response)
  assert.equal(response.status, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(JSON.parse(response.body).schemaVersion, '1')

  const wrongMethod = responseRecorder()
  await route.handler({ method: 'POST', headers: {} }, wrongMethod)
  assert.equal(wrongMethod.status, 405)

  const crossSite = responseRecorder()
  await route.handler({ method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }, crossSite)
  assert.equal(crossSite.status, 403)

  const missingBrowserContext = responseRecorder()
  await route.handler({ method: 'GET', headers: {} }, missingBrowserContext)
  assert.equal(missingBrowserContext.status, 403)
})

test('Workflow Center API uses a fixed public error instead of exposing host failures', async () => {
  let route
  const configured = options()
  configured.store = {
    ...configured.store,
    async search() { throw new Error('private failure at /data/secret/workflows') },
  }
  registerWorkflowCenterApi({
    inject(_dependencies, callback) {
      callback({
        webServer: { register(value) { route = value; return () => {} } },
        effect(factory) { return factory() },
      })
    },
  }, configured)

  const response = responseRecorder()
  await route.handler({ method: 'GET', headers: { 'sec-fetch-site': 'same-origin' } }, response)

  assert.equal(response.status, 500)
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    error: {
      code: 'bootstrap_failed',
      message: 'Workflow Center bootstrap is temporarily unavailable.',
    },
  })
  assert.doesNotMatch(response.body, /private|\/data\/secret/)
})
