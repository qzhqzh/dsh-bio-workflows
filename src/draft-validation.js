import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path'

import { PACKAGE_VERSION } from './info.js'
import {
  isSafeBundlePath,
  validateLoadedWdlBundle,
  WdlBundleValidationError,
} from './wdl-bundle.js'

export const DRAFT_VALIDATION_SCHEMA_VERSION = '1'
export const DRAFT_VALIDATOR_POLICY_VERSION = '1'

const VALIDATION_CONFIG_KEYS = new Set(['validator'])
const VALIDATOR_CONFIG_KEYS = new Set(['executable', 'expectedVersion'])
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const MAX_PATH_LENGTH = 4096
const MAX_OUTPUT_BYTES = 128 * 1024
const MAX_DIAGNOSTICS = 128
const MAX_DIAGNOSTIC_TEXT = 1000
const PROCESS_GRACE_MS = 5_000
const VALIDATION_TIMEOUT_MS = 30_000

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

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digestValue(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value), 'utf8').digest('hex')}`
}

function throwIfAborted(signal) {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('draft validation was aborted')
  error.name = 'AbortError'
  throw error
}

function errorResult(code, message, details = {}) {
  return { ok: false, error: { code, message }, ...details }
}

export class DraftValidationConfigError extends Error {
  constructor(errors) {
    super(`invalid authoring config: ${errors.map((error) => `${error.path} ${error.message}`).join('; ')}`)
    this.name = 'DraftValidationConfigError'
    this.errors = errors
  }
}

export function parseDraftValidationConfig(value = {}) {
  const errors = []
  if (!isPlainObject(value)) {
    throw new DraftValidationConfigError([
      { path: '$', code: 'type', message: 'authoring config must be an object' },
    ])
  }
  for (const key of Object.keys(value)) {
    if (!VALIDATION_CONFIG_KEYS.has(key)) {
      errors.push({ path: `$.${key}`, code: 'additional_property', message: `unsupported property: ${key}` })
    }
  }
  const validator = value.validator ?? {}
  if (!isPlainObject(validator)) {
    errors.push({ path: '$.validator', code: 'type', message: 'must be an object' })
  } else {
    for (const key of Object.keys(validator)) {
      if (!VALIDATOR_CONFIG_KEYS.has(key)) {
        errors.push({ path: `$.validator.${key}`, code: 'additional_property', message: `unsupported property: ${key}` })
      }
    }
  }
  const executable = isPlainObject(validator) ? validator.executable ?? 'miniwdl' : 'miniwdl'
  const expectedVersion = isPlainObject(validator) ? validator.expectedVersion ?? '1.15.0' : '1.15.0'
  if (typeof executable !== 'string' || executable.length === 0 || executable.length > MAX_PATH_LENGTH) {
    errors.push({ path: '$.validator.executable', code: 'type', message: 'must be a non-empty bounded string' })
  } else if (!isAbsolute(executable) && (executable.includes('/') || executable.includes('\\'))) {
    errors.push({
      path: '$.validator.executable',
      code: 'format',
      message: 'must be an absolute path or a bare executable name',
    })
  }
  if (typeof expectedVersion !== 'string' || !SEMVER_PATTERN.test(expectedVersion)) {
    errors.push({ path: '$.validator.expectedVersion', code: 'format', message: 'must be an exact semantic version' })
  }
  if (errors.length > 0) throw new DraftValidationConfigError(errors)
  return deepFreeze({ validator: { executable, expectedVersion } })
}

function diagnostic(path, code, message, severity = 'error', source = 'structural') {
  return {
    path: String(path).slice(0, MAX_DIAGNOSTIC_TEXT),
    code: String(code).slice(0, 128),
    message: String(message).slice(0, MAX_DIAGNOSTIC_TEXT),
    severity,
    source,
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function sortDiagnostics(items) {
  return [...items].sort((left, right) => (
    compareUtf8(left.path, right.path)
    || compareUtf8(left.code, right.code)
    || compareUtf8(left.message, right.message)
    || compareUtf8(left.severity, right.severity)
    || compareUtf8(left.source, right.source)
  ))
}

function declaredWdlVersion(source) {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  for (const line of lines) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    return /^\s*version\s+([0-9]+\.[0-9]+)\s*(?:#.*)?$/.exec(line)?.[1] ?? null
  }
  return null
}

function skipCommandPlaceholder(source, openBrace) {
  let depth = 1
  let quote = null
  let escaped = false
  for (let index = openBrace + 1; index < source.length; index += 1) {
    const character = source[index]
    if (quote !== null) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '#') {
      while (index + 1 < source.length && !['\r', '\n'].includes(source[index + 1])) index += 1
      continue
    }
    if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) return index
  }
  return source.length
}

function skipBraceCommand(source, openBrace) {
  for (let index = openBrace + 1; index < source.length; index += 1) {
    if (source.startsWith('${', index) || source.startsWith('~{', index)) {
      index = skipCommandPlaceholder(source, index + 1)
      continue
    }
    if (source[index] === '}') return index
  }
  return source.length
}

function skipHeredocCommand(source, openingDelimiter) {
  for (let index = openingDelimiter + 3; index < source.length; index += 1) {
    if (source.startsWith('~{', index)) {
      index = skipCommandPlaceholder(source, index + 1)
      continue
    }
    if (source.startsWith('>>>', index)) return index + 2
  }
  return source.length
}

function commandBodyStart(source, offset) {
  let index = offset
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1
      continue
    }
    if (source[index] === '#') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    return index
  }
  return source.length
}

function tokenizeWdl(source) {
  const tokens = []
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (/\s/.test(character)) continue
    if (character === '#') {
      while (index + 1 < source.length && source[index + 1] !== '\n') index += 1
      continue
    }
    if (source.startsWith('<<<', index)) {
      index = skipHeredocCommand(source, index)
      continue
    }
    if (character === '"' || character === "'") {
      const quote = character
      let value = ''
      let plain = true
      let closed = false
      for (index += 1; index < source.length; index += 1) {
        const item = source[index]
        if (item === quote) {
          closed = true
          break
        }
        if (item === '\\') {
          plain = false
          value += item
          if (index + 1 < source.length) value += source[++index]
          continue
        }
        if (source.startsWith('${', index) || source.startsWith('~{', index)) {
          plain = false
          const placeholderEnd = skipCommandPlaceholder(source, index + 1)
          value += source.slice(index, Math.min(placeholderEnd + 1, source.length))
          index = placeholderEnd
          continue
        }
        value += item
      }
      tokens.push({ kind: 'string', value, plain: plain && closed })
      continue
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = index
      while (index + 1 < source.length && /[A-Za-z0-9_]/.test(source[index + 1])) index += 1
      const value = source.slice(start, index + 1)
      tokens.push({ kind: 'identifier', value })
      if (value === 'command') {
        const bodyStart = commandBodyStart(source, index + 1)
        if (source.startsWith('<<<', bodyStart)) {
          index = skipHeredocCommand(source, bodyStart)
        } else if (source[bodyStart] === '{') {
          index = skipBraceCommand(source, bodyStart)
        }
      }
      continue
    }
    tokens.push({ kind: 'symbol', value: character })
  }
  return tokens
}

function matchingBrace(tokens, openIndex) {
  let depth = 0
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === '{') depth += 1
    else if (tokens[index].value === '}' && --depth === 0) return index
  }
  return tokens.length
}

function hasTopLevelWorkflow(source) {
  const tokens = tokenizeWdl(source)
  let depth = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (
      depth === 0
      && token.kind === 'identifier'
      && token.value === 'workflow'
      && tokens[index + 1]?.kind === 'identifier'
      && tokens[index + 2]?.value === '{'
    ) {
      return true
    }
    if (token.value === '{') depth += 1
    else if (token.value === '}') depth = Math.max(0, depth - 1)
  }
  return false
}

function topLevelImports(tokens) {
  const imports = []
  let depth = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.value === '{') {
      depth += 1
      continue
    }
    if (token.value === '}') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0 && token.kind === 'identifier' && token.value === 'import') {
      imports.push(tokens[index + 1])
    }
  }
  return imports
}

function runtimeDeclarations(tokens) {
  const declarations = []
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index]?.kind !== 'identifier'
      || tokens[index].value !== 'runtime'
      || tokens[index + 1]?.value !== '{'
    ) {
      continue
    }
    const blockEnd = matchingBrace(tokens, index + 1)
    for (let cursor = index + 2; cursor < blockEnd;) {
      const key = tokens[cursor]
      if (key?.kind !== 'identifier' || tokens[cursor + 1]?.value !== ':') {
        cursor += 1
        continue
      }
      const expressionStart = cursor + 2
      let expressionEnd = expressionStart
      let nested = 0
      while (expressionEnd < blockEnd) {
        const token = tokens[expressionEnd]
        if (nested === 0 && token.value === ',') break
        if (
          nested === 0
          && token.kind === 'identifier'
          && tokens[expressionEnd + 1]?.value === ':'
        ) {
          break
        }
        if (['{', '[', '('].includes(token.value)) nested += 1
        else if (['}', ']', ')'].includes(token.value)) nested = Math.max(0, nested - 1)
        expressionEnd += 1
      }
      if (key.value === 'docker' || key.value === 'container') {
        declarations.push({ key: key.value, expression: tokens.slice(expressionStart, expressionEnd) })
      }
      cursor = expressionEnd
    }
    index = blockEnd
  }
  return declarations
}

function structuralValidation(resolved) {
  const { metadata, snapshot } = resolved
  const diagnostics = []
  let truncated = false
  const addDiagnostic = (item) => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(item)
    else truncated = true
  }
  const files = new Map(snapshot.files.map((file) => [file.path, file]))
  const entrypoint = files.get(metadata.entrypoint)
  const entrypointValid = entrypoint?.role === 'workflow'
  if (!entrypointValid) {
    addDiagnostic(diagnostic('$.entrypoint', 'entrypoint_missing', 'main.wdl must exist with the workflow role'))
  } else if (!hasTopLevelWorkflow(entrypoint.content)) {
    addDiagnostic(diagnostic('$.entrypoint', 'workflow_declaration', 'entrypoint must declare a workflow'))
  }

  let versionValid = true
  let importsSafe = true
  const wdlFiles = snapshot.files.filter((file) => file.path.endsWith('.wdl'))
  for (const file of wdlFiles) {
    const tokens = tokenizeWdl(file.content)
    const version = declaredWdlVersion(file.content)
    if (version !== '1.0') {
      versionValid = false
      addDiagnostic(diagnostic(
        `$.files[${file.path}]`,
        'wdl_version',
        version === null ? 'must declare WDL version 1.0 as the first substantive line' : `must declare WDL 1.0, found ${version}`,
      ))
    }
    for (const importedToken of topLevelImports(tokens)) {
      const imported = importedToken?.value
      if (
        importedToken?.kind !== 'string'
        || importedToken.plain !== true
        || /^[a-z][a-z0-9+.-]*:/i.test(imported)
        || !isSafeBundlePath(imported)
      ) {
        importsSafe = false
        addDiagnostic(diagnostic(
          `$.files[${file.path}]`,
          'external_import',
          importedToken?.kind === 'string' && importedToken.plain === true
            ? `remote or escaping import is forbidden: ${imported}`
            : 'imports must use plain static local string literals',
        ))
        continue
      }
      const target = posix.normalize(posix.join(posix.dirname(file.path), imported))
      if (!isSafeBundlePath(target) || !files.has(target) || !target.endsWith('.wdl')) {
        importsSafe = false
        addDiagnostic(diagnostic(
          `$.files[${file.path}]`,
          'missing_import',
          `local WDL import is not present in the revision: ${imported}`,
        ))
      }
    }
  }

  let examplesValid = true
  for (const file of snapshot.files.filter((item) => item.role === 'example')) {
    try {
      JSON.parse(file.content)
    } catch {
      examplesValid = false
      addDiagnostic(diagnostic(`$.files[${file.path}]`, 'json', 'example file must contain valid JSON'))
    }
  }

  let containersValid = true
  for (const file of wdlFiles) {
    for (const declaration of runtimeDeclarations(tokenizeWdl(file.content))) {
      const literal = declaration.expression.length === 1
        && declaration.expression[0].kind === 'string'
        && declaration.expression[0].plain === true
        ? declaration.expression[0].value
        : null
      if (literal === null) {
        containersValid = false
        addDiagnostic(diagnostic(
          `$.files[${file.path}]`,
          'container_reference_dynamic',
          'container references must be literal digest-pinned images',
        ))
      } else if (!/^[^\s"'\\]+@sha256:[a-f0-9]{64}$/.test(literal)) {
        containersValid = false
        addDiagnostic(diagnostic(
          `$.files[${file.path}]`,
          'container_digest_unpinned',
          `container image must be pinned by SHA-256 digest: ${literal}`,
        ))
      }
    }
  }

  let metadataValid = true
  const descriptorFile = files.get('workflow.json')
  if (descriptorFile !== undefined) {
    try {
      const descriptor = JSON.parse(descriptorFile.content)
      const contents = Object.fromEntries(snapshot.files
        .filter((file) => file.path !== 'workflow.json')
        .map((file) => [file.path, file.content]))
      validateLoadedWdlBundle(descriptor, contents)
    } catch (error) {
      metadataValid = false
      if (error instanceof WdlBundleValidationError) {
        for (const item of error.errors) {
          addDiagnostic(diagnostic(
            `$.workflow.json${item.path.slice(1)}`,
            item.code,
            item.message,
          ))
        }
      } else {
        addDiagnostic(diagnostic('$.workflow.json', 'json', 'workflow.json must contain valid bundle metadata'))
      }
    }
  }

  const checks = [
    { id: 'source-integrity', status: 'passed' },
    { id: 'entrypoint', status: entrypointValid && hasTopLevelWorkflow(entrypoint?.content ?? '') ? 'passed' : 'failed' },
    { id: 'wdl-version', status: versionValid ? 'passed' : 'failed' },
    { id: 'local-imports', status: importsSafe ? 'passed' : 'failed' },
    { id: 'examples', status: examplesValid ? 'passed' : 'failed' },
    { id: 'container-pins', status: containersValid ? 'passed' : 'failed' },
    { id: 'bundle-metadata', status: descriptorFile === undefined ? 'not_applicable' : metadataValid ? 'passed' : 'failed' },
  ]
  return {
    diagnostics,
    checks,
    engineSafe: entrypointValid && importsSafe,
    structurallyValid: diagnostics.every((item) => item.severity !== 'error'),
    truncated,
  }
}

function currentUid() {
  return typeof process.getuid === 'function' ? BigInt(process.getuid()) : null
}

async function assertProtectedPathAncestors(path) {
  const uid = currentUid()
  const ancestors = []
  let ancestor = dirname(path)
  while (true) {
    const metadata = await lstat(ancestor, { bigint: true })
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('validator executable ancestors must be non-symlink directories')
    }
    ancestors.push(metadata)
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  const filesystemRootUid = ancestors.at(-1).uid
  for (const metadata of ancestors) {
    if (uid !== null && metadata.uid !== filesystemRootUid && metadata.uid !== uid) {
      throw new Error('validator executable ancestors have an unsafe owner')
    }
    if ((metadata.mode & 0o022n) !== 0n && (metadata.mode & 0o1000n) === 0n) {
      throw new Error('writable validator executable ancestors must use sticky replacement protection')
    }
  }
}

function executableIdentity(path, metadata) {
  return {
    path,
    size: metadata.size.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    uid: metadata.uid.toString(),
    mode: (metadata.mode & 0o777n).toString(8).padStart(3, '0'),
  }
}

function sameIdentity(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key])
}

async function inspectExecutable(path) {
  const initial = await lstat(path, { bigint: true })
  if (!initial.isFile() || initial.isSymbolicLink()) {
    throw new Error('validator executable must be a canonical non-symlink regular file')
  }
  const canonical = await realpath(path)
  if (canonical !== path) throw new Error('validator executable path must be canonical')
  await assertProtectedPathAncestors(canonical)
  let handle
  try {
    handle = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
    const metadata = await handle.stat({ bigint: true })
    if (!metadata.isFile()) throw new Error('validator executable must remain a regular file')
    if (process.platform !== 'linux' || await realpath(`/proc/self/fd/${handle.fd}`) !== canonical) {
      throw new Error('validator executable descriptor identity could not be verified')
    }
    const uid = currentUid()
    if (uid !== null && metadata.uid !== 0n && metadata.uid !== uid) {
      throw new Error('validator executable has an unsafe owner')
    }
    if ((metadata.mode & 0o022n) !== 0n || (metadata.mode & 0o111n) === 0n) {
      throw new Error('validator executable permissions are unsafe')
    }
    await access(canonical, constants.R_OK | constants.X_OK)
    return executableIdentity(canonical, metadata)
  } finally {
    await handle?.close()
  }
}

async function assertExecutableUnchanged(identity) {
  if (!sameIdentity(identity, await inspectExecutable(identity.path))) {
    throw new Error('validator executable changed during validation')
  }
}

function boundedSignal(signal) {
  const timeout = AbortSignal.timeout(VALIDATION_TIMEOUT_MS)
  return { signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]), timeout }
}

function childEnvironment(ambientEnvironment, validationRoot) {
  const environment = Object.create(null)
  const ambient = ambientEnvironment !== null && typeof ambientEnvironment === 'object'
    ? ambientEnvironment
    : {}
  for (const key of Object.keys(ambient)) environment[key] = undefined
  Object.assign(environment, {
    HOME: '/nonexistent',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    PATH: '/nonexistent',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONSAFEPATH: '1',
    TMPDIR: validationRoot,
  })
  return environment
}

function readCollected(reader) {
  if (reader === undefined) return { text: '', lossy: false }
  const result = reader.readFrom(0)
  return { text: result.text, lossy: result.lossy }
}

function boundedNonEmptyLines(value, limit) {
  const selected = []
  let count = 0
  let start = 0
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && value[index] !== '\n') continue
    const line = value.slice(start, index).trimEnd()
    start = index + 1
    if (line.trim().length === 0) continue
    count += 1
    const candidate = { line, bytes: Buffer.from(line, 'utf8') }
    if (
      selected.length === limit
      && Buffer.compare(candidate.bytes, selected.at(-1).bytes) >= 0
    ) {
      continue
    }
    let low = 0
    let high = selected.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (Buffer.compare(candidate.bytes, selected[middle].bytes) < 0) high = middle
      else low = middle + 1
    }
    selected.splice(low, 0, candidate)
    if (selected.length > limit) selected.pop()
  }
  return {
    lines: selected.map((item) => item.line),
    truncated: count > limit,
  }
}

async function runCommand(subprocess, argv, cwd, identity, operation, validationRoot) {
  await assertExecutableUnchanged(identity)
  const bounded = boundedSignal(operation.signal)
  const handle = subprocess.spawn({
    argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: MAX_OUTPUT_BYTES },
      stderr: { maxBytes: MAX_OUTPUT_BYTES },
    },
    graceMs: PROCESS_GRACE_MS,
    signal: bounded.signal,
    env: childEnvironment(operation.environment, validationRoot),
  })
  const outcome = await handle.done
  await handle.waitForExit()
  throwIfAborted(operation.signal)
  if (bounded.timeout.aborted) throw new Error(`validator timed out after ${VALIDATION_TIMEOUT_MS}ms`)
  return {
    outcome,
    stdout: readCollected(handle.collected?.stdout),
    stderr: readCollected(handle.collected?.stderr),
  }
}

async function ensureSnapshotDirectory(root, path) {
  let current = root
  for (const segment of path.split('/').slice(0, -1)) {
    current = join(current, segment)
    try {
      await mkdir(current, { mode: 0o700 })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const metadata = await lstat(current)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('unsafe validation snapshot directory')
    const canonical = await realpath(current)
    const remainder = relative(root, canonical)
    if (remainder === '..' || remainder.startsWith(`..${sep}`)) throw new Error('validation snapshot escaped its root')
  }
}

async function writeSnapshotFile(root, file) {
  await ensureSnapshotDirectory(root, file.path)
  const path = join(root, ...file.path.split('/'))
  let handle
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    await handle.writeFile(file.content, 'utf8')
  } finally {
    await handle?.close()
  }
}

function normalizeMiniwdlDiagnostics(result, validationRoot) {
  const combined = [result.stderr.text, result.stdout.text].filter(Boolean).join('\n')
  const normalizedRoot = `${validationRoot}${sep}`
  const scanned = boundedNonEmptyLines(
    combined.replaceAll(normalizedRoot, '$DRAFT/'),
    MAX_DIAGNOSTICS,
  )
  const truncated = result.stdout.lossy || result.stderr.lossy || scanned.truncated
  const normalized = scanned.lines.map((line) => diagnostic(
    '$.miniwdl',
    'miniwdl_output',
    line,
    result.outcome.exitCode === 0 ? 'warning' : 'error',
    'miniwdl',
  ))
  return {
    diagnostics: sortDiagnostics(normalized).slice(0, MAX_DIAGNOSTICS),
    truncated,
  }
}

export function createDraftValidator(options) {
  if (!isPlainObject(options) || typeof options.store?.resolve !== 'function') {
    throw new TypeError('draft validator requires a draft store')
  }
  const store = options.store
  const config = parseDraftValidationConfig(options.config ?? {})
  const getSubprocess = typeof options.getSubprocess === 'function' ? options.getSubprocess : () => undefined
  const getEnvironment = typeof options.getEnvironment === 'function' ? options.getEnvironment : () => process.env

  return Object.freeze({
    config,
    summary() {
      const subprocess = getSubprocess()
      return {
        configured: true,
        subprocessAvailable: typeof subprocess?.resolveExecutable === 'function' && typeof subprocess?.spawn === 'function',
        expectedVersion: config.validator.expectedVersion,
        policyVersion: DRAFT_VALIDATOR_POLICY_VERSION,
      }
    },
    async validate(optionsValue, operation = {}) {
      throwIfAborted(operation.signal)
      const resolved = await store.resolve(optionsValue, operation)
      if (!resolved.ok) return resolved
      const structural = structuralValidation(resolved)
      if (!structural.engineSafe) {
        const diagnostics = sortDiagnostics(structural.diagnostics)
        const checks = [...structural.checks, { id: 'miniwdl-check', status: 'skipped' }]
        const core = {
          schemaVersion: DRAFT_VALIDATION_SCHEMA_VERSION,
          draftId: resolved.metadata.draftId,
          revision: resolved.snapshot.revision,
          contentDigest: resolved.snapshot.contentDigest,
          pluginVersion: PACKAGE_VERSION,
          policyVersion: DRAFT_VALIDATOR_POLICY_VERSION,
          languageVersion: resolved.metadata.languageVersion,
          validator: null,
          checks,
          diagnostics,
          valid: false,
          truncated: structural.truncated,
          executionAuthorized: false,
        }
        return { ok: true, validation: { ...core, validationDigest: digestValue(core) } }
      }
      const subprocess = getSubprocess()
      if (typeof subprocess?.resolveExecutable !== 'function' || typeof subprocess?.spawn !== 'function') {
        return errorResult('validator_unavailable', 'miniwdl validator service is unavailable', {
          draftId: resolved.metadata.draftId,
          revision: resolved.snapshot.revision,
          contentDigest: resolved.snapshot.contentDigest,
          diagnostics: sortDiagnostics(structural.diagnostics),
        })
      }

      let validationRoot
      try {
        const resolveSignal = boundedSignal(operation.signal)
        const executable = await subprocess.resolveExecutable(
          config.validator.executable,
          { NO_COLOR: '1' },
          resolveSignal.signal,
        )
        throwIfAborted(operation.signal)
        if (resolveSignal.timeout.aborted || !isAbsolute(executable)) {
          throw new Error('validator executable resolution failed or timed out')
        }
        const identity = await inspectExecutable(executable)
        validationRoot = await mkdtemp(join(tmpdir(), 'dsh-bio-wdl-validate-'))
        for (const file of resolved.snapshot.files) {
          throwIfAborted(operation.signal)
          await writeSnapshotFile(validationRoot, file)
        }

        const runOperation = {
          signal: operation.signal,
          environment: getEnvironment(),
        }
        const versionResult = await runCommand(
          subprocess,
          [identity.path, '--version'],
          validationRoot,
          identity,
          runOperation,
          validationRoot,
        )
        const versionMatch = /(?:^|\s)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\s|$)/.exec(
          versionResult.stdout.text.trim(),
        )
        if (
          versionResult.outcome.exitCode !== 0
          || versionResult.outcome.signal !== null
          || versionResult.stdout.lossy
          || versionResult.stderr.lossy
          || versionMatch === null
        ) {
          throw new Error('miniwdl version probe did not return a bounded exact version')
        }
        if (versionMatch[1] !== config.validator.expectedVersion) {
          throw new Error(`miniwdl version mismatch: expected ${config.validator.expectedVersion}, found ${versionMatch[1]}`)
        }

        const checkResult = await runCommand(
          subprocess,
          [identity.path, 'check', '--no-outside-imports', resolved.metadata.entrypoint],
          validationRoot,
          identity,
          runOperation,
          validationRoot,
        )
        if (!Number.isSafeInteger(checkResult.outcome.exitCode) || checkResult.outcome.signal !== null) {
          throw new Error('miniwdl check terminated without a normal exit code')
        }
        const miniwdl = normalizeMiniwdlDiagnostics(checkResult, validationRoot)
        const diagnostics = sortDiagnostics([...structural.diagnostics, ...miniwdl.diagnostics])
        const miniwdlPassed = checkResult.outcome.exitCode === 0
        if (!miniwdlPassed && miniwdl.diagnostics.length === 0) {
          diagnostics.push(diagnostic('$.miniwdl', 'miniwdl_check_failed', 'miniwdl check exited unsuccessfully', 'error', 'miniwdl'))
        }
        const checks = [...structural.checks, { id: 'miniwdl-check', status: miniwdlPassed ? 'passed' : 'failed' }]
        const core = {
          schemaVersion: DRAFT_VALIDATION_SCHEMA_VERSION,
          draftId: resolved.metadata.draftId,
          revision: resolved.snapshot.revision,
          contentDigest: resolved.snapshot.contentDigest,
          pluginVersion: PACKAGE_VERSION,
          policyVersion: DRAFT_VALIDATOR_POLICY_VERSION,
          languageVersion: resolved.metadata.languageVersion,
          validator: {
            name: 'miniwdl',
            version: versionMatch[1],
            executable: identity,
          },
          checks,
          diagnostics: sortDiagnostics(diagnostics).slice(0, MAX_DIAGNOSTICS),
          valid: structural.structurallyValid && miniwdlPassed,
          truncated: structural.truncated || miniwdl.truncated || diagnostics.length > MAX_DIAGNOSTICS,
          executionAuthorized: false,
        }
        return { ok: true, validation: { ...core, validationDigest: digestValue(core) } }
      } catch (error) {
        throwIfAborted(operation.signal)
        return errorResult('validator_unavailable', 'miniwdl validator could not produce authoritative evidence', {
          draftId: resolved.metadata.draftId,
          revision: resolved.snapshot.revision,
          contentDigest: resolved.snapshot.contentDigest,
          reason: String(error?.message ?? error).slice(0, MAX_DIAGNOSTIC_TEXT),
          diagnostics: sortDiagnostics(structural.diagnostics),
        })
      } finally {
        if (validationRoot !== undefined) await rm(validationRoot, { recursive: true, force: true })
      }
    },
  })
}
