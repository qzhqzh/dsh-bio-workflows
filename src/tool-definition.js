import { getDefaultToolPresentation } from './tool-presentation.js'

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const MAX_ARGUMENT_VIOLATIONS = 128
const MAX_VALIDATED_ARRAY_ITEMS = 1024
const MAX_VALIDATED_OBJECT_PROPERTIES = 1024
const TOOL_ARGUMENT_VALIDATORS = new WeakMap()

function addViolation(violations, message) {
  if (violations.length < MAX_ARGUMENT_VIOLATIONS) violations.push(message)
}

function compileParameters(spec) {
  const properties = {}
  const required = []

  for (const [name, definition] of Object.entries(spec)) {
    const {
      required: requiredValue,
      topLevelRequired = false,
      ...schemaWithoutRequired
    } = definition
    const schema = Array.isArray(requiredValue)
      ? { ...schemaWithoutRequired, required: requiredValue }
      : schemaWithoutRequired
    assertSupportedSchema(schema, name)
    properties[name] = schema
    if (requiredValue === true || topLevelRequired === true) required.push(name)
  }

  return {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
  }
}

function assertSupportedSchema(schema, name) {
  if (!isPlainObject(schema) || !['string', 'object', 'integer', 'array'].includes(schema.type)) {
    throw new TypeError(`unsupported tool parameter type for ${name}: ${schema?.type}`)
  }
  if (schema.type === 'object' && schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      throw new TypeError(`tool object parameter properties for ${name} must be an object`)
    }
    for (const [property, child] of Object.entries(schema.properties)) {
      assertSupportedSchema(child, `${name}.${property}`)
    }
  }
  if (schema.type === 'array') {
    if (schema.items === undefined) throw new TypeError(`tool array parameter ${name} requires an items schema`)
    assertSupportedSchema(schema.items, `${name}[]`)
  }
}

function validateValue(definition, item, path, violations) {
  if (definition.type === 'string') {
    if (typeof item !== 'string') {
      addViolation(violations, `${path} must be a string`)
      return
    }
    if (definition.minLength !== undefined && item.length < definition.minLength) {
      addViolation(violations, `${path} must contain at least ${definition.minLength} character(s)`)
    }
    if (definition.maxLength !== undefined && item.length > definition.maxLength) {
      addViolation(violations, `${path} must contain at most ${definition.maxLength} character(s)`)
    }
    if (definition.pattern !== undefined && !new RegExp(definition.pattern).test(item)) {
      addViolation(violations, `${path} must match ${definition.pattern}`)
    }
    if (definition.enum !== undefined && !definition.enum.includes(item)) {
      addViolation(violations, `${path} must be one of: ${definition.enum.join(', ')}`)
    }
    return
  }
  if (definition.type === 'integer') {
    if (!Number.isSafeInteger(item)) {
      addViolation(violations, `${path} must be an integer`)
      return
    }
    if (definition.minimum !== undefined && item < definition.minimum) {
      addViolation(violations, `${path} must be at least ${definition.minimum}`)
    }
    if (definition.maximum !== undefined && item > definition.maximum) {
      addViolation(violations, `${path} must be at most ${definition.maximum}`)
    }
    return
  }
  if (definition.type === 'array') {
    if (!Array.isArray(item)) {
      addViolation(violations, `${path} must be an array`)
      return
    }
    if (definition.minItems !== undefined && item.length < definition.minItems) {
      addViolation(violations, `${path} must contain at least ${definition.minItems} item(s)`)
    }
    if (definition.maxItems !== undefined && item.length > definition.maxItems) {
      addViolation(violations, `${path} must contain at most ${definition.maxItems} item(s)`)
    }
    if (item.length > MAX_VALIDATED_ARRAY_ITEMS) {
      addViolation(violations, `${path} must contain at most ${MAX_VALIDATED_ARRAY_ITEMS} validated item(s)`)
    }
    for (let index = 0; index < Math.min(item.length, MAX_VALIDATED_ARRAY_ITEMS); index += 1) {
      validateValue(definition.items, item[index], `${path}[${index}]`, violations)
    }
    return
  }
  if (!isPlainObject(item)) {
    addViolation(violations, `${path} must be an object`)
    return
  }
  for (const name of definition.required ?? []) {
    if (!Object.hasOwn(item, name)) addViolation(violations, `${path}.${name} is required`)
  }
  let propertyCount = 0
  for (const name in item) {
    if (!Object.hasOwn(item, name)) continue
    propertyCount += 1
    if (propertyCount > MAX_VALIDATED_OBJECT_PROPERTIES) {
      addViolation(violations, `${path} must contain at most ${MAX_VALIDATED_OBJECT_PROPERTIES} validated properties`)
      break
    }
    const value = item[name]
    const child = definition.properties?.[name]
    if (child === undefined) {
      if (definition.additionalProperties === false) addViolation(violations, `${path}.${name} is not supported`)
      continue
    }
    validateValue(child, value, `${path}.${name}`, violations)
  }
}

function validateArguments(schema, value) {
  if (!isPlainObject(value)) return ['$ must be an object']

  const violations = []
  for (const name of schema.required ?? []) {
    if (!Object.hasOwn(value, name)) addViolation(violations, `$.${name} is required`)
  }

  for (const [name, definition] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(value, name)) continue
    validateValue(definition, value[name], `$.${name}`, violations)
  }
  return violations
}

export function validateToolArguments(tool, value) {
  return TOOL_ARGUMENT_VALIDATORS.get(tool)?.(value) ?? validateArguments(tool.parameters, value)
}

function invalidArgumentsResult(violations) {
  const message = `invalid arguments: ${violations.join('; ')}`
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: {
      message,
      info: {
        name: 'ToolArgsError',
        code: 'INVALID_ARGS',
      },
    },
  }
}

export class ToolArgsError extends Error {
  constructor(violations) {
    super(`invalid arguments: ${violations.join('; ')}`)
    this.name = 'ToolArgsError'
    this.code = 'INVALID_ARGS'
    this.violations = Object.freeze([...violations])
  }
}

export function defineTool(options) {
  const {
    refineArguments,
    presentCall: userPresentCall,
    presentResult: userPresentResult,
    ...definition
  } = options
  const parameters = compileParameters(options.parameters)
  const userExecute = options.execute
  const userIsConcurrencySafe = options.isConcurrencySafe
  const defaults = getDefaultToolPresentation(options.name)
  const presentCall = userPresentCall ?? defaults.presentCall
  const presentResult = userPresentResult ?? defaults.presentResult
  const validate = (args) => {
    const violations = validateArguments(parameters, args)
    if (violations.length > 0 || refineArguments === undefined) return violations
    const refined = refineArguments(args)
    if (!Array.isArray(refined) || refined.some((item) => typeof item !== 'string')) {
      throw new TypeError('refineArguments must return an array of violation strings')
    }
    for (const item of refined) addViolation(violations, item)
    return violations
  }

  const tool = {
    ...definition,
    parameters,
    async execute(args, exec) {
      const violations = validate(args)
      if (violations.length > 0) throw new ToolArgsError(violations)
      return userExecute(args, exec)
    },
    ...(presentCall === undefined
      ? {}
      : {
          presentCall(args) {
            if (validate(args).length > 0) return undefined
            return presentCall(args)
          },
        }),
    ...(presentResult === undefined
      ? {}
      : {
          presentResult(args, result) {
            if (validate(args).length > 0) return undefined
            return presentResult(args, result)
          },
        }),
    ...(userIsConcurrencySafe === undefined
      ? {}
      : {
          isConcurrencySafe(args) {
            if (validate(args).length > 0) return false
            return userIsConcurrencySafe(args)
          },
        }),
  }
  TOOL_ARGUMENT_VALIDATORS.set(tool, validate)
  return tool
}

export function registerToolArgumentGuard(ctx, tools) {
  const ownedTools = new Set(tools)

  ctx.on('tools/execute', async (exec, next) => {
    const tool = ctx.tools.get(exec.name, exec.agent)
    if (!ownedTools.has(tool)) return next()

    const violations = validateToolArguments(tool, exec.arguments)
    return violations.length === 0 ? next() : invalidArgumentsResult(violations)
  })
}
