import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  WdlBundleValidationError,
  describeWdlBundleValidation,
  loadWdlBundle,
  sha256Text,
  validateLoadedWdlBundle,
} from './wdl-bundle.js'

export const WORKFLOW_STORE_SOURCES = Object.freeze(['builtin', 'installed', 'draft'])

const STORE_CONFIG_KEYS = new Set(['root', 'writeEnabled'])
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const BUNDLE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const MAX_DISCOVERED_BUNDLES = 256
const MAX_DISCOVERED_BYTES = 32 * 1024 * 1024
const MAX_DISCOVERY_ENTRIES = 4096
const MAX_DIAGNOSTICS = 64
const MAX_DIAGNOSTIC_ERRORS = 8
const MAX_CONFIG_ROOT_LENGTH = 4096
const BUILTIN_ROOT = fileURLToPath(new URL('../workflows/', import.meta.url))

function throwIfAborted(signal) {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('workflow store operation was aborted')
  error.name = 'AbortError'
  throw error
}

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

export class WorkflowStoreConfigValidationError extends Error {
  constructor(errors) {
    super(`invalid workflow store config: ${errors.map((error) => `${error.path} ${error.message}`).join('; ')}`)
    this.name = 'WorkflowStoreConfigValidationError'
    this.errors = errors
  }
}

export function parseWorkflowStoreConfig(value = {}) {
  const errors = []
  if (!isPlainObject(value)) {
    throw new WorkflowStoreConfigValidationError([
      { path: '$', code: 'type', message: 'store config must be an object' },
    ])
  }
  for (const key of Object.keys(value)) {
    if (!STORE_CONFIG_KEYS.has(key)) {
      errors.push({ path: `$.${key}`, code: 'additional_property', message: `unsupported property: ${key}` })
    }
  }

  const writeEnabled = value.writeEnabled ?? false
  if (typeof writeEnabled !== 'boolean') {
    errors.push({ path: '$.writeEnabled', code: 'type', message: 'must be a boolean' })
  }
  if (value.root !== undefined) {
    if (typeof value.root !== 'string' || value.root.length === 0) {
      errors.push({ path: '$.root', code: 'type', message: 'must be a non-empty string' })
    } else if (value.root.length > MAX_CONFIG_ROOT_LENGTH) {
      errors.push({ path: '$.root', code: 'max_length', message: `must contain at most ${MAX_CONFIG_ROOT_LENGTH} characters` })
    } else if (!isAbsolute(value.root)) {
      errors.push({ path: '$.root', code: 'format', message: 'must be an absolute path' })
    }
  }
  if (writeEnabled === true && value.root === undefined) {
    errors.push({ path: '$.root', code: 'required', message: 'is required when writes are enabled' })
  }
  if (errors.length > 0) throw new WorkflowStoreConfigValidationError(errors)

  return deepFreeze({
    root: value.root === undefined ? null : resolve(value.root),
    writeEnabled,
  })
}

function storePathError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

async function inspectStoreDirectory(path, containmentRoot) {
  const initial = await lstat(path)
  if (!initial.isDirectory() || initial.isSymbolicLink()) {
    throw storePathError('STORE_PATH_UNSAFE', `unsafe workflow store discovery path: ${path}`)
  }
  const canonical = await realpath(path)
  const completed = await lstat(path)
  if (
    !completed.isDirectory()
    || completed.isSymbolicLink()
    || completed.dev !== initial.dev
    || completed.ino !== initial.ino
    || (containmentRoot !== undefined && !isContainedPath(containmentRoot, canonical))
  ) {
    throw storePathError('STORE_PATH_UNSAFE', `unsafe workflow store discovery path: ${path}`)
  }
  return canonical
}

async function safeDirectoryEntries(path, budget, containmentRoot) {
  const entries = []
  let directory
  try {
    await inspectStoreDirectory(path, containmentRoot)
    directory = await opendir(path)
    for await (const entry of directory) {
      if (budget.remainingDiscoveryEntries === 0) {
        throw storePathError('STORE_ENTRY_LIMIT', 'workflow store contains too many directory entries')
      }
      budget.remainingDiscoveryEntries -= 1
      entries.push(entry)
    }
    return entries
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function discoverBundleDirectories(root, limit, budget, containmentRoot) {
  const directories = []
  const ids = (await safeDirectoryEntries(root, budget, containmentRoot))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))

  for (const id of ids) {
    const idPath = join(root, id.name)
    const versions = (await safeDirectoryEntries(idPath, budget, containmentRoot))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const version of versions) {
      const directory = join(idPath, version.name)
      await inspectStoreDirectory(directory, containmentRoot)
      directories.push(directory)
      if (directories.length >= limit) return directories
    }
  }
  return directories
}

function semverParts(version) {
  const withoutBuild = version.split('+', 1)[0]
  const separator = withoutBuild.indexOf('-')
  const core = separator === -1 ? withoutBuild : withoutBuild.slice(0, separator)
  const prerelease = separator === -1 ? '' : withoutBuild.slice(separator + 1)
  return { numbers: core.split('.').map(Number), prerelease }
}

function compareVersions(left, right) {
  const leftParts = semverParts(left)
  const rightParts = semverParts(right)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts.numbers[index] !== rightParts.numbers[index]) {
      return leftParts.numbers[index] - rightParts.numbers[index]
    }
  }
  if (leftParts.prerelease === rightParts.prerelease) return 0
  if (leftParts.prerelease === '') return 1
  if (rightParts.prerelease === '') return -1
  return leftParts.prerelease.localeCompare(rightParts.prerelease, 'en', { numeric: true })
}

function summarizeEntry(entry, installedKeys) {
  const { descriptor, digest } = entry.bundle
  const manifest = descriptor.manifest
  return {
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    summary: manifest.summary,
    status: manifest.status,
    language: 'wdl',
    languageVersion: descriptor.wdl.version,
    engines: descriptor.wdl.engines.map((engine) => ({ ...engine })),
    tags: [...manifest.tags],
    source: entry.source,
    trust: entry.source === 'builtin' ? 'builtin' : 'local',
    verification: { ...descriptor.verification, checks: [...descriptor.verification.checks] },
    digest,
    installed: installedKeys.has(`${manifest.id}@${manifest.version}`),
  }
}

async function loadEntries(root, source, containmentRoot, budget, signal) {
  const entries = []
  const diagnostics = []
  if (budget.remainingBundles === 0 || budget.remainingBytes === 0) return { entries, diagnostics }
  let directories
  try {
    directories = await discoverBundleDirectories(
      root,
      budget.remainingBundles,
      budget,
      containmentRoot,
    )
  } catch (error) {
    if (error?.code !== 'STORE_ENTRY_LIMIT' && error?.code !== 'STORE_PATH_UNSAFE') throw error
    appendDiagnostic(diagnostics, budget, {
      source,
      directory: root,
      code: error.code.toLocaleLowerCase('en'),
    })
    return { entries, diagnostics }
  }
  for (const directory of directories) {
    if (budget.remainingBundles <= 0 || budget.remainingBytes <= 0) break
    throwIfAborted(signal)
    budget.remainingBundles -= 1
    try {
      const bundle = await loadWdlBundle(directory, {
        onReadBytes(bytes) {
          if (bytes > budget.remainingBytes) {
            budget.remainingBytes = 0
            throw storePathError('STORE_BYTE_LIMIT', 'workflow store read budget was exceeded')
          }
          budget.remainingBytes -= bytes
        },
      })
      entries.push({ source, directory, bundle })
      if (budget.remainingBundles === 0 || budget.remainingBytes === 0) break
    } catch (error) {
      if (error?.code === 'STORE_BYTE_LIMIT') {
        appendDiagnostic(diagnostics, budget, { source, directory, code: 'store_byte_limit' })
        break
      }
      if (!(error instanceof WdlBundleValidationError)) throw error
      appendDiagnostic(diagnostics, budget, {
        source,
        directory,
        code: 'invalid_bundle',
        errors: error.errors,
      })
    }
  }
  return { entries, diagnostics }
}

function appendDiagnostic(diagnostics, budget, diagnostic) {
  if (budget.remainingDiagnostics <= 0) return
  if (budget.remainingDiagnostics === 1) {
    diagnostics.push({
      source: diagnostic.source,
      directory: diagnostic.directory,
      code: 'diagnostics_limit',
    })
    budget.remainingDiagnostics = 0
    return
  }
  diagnostics.push({
    ...diagnostic,
    ...(diagnostic.errors === undefined
      ? {}
      : {
          errors: diagnostic.errors.slice(0, MAX_DIAGNOSTIC_ERRORS).map((error) => ({
            path: String(error.path).slice(0, 512),
            code: String(error.code).slice(0, 128),
            message: String(error.message).slice(0, 512),
          })),
          errorsTruncated: diagnostic.errors.length > MAX_DIAGNOSTIC_ERRORS,
        }),
  })
  budget.remainingDiagnostics -= 1
}

function matchesSearch(entry, filters) {
  const descriptor = entry.bundle.descriptor
  const manifest = descriptor.manifest
  if (filters.source !== undefined && entry.source !== filters.source) return false
  if (filters.language !== undefined && filters.language !== 'wdl') return false
  if (filters.tag !== undefined && !manifest.tags.includes(filters.tag)) return false
  if (filters.query !== undefined) {
    const query = filters.query.toLocaleLowerCase('en')
    const haystack = [manifest.id, manifest.name, manifest.summary, ...manifest.tags]
      .join('\n')
      .toLocaleLowerCase('en')
    if (!haystack.includes(query)) return false
  }
  return true
}

function validateSearchFilters(filters) {
  if (!isPlainObject(filters)) throw new TypeError('workflow store filters must be an object')
  for (const key of Object.keys(filters)) {
    if (!['query', 'language', 'tag', 'source'].includes(key)) {
      throw new TypeError(`unsupported workflow store filter: ${key}`)
    }
    if (typeof filters[key] !== 'string') throw new TypeError(`${key} filter must be a string`)
  }
  if (filters.source !== undefined && !WORKFLOW_STORE_SOURCES.includes(filters.source)) {
    throw new TypeError(`source must be one of: ${WORKFLOW_STORE_SOURCES.join(', ')}`)
  }
}

function isContainedPath(root, target) {
  const remainder = relative(root, target)
  return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`))
}

async function ensureDirectory(path) {
  let stat
  try {
    stat = await lstat(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (mkdirError) {
      if (mkdirError?.code !== 'EEXIST') throw mkdirError
    }
    stat = await lstat(path)
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`unsafe workflow store path component: ${path}`)
  }
}

async function ensureStoreRoot(root) {
  const parsed = parse(root)
  let current = parsed.root
  const segments = root.slice(parsed.root.length).split(sep).filter(Boolean)
  for (const segment of segments) {
    current = join(current, segment)
    await ensureDirectory(current)
  }
  const initial = await lstat(root)
  const canonical = await realpath(root)
  const completed = await lstat(root)
  if (
    !completed.isDirectory()
    || completed.isSymbolicLink()
    || completed.dev !== initial.dev
    || completed.ino !== initial.ino
  ) {
    throw new Error(`unsafe workflow store root: ${root}`)
  }
  return canonical
}

async function ensureSafeDirectoryChain(root, segments) {
  let current = root
  for (const segment of segments) {
    current = join(current, segment)
    await ensureDirectory(current)
    const canonical = await realpath(current)
    if (!isContainedPath(root, canonical)) {
      throw new Error(`unsafe workflow store path component: ${current}`)
    }
  }
  return current
}

async function targetState(target) {
  try {
    const stat = await lstat(target)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`unsafe workflow store target: ${target}`)
    }
    return 'directory'
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}

async function writeExclusiveFile(path, content, containmentRoot) {
  let handle
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    const opened = await handle.stat()
    const canonical = await realpath(path)
    const pathStat = await lstat(path)
    if (
      !opened.isFile()
      || pathStat.isSymbolicLink()
      || !pathStat.isFile()
      || opened.dev !== pathStat.dev
      || opened.ino !== pathStat.ino
      || !isContainedPath(containmentRoot, canonical)
    ) {
      throw new Error(`unsafe workflow store destination: ${path}`)
    }
    await handle.writeFile(content, 'utf8')
    const completed = await handle.stat()
    if (!completed.isFile() || completed.dev !== opened.dev || completed.ino !== opened.ino) {
      throw new Error(`workflow store destination changed while writing: ${path}`)
    }
  } finally {
    await handle?.close()
  }
}

async function writeBundleFiles(target, storeRoot, bundle, signal) {
  throwIfAborted(signal)
  const containmentRoot = await inspectStoreDirectory(target, storeRoot)
  await writeExclusiveFile(
    join(target, 'workflow.json'),
    `${JSON.stringify(bundle.descriptor, null, 2)}\n`,
    containmentRoot,
  )
  for (const path of Object.keys(bundle.contents).sort()) {
    throwIfAborted(signal)
    const destination = join(target, ...path.split('/'))
    const parentSegments = dirname(path) === '.' ? [] : dirname(path).split('/')
    await ensureSafeDirectoryChain(target, parentSegments)
    await writeExclusiveFile(destination, bundle.contents[path], containmentRoot)
  }
}

async function writeBundleAtomic(config, area, bundle, signal) {
  throwIfAborted(signal)
  const storeRoot = await ensureStoreRoot(config.root)
  const id = bundle.descriptor.manifest.id
  const version = bundle.descriptor.manifest.version
  const parent = await ensureSafeDirectoryChain(storeRoot, [area, id])
  const target = join(parent, version)
  const state = await targetState(target)
  if (state === 'directory') {
    try {
      const existing = await loadWdlBundle(target)
      return {
        status: existing.digest === bundle.digest ? 'already_present' : 'conflict',
        path: target,
        digest: existing.digest,
      }
    } catch (error) {
      if (!(error instanceof WdlBundleValidationError)) throw error
      return { status: 'conflict', path: target, digest: null }
    }
  }

  const temporary = join(parent, `.tmp-${version}-${randomUUID()}`)
  await ensureDirectory(temporary)
  try {
    await writeBundleFiles(temporary, storeRoot, bundle, signal)
    throwIfAborted(signal)
    const staged = await loadWdlBundle(temporary)
    if (staged.digest !== bundle.digest) {
      throw new Error('staged workflow bundle digest changed before installation')
    }
    if (await realpath(parent) !== parent) {
      throw new Error(`unsafe workflow store path component: ${parent}`)
    }
    await rename(temporary, target)
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
      return { status: 'conflict', path: target, digest: null }
    }
    throw error
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  const installed = await loadWdlBundle(target)
  if (installed.digest !== bundle.digest) {
    throw new Error('installed workflow bundle digest does not match the approved bundle')
  }
  return { status: 'created', path: target, digest: installed.digest }
}

function scaffoldWorkflowName(id) {
  const normalized = id.replace(/[.-]/g, '_')
  return /^[A-Za-z]/.test(normalized) ? normalized : `workflow_${normalized}`
}

function createScaffoldBundle({ id, version = '0.1.0', name, summary }) {
  if (typeof id !== 'string' || !IDENTIFIER_PATTERN.test(id)) {
    throw new TypeError('id must be a lowercase workflow identifier')
  }
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new TypeError('version must be a semantic version')
  }
  if (typeof name !== 'string' || name.length === 0 || name.length > 160) {
    throw new TypeError('name must contain 1 to 160 characters')
  }
  if (typeof summary !== 'string' || summary.length === 0 || summary.length > 1000) {
    throw new TypeError('summary must contain 1 to 1000 characters')
  }

  const workflowName = scaffoldWorkflowName(id)
  const contents = {
    'main.wdl': `version 1.0\n\nworkflow ${workflowName} {\n  input {\n    String message\n  }\n\n  output {\n    String submitted_message = message\n  }\n}\n`,
    'examples/inputs.json': `${JSON.stringify({ message: 'hello from dsh-bio-workflows' }, null, 2)}\n`,
    'README.md': `# ${name}\n\n${summary}\n\nThis draft was generated by dsh-bio-workflows. Validate it with a real WDL engine before execution.\n`,
  }
  const roles = {
    'main.wdl': 'workflow',
    'examples/inputs.json': 'example',
    'README.md': 'documentation',
  }
  const descriptor = {
    bundleVersion: '1',
    manifest: {
      schemaVersion: '1',
      id,
      version,
      name,
      summary,
      status: 'draft',
      engine: { name: 'miniwdl' },
      inputs: [{ id: 'message', type: 'string', required: true }],
      outputs: [{ id: 'submitted_message', type: 'string' }],
      tags: ['custom', 'wdl'],
    },
    wdl: {
      version: '1.0',
      entrypoint: 'main.wdl',
      engines: [{ name: 'miniwdl' }, { name: 'cromwell' }],
    },
    source: { kind: 'local' },
    authors: [],
    license: 'NOASSERTION',
    verification: { status: 'unverified', checks: [] },
    files: Object.keys(contents).sort().map((path) => ({
      path,
      role: roles[path],
      sha256: sha256Text(contents[path]),
    })),
  }
  return validateLoadedWdlBundle(descriptor, contents)
}

function errorResult(code, message, details = {}) {
  return { ok: false, error: { code, message }, ...details }
}

export function createWorkflowStore(configValue = {}) {
  const config = parseWorkflowStoreConfig(configValue)

  async function entries(signal) {
    throwIfAborted(signal)
    const budget = {
      remainingBundles: MAX_DISCOVERED_BUNDLES,
      remainingBytes: MAX_DISCOVERED_BYTES,
      remainingDiscoveryEntries: MAX_DISCOVERY_ENTRIES,
      remainingDiagnostics: MAX_DIAGNOSTICS,
    }
    const builtinRoot = await inspectStoreDirectory(BUILTIN_ROOT)
    const builtin = await loadEntries(BUILTIN_ROOT, 'builtin', builtinRoot, budget, signal)
    if (config.root === null) return builtin
    let localRoot
    try {
      localRoot = await inspectStoreDirectory(config.root)
    } catch (error) {
      if (error?.code === 'ENOENT') return builtin
      if (error?.code !== 'STORE_PATH_UNSAFE') throw error
      const diagnostics = [...builtin.diagnostics]
      appendDiagnostic(diagnostics, budget, {
        source: 'local',
        directory: config.root,
        code: 'store_path_unsafe',
      })
      return {
        entries: builtin.entries,
        diagnostics,
      }
    }
    const installed = await loadEntries(
      join(localRoot, 'installed'),
      'installed',
      localRoot,
      budget,
      signal,
    )
    const draft = await loadEntries(join(localRoot, 'drafts'), 'draft', localRoot, budget, signal)
    return {
      entries: [...builtin.entries, ...installed.entries, ...draft.entries],
      diagnostics: [...builtin.diagnostics, ...installed.diagnostics, ...draft.diagnostics],
    }
  }

  async function resolveEntry({ id, version, source = 'builtin' }, signal) {
    throwIfAborted(signal)
    if (typeof id !== 'string' || !IDENTIFIER_PATTERN.test(id)) {
      throw new TypeError('id must be a lowercase workflow identifier')
    }
    if (version !== undefined && (typeof version !== 'string' || !SEMVER_PATTERN.test(version))) {
      throw new TypeError('version must be a semantic version')
    }
    if (!WORKFLOW_STORE_SOURCES.includes(source)) {
      throw new TypeError(`source must be one of: ${WORKFLOW_STORE_SOURCES.join(', ')}`)
    }
    const discovered = await entries(signal)
    const selected = discovered.entries
      .filter((entry) => (
        entry.source === source
        && entry.bundle.descriptor.manifest.id === id
        && (version === undefined || entry.bundle.descriptor.manifest.version === version)
      ))
      .sort((left, right) => compareVersions(
        right.bundle.descriptor.manifest.version,
        left.bundle.descriptor.manifest.version,
      ))
    return { entry: selected[0] ?? null, diagnostics: discovered.diagnostics }
  }

  async function prepareInstall(options, operation = {}) {
    throwIfAborted(operation.signal)
    if (!isPlainObject(options)) throw new TypeError('install options must be an object')
    if (typeof options.version !== 'string' || !SEMVER_PATTERN.test(options.version)) {
      throw new TypeError('version must be an exact semantic version')
    }
    if (typeof options.expectedDigest !== 'string' || !BUNDLE_DIGEST_PATTERN.test(options.expectedDigest)) {
      throw new TypeError('expectedDigest must be a SHA-256 bundle digest')
    }
    const resolved = await resolveEntry(options, operation.signal)
    if (resolved.entry === null) {
      return errorResult('workflow_not_found', 'workflow bundle was not found', {
        diagnostics: resolved.diagnostics,
      })
    }
    const actualDigest = resolved.entry.bundle.digest
    if (actualDigest !== options.expectedDigest) {
      return errorResult('digest_mismatch', 'workflow bundle digest does not match expectedDigest', {
        expectedDigest: options.expectedDigest,
        actualDigest,
      })
    }
    const manifest = resolved.entry.bundle.descriptor.manifest
    return {
      ok: true,
      id: manifest.id,
      version: manifest.version,
      source: resolved.entry.source,
      digest: actualDigest,
      executionAuthorized: false,
    }
  }

  function prepareScaffold(options) {
    const bundle = createScaffoldBundle(options)
    return {
      ok: true,
      id: bundle.descriptor.manifest.id,
      version: bundle.descriptor.manifest.version,
      source: 'draft',
      digest: bundle.digest,
      executionAuthorized: false,
    }
  }

  return Object.freeze({
    config,
    summary: Object.freeze({
      builtinWorkflowCount: 2,
      localStoreConfigured: config.root !== null,
      writesEnabled: config.writeEnabled,
    }),
    async search(filters = {}, operation = {}) {
      validateSearchFilters(filters)
      const discovered = await entries(operation.signal)
      const installedKeys = new Set(discovered.entries
        .filter((entry) => entry.source === 'installed')
        .map((entry) => {
          const manifest = entry.bundle.descriptor.manifest
          return `${manifest.id}@${manifest.version}`
        }))
      const sourceKeys = new Set(discovered.entries
        .filter((entry) => entry.source !== 'installed')
        .map((entry) => {
          const manifest = entry.bundle.descriptor.manifest
          return `${manifest.id}@${manifest.version}@${entry.bundle.digest}`
        }))
      const searchable = filters.source === undefined
        ? discovered.entries.filter((entry) => {
            if (entry.source !== 'installed') return true
            const manifest = entry.bundle.descriptor.manifest
            return !sourceKeys.has(`${manifest.id}@${manifest.version}@${entry.bundle.digest}`)
          })
        : discovered.entries
      const workflows = searchable
        .filter((entry) => matchesSearch(entry, filters))
        .map((entry) => summarizeEntry(entry, installedKeys))
        .sort((left, right) => (
          left.id.localeCompare(right.id)
          || compareVersions(right.version, left.version)
          || left.source.localeCompare(right.source)
        ))
      return { count: workflows.length, workflows, diagnostics: discovered.diagnostics }
    },
    async validate(options, operation = {}) {
      const resolved = await resolveEntry(options, operation.signal)
      if (resolved.entry === null) {
        return errorResult('workflow_not_found', 'workflow bundle was not found', {
          validation: null,
          diagnostics: resolved.diagnostics,
        })
      }
      return {
        ok: true,
        source: resolved.entry.source,
        validation: describeWdlBundleValidation(resolved.entry.bundle),
        diagnostics: resolved.diagnostics,
      }
    },
    prepareInstall,
    prepareScaffold,
    async install(options, operation = {}) {
      throwIfAborted(operation.signal)
      if (!config.writeEnabled) {
        return errorResult('store_writes_disabled', 'workflow store writes are disabled')
      }
      const prepared = await prepareInstall(options, operation)
      if (!prepared.ok) return prepared
      const resolved = await resolveEntry(options, operation.signal)
      if (resolved.entry === null || resolved.entry.bundle.digest !== prepared.digest) {
        return errorResult('source_changed', 'workflow bundle changed after approval preparation', {
          expectedDigest: prepared.digest,
          actualDigest: resolved.entry?.bundle.digest ?? null,
        })
      }
      if (resolved.entry.source === 'installed') {
        return {
          ok: true,
          status: 'already_present',
          path: resolved.entry.directory,
          digest: resolved.entry.bundle.digest,
          executionAuthorized: false,
        }
      }
      const result = await writeBundleAtomic(
        config,
        'installed',
        resolved.entry.bundle,
        operation.signal,
      )
      return {
        ok: result.status === 'created' || result.status === 'already_present',
        ...result,
        executionAuthorized: false,
      }
    },
    async scaffold(options, operation = {}) {
      throwIfAborted(operation.signal)
      if (!config.writeEnabled) {
        return errorResult('store_writes_disabled', 'workflow store writes are disabled')
      }
      const prepared = prepareScaffold(options)
      const bundle = createScaffoldBundle(options)
      if (bundle.digest !== prepared.digest) {
        return errorResult('source_changed', 'draft bundle changed after approval preparation')
      }
      const result = await writeBundleAtomic(config, 'drafts', bundle, operation.signal)
      return {
        ok: result.status === 'created',
        ...result,
        source: 'draft',
        executionAuthorized: false,
      }
    },
  })
}
