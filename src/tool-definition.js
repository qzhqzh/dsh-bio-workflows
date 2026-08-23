function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function compileParameters(spec) {
  const properties = {}
  const required = []

  for (const [name, definition] of Object.entries(spec)) {
    const { required: isRequired, ...schema } = definition
    if (schema.type !== 'string' && schema.type !== 'object') {
      throw new TypeError(`unsupported tool parameter type for ${name}: ${schema.type}`)
    }
    properties[name] = schema
    if (isRequired === true) required.push(name)
  }

  return {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
  }
}

function validateArguments(schema, value) {
  if (!isPlainObject(value)) return ['$ must be an object']

  const violations = []
  for (const name of schema.required ?? []) {
    if (!Object.hasOwn(value, name)) violations.push(`$.${name} is required`)
  }

  for (const [name, definition] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(value, name)) continue
    const item = value[name]
    if (definition.type === 'string' && typeof item !== 'string') {
      violations.push(`$.${name} must be a string`)
    } else if (definition.type === 'string') {
      if (definition.minLength !== undefined && item.length < definition.minLength) {
        violations.push(`$.${name} must contain at least ${definition.minLength} character(s)`)
      }
      if (definition.maxLength !== undefined && item.length > definition.maxLength) {
        violations.push(`$.${name} must contain at most ${definition.maxLength} character(s)`)
      }
      if (definition.pattern !== undefined && !new RegExp(definition.pattern).test(item)) {
        violations.push(`$.${name} must match ${definition.pattern}`)
      }
      if (definition.enum !== undefined && !definition.enum.includes(item)) {
        violations.push(`$.${name} must be one of: ${definition.enum.join(', ')}`)
      }
    } else if (definition.type === 'object' && !isPlainObject(item)) {
      violations.push(`$.${name} must be an object`)
    }
  }
  return violations
}

export function validateToolArguments(tool, value) {
  return validateArguments(tool.parameters, value)
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
  const parameters = compileParameters(options.parameters)
  const userExecute = options.execute
  const userIsConcurrencySafe = options.isConcurrencySafe
  const validate = (args) => validateArguments(parameters, args)

  return {
    ...options,
    parameters,
    async execute(args, exec) {
      const violations = validate(args)
      if (violations.length > 0) throw new ToolArgsError(violations)
      return userExecute(args, exec)
    },
    ...(userIsConcurrencySafe === undefined
      ? {}
      : {
          isConcurrencySafe(args) {
            if (validate(args).length > 0) return false
            return userIsConcurrencySafe(args)
          },
        }),
  }
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
