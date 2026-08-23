import {
  parseWorkflowManifest,
  validateWorkflowManifest,
} from './manifest.js'

function clone(value) {
  return structuredClone(value)
}

function compareIds(left, right) {
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}

function prefixManifestErrors(errors, index) {
  return errors.map((error) => ({
    ...error,
    path: `$[${index}]${error.path.slice(1)}`,
  }))
}

export class WorkflowCatalogValidationError extends Error {
  constructor(errors) {
    super(`invalid workflow catalog: ${errors.map((error) => `${error.path} ${error.message}`).join('; ')}`)
    this.name = 'WorkflowCatalogValidationError'
    this.errors = errors
  }
}

export function createWorkflowCatalog(manifests = []) {
  if (!Array.isArray(manifests)) {
    throw new WorkflowCatalogValidationError([
      { path: '$', code: 'type', message: 'catalog manifests must be an array' },
    ])
  }

  const errors = []
  const parsed = []
  const seenIds = new Map()

  manifests.forEach((manifest, index) => {
    const result = validateWorkflowManifest(manifest)
    if (!result.valid) {
      errors.push(...prefixManifestErrors(result.errors, index))
      return
    }

    const normalized = parseWorkflowManifest(manifest)
    if (seenIds.has(normalized.id)) {
      errors.push({
        path: `$[${index}].id`,
        code: 'duplicate',
        message: `duplicate workflow id: ${normalized.id}`,
      })
      return
    }
    seenIds.set(normalized.id, index)
    parsed.push(normalized)
  })

  if (errors.length > 0) throw new WorkflowCatalogValidationError(errors)

  parsed.sort(compareIds)
  const byId = new Map(parsed.map((manifest) => [manifest.id, manifest]))

  return Object.freeze({
    size: parsed.length,
    list(filters = {}) {
      const selected = parsed.filter((manifest) => {
        if (filters.engine !== undefined && manifest.engine.name !== filters.engine) return false
        if (filters.status !== undefined && manifest.status !== filters.status) return false
        if (filters.tag !== undefined && !manifest.tags.includes(filters.tag)) return false
        return true
      })

      return selected.map((manifest) => ({
        id: manifest.id,
        version: manifest.version,
        name: manifest.name,
        summary: manifest.summary,
        status: manifest.status,
        engine: clone(manifest.engine),
        tags: [...manifest.tags],
        inputCount: manifest.inputs.length,
        outputCount: manifest.outputs.length,
      }))
    },
    get(id) {
      const manifest = byId.get(id)
      return manifest === undefined ? null : clone(manifest)
    },
  })
}
