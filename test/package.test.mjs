import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  TOOL_NAME,
  getPackageInfo,
  registerInfoTool,
} from '../src/info.js'

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)

test('package metadata matches the runtime identity', () => {
  assert.equal(packageJson.name, PACKAGE_NAME)
  assert.equal(packageJson.version, PACKAGE_VERSION)
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.dependencies, undefined)
  assert.equal(packageJson.devDependencies, undefined)
  assert.equal(packageJson.peerDependencies, undefined)
  assert.equal(packageJson.publishConfig.registry, 'https://registry.npmjs.org/')
  assert.equal(packageJson.exports['./catalog'], './src/catalog.js')
  assert.equal(packageJson.exports['./manifest'], './src/manifest.js')
  assert.equal(packageJson.exports['./preflight'], './src/preflight.js')
  assert.equal(
    packageJson.exports['./schema/workflow-manifest.schema.json'],
    './schema/workflow-manifest.schema.json',
  )
})

test('the foundation package has no install lifecycle scripts', () => {
  assert.equal(packageJson.scripts.preinstall, undefined)
  assert.equal(packageJson.scripts.install, undefined)
  assert.equal(packageJson.scripts.postinstall, undefined)
  assert.equal(packageJson.scripts.prepare, undefined)
})

test('the bundle patch installs the expected package', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

  assert.match(patch, /id: bio-workflows/)
  assert.match(patch, /name: dsh-bio-workflows/)
  assert.match(patch, /manifests: \[\]/)
  assert.match(patch, /engines: \{\}/)
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
  const tool = registerInfoTool(ctx, 3, 2)
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
  assert.equal(result.workflowCount, 3)
  assert.equal(result.declaredEngineCount, 2)
  assert.equal(result.capabilities.workflowCatalog, true)
  assert.equal(result.capabilities.manifestValidation, true)
  assert.equal(result.capabilities.preflightValidation, true)
  assert.equal(result.capabilities.workflowExecution, false)
})
