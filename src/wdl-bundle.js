import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseWorkflowManifest, validateWorkflowManifest } from './manifest.js'

export const WDL_BUNDLE_SCHEMA_VERSION = '1'
export const WDL_LANGUAGE_VERSIONS = Object.freeze(['1.0', '1.1', '1.2', '1.3'])
export const WDL_FILE_ROLES = Object.freeze([
  'workflow',
  'task',
  'example',
  'documentation',
  'license',
])
export const WDL_SOURCE_KINDS = Object.freeze(['builtin', 'local', 'git', 'trs'])
export const WDL_VERIFICATION_STATUSES = Object.freeze([
  'unverified',
  'structural',
  'verified',
])

const MAX_DESCRIPTOR_BYTES = 256 * 1024
const MAX_FILE_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const MAX_FILES = 128
const MAX_DIRECTORIES = 128
const MAX_VALIDATION_ERRORS = 256
const MAX_ERROR_TEXT_LENGTH = 512
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const BUNDLE_KEYS = new Set([
  'bundleVersion',
  'manifest',
  'wdl',
  'source',
  'authors',
  'license',
  'verification',
  'files',
])
const WDL_KEYS = new Set(['version', 'entrypoint', 'engines'])
const ENGINE_KEYS = new Set(['name', 'version'])
const SOURCE_KEYS = new Set(['kind', 'repository', 'revision'])
const VERIFICATION_KEYS = new Set(['status', 'checks'])
const FILE_KEYS = new Set(['path', 'role', 'sha256'])

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function addError(errors, path, code, message) {
  if (errors.length >= MAX_VALIDATION_ERRORS) return
  errors.push({
    path: String(path).slice(0, MAX_ERROR_TEXT_LENGTH),
    code,
    message: String(message).slice(0, MAX_ERROR_TEXT_LENGTH),
  })
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
    return false
  }
  if (options.minLength !== undefined && value.length < options.minLength) {
    addError(errors, path, 'min_length', `must contain at least ${options.minLength} character(s)`)
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    addError(errors, path, 'max_length', `must contain at most ${options.maxLength} character(s)`)
  }
  if (options.pattern !== undefined && !options.pattern.test(value)) {
    addError(errors, path, 'format', options.patternMessage)
  }
  return true
}

function validateEnum(value, allowed, path, errors) {
  if (!allowed.includes(value)) {
    addError(errors, path, 'enum', `must be one of: ${allowed.join(', ')}`)
  }
}

function prefixManifestErrors(errors) {
  return errors.map((error) => ({
    ...error,
    path: `$.manifest${error.path.slice(1)}`,
  }))
}

export function isSafeBundlePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) return false
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/')) return false
  const segments = value.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function validateEngine(value, index, errors) {
  const path = `$.wdl.engines[${index}]`
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
    validateString(value.version, `${path}.version`, errors, { minLength: 1, maxLength: 128 })
  }
}

function validateWdl(value, errors) {
  const path = '$.wdl'
  if (!isPlainObject(value)) {
    addError(errors, path, 'type', 'must be an object')
    return
  }
  validateAllowedKeys(value, WDL_KEYS, path, errors)
  validateRequiredKeys(value, ['version', 'entrypoint', 'engines'], path, errors)
  if (Object.hasOwn(value, 'version')) {
    if (validateString(value.version, `${path}.version`, errors, { minLength: 1, maxLength: 16 })) {
      validateEnum(value.version, WDL_LANGUAGE_VERSIONS, `${path}.version`, errors)
    }
  }
  if (Object.hasOwn(value, 'entrypoint')) {
    if (validateString(value.entrypoint, `${path}.entrypoint`, errors, { minLength: 1, maxLength: 240 })) {
      if (!isSafeBundlePath(value.entrypoint) || !value.entrypoint.endsWith('.wdl')) {
        addError(errors, `${path}.entrypoint`, 'format', 'must be a safe relative .wdl path')
      }
    }
  }
  if (Object.hasOwn(value, 'engines')) {
    if (!Array.isArray(value.engines)) {
      addError(errors, `${path}.engines`, 'type', 'must be an array')
    } else {
      if (value.engines.length === 0) {
        addError(errors, `${path}.engines`, 'min_items', 'must contain at least one engine')
      }
      const names = new Set()
      value.engines.forEach((engine, index) => {
        validateEngine(engine, index, errors)
        if (isPlainObject(engine) && typeof engine.name === 'string') {
          if (names.has(engine.name)) {
            addError(errors, `${path}.engines[${index}].name`, 'duplicate', `duplicate engine: ${engine.name}`)
          }
          names.add(engine.name)
        }
      })
    }
  }
}

function validateSource(value, errors) {
  const path = '$.source'
  if (!isPlainObject(value)) {
    addError(errors, path, 'type', 'must be an object')
    return
  }
  validateAllowedKeys(value, SOURCE_KEYS, path, errors)
  validateRequiredKeys(value, ['kind'], path, errors)
  if (Object.hasOwn(value, 'kind')) {
    if (validateString(value.kind, `${path}.kind`, errors, { minLength: 1, maxLength: 32 })) {
      validateEnum(value.kind, WDL_SOURCE_KINDS, `${path}.kind`, errors)
    }
  }
  for (const key of ['repository', 'revision']) {
    if (Object.hasOwn(value, key)) {
      validateString(value[key], `${path}.${key}`, errors, { minLength: 1, maxLength: 500 })
    }
  }
}

function validateStringArray(value, path, errors, options = {}) {
  if (!Array.isArray(value)) {
    addError(errors, path, 'type', 'must be an array')
    return
  }
  if (options.maxItems !== undefined && value.length > options.maxItems) {
    addError(errors, path, 'max_items', `must contain at most ${options.maxItems} item(s)`)
  }
  const seen = new Set()
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    validateString(item, itemPath, errors, { minLength: 1, maxLength: options.maxLength ?? 200 })
    if (typeof item === 'string') {
      if (seen.has(item)) addError(errors, itemPath, 'duplicate', `duplicate value: ${item}`)
      seen.add(item)
    }
  })
}

function validateVerification(value, errors) {
  const path = '$.verification'
  if (!isPlainObject(value)) {
    addError(errors, path, 'type', 'must be an object')
    return
  }
  validateAllowedKeys(value, VERIFICATION_KEYS, path, errors)
  validateRequiredKeys(value, ['status', 'checks'], path, errors)
  if (Object.hasOwn(value, 'status')) {
    if (validateString(value.status, `${path}.status`, errors, { minLength: 1, maxLength: 32 })) {
      validateEnum(value.status, WDL_VERIFICATION_STATUSES, `${path}.status`, errors)
    }
  }
  if (Object.hasOwn(value, 'checks')) {
    validateStringArray(value.checks, `${path}.checks`, errors, { maxItems: 32, maxLength: 160 })
  }
}

function validateFiles(value, errors) {
  const path = '$.files'
  if (!Array.isArray(value)) {
    addError(errors, path, 'type', 'must be an array')
    return
  }
  if (value.length === 0) addError(errors, path, 'min_items', 'must contain at least one file')
  if (value.length > MAX_FILES) addError(errors, path, 'max_items', `must contain at most ${MAX_FILES} files`)

  const paths = new Set()
  value.forEach((file, index) => {
    const itemPath = `${path}[${index}]`
    if (!isPlainObject(file)) {
      addError(errors, itemPath, 'type', 'must be an object')
      return
    }
    validateAllowedKeys(file, FILE_KEYS, itemPath, errors)
    validateRequiredKeys(file, ['path', 'role', 'sha256'], itemPath, errors)
    if (Object.hasOwn(file, 'path')) {
      if (validateString(file.path, `${itemPath}.path`, errors, { minLength: 1, maxLength: 240 })) {
        if (!isSafeBundlePath(file.path)) {
          addError(errors, `${itemPath}.path`, 'format', 'must be a safe relative path')
        }
        if (file.path === 'workflow.json') {
          addError(errors, `${itemPath}.path`, 'reserved_path', 'workflow.json is reserved for the bundle descriptor')
        }
        if (paths.has(file.path)) {
          addError(errors, `${itemPath}.path`, 'duplicate', `duplicate file path: ${file.path}`)
        }
        paths.add(file.path)
      }
    }
    if (Object.hasOwn(file, 'role')) {
      if (validateString(file.role, `${itemPath}.role`, errors, { minLength: 1, maxLength: 32 })) {
        validateEnum(file.role, WDL_FILE_ROLES, `${itemPath}.role`, errors)
      }
    }
    if (Object.hasOwn(file, 'sha256')) {
      validateString(file.sha256, `${itemPath}.sha256`, errors, {
        minLength: 64,
        maxLength: 64,
        pattern: SHA256_PATTERN,
        patternMessage: 'must be a lowercase SHA-256 digest',
      })
    }
  })
}

export function validateWdlBundleDescriptor(value) {
  const errors = []
  if (!isPlainObject(value)) {
    addError(errors, '$', 'type', 'WDL bundle descriptor must be an object')
    return { valid: false, errors }
  }

  validateAllowedKeys(value, BUNDLE_KEYS, '$', errors)
  validateRequiredKeys(
    value,
    ['bundleVersion', 'manifest', 'wdl', 'source', 'authors', 'license', 'verification', 'files'],
    '$',
    errors,
  )

  if (Object.hasOwn(value, 'bundleVersion') && value.bundleVersion !== WDL_BUNDLE_SCHEMA_VERSION) {
    addError(errors, '$.bundleVersion', 'const', `must equal ${WDL_BUNDLE_SCHEMA_VERSION}`)
  }
  if (Object.hasOwn(value, 'manifest')) {
    const manifestResult = validateWorkflowManifest(value.manifest)
    if (!manifestResult.valid) {
      for (const error of prefixManifestErrors(manifestResult.errors)) {
        addError(errors, error.path, error.code, error.message)
      }
    }
  }
  if (Object.hasOwn(value, 'wdl')) validateWdl(value.wdl, errors)
  if (Object.hasOwn(value, 'source')) validateSource(value.source, errors)
  if (Object.hasOwn(value, 'authors')) {
    validateStringArray(value.authors, '$.authors', errors, { maxItems: 32, maxLength: 200 })
  }
  if (Object.hasOwn(value, 'license')) {
    validateString(value.license, '$.license', errors, { minLength: 1, maxLength: 100 })
  }
  if (Object.hasOwn(value, 'verification')) validateVerification(value.verification, errors)
  if (Object.hasOwn(value, 'files')) validateFiles(value.files, errors)

  if (
    isPlainObject(value.wdl)
    && typeof value.wdl.entrypoint === 'string'
    && Array.isArray(value.files)
  ) {
    const entrypoint = value.files.find((file) => file?.path === value.wdl.entrypoint)
    if (entrypoint === undefined) {
      addError(errors, '$.wdl.entrypoint', 'missing_file', 'entrypoint must be declared in files')
    } else if (entrypoint.role !== 'workflow') {
      addError(errors, '$.wdl.entrypoint', 'role', 'entrypoint file role must be workflow')
    }
  }
  if (
    isPlainObject(value.manifest)
    && isPlainObject(value.manifest.engine)
    && typeof value.manifest.engine.name === 'string'
    && isPlainObject(value.wdl)
    && Array.isArray(value.wdl.engines)
    && !value.wdl.engines.some((engine) => engine?.name === value.manifest.engine.name)
  ) {
    addError(
      errors,
      '$.manifest.engine.name',
      'compatibility',
      'manifest engine must be included in wdl.engines',
    )
  }

  return { valid: errors.length === 0, errors }
}

export class WdlBundleValidationError extends Error {
  constructor(errors) {
    super(`invalid WDL bundle: ${errors.map((error) => `${error.path} ${error.message}`).join('; ')}`)
    this.name = 'WdlBundleValidationError'
    this.errors = errors
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}

export function parseWdlBundleDescriptor(value) {
  const result = validateWdlBundleDescriptor(value)
  if (!result.valid) throw new WdlBundleValidationError(result.errors)

  return deepFreeze({
    bundleVersion: value.bundleVersion,
    manifest: parseWorkflowManifest(value.manifest),
    wdl: {
      version: value.wdl.version,
      entrypoint: value.wdl.entrypoint,
      engines: value.wdl.engines.map((engine) => ({
        name: engine.name,
        ...(engine.version === undefined ? {} : { version: engine.version }),
      })),
    },
    source: {
      kind: value.source.kind,
      ...(value.source.repository === undefined ? {} : { repository: value.source.repository }),
      ...(value.source.revision === undefined ? {} : { revision: value.source.revision }),
    },
    authors: [...value.authors],
    license: value.license,
    verification: {
      status: value.verification.status,
      checks: [...value.verification.checks],
    },
    files: value.files.map((file) => ({ ...file })),
  })
}

export function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function computeWdlBundleDigest(bundle) {
  const hash = createHash('sha256')
  hash.update(stableStringify(bundle.descriptor))
  for (const path of Object.keys(bundle.contents).sort()) {
    hash.update('\0')
    hash.update(path)
    hash.update('\0')
    hash.update(bundle.contents[path], 'utf8')
  }
  return `sha256:${hash.digest('hex')}`
}

function resolveBundleFile(root, relativePath) {
  const resolved = resolve(root, ...relativePath.split('/'))
  if (!isContainedPath(root, resolved)) {
    throw new WdlBundleValidationError([
      { path: '$.files', code: 'path_escape', message: `file escapes bundle root: ${relativePath}` },
    ])
  }
  return resolved
}

function isContainedPath(root, target) {
  const remainder = relative(root, target)
  return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`))
}

function fileIssue(errorPath, code, message) {
  return new WdlBundleValidationError([{ path: errorPath, code, message }])
}

async function inspectSafeBundlePath(root, relativePath, errorPath, expectedType) {
  const segments = relativePath === '' ? [] : relativePath.split('/')
  let current = root
  let initialRootStat

  try {
    initialRootStat = await lstat(root)
    if (!initialRootStat.isDirectory() || initialRootStat.isSymbolicLink()) {
      throw fileIssue('$', 'directory_type', 'bundle root must be a non-symlink directory')
    }
    for (let index = 0; index < segments.length; index += 1) {
      current = resolve(current, segments[index])
      const stat = await lstat(current)
      const final = index === segments.length - 1
      if (stat.isSymbolicLink()) {
        throw fileIssue(errorPath, 'symlink', `bundle path must not contain symlinks: ${relativePath}`)
      }
      if (!final && !stat.isDirectory()) {
        throw fileIssue(errorPath, 'file_type', `bundle path parent must be a directory: ${relativePath}`)
      }
      if (final && expectedType === 'file' && !stat.isFile()) {
        throw fileIssue(errorPath, 'file_type', 'must be a regular non-symlink file')
      }
      if (final && expectedType === 'directory' && !stat.isDirectory()) {
        throw fileIssue(errorPath, 'directory_type', 'must be a non-symlink directory')
      }
    }
  } catch (error) {
    if (error instanceof WdlBundleValidationError) throw error
    if (error?.code === 'ENOENT') {
      const code = expectedType === 'directory' ? 'missing_directory' : 'missing_file'
      throw fileIssue(errorPath, code, `${expectedType} does not exist`)
    }
    throw error
  }

  const canonicalRoot = await realpath(root)
  const completedRootStat = await lstat(root)
  if (
    !completedRootStat.isDirectory()
    || completedRootStat.isSymbolicLink()
    || completedRootStat.dev !== initialRootStat.dev
    || completedRootStat.ino !== initialRootStat.ino
  ) {
    throw fileIssue('$', 'path_changed', 'bundle root changed during path inspection')
  }
  const canonicalTarget = await realpath(current)
  if (!isContainedPath(canonicalRoot, canonicalTarget)) {
    throw fileIssue(errorPath, 'path_escape', `bundle path escapes its root: ${relativePath}`)
  }
  return { canonicalRoot, canonicalTarget, target: current }
}

async function readBoundedFile(
  root,
  relativePath,
  maxBytes,
  remainingBytes,
  errorPath,
  onReadBytes,
) {
  const inspected = await inspectSafeBundlePath(root, relativePath, errorPath, 'file')
  const readLimit = Math.min(maxBytes, remainingBytes)
  let handle
  try {
    handle = await open(
      inspected.target,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    )
    const openedStat = await handle.stat()
    if (!openedStat.isFile()) {
      throw fileIssue(errorPath, 'file_type', 'must be a regular non-symlink file')
    }
    if (openedStat.size > maxBytes) {
      throw fileIssue(errorPath, 'max_bytes', `must contain at most ${maxBytes} bytes`)
    }
    if (openedStat.size > remainingBytes) {
      throw fileIssue('$.files', 'max_bytes', `bundle must contain at most ${MAX_TOTAL_BYTES} bytes`)
    }

    const canonicalAfterOpen = await realpath(inspected.target)
    const pathStat = await lstat(inspected.target)
    if (
      pathStat.isSymbolicLink()
      || !pathStat.isFile()
      || canonicalAfterOpen !== inspected.canonicalTarget
      || !isContainedPath(inspected.canonicalRoot, canonicalAfterOpen)
      || pathStat.dev !== openedStat.dev
      || pathStat.ino !== openedStat.ino
    ) {
      throw fileIssue(errorPath, 'path_changed', 'bundle file changed while it was being opened')
    }

    const chunks = []
    let bytes = 0
    while (bytes <= readLimit) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, readLimit + 1 - bytes))
      if (chunk.length === 0) break
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, bytes)
      if (bytesRead === 0) break
      onReadBytes?.(bytesRead)
      chunks.push(chunk.subarray(0, bytesRead))
      bytes += bytesRead
    }
    if (bytes > readLimit) {
      if (remainingBytes < maxBytes) {
        throw fileIssue('$.files', 'max_bytes', `bundle must contain at most ${MAX_TOTAL_BYTES} bytes`)
      }
      throw fileIssue(errorPath, 'max_bytes', `must contain at most ${maxBytes} bytes`)
    }
    const completedStat = await handle.stat()
    const canonicalAfterRead = await realpath(inspected.target)
    const completedPathStat = await lstat(inspected.target)
    if (
      !completedStat.isFile()
      || completedStat.size !== openedStat.size
      || completedStat.mtimeMs !== openedStat.mtimeMs
      || completedStat.ctimeMs !== openedStat.ctimeMs
      || canonicalAfterRead !== inspected.canonicalTarget
      || completedPathStat.isSymbolicLink()
      || !completedPathStat.isFile()
      || completedPathStat.dev !== completedStat.dev
      || completedPathStat.ino !== completedStat.ino
    ) {
      throw fileIssue(errorPath, 'path_changed', 'bundle file changed while it was being read')
    }
    return { content: Buffer.concat(chunks, bytes).toString('utf8'), bytes }
  } catch (error) {
    if (error instanceof WdlBundleValidationError) throw error
    if (error?.code === 'ENOENT') throw fileIssue(errorPath, 'missing_file', 'file does not exist')
    if (error?.code === 'ELOOP') throw fileIssue(errorPath, 'symlink', 'must be a regular non-symlink file')
    throw error
  } finally {
    await handle?.close()
  }
}

async function inventoryBundle(root) {
  const files = []
  const directories = []
  const queue = [{ path: root, relativePath: '' }]
  let visitedEntries = 0

  while (queue.length > 0) {
    const current = queue.shift()
    await inspectSafeBundlePath(root, current.relativePath, '$', 'directory')
    const directory = await opendir(current.path)
    for await (const entry of directory) {
      visitedEntries += 1
      if (visitedEntries > MAX_FILES + MAX_DIRECTORIES + 1) {
        throw fileIssue('$', 'max_entries', 'bundle contains too many filesystem entries')
      }
      const relativePath = current.relativePath === ''
        ? entry.name
        : `${current.relativePath}/${entry.name}`
      const absolutePath = resolveBundleFile(root, relativePath)
      let stat
      try {
        stat = await lstat(absolutePath)
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw fileIssue(`$.files[${relativePath}]`, 'path_changed', 'bundle entry changed during inventory')
        }
        throw error
      }
      if (stat.isSymbolicLink()) {
        throw fileIssue(`$.files[${relativePath}]`, 'symlink', 'bundle entries must not be symlinks')
      }
      if (stat.isDirectory()) {
        directories.push(relativePath)
        if (directories.length > MAX_DIRECTORIES) {
          throw fileIssue('$', 'max_directories', `bundle must contain at most ${MAX_DIRECTORIES} directories`)
        }
        await inspectSafeBundlePath(root, relativePath, `$.files[${relativePath}]`, 'directory')
        queue.push({ path: absolutePath, relativePath })
      } else if (stat.isFile()) {
        files.push(relativePath)
        if (files.length > MAX_FILES + 1) {
          throw fileIssue('$', 'max_files', `bundle must contain at most ${MAX_FILES + 1} files including workflow.json`)
        }
      } else {
        throw fileIssue(`$.files[${relativePath}]`, 'file_type', 'bundle entries must be regular files or directories')
      }
    }
  }
  return { directories, files }
}

function validateBundleInventory(descriptor, inventory) {
  const declaredFiles = new Set(descriptor.files.map((file) => file.path))
  const actualFiles = new Set(inventory.files)
  const errors = []
  for (const path of actualFiles) {
    if (path !== 'workflow.json' && !declaredFiles.has(path)) {
      addError(errors, `$.files[${path}]`, 'undeclared_file', 'bundle file is not declared in workflow.json')
    }
  }
  for (const path of declaredFiles) {
    if (!actualFiles.has(path)) {
      addError(errors, `$.files[${path}]`, 'missing_file', 'declared file does not exist')
    }
  }
  for (const path of inventory.directories) {
    if (![...declaredFiles].some((declared) => declared.startsWith(`${path}/`))) {
      addError(errors, `$.files[${path}]`, 'undeclared_directory', 'bundle directory contains no declared files')
    }
  }
  if (errors.length > 0) throw new WdlBundleValidationError(errors)
}

function validateWdlSourceFiles(descriptor, contents) {
  const errors = []
  const wdlFiles = descriptor.files.filter((file) => file.path.endsWith('.wdl'))

  for (const file of wdlFiles) {
    const source = contents[file.path]
    if (typeof source !== 'string') continue
    const versionMatch = /^\s*version\s+([0-9]+\.[0-9]+)\s*$/m.exec(source)
    if (versionMatch === null) {
      addError(errors, `$.files[${file.path}]`, 'wdl_version', 'must declare a WDL version')
    } else if (versionMatch[1] !== descriptor.wdl.version) {
      addError(
        errors,
        `$.files[${file.path}]`,
        'wdl_version',
        `declares WDL ${versionMatch[1]} instead of ${descriptor.wdl.version}`,
      )
    }

    for (const match of source.matchAll(/\bimport\s+"([^"]+)"/g)) {
      const imported = match[1]
      if (/^[a-z][a-z0-9+.-]*:/i.test(imported) || !isSafeBundlePath(imported)) {
        addError(errors, `$.files[${file.path}]`, 'external_import', `unsafe WDL import: ${imported}`)
        continue
      }
      const target = posix.normalize(posix.join(posix.dirname(file.path), imported))
      if (!isSafeBundlePath(target) || !Object.hasOwn(contents, target)) {
        addError(errors, `$.files[${file.path}]`, 'missing_import', `WDL import is not bundled: ${imported}`)
      }
    }
  }

  const entrypoint = contents[descriptor.wdl.entrypoint]
  if (entrypoint !== undefined && !/\bworkflow\s+[A-Za-z][A-Za-z0-9_]*\s*\{/.test(entrypoint)) {
    addError(errors, '$.wdl.entrypoint', 'workflow_declaration', 'entrypoint must declare a workflow')
  }

  for (const file of descriptor.files.filter((item) => item.role === 'example')) {
    if (typeof contents[file.path] !== 'string') continue
    try {
      JSON.parse(contents[file.path])
    } catch {
      addError(errors, `$.files[${file.path}]`, 'json', 'example file must contain valid JSON')
    }
  }
  return errors
}

export function validateLoadedWdlBundle(descriptorValue, contentsValue) {
  const descriptor = parseWdlBundleDescriptor(descriptorValue)
  const errors = []
  if (!isPlainObject(contentsValue)) {
    throw new WdlBundleValidationError([
      { path: '$.contents', code: 'type', message: 'contents must be an object' },
    ])
  }

  const contents = {}
  let totalBytes = 0
  for (const file of descriptor.files) {
    if (!Object.hasOwn(contentsValue, file.path) || typeof contentsValue[file.path] !== 'string') {
      addError(errors, `$.files[${file.path}]`, 'missing_content', 'declared file content is missing')
      continue
    }
    const content = contentsValue[file.path]
    const bytes = Buffer.byteLength(content, 'utf8')
    totalBytes += bytes
    if (totalBytes > MAX_TOTAL_BYTES) {
      addError(errors, '$.files', 'max_bytes', `bundle must contain at most ${MAX_TOTAL_BYTES} bytes`)
      break
    }
    if (bytes > MAX_FILE_BYTES) {
      addError(errors, `$.files[${file.path}]`, 'max_bytes', `must contain at most ${MAX_FILE_BYTES} bytes`)
    }
    if (sha256Text(content) !== file.sha256) {
      addError(errors, `$.files[${file.path}].sha256`, 'digest_mismatch', 'file digest does not match content')
    }
    contents[file.path] = content
  }
  for (const path of Object.keys(contentsValue)) {
    if (!descriptor.files.some((file) => file.path === path)) {
      addError(errors, `$.contents.${path}`, 'undeclared_file', 'content is not declared in files')
    }
  }
  errors.push(...validateWdlSourceFiles(descriptor, contents))
  if (errors.length > 0) throw new WdlBundleValidationError(errors)

  const bundle = { descriptor, contents: deepFreeze(contents) }
  return deepFreeze({ ...bundle, digest: computeWdlBundleDigest(bundle) })
}

export async function loadWdlBundle(directory, operation = {}) {
  const root = resolve(directory instanceof URL ? fileURLToPath(directory) : directory)
  let rootStat
  try {
    rootStat = await lstat(root)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new WdlBundleValidationError([
        { path: '$', code: 'missing_directory', message: 'bundle directory does not exist' },
      ])
    }
    throw error
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new WdlBundleValidationError([
      { path: '$', code: 'directory_type', message: 'bundle root must be a non-symlink directory' },
    ])
  }
  const descriptorRead = await readBoundedFile(
    root,
    'workflow.json',
    MAX_DESCRIPTOR_BYTES,
    MAX_DESCRIPTOR_BYTES,
    '$.workflow.json',
    operation.onReadBytes,
  )
  const descriptorSource = descriptorRead.content
  let descriptorValue
  try {
    descriptorValue = JSON.parse(descriptorSource)
  } catch {
    throw new WdlBundleValidationError([
      { path: '$.workflow.json', code: 'json', message: 'must contain valid JSON' },
    ])
  }
  const descriptor = parseWdlBundleDescriptor(descriptorValue)
  const inventory = await inventoryBundle(root)
  validateBundleInventory(descriptor, inventory)

  const contents = {}
  let totalBytes = 0
  for (const file of descriptor.files) {
    const read = await readBoundedFile(
      root,
      file.path,
      MAX_FILE_BYTES,
      MAX_TOTAL_BYTES - totalBytes,
      `$.files[${file.path}]`,
      operation.onReadBytes,
    )
    totalBytes += read.bytes
    contents[file.path] = read.content
  }
  validateBundleInventory(descriptor, await inventoryBundle(root))
  return validateLoadedWdlBundle(descriptor, contents)
}

export function describeWdlBundleValidation(bundle) {
  const warnings = []
  const hasMiniWdlCheck = bundle.descriptor.verification.checks
    .some((check) => check === 'miniwdl-check' || check.startsWith('miniwdl-check@'))
  if (hasMiniWdlCheck) {
    warnings.push({
      code: 'wdl_engine_semantics_not_revalidated',
      message: 'The recorded WDL engine check was not rerun by this validation call.',
    })
  } else {
    warnings.push({
      code: 'wdl_engine_semantics_not_checked',
      message: 'WDL engine parsing and semantic validation have not been run.',
    })
  }
  warnings.push({
    code: 'engine_execution_not_checked',
    message: 'The workflow has not been executed by a configured engine.',
  })
  const wdlSources = bundle.descriptor.files
    .filter((file) => file.path.endsWith('.wdl'))
    .map((file) => bundle.contents[file.path])
    .join('\n')
  const literalImages = [...wdlSources.matchAll(/\bdocker\s*:\s*"([^"]+)"/g)]
  if (literalImages.some((match) => !match[1].includes('@sha256:'))) {
    warnings.push({
      code: 'container_digest_unpinned',
      message: 'At least one container image is not pinned by digest.',
    })
  }

  return {
    valid: true,
    level: 'structural',
    executionReady: false,
    digest: bundle.digest,
    workflow: {
      id: bundle.descriptor.manifest.id,
      version: bundle.descriptor.manifest.version,
      language: 'wdl',
      languageVersion: bundle.descriptor.wdl.version,
      entrypoint: bundle.descriptor.wdl.entrypoint,
    },
    verification: bundle.descriptor.verification,
    errors: [],
    warnings,
    limitations: [
      hasMiniWdlCheck ? 'engine_semantics_not_revalidated' : 'engine_semantics_not_checked',
      'engine_execution_not_checked',
      'workflow_execution_disabled',
    ],
  }
}

export async function validateWdlBundleDirectory(directory) {
  try {
    return describeWdlBundleValidation(await loadWdlBundle(directory))
  } catch (error) {
    if (!(error instanceof WdlBundleValidationError)) throw error
    return {
      valid: false,
      level: 'structural',
      executionReady: false,
      digest: null,
      workflow: null,
      verification: null,
      errors: error.errors,
      warnings: [],
      limitations: ['bundle_invalid', 'workflow_execution_disabled'],
    }
  }
}
