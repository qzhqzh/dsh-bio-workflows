import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  BIO_WDL_AUTHORING_SKILL,
  BIO_WDL_AUTHORING_SKILL_DESCRIPTION,
  BIO_WDL_AUTHORING_SKILL_NAME,
  registerBioWdlAuthoringSkill,
} from '../src/authoring-skill.js'

test('packaged authoring skill preserves the non-production authority boundary', async () => {
  const source = await readFile(
    new URL('../skills/bio-wdl-authoring/SKILL.md', import.meta.url),
    'utf8',
  )

  assert.match(source, new RegExp(`^---\\nname: ${BIO_WDL_AUTHORING_SKILL_NAME}\\n`))
  assert.match(source, new RegExp(`description: ${BIO_WDL_AUTHORING_SKILL_DESCRIPTION.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n---\\n`))
  assert.equal(BIO_WDL_AUTHORING_SKILL.name, BIO_WDL_AUTHORING_SKILL_NAME)
  assert.equal(BIO_WDL_AUTHORING_SKILL.description, BIO_WDL_AUTHORING_SKILL_DESCRIPTION)
  assert.deepEqual(BIO_WDL_AUTHORING_SKILL.invocation, {
    modelInvocable: true,
    userInvocable: true,
  })
  assert.match(BIO_WDL_AUTHORING_SKILL.content, /ready_for_isolated_test/)
  assert.match(BIO_WDL_AUTHORING_SKILL.content, /Software Trial Report v1\.success.*false/)
  assert.match(BIO_WDL_AUTHORING_SKILL.content, /Never substitute `bio_workflows_run`/)
  assert.doesNotMatch(BIO_WDL_AUTHORING_SKILL.content, /api[_-]?key|bearer token/i)
})

test('authoring skill registration is optional and contributes one immutable definition', () => {
  assert.equal(registerBioWdlAuthoringSkill(undefined), false)
  const definitions = []
  assert.equal(registerBioWdlAuthoringSkill({
    register: (definition) => definitions.push(definition),
  }), true)
  assert.deepEqual(definitions, [BIO_WDL_AUTHORING_SKILL])
  assert.equal(Object.isFrozen(definitions[0]), true)
})
