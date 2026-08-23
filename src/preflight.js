import { parseWorkflowManifest } from './manifest.js'

export const PREFLIGHT_STATUSES = Object.freeze(['pass', 'fail', 'incomplete'])

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const ENVIRONMENT_KEYS = new Set(['engines'])
const ENGINE_KEYS = new Set(['available', 'version'])

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}

function addError(errors, path, code, message) {
  errors.push({ path, code, message })
}

export class PreflightEnvironmentValidationError extends Error {
  constructor(errors) {
    super(`invalid preflight environment: ${errors.map((error) => `${error.path} ${error.message}`).join('; ')}`)
    this.name = 'PreflightEnvironmentValidationError'
    this.errors = errors
  }
}

export function parsePreflightEnvironment(value = {}) {
  const errors = []
  if (!isPlainObject(value)) {
    throw new PreflightEnvironmentValidationError([
      { path: '$', code: 'type', message: 'environment must be an object' },
    ])
  }

  for (const key of Object.keys(value)) {
    if (!ENVIRONMENT_KEYS.has(key)) {
      addError(errors, `$.${key}`, 'additional_property', `unsupported property: ${key}`)
    }
  }

  const engines = value.engines ?? {}
  if (!isPlainObject(engines)) {
    addError(errors, '$.engines', 'type', 'must be an object')
  }

  const normalizedEngines = {}
  if (isPlainObject(engines)) {
    for (const name of Object.keys(engines).sort()) {
      const path = `$.engines.${name}`
      const engine = engines[name]
      if (!IDENTIFIER_PATTERN.test(name)) {
        addError(errors, path, 'format', 'engine key must be a lowercase identifier')
      }
      if (!isPlainObject(engine)) {
        addError(errors, path, 'type', 'must be an object')
        continue
      }
      for (const key of Object.keys(engine)) {
        if (!ENGINE_KEYS.has(key)) {
          addError(errors, `${path}.${key}`, 'additional_property', `unsupported property: ${key}`)
        }
      }
      if (!Object.hasOwn(engine, 'available')) {
        addError(errors, `${path}.available`, 'required', 'property is required')
      } else if (typeof engine.available !== 'boolean') {
        addError(errors, `${path}.available`, 'type', 'must be a boolean')
      }
      if (Object.hasOwn(engine, 'version')) {
        if (typeof engine.version !== 'string') {
          addError(errors, `${path}.version`, 'type', 'must be a string')
        } else if (engine.version.length === 0 || engine.version.length > 128) {
          addError(errors, `${path}.version`, 'length', 'must contain 1 to 128 characters')
        }
      }

      if (
        typeof engine.available === 'boolean'
        && (engine.version === undefined || typeof engine.version === 'string')
      ) {
        normalizedEngines[name] = {
          available: engine.available,
          ...(engine.version === undefined ? {} : { version: engine.version }),
        }
      }
    }
  }

  if (errors.length > 0) throw new PreflightEnvironmentValidationError(errors)
  return deepFreeze({ engines: normalizedEngines })
}

function validateScalar(value, type, path, errors) {
  if (type === 'file' || type === 'directory' || type === 'string') {
    if (typeof value !== 'string' || value.length === 0) {
      addError(errors, path, 'type', `must be a non-empty ${type} string`)
    }
    return
  }
  if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      addError(errors, path, 'type', 'must be a finite integer')
    }
    return
  }
  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      addError(errors, path, 'type', 'must be a finite number')
    }
    return
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    addError(errors, path, 'type', 'must be a boolean')
  }
}

function validateInputValues(manifest, values) {
  const errors = []
  if (!isPlainObject(values)) {
    addError(errors, '$.inputs', 'type', 'inputs must be an object')
    return { status: 'fail', checked: 0, errors }
  }

  const ports = new Map(manifest.inputs.map((input) => [input.id, input]))
  for (const key of Object.keys(values).sort()) {
    if (!ports.has(key)) {
      addError(errors, `$.inputs.${key}`, 'unknown_input', `workflow does not declare input: ${key}`)
    }
  }

  for (const input of manifest.inputs) {
    const path = `$.inputs.${input.id}`
    if (!Object.hasOwn(values, input.id)) {
      if (input.required) addError(errors, path, 'required', 'input is required')
      continue
    }

    const value = values[input.id]
    if (input.cardinality === 'many') {
      if (!Array.isArray(value)) {
        addError(errors, path, 'type', 'must be an array')
        continue
      }
      if (input.required && value.length === 0) {
        addError(errors, path, 'min_items', 'must contain at least one value')
      }
      value.forEach((item, index) => validateScalar(item, input.type, `${path}[${index}]`, errors))
      continue
    }

    validateScalar(value, input.type, path, errors)
  }

  return {
    status: errors.length === 0 ? 'pass' : 'fail',
    checked: manifest.inputs.length,
    errors,
  }
}

function validateEnvironment(manifest, environment) {
  const required = {
    name: manifest.engine.name,
    ...(manifest.engine.version === undefined ? {} : { version: manifest.engine.version }),
  }
  const declared = Object.hasOwn(environment.engines, manifest.engine.name)
    ? environment.engines[manifest.engine.name]
    : null
  const errors = []
  let status = 'pass'

  if (declared === null) {
    status = 'incomplete'
    addError(
      errors,
      `$.environment.engines.${manifest.engine.name}`,
      'engine_not_declared',
      'engine availability is not declared',
    )
  } else if (!declared.available) {
    status = 'fail'
    addError(
      errors,
      `$.environment.engines.${manifest.engine.name}.available`,
      'engine_unavailable',
      'engine is declared unavailable',
    )
  } else if (required.version !== undefined && declared.version === undefined) {
    status = 'incomplete'
    addError(
      errors,
      `$.environment.engines.${manifest.engine.name}.version`,
      'engine_version_not_declared',
      `workflow requires exact engine version ${required.version}`,
    )
  } else if (required.version !== undefined && declared.version !== required.version) {
    status = 'fail'
    addError(
      errors,
      `$.environment.engines.${manifest.engine.name}.version`,
      'engine_version_mismatch',
      `workflow requires exact engine version ${required.version}`,
    )
  }

  return { status, required, declared, errors }
}

export function preflightWorkflow(manifestValue, inputValues, environmentValue = {}) {
  const manifest = parseWorkflowManifest(manifestValue)
  const environment = parsePreflightEnvironment(environmentValue)
  const inputs = validateInputValues(manifest, inputValues)
  const environmentCheck = validateEnvironment(manifest, environment)
  const status = inputs.status === 'fail' || environmentCheck.status === 'fail'
    ? 'fail'
    : environmentCheck.status === 'incomplete'
      ? 'incomplete'
      : 'pass'

  return {
    workflow: { id: manifest.id, version: manifest.version },
    status,
    executionReady: false,
    checks: {
      inputs,
      environment: environmentCheck,
    },
    limitations: [
      'filesystem_not_checked',
      'engine_not_probed',
      'execution_not_enabled',
    ],
  }
}
