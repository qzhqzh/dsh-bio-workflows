import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const BIO_WDL_AUTHORING_SKILL_NAME = 'bio-wdl-authoring'
export const BIO_WDL_AUTHORING_SKILL_DESCRIPTION =
  'Author or repair reviewable WDL drafts through dsh-bio-workflows deterministic, revision-bound tools. Use for bioinformatics workflow drafting, validation repair, graph inspection, Mission authoring, or an explicitly requested isolated fixture trial.'

const skillUrl = new URL('../skills/bio-wdl-authoring/SKILL.md', import.meta.url)
const skillFile = readFileSync(skillUrl, 'utf8')
const frontmatterEnd = skillFile.indexOf('\n---\n', 4)

if (!skillFile.startsWith('---\n') || frontmatterEnd === -1) {
  throw new Error('packaged bio-wdl-authoring skill has invalid frontmatter')
}

const content = skillFile.slice(frontmatterEnd + 5).trim()

export const BIO_WDL_AUTHORING_SKILL = Object.freeze({
  name: BIO_WDL_AUTHORING_SKILL_NAME,
  description: BIO_WDL_AUTHORING_SKILL_DESCRIPTION,
  content,
  invocation: Object.freeze({ modelInvocable: true, userInvocable: true }),
  source: 'bundled',
  resourceBase: Object.freeze({
    kind: 'directory',
    path: fileURLToPath(new URL('../skills/bio-wdl-authoring/', import.meta.url)),
  }),
})

export function registerBioWdlAuthoringSkill(skills) {
  if (typeof skills?.register !== 'function') return false
  skills.register(BIO_WDL_AUTHORING_SKILL)
  return true
}
