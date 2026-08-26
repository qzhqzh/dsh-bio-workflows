import { createHash } from 'node:crypto'

export const WORKFLOW_GRAPH_SCHEMA_VERSION = '1'
export const WORKFLOW_GRAPH_LIMITS = Object.freeze({
  maxSourceBytes: 1024 * 1024,
  maxNodes: 512,
  maxEdges: 2048,
  maxDiagnostics: 128,
  maxPortsPerNode: 128,
})

const SOURCE_PATH = 'main.wdl'
const DRAFT_ID = /^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^sha256:[a-f0-9]{64}$/u
const BUILTIN_TYPES = new Set([
  'Array', 'Boolean', 'Directory', 'File', 'Float', 'Int', 'Map', 'Object', 'Pair', 'String',
])
const IGNORED_REFERENCES = new Set([
  'after', 'as', 'call', 'else', 'false', 'if', 'in', 'input', 'meta', 'none', 'null',
  'output', 'parameter_meta', 'scatter', 'then', 'true', 'workflow',
])

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

function boundedText(value, maximum) {
  if (value.length <= maximum) return value
  const suffix = `~${createHash('sha256').update(value).digest('hex').slice(0, 12)}`
  return `${value.slice(0, maximum - suffix.length)}${suffix}`
}

function stableNodeId(value) {
  return boundedText(value, 240)
}

function lineStarts(source) {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function position(starts, offset) {
  let low = 0
  let high = starts.length
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (starts[middle] <= offset) low = middle
    else high = middle
  }
  return { line: low + 1, column: offset - starts[low] + 1, offset }
}

function sourceRange(starts, start, end) {
  return {
    path: SOURCE_PATH,
    start: position(starts, start),
    end: position(starts, Math.max(start, end)),
  }
}

function tokenize(source, starts, addDiagnostic) {
  const tokens = []
  let index = 0
  const push = (type, start, end) => tokens.push({
    type,
    value: source.slice(start, end),
    start,
    end,
    ...position(starts, start),
  })

  while (index < source.length) {
    const character = source[index]
    if (/\s/u.test(character)) {
      index += 1
      continue
    }
    if (character === '#' || source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index)
      index = newline === -1 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2)
      if (close === -1) {
        addDiagnostic('unterminated_comment', 'error', 'Unterminated block comment.', index, source.length)
        break
      }
      index = close + 2
      continue
    }
    if (source.startsWith('<<<', index)) {
      const close = source.indexOf('>>>', index + 3)
      if (close === -1) {
        addDiagnostic('unterminated_command', 'error', 'Unterminated WDL command block.', index, source.length)
        break
      }
      push('opaque', index, close + 3)
      index = close + 3
      continue
    }
    if (character === '"' || character === "'") {
      const quote = character
      const start = index
      index += 1
      let escaped = false
      while (index < source.length) {
        const next = source[index]
        index += 1
        if (escaped) escaped = false
        else if (next === '\\') escaped = true
        else if (next === quote) break
      }
      if (source[index - 1] !== quote) {
        addDiagnostic('unterminated_string', 'error', 'Unterminated WDL string literal.', start, source.length)
      }
      push('opaque', start, index)
      continue
    }
    if (/[A-Za-z_]/u.test(character)) {
      const start = index
      index += 1
      while (index < source.length && /[A-Za-z0-9_]/u.test(source[index])) index += 1
      push('identifier', start, index)
      continue
    }
    if (/[0-9]/u.test(character)) {
      const start = index
      index += 1
      while (index < source.length && /[0-9A-Za-z_.+-]/u.test(source[index])) index += 1
      push('number', start, index)
      continue
    }
    const pair = source.slice(index, index + 2)
    if (['==', '!=', '<=', '>=', '&&', '||', '=>'].includes(pair)) {
      push('symbol', index, index + 2)
      index += 2
      continue
    }
    push('symbol', index, index + 1)
    index += 1
  }
  return tokens
}

function matching(tokens, startIndex, open = '{', close = '}') {
  if (tokens[startIndex]?.value !== open) return -1
  let depth = 0
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1
    if (tokens[index].value === close) depth -= 1
    if (depth === 0) return index
  }
  return -1
}

function blockAfter(tokens, index, limit = tokens.length) {
  for (let cursor = index; cursor < Math.min(limit, index + 12); cursor += 1) {
    if (tokens[cursor]?.value === '{') {
      const end = matching(tokens, cursor)
      return end === -1 ? null : { open: cursor, close: end }
    }
  }
  return null
}

function parseType(tokens, start, limit, source) {
  if (tokens[start]?.type !== 'identifier') return null
  let cursor = start + 1
  if (tokens[cursor]?.value === '[') {
    let depth = 0
    for (; cursor < limit; cursor += 1) {
      if (tokens[cursor].value === '[') depth += 1
      if (tokens[cursor].value === ']') {
        depth -= 1
        if (depth === 0) {
          cursor += 1
          break
        }
      }
    }
    if (depth !== 0) return null
  }
  if (tokens[cursor]?.value === '?' || tokens[cursor]?.value === '+') cursor += 1
  const end = tokens[cursor - 1]?.end ?? tokens[start].end
  return { value: source.slice(tokens[start].start, end).replace(/\s+/gu, ''), next: cursor }
}

function looksLikeDeclaration(tokens, index, limit, source, structNames = new Set()) {
  const first = tokens[index]
  if (first?.type !== 'identifier') return false
  if (
    !BUILTIN_TYPES.has(first.value)
    && !structNames.has(first.value)
    && !/^[A-Z]/u.test(first.value)
  ) return false
  const type = parseType(tokens, index, limit, source)
  return type !== null && tokens[type.next]?.type === 'identifier'
}

function looksLikeWorkflowElement(tokens, index, limit, source, structNames) {
  const token = tokens[index]
  if (token?.value === 'call') return true
  if (
    ['input', 'output', 'meta', 'parameter_meta', 'hints', 'runtime', 'requirements'].includes(token?.value)
    && tokens[index + 1]?.value === '{'
  ) return true
  if (token?.value === 'command') return true
  if (token?.value === 'scatter' || token?.value === 'if') {
    if (tokens[index + 1]?.value !== '(') return false
    const close = matching(tokens, index + 1, '(', ')')
    return close !== -1 && close < limit && tokens[close + 1]?.value === '{'
  }
  return looksLikeDeclaration(tokens, index, limit, source, structNames)
}

function nextStatement(tokens, start, limit, source, structNames) {
  let round = 0
  let square = 0
  let curly = 0
  for (let cursor = start; cursor < limit; cursor += 1) {
    const value = tokens[cursor].value
    if (value === '(') round += 1
    else if (value === ')') round = Math.max(0, round - 1)
    else if (value === '[') square += 1
    else if (value === ']') square = Math.max(0, square - 1)
    else if (value === '{') curly += 1
    else if (value === '}') curly = Math.max(0, curly - 1)
    if (round === 0 && square === 0 && curly === 0) {
      if (value === ';' || value === ',') return cursor
      if (looksLikeWorkflowElement(tokens, cursor, limit, source, structNames)) return cursor
    }
  }
  return limit
}

function declarations(tokens, open, close, source, addDiagnostic, structNames) {
  const values = []
  let cursor = open + 1
  while (cursor < close) {
    while (cursor < close && [',', ';'].includes(tokens[cursor].value)) cursor += 1
    if (cursor >= close) break
    const type = parseType(tokens, cursor, close, source)
    const name = type === null ? null : tokens[type.next]
    if (type === null || name?.type !== 'identifier') {
      addDiagnostic(
        'unsupported_declaration',
        'warning',
        'Could not prove the structure of this WDL declaration; it was omitted from the graph.',
        tokens[cursor].start,
        tokens[cursor].end,
      )
      cursor += 1
      continue
    }
    const boundary = nextStatement(tokens, type.next + 1, close, source, structNames)
    const equals = tokens.slice(type.next + 1, boundary).findIndex((token) => token.value === '=')
    const equalsIndex = equals === -1 ? -1 : type.next + 1 + equals
    const last = tokens[Math.max(type.next, boundary - 1)]
    values.push({
      type: type.value,
      name: name.value,
      expression: equalsIndex === -1 ? [] : tokens.slice(equalsIndex + 1, boundary),
      start: tokens[cursor].start,
      end: last.end,
    })
    cursor = boundary
  }
  return values
}

function topLevelBlocks(tokens, start, end, names) {
  const found = new Map()
  let depth = 0
  for (let index = start; index < end; index += 1) {
    const value = tokens[index].value
    if (value === '{') depth += 1
    else if (value === '}') depth -= 1
    if (depth !== 0 || !names.has(value) || tokens[index + 1]?.value !== '{') continue
    const close = matching(tokens, index + 1)
    if (close !== -1 && close <= end) {
      found.set(value, { open: index + 1, close, keyword: index })
      index = close
    }
  }
  return found
}

function legacyTaskInputs(tokens, open, close, source, structNames) {
  const values = []
  let cursor = open + 1
  while (cursor < close) {
    const token = tokens[cursor]
    if (token.value === 'command') {
      if (tokens[cursor + 1]?.type === 'opaque') {
        cursor += 2
        continue
      }
      if (tokens[cursor + 1]?.value === '{') {
        const commandClose = matching(tokens, cursor + 1)
        cursor = commandClose === -1 ? cursor + 1 : commandClose + 1
        continue
      }
      cursor += 1
      continue
    }
    if (tokens[cursor + 1]?.value === '{') {
      const sectionClose = matching(tokens, cursor + 1)
      if (sectionClose !== -1 && sectionClose <= close) {
        cursor = sectionClose + 1
        continue
      }
    }
    if (!looksLikeDeclaration(tokens, cursor, close, source, structNames)) {
      cursor += 1
      continue
    }
    const type = parseType(tokens, cursor, close, source)
    const name = tokens[type.next]
    const boundary = nextStatement(tokens, type.next + 1, close, source, structNames)
    const equals = tokens.slice(type.next + 1, boundary).some((item) => item.value === '=')
    if (!equals) {
      const last = tokens[Math.max(type.next, boundary - 1)]
      values.push({
        type: type.value,
        name: name.value,
        expression: [],
        start: token.start,
        end: last.end,
      })
    }
    cursor = Math.max(cursor + 1, boundary)
  }
  return values
}

function taskSignatures(tokens, source, addDiagnostic, structNames) {
  const signatures = new Map()
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== 'task' || tokens[index + 1]?.type !== 'identifier') continue
    const block = blockAfter(tokens, index + 2)
    if (block === null) {
      addDiagnostic('invalid_task', 'warning', 'Task block could not be parsed.', tokens[index].start, tokens[index + 1].end)
      continue
    }
    const sections = topLevelBlocks(tokens, block.open + 1, block.close, new Set(['input', 'output']))
    const explicitInputs = sections.has('input')
      ? declarations(tokens, sections.get('input').open, sections.get('input').close, source, addDiagnostic, structNames)
      : []
    const inputs = [
      ...explicitInputs,
      ...legacyTaskInputs(tokens, block.open, block.close, source, structNames),
    ].sort((left, right) => left.start - right.start)
    signatures.set(tokens[index + 1].value, {
      inputs,
      outputs: sections.has('output')
        ? declarations(tokens, sections.get('output').open, sections.get('output').close, source, addDiagnostic, structNames)
        : [],
    })
    index = block.close
  }
  return signatures
}

function isRecordConstructor(tokens, index, structNames) {
  const token = tokens[index]
  return token?.value === 'object'
    || (token?.type === 'identifier' && structNames.has(token.value))
    || (
      token?.type === 'identifier'
      && tokens[index - 1]?.value === '.'
      && tokens[index - 2]?.type === 'identifier'
    )
}

function referenceNames(tokens, addDiagnostic, structNames) {
  const names = []
  const recordLiterals = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.value === '{') {
      recordLiterals.push(isRecordConstructor(tokens, index - 1, structNames))
      continue
    }
    if (token.value === '}') {
      recordLiterals.pop()
      continue
    }
    if (
      token.type === 'opaque'
      && (token.value.startsWith('"') || token.value.startsWith("'"))
      && /(?:~|\$)\{/u.test(token.value)
    ) {
      addDiagnostic(
        'unsupported_string_interpolation',
        'warning',
        'String interpolation dependencies are not extracted by WorkflowGraph v1.',
        token.start,
        token.end,
      )
      continue
    }
    if (token.type !== 'identifier' || IGNORED_REFERENCES.has(token.value)) continue
    if (tokens[index + 1]?.value === '{' && isRecordConstructor(tokens, index, structNames)) continue
    if (recordLiterals.at(-1) === true && tokens[index + 1]?.value === ':') continue
    const parts = [token.value]
    let cursor = index
    while (tokens[cursor + 1]?.value === '.' && tokens[cursor + 2]?.type === 'identifier') {
      parts.push(tokens[cursor + 2].value)
      cursor += 2
    }
    index = cursor
    if (tokens[cursor + 1]?.value === '(') continue
    const name = parts.join('.')
    if (!names.includes(name)) names.push(name)
  }
  return names
}

function callDetails(tokens, index, limit) {
  let cursor = index + 1
  if (tokens[cursor]?.type !== 'identifier') return null
  const targetParts = [tokens[cursor].value]
  cursor += 1
  while (tokens[cursor]?.value === '.' && tokens[cursor + 1]?.type === 'identifier') {
    targetParts.push(tokens[cursor + 1].value)
    cursor += 2
  }
  let alias = targetParts.at(-1)
  const after = []
  if (tokens[cursor]?.value === 'as' && tokens[cursor + 1]?.type === 'identifier') {
    alias = tokens[cursor + 1].value
    cursor += 2
  }
  while (tokens[cursor]?.value === 'after' && tokens[cursor + 1]?.type === 'identifier') {
    after.push(tokens[cursor + 1].value)
    cursor += 2
  }
  let open = -1
  let close = -1
  if (tokens[cursor]?.value === '{') {
    open = cursor
    close = matching(tokens, open)
    if (close === -1 || close > limit) return null
  }
  const mappings = []
  if (open !== -1) {
    let input = open + 1
    while (input < close && tokens[input].value !== 'input') input += 1
    if (input < close && tokens[input + 1]?.value === ':') {
      let item = input + 2
      while (item < close) {
        while (item < close && tokens[item].value === ',') item += 1
        if (tokens[item]?.type !== 'identifier' || tokens[item + 1]?.value !== '=') break
        const name = tokens[item].value
        const expressionStart = item + 2
        let expressionEnd = expressionStart
        let depth = 0
        while (expressionEnd < close) {
          const value = tokens[expressionEnd].value
          if (['(', '[', '{'].includes(value)) depth += 1
          else if ([')', ']', '}'].includes(value)) depth -= 1
          if (depth === 0 && value === ',') break
          expressionEnd += 1
        }
        mappings.push({ name, expression: tokens.slice(expressionStart, expressionEnd) })
        item = expressionEnd + 1
      }
    }
  }
  const endIndex = close === -1 ? cursor - 1 : close
  return {
    target: targetParts.join('.'),
    alias,
    after,
    mappings,
    endIndex: Math.max(index + 1, endIndex),
  }
}

function port(declaration, addDiagnostic) {
  if (declaration.type.length > 256) {
    addDiagnostic(
      'port_type_limit',
      'warning',
      'A WDL port type exceeds the WorkflowGraph v1 display limit and was shortened.',
      declaration.start,
      declaration.end,
    )
  }
  return {
    id: boundedText(declaration.name, 128),
    name: boundedText(declaration.name, 128),
    type: boundedText(declaration.type, 256),
  }
}

function edgeId(kind, from, to) {
  return `edge:${createHash('sha256').update(`${kind}\0${from.node}\0${from.port}\0${to.node}\0${to.port}`).digest('hex').slice(0, 24)}`
}

export function createWorkflowGraph(input) {
  if (input === null || typeof input !== 'object') throw new TypeError('workflow graph input must be an object')
  if (!DRAFT_ID.test(input.draftId)) throw new TypeError('workflow graph draftId is invalid')
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || input.revision > 256) {
    throw new TypeError('workflow graph revision is invalid')
  }
  if (!SHA256.test(input.contentDigest)) throw new TypeError('workflow graph contentDigest is invalid')
  if (typeof input.source !== 'string') throw new TypeError('workflow graph source must be a string')
  const source = input.source
  if (Buffer.byteLength(source, 'utf8') > WORKFLOW_GRAPH_LIMITS.maxSourceBytes) {
    throw new RangeError(`workflow graph source exceeds ${WORKFLOW_GRAPH_LIMITS.maxSourceBytes} bytes`)
  }
  const starts = lineStarts(source)
  const diagnostics = []
  let complete = true
  const addDiagnostic = (code, severity, message, start, end) => {
    complete = false
    if (diagnostics.length >= WORKFLOW_GRAPH_LIMITS.maxDiagnostics) return
    diagnostics.push({
      code,
      severity,
      message: String(message).slice(0, 1000),
      ...(Number.isSafeInteger(start) ? { range: sourceRange(starts, start, end ?? start) } : {}),
    })
  }
  const tokens = tokenize(source, starts, addDiagnostic)
  const structNames = new Set()
  for (const token of tokens) {
    if (token.type === 'identifier' && token.value.length > 128) {
      addDiagnostic(
        'identifier_limit',
        'warning',
        'A WDL identifier exceeds the WorkflowGraph v1 display limit and was shortened.',
        token.start,
        token.end,
      )
    }
  }
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index].value === 'struct' && tokens[index + 1].type === 'identifier') {
      structNames.add(tokens[index + 1].value)
    }
  }
  const versionIndex = tokens.findIndex((token) => token.value === 'version')
  const rawLanguageVersion = versionIndex === -1 ? 'unknown' : tokens[versionIndex + 1]?.value ?? 'unknown'
  if (rawLanguageVersion.length > 32) {
    addDiagnostic('language_version_limit', 'warning', 'The WDL version token exceeds the WorkflowGraph v1 display limit.', tokens[versionIndex]?.start, tokens[versionIndex + 1]?.end)
  }
  const languageVersion = boundedText(rawLanguageVersion, 32)
  if (languageVersion !== '1.0') {
    addDiagnostic('unsupported_wdl_version', 'warning', `WorkflowGraph v1 currently supports WDL 1.0; found ${languageVersion}.`, tokens[versionIndex]?.start, tokens[versionIndex + 1]?.end)
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === 'import') {
      addDiagnostic('unsupported_import', 'warning', 'Imported WDL definitions are not resolved by WorkflowGraph v1.', tokens[index].start, tokens[index + 1]?.end)
    }
  }

  const tasks = taskSignatures(tokens, source, addDiagnostic, structNames)
  const workflowIndex = tokens.findIndex((token, index) => (
    token.value === 'workflow' && tokens[index + 1]?.type === 'identifier'
  ))
  if (workflowIndex === -1) {
    addDiagnostic('workflow_missing', 'error', 'No WDL workflow declaration was found.')
    const core = {
      schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
      draftId: input.draftId,
      revision: input.revision,
      contentDigest: input.contentDigest,
      sourcePath: SOURCE_PATH,
      languageVersion,
      workflow: { name: 'unknown', range: sourceRange(starts, 0, 0) },
      complete: false,
      nodes: [],
      edges: [],
      diagnostics,
      executionAuthorized: false,
    }
    return Object.freeze({ ...core, graphDigest: digest(core) })
  }
  const workflowNameRaw = tokens[workflowIndex + 1].value
  const workflowName = boundedText(workflowNameRaw, 128)
  const workflowBlock = blockAfter(tokens, workflowIndex + 2)
  if (workflowBlock === null) {
    addDiagnostic('workflow_block_invalid', 'error', 'The workflow body could not be parsed.', tokens[workflowIndex].start, tokens[workflowIndex + 1].end)
  }

  const nodes = []
  const edges = []
  const nodeIds = new Set()
  const edgeIds = new Set()
  const producers = new Map()
  const ambiguousProducers = new Set()
  const pendingReferences = []
  const pendingControls = []

  const ports = (declarationsValue, start, end) => {
    if (declarationsValue.length > WORKFLOW_GRAPH_LIMITS.maxPortsPerNode) {
      addDiagnostic(
        'port_limit',
        'warning',
        `A graph node exceeds the ${WORKFLOW_GRAPH_LIMITS.maxPortsPerNode}-port limit; excess ports were omitted.`,
        start,
        end,
      )
    }
    return declarationsValue
      .slice(0, WORKFLOW_GRAPH_LIMITS.maxPortsPerNode)
      .map((declaration) => port(declaration, addDiagnostic))
  }

  const addNode = (node) => {
    if (nodes.length >= WORKFLOW_GRAPH_LIMITS.maxNodes) {
      addDiagnostic('node_limit', 'error', `Graph node limit ${WORKFLOW_GRAPH_LIMITS.maxNodes} was reached.`, node.range.start.offset, node.range.end.offset)
      return false
    }
    if (nodeIds.has(node.id)) {
      addDiagnostic('duplicate_node', 'error', `Duplicate graph node id ${node.id}.`, node.range.start.offset, node.range.end.offset)
      return false
    }
    nodeIds.add(node.id)
    nodes.push(node)
    return true
  }
  const addEdge = (kind, from, to) => {
    if (!nodeIds.has(from.node) || !nodeIds.has(to.node)) return
    if (edges.length >= WORKFLOW_GRAPH_LIMITS.maxEdges) {
      addDiagnostic('edge_limit', 'error', `Graph edge limit ${WORKFLOW_GRAPH_LIMITS.maxEdges} was reached.`)
      return
    }
    const id = edgeId(kind, from, to)
    if (edgeIds.has(id)) return
    edgeIds.add(id)
    edges.push({ id, kind, from, to })
  }
  const registerProducer = (name, producer, start, end) => {
    if (ambiguousProducers.has(name)) return
    if (producers.has(name)) {
      addDiagnostic(
        'ambiguous_producer',
        'warning',
        `More than one WDL value defines ${name}; WorkflowGraph v1 will not guess which one applies.`,
        start,
        end,
      )
      producers.delete(name)
      ambiguousProducers.add(name)
      return
    }
    producers.set(name, producer)
  }
  const connectReferences = (expression, toNode, toPort) => {
    pendingReferences.push({ expression, toNode, toPort })
  }
  const resolveReferences = ({ expression, toNode, toPort }) => {
    for (const name of referenceNames(expression, addDiagnostic, structNames)) {
      let candidate = name
      let producer
      while (candidate !== '') {
        producer = producers.get(candidate)
        if (producer !== undefined) break
        const separator = candidate.lastIndexOf('.')
        candidate = separator === -1 ? '' : candidate.slice(0, separator)
      }
      if (producer !== undefined) addEdge('data', producer, { node: toNode, port: toPort })
    }
  }
  const contain = (parentGroup, child) => {
    if (parentGroup === undefined) return
    addEdge('containment', { node: parentGroup, port: 'group' }, { node: child, port: 'member' })
  }

  if (workflowBlock !== null) {
    const sections = topLevelBlocks(tokens, workflowBlock.open + 1, workflowBlock.close, new Set(['input', 'output']))
    const inputs = sections.has('input')
      ? declarations(tokens, sections.get('input').open, sections.get('input').close, source, addDiagnostic, structNames)
      : []
    const defaultedInputs = []
    for (const declaration of inputs) {
      const id = stableNodeId(`workflow-input:${declaration.name}`)
      const defaultPort = declaration.expression.length === 0
        ? null
        : port({ ...declaration, name: 'default' }, addDiagnostic)
      if (addNode({
        id,
        kind: 'workflow-input',
        label: boundedText(declaration.name, 128),
        range: sourceRange(starts, declaration.start, declaration.end),
        inputs: defaultPort === null ? [] : [defaultPort],
        outputs: [port({ ...declaration, name: 'value' }, addDiagnostic)],
      })) {
        registerProducer(declaration.name, { node: id, port: 'value' }, declaration.start, declaration.end)
        if (defaultPort !== null) defaultedInputs.push({ declaration, id, port: defaultPort.id })
      }
    }
    for (const input of defaultedInputs) {
      connectReferences(input.declaration.expression, input.id, input.port)
    }

    const parseBody = (start, end, parentGroup) => {
      let cursor = start
      let depth = 0
      while (cursor < end) {
        const token = tokens[cursor]
        if (token.value === '{') {
          depth += 1
          cursor += 1
          continue
        }
        if (token.value === '}') {
          depth -= 1
          cursor += 1
          continue
        }
        if (depth !== 0) {
          cursor += 1
          continue
        }
        if (['input', 'output', 'meta', 'parameter_meta', 'hints'].includes(token.value) && tokens[cursor + 1]?.value === '{') {
          const close = matching(tokens, cursor + 1)
          cursor = close === -1 ? cursor + 1 : close + 1
          continue
        }
        if (token.value === 'call') {
          const details = callDetails(tokens, cursor, end)
          if (details === null) {
            addDiagnostic('unsupported_call', 'warning', 'Could not prove this call structure; it was omitted.', token.start, token.end)
            cursor += 1
            continue
          }
          // Imported task signatures are not available in this source-only graph.
          // Never borrow a same-named local task signature for a qualified call.
          const signature = details.target.includes('.') ? undefined : tasks.get(details.target)
          const id = stableNodeId(`call:${details.alias}:${token.start}`)
          const range = sourceRange(starts, token.start, tokens[details.endIndex].end)
          const inputDeclarations = signature?.inputs ?? details.mappings.map((mapping) => ({
            name: mapping.name,
            type: 'Any',
            start: token.start,
            end: tokens[details.endIndex].end,
          }))
          const outputDeclarations = signature?.outputs ?? []
          const inputPorts = ports(inputDeclarations, token.start, tokens[details.endIndex].end)
          const outputPorts = ports(outputDeclarations, token.start, tokens[details.endIndex].end)
          const inputPortByName = new Map(
            inputDeclarations
              .slice(0, WORKFLOW_GRAPH_LIMITS.maxPortsPerNode)
              .map((declaration, index) => [declaration.name, inputPorts[index].id]),
          )
          if (details.target.length > 240) {
            addDiagnostic(
              'call_target_limit',
              'warning',
              'A call target exceeds the WorkflowGraph v1 display limit and was shortened.',
              token.start,
              tokens[details.endIndex].end,
            )
          }
          const callNode = {
            id,
            kind: 'call',
            label: boundedText(details.alias, 128),
            target: boundedText(
              details.target.split('.').map((part) => boundedText(part, 128)).join('.'),
              240,
            ),
            range,
            ...(parentGroup === undefined ? {} : { parentGroup }),
            inputs: inputPorts,
            outputs: outputPorts,
          }
          if (signature === undefined) {
            addDiagnostic('unresolved_call_target', 'warning', `Call target ${details.target} is not defined in this source file.`, token.start, tokens[details.endIndex].end)
          }
          if (addNode(callNode)) {
            contain(parentGroup, id)
            for (const mapping of details.mappings) {
              const inputPort = inputPortByName.get(mapping.name)
              if (inputPort === undefined) {
                addDiagnostic(
                  'unresolved_call_input',
                  'warning',
                  'A call input mapping could not be attached to a declared graph port.',
                  token.start,
                  tokens[details.endIndex].end,
                )
              } else {
                connectReferences(mapping.expression, id, inputPort)
              }
            }
            for (const prerequisite of details.after) {
              pendingControls.push({
                prerequisite,
                toNode: id,
                start: token.start,
                end: tokens[details.endIndex].end,
              })
            }
            registerProducer(
              `call:${details.alias}`,
              { node: id, port: 'complete' },
              token.start,
              tokens[details.endIndex].end,
            )
            for (const [index, output] of outputDeclarations
              .slice(0, WORKFLOW_GRAPH_LIMITS.maxPortsPerNode)
              .entries()) {
              registerProducer(
                `${details.alias}.${output.name}`,
                { node: id, port: outputPorts[index].id },
                token.start,
                tokens[details.endIndex].end,
              )
            }
          }
          cursor = details.endIndex + 1
          continue
        }
        if (token.value === 'scatter' || token.value === 'if') {
          const conditional = token.value === 'if'
          const paren = tokens[cursor + 1]?.value === '(' ? cursor + 1 : -1
          const parenClose = paren === -1 ? -1 : matching(tokens, paren, '(', ')')
          const blockOpen = parenClose === -1 ? -1 : parenClose + 1
          const blockClose = blockOpen === -1 || tokens[blockOpen]?.value !== '{' ? -1 : matching(tokens, blockOpen)
          if (parenClose === -1 || blockClose === -1 || blockClose > end) {
            addDiagnostic('unsupported_group', 'warning', `Could not prove this ${token.value} structure; it was omitted.`, token.start, token.end)
            cursor += 1
            continue
          }
          let label = 'condition'
          let expression = tokens.slice(paren + 1, parenClose)
          if (!conditional) {
            const inIndex = expression.findIndex((item) => item.value === 'in')
            if (inIndex <= 0 || expression[0].type !== 'identifier') {
              addDiagnostic('unsupported_scatter', 'warning', 'Could not prove the scatter variable and collection.', token.start, tokens[parenClose].end)
            } else {
              label = expression[0].value
              expression = expression.slice(inIndex + 1)
            }
          }
          const kind = conditional ? 'conditional' : 'scatter'
          const id = stableNodeId(`${kind}:${label}:${token.start}`)
          if (addNode({
            id,
            kind,
            label: conditional ? 'if' : boundedText(label, 128),
            range: sourceRange(starts, token.start, tokens[blockClose].end),
            ...(parentGroup === undefined ? {} : { parentGroup }),
            inputs: [{ id: conditional ? 'condition' : 'collection', name: conditional ? 'condition' : 'collection', type: conditional ? 'Boolean' : 'Array[Any]' }],
            outputs: conditional ? [] : [{ id: boundedText(label, 128), name: boundedText(label, 128), type: 'Any' }],
          })) {
            contain(parentGroup, id)
            connectReferences(expression, id, conditional ? 'condition' : 'collection')
            if (!conditional) {
              registerProducer(
                label,
                { node: id, port: boundedText(label, 128) },
                token.start,
                tokens[parenClose].end,
              )
            }
            parseBody(blockOpen + 1, blockClose, id)
          }
          cursor = blockClose + 1
          continue
        }
        if (looksLikeDeclaration(tokens, cursor, end, source, structNames)) {
          const type = parseType(tokens, cursor, end, source)
          const name = tokens[type.next]
          const boundary = nextStatement(tokens, type.next + 1, end, source, structNames)
          const equalsOffset = tokens.slice(type.next + 1, boundary).findIndex((item) => item.value === '=')
          const expression = equalsOffset === -1 ? [] : tokens.slice(type.next + 2 + equalsOffset, boundary)
          const legacyInput = equalsOffset === -1 && parentGroup === undefined
          const id = legacyInput
            ? stableNodeId(`workflow-input:${name.value}`)
            : stableNodeId(`declaration:${name.value}:${token.start}`)
          const declarationPort = port({
            name: 'value',
            type: type.value,
            start: token.start,
            end: tokens[Math.max(type.next, boundary - 1)].end,
          }, addDiagnostic)
          if (addNode({
            id,
            kind: legacyInput ? 'workflow-input' : 'declaration',
            label: boundedText(name.value, 128),
            range: sourceRange(starts, token.start, tokens[Math.max(type.next, boundary - 1)].end),
            ...(parentGroup === undefined ? {} : { parentGroup }),
            inputs: legacyInput ? [] : [declarationPort],
            outputs: [declarationPort],
          })) {
            contain(parentGroup, id)
            if (!legacyInput) connectReferences(expression, id, 'value')
            registerProducer(name.value, { node: id, port: 'value' }, token.start, name.end)
          }
          cursor = Math.max(cursor + 1, boundary)
          continue
        }
        if (token.type === 'identifier' && !['version', 'workflow'].includes(token.value)) {
          addDiagnostic('unsupported_workflow_syntax', 'warning', `Unsupported workflow statement ${token.value} was omitted.`, token.start, token.end)
        }
        cursor += 1
      }
    }

    parseBody(workflowBlock.open + 1, workflowBlock.close, undefined)

    const outputs = sections.has('output')
      ? declarations(tokens, sections.get('output').open, sections.get('output').close, source, addDiagnostic, structNames)
      : []
    for (const declaration of outputs) {
      const id = stableNodeId(`workflow-output:${declaration.name}`)
      if (addNode({
        id,
        kind: 'workflow-output',
        label: boundedText(declaration.name, 128),
        range: sourceRange(starts, declaration.start, declaration.end),
        inputs: [port({ ...declaration, name: 'value' }, addDiagnostic)],
        outputs: [],
      })) connectReferences(declaration.expression, id, 'value')
    }

    for (const pending of pendingReferences) resolveReferences(pending)
    for (const pending of pendingControls) {
      const producer = producers.get(`call:${pending.prerequisite}`)
      if (producer === undefined) {
        addDiagnostic(
          'unresolved_call_dependency',
          'warning',
          `Call dependency ${pending.prerequisite} could not be resolved in this workflow.`,
          pending.start,
          pending.end,
        )
      } else {
        addEdge('control', producer, { node: pending.toNode, port: 'after' })
      }
    }
  }

  nodes.sort((left, right) => left.range.start.offset - right.range.start.offset || left.id.localeCompare(right.id))
  edges.sort((left, right) => left.id.localeCompare(right.id))
  diagnostics.sort((left, right) => (left.range?.start.offset ?? Number.MAX_SAFE_INTEGER) - (right.range?.start.offset ?? Number.MAX_SAFE_INTEGER) || left.code.localeCompare(right.code))
  const workflowEnd = workflowBlock === null ? tokens[workflowIndex + 1].end : tokens[workflowBlock.close].end
  const core = {
    schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
    draftId: input.draftId,
    revision: input.revision,
    contentDigest: input.contentDigest,
    sourcePath: SOURCE_PATH,
    languageVersion,
    workflow: {
      name: workflowName,
      range: sourceRange(starts, tokens[workflowIndex].start, workflowEnd),
    },
    complete,
    nodes,
    edges,
    diagnostics,
    executionAuthorized: false,
  }
  return Object.freeze({ ...core, graphDigest: digest(core) })
}
