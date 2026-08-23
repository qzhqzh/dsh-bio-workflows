export const MANIFEST_SCHEMA_VERSION = '1'
export const WORKFLOW_STATUSES = Object.freeze(['draft', 'ready', 'deprecated'])
export const VALUE_TYPES = Object.freeze([
  'file',
  'directory',
  'string',
  'integer',
  'number',
  'boolean',
])
export const CARDINALITIES = Object.freeze(['one', 'many'])

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const TAG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'id',
  'version',
  'name',
  'summary',
  'status',
  'engine',
  'inputs',
  'outputs',
  'tags',
])
const ENGINE_KEYS = new Set(['name', 'version'])
const INPUT_KEYS = new Set(['id', 'type', 'required', 'cardinality', 'description'])
const OUTPUT_KEYS = new Set(['id', 'type', 'cardinality', 'description'])

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function addError(errors, path, code, message) {
  errors.push({ path, code, message })
}

function validateAllowedKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addError(errors, `${path}.${key}`, 'additional_property', `unsupported property: ${key}`)
    }
  }
}

function validateRequiredKeys(value, required, path, errors) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      addError(errors, `${path}.${key}`, 'required', 'property is required')
    }
  }
}

function validateString(value, path, errors, options = {}) {
  if (typeof value !== 'string') {
    addError(errors, path, 'type', 'must be a string')
    return
  }
  if (options.minLength !== undefined && value.length < options.minLength) {
    addError(errors, path, 'min_length', `must contain at least ${options.minLength} character(s)`)
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    addError(errors, path, 'max_length', `must contain at most ${options.maxLength} character(s)`)
  }
  if (options.pattern && !options.pattern.test(value)) {
    addError(errors, path, 'format', options.patternMessage)
  }
}

function validateEnum(value, values, path, errors) {
  if (!values.includes(value)) {
    addError(errors, path, 'enum', `must be one of: ${values.join(', ')}`)
  }
}

function validateEngine(value, errors) {
  const path = '$.engine'
  if (!isPlainObject(value)) {
    addError(errors, path, 'type', 'must be an object')
    return
  }

  validateAllowedKeys(value, ENGINE_KEYS, path, errors)
  validateRequiredKeys(value, ['name'], path, errors)
  if (Object.hasOwn(value, 'name')) {
    validateString(value.name, `${path}.name`, errors, {
      minLength: 1,
      maxLength: 64,
      pattern: IDENTIFIER_PATTERN,
      patternMessage: 'must be a lowercase engine identifier',
    })
  }
  if (Object.hasOwn(value, 'version')) {
    validateString(value.version, `${path}.version`, errors, {
      minLength: 1,
      maxLength: 128,
    })
  }
}

function validatePorts(value, kind, errors) {
  const path = `$.${kind}`
  if (!Array.isArray(value)) {
    addError(errors, path, 'type', 'must be an array')
    return
  }

  const input = kind === 'inputs'
  const allowedKeys = input ? INPUT_KEYS : OUTPUT_KEYS
  const requiredKeys = input ? ['id', 'type', 'required'] : ['id', 'type']
  const seen = new Set()

  value.forEach((port, index) => {
    const itemPath = `${path}[${index}]`
    if (!isPlainObject(port)) {
      addError(errors, itemPath, 'type', 'must be an object')
      return
    }

    validateAllowedKeys(port, allowedKeys, itemPath, errors)
    validateRequiredKeys(port, requiredKeys, itemPath, errors)

    if (Object.hasOwn(port, 'id')) {
      validateString(port.id, `${itemPath}.id`, errors, {
        minLength: 1,
        maxLength: 128,
        pattern: IDENTIFIER_PATTERN,
        patternMessage: 'must be a lowercase identifier',
      })
      if (typeof port.id === 'string') {
        if (seen.has(port.id)) {
          addError(errors, `${itemPath}.id`, 'duplicate', `duplicate ${kind} id: ${port.id}`)
        }
        seen.add(port.id)
      }
    }
    if (Object.hasOwn(port, 'type')) {
      if (typeof port.type !== 'string') {
        addError(errors, `${itemPath}.type`, 'type', 'must be a string')
      } else {
        validateEnum(port.type, VALUE_TYPES, `${itemPath}.type`, errors)
      }
    }
    if (input && Object.hasOwn(port, 'required') && typeof port.required !== 'boolean') {
      addError(errors, `${itemPath}.required`, 'type', 'must be a boolean')
    }
    if (Object.hasOwn(port, 'cardinality')) {
      if (typeof port.cardinality !== 'string') {
        addError(errors, `${itemPath}.cardinality`, 'type', 'must be a string')
      } else {
        validateEnum(port.cardinality, CARDINALITIES, `${itemPath}.cardinality`, errors)
      }
    }
    if (Object.hasOwn(port, 'description')) {
      validateString(port.description, `${itemPath}.description`, errors, {
        minLength: 1,
        maxLength: 1000,
      })
    }
  })
}

function validateTags(value, errors) {
  const path = '$.tags'
  if (!Array.isArray(value)) {
    addError(errors, path, 'type', 'must be an array')
    return
  }
  if (value.length > 32) {
    addError(errors, path, 'max_items', 'must contain at most 32 tags')
  }

  const seen = new Set()
  value.forEach((tag, index) => {
    const itemPath = `${path}[${index}]`
    validateString(tag, itemPath, errors, {
      minLength: 1,
      maxLength: 64,
      pattern: TAG_PATTERN,
      patternMessage: 'must be a lowercase tag identifier',
    })
    if (typeof tag === 'string') {
      if (seen.has(tag)) addError(errors, itemPath, 'duplicate', `duplicate tag: ${tag}`)
      seen.add(tag)
    }
  })
}

export function validateWorkflowManifest(value) {
  const errors = []
  if (!isPlainObject(value)) {
    addError(errors, '$', 'type', 'manifest must be an object')
    return { valid: false, errors }
  }

  validateAllowedKeys(value, MANIFEST_KEYS, '$', errors)
  validateRequiredKeys(
    value,
    ['schemaVersion', 'id', 'version', 'name', 'summary', 'status', 'engine'],
    '$',
    errors,
  )

  if (Object.hasOwn(value, 'schemaVersion')) {
    if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
      addError(
        errors,
        '$.schemaVersion',
        'const',
        `must equal ${MANIFEST_SCHEMA_VERSION}`,
      )
    }
  }
  if (Object.hasOwn(value, 'id')) {
    validateString(value.id, '$.id', errors, {
      minLength: 1,
      maxLength: 128,
      pattern: IDENTIFIER_PATTERN,
      patternMessage: 'must be a lowercase workflow identifier',
    })
  }
  if (Object.hasOwn(value, 'version')) {
    validateString(value.version, '$.version', errors, {
      minLength: 1,
      maxLength: 128,
      pattern: SEMVER_PATTERN,
      patternMessage: 'must be a semantic version',
    })
  }
  if (Object.hasOwn(value, 'name')) {
    validateString(value.name, '$.name', errors, { minLength: 1, maxLength: 160 })
  }
  if (Object.hasOwn(value, 'summary')) {
    validateString(value.summary, '$.summary', errors, { minLength: 1, maxLength: 1000 })
  }
  if (Object.hasOwn(value, 'status')) {
    if (typeof value.status !== 'string') {
      addError(errors, '$.status', 'type', 'must be a string')
    } else {
      validateEnum(value.status, WORKFLOW_STATUSES, '$.status', errors)
    }
  }
  if (Object.hasOwn(value, 'engine')) validateEngine(value.engine, errors)
  if (Object.hasOwn(value, 'inputs')) validatePorts(value.inputs, 'inputs', errors)
  if (Object.hasOwn(value, 'outputs')) validatePorts(value.outputs, 'outputs', errors)
  if (Object.hasOwn(value, 'tags')) validateTags(value.tags, errors)

  return { valid: errors.length === 0, errors }
}

export class WorkflowManifestValidationError extends Error {
  constructor(errors) {
    super(`invalid workflow manifest: ${errors.map((error) => `${error.path} ${error.message}`).join('; ')}`)
    this.name = 'WorkflowManifestValidationError'
    this.errors = errors
  }
}

function normalizePort(port, input) {
  return {
    id: port.id,
    type: port.type,
    ...(input ? { required: port.required } : {}),
    cardinality: port.cardinality ?? 'one',
    ...(port.description === undefined ? {} : { description: port.description }),
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}

export function parseWorkflowManifest(value) {
  const result = validateWorkflowManifest(value)
  if (!result.valid) throw new WorkflowManifestValidationError(result.errors)

  return deepFreeze({
    schemaVersion: value.schemaVersion,
    id: value.id,
    version: value.version,
    name: value.name,
    summary: value.summary,
    status: value.status,
    engine: {
      name: value.engine.name,
      ...(value.engine.version === undefined ? {} : { version: value.engine.version }),
    },
    inputs: (value.inputs ?? []).map((port) => normalizePort(port, true)),
    outputs: (value.outputs ?? []).map((port) => normalizePort(port, false)),
    tags: [...(value.tags ?? [])],
  })
}
