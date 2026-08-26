import { createHash, randomUUID } from 'node:crypto'
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
import { TextDecoder } from 'node:util'

import { isSafeBundlePath, WDL_FILE_ROLES } from './wdl-bundle.js'
import { parseWorkflowStoreConfig } from './workflow-store.js'

export const DRAFT_SCHEMA_VERSION = '1'
export const DRAFT_SOURCE_DIGEST_VERSION = '1'
export const DRAFT_ENTRYPOINT = 'main.wdl'
export const DRAFT_LANGUAGE_VERSION = '1.0'
export const DRAFT_LIMITS = Object.freeze({
  maxFiles: 128,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxRevisions: 256,
})

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const DRAFT_ID_PATTERN = /^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const REVISION_DIRECTORY_PATTERN = /^\d{8}$/
const TEMPORARY_DIRECTORY_PATTERN = /^\.tmp-[0-9a-f-]{36}$/
const CAPACITY_SLOT_PATTERN = /^slot-(\d{3})$/
const MAX_OWNER_LENGTH = 512
const MAX_WORKFLOW_ID_LENGTH = 64
const MAX_WORKFLOW_VERSION_LENGTH = 128
const MAX_METADATA_BYTES = 32 * 1024
// JSON string escaping can expand a valid 4 MiB UTF-8 source snapshot by up to
// six bytes per input byte (for example, NUL becomes `\u0000`). The extra MiB
// bounds paths and the fixed revision structure while raw source limits remain
// authoritative.
const MAX_REVISION_JSON_BYTES = (6 * DRAFT_LIMITS.maxTotalBytes) + (1024 * 1024)
const MAX_DIRECTORY_ENTRIES = 512
const MAX_DRAFTS_PER_OWNER = 256
const MAX_CAPACITY_RECORD_BYTES = 1024
const STALE_STAGING_AGE_MS = 60 * 60 * 1000
const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const ROLE_SET = new Set(WDL_FILE_ROLES)

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function throwIfAborted(signal) {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error) throw signal.reason
  const error = new Error('draft store operation was aborted')
  error.name = 'AbortError'
  throw error
}

function errorResult(code, message, details = {}) {
  return { ok: false, error: { code, message }, ...details }
}

function isContainedPath(root, target) {
  const remainder = relative(root, target)
  return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith(`..${sep}`))
}

function currentUid() {
  return typeof process.getuid === 'function' ? BigInt(process.getuid()) : null
}

function assertPrivateDirectory(metadata, path) {
  const uid = currentUid()
  if (uid !== null && metadata.uid !== uid) {
    throw new Error(`draft store directory must be owned by the DSH process user: ${path}`)
  }
  if ((metadata.mode & 0o022n) !== 0n) {
    throw new Error(`draft store directory must not be writable by group or other users: ${path}`)
  }
}

async function assertProtectedPathAncestors(path) {
  const uid = currentUid()
  const ancestors = []
  let ancestor = dirname(path)
  while (true) {
    const metadata = await lstat(ancestor, { bigint: true })
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('draft store ancestors must be non-symlink directories')
    }
    ancestors.push(metadata)
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  const filesystemRootUid = ancestors.at(-1).uid
  for (const metadata of ancestors) {
    if (uid !== null && metadata.uid !== filesystemRootUid && metadata.uid !== uid) {
      throw new Error('draft store ancestors must be owned by filesystem root or the DSH process user')
    }
    if ((metadata.mode & 0o022n) !== 0n && (metadata.mode & 0o1000n) === 0n) {
      throw new Error('writable draft store ancestors must use sticky replacement protection')
    }
  }
}

function directoryIdentity(path, metadata) {
  return Object.freeze({
    path,
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    uid: metadata.uid.toString(),
    mode: (metadata.mode & 0o777n).toString(8).padStart(3, '0'),
  })
}

function hasWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

function assertString(value, label, minLength, maxLength) {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    throw new TypeError(`${label} must contain ${minLength} to ${maxLength} characters`)
  }
  if (!hasWellFormedUnicode(value)) throw new TypeError(`${label} must contain well-formed Unicode`)
}

function validateOwnerSession(value) {
  assertString(value, 'owner session', 1, MAX_OWNER_LENGTH)
  return value
}

function validateDraftId(value) {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) {
    throw new TypeError('draftId must be a plugin-minted draft UUID')
  }
  return value
}

function validateRevision(value, label = 'revision') {
  if (!Number.isSafeInteger(value) || value < 1 || value > DRAFT_LIMITS.maxRevisions) {
    throw new TypeError(`${label} must be a positive integer not greater than ${DRAFT_LIMITS.maxRevisions}`)
  }
  return value
}

function validateDigest(value, label = 'contentDigest') {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a SHA-256 digest`)
  }
  return value
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function normalizeFiles(filesValue) {
  if (!Array.isArray(filesValue) || filesValue.length === 0) {
    throw new TypeError('draft files must be a non-empty array')
  }
  if (filesValue.length > DRAFT_LIMITS.maxFiles) {
    throw new TypeError(`draft must contain at most ${DRAFT_LIMITS.maxFiles} files`)
  }

  const paths = new Set()
  let totalBytes = 0
  const files = filesValue.map((file, index) => {
    if (!isPlainObject(file)) throw new TypeError(`files[${index}] must be an object`)
    for (const key of Object.keys(file)) {
      if (!['path', 'role', 'content'].includes(key)) {
        throw new TypeError(`unsupported files[${index}] property: ${key}`)
      }
    }
    if (!isSafeBundlePath(file.path) || !hasWellFormedUnicode(file.path)) {
      throw new TypeError(`files[${index}].path must be a safe relative POSIX path with well-formed Unicode`)
    }
    if (paths.has(file.path)) throw new TypeError(`duplicate draft file path: ${file.path}`)
    paths.add(file.path)
    if (typeof file.role !== 'string' || !ROLE_SET.has(file.role)) {
      throw new TypeError(`files[${index}].role must be one of: ${WDL_FILE_ROLES.join(', ')}`)
    }
    if (typeof file.content !== 'string' || !hasWellFormedUnicode(file.content)) {
      throw new TypeError(`files[${index}].content must be a well-formed Unicode string`)
    }
    const bytes = Buffer.byteLength(file.content, 'utf8')
    if (bytes > DRAFT_LIMITS.maxFileBytes) {
      throw new TypeError(`${file.path} must contain at most ${DRAFT_LIMITS.maxFileBytes} bytes`)
    }
    totalBytes += bytes
    if (totalBytes > DRAFT_LIMITS.maxTotalBytes) {
      throw new TypeError(`draft must contain at most ${DRAFT_LIMITS.maxTotalBytes} bytes`)
    }
    return Object.freeze({ path: file.path, role: file.role, content: file.content })
  }).sort((left, right) => compareUtf8(left.path, right.path))

  const entrypoint = files.find((file) => file.path === DRAFT_ENTRYPOINT)
  if (entrypoint === undefined || entrypoint.role !== 'workflow') {
    throw new TypeError(`${DRAFT_ENTRYPOINT} must exist with the workflow role`)
  }
  return Object.freeze(files)
}

function updateLengthDelimited(hash, label, value) {
  const bytes = Buffer.from(value, 'utf8')
  hash.update(`${label}:${bytes.length}:`, 'utf8')
  hash.update(bytes)
  hash.update('\n', 'utf8')
}

export function computeDraftContentDigest(filesValue) {
  const files = normalizeFiles(filesValue)
  const hash = createHash('sha256')
  hash.update(`dsh-bio-draft-source-v${DRAFT_SOURCE_DIGEST_VERSION}\n`, 'utf8')
  for (const file of files) {
    updateLengthDelimited(hash, 'path', file.path)
    updateLengthDelimited(hash, 'role', file.role)
    updateLengthDelimited(hash, 'content', file.content)
  }
  return `sha256:${hash.digest('hex')}`
}

function fileIndex(files) {
  return files.map((file) => ({
    path: file.path,
    role: file.role,
    bytes: Buffer.byteLength(file.content, 'utf8'),
    sha256: createHash('sha256').update(file.content, 'utf8').digest('hex'),
  }))
}

function summarize(metadata, snapshot, selectedPath) {
  const base = {
    ok: true,
    schemaVersion: DRAFT_SCHEMA_VERSION,
    draftId: metadata.draftId,
    workflowId: metadata.workflow.id,
    version: metadata.workflow.version,
    name: metadata.workflow.name,
    summary: metadata.workflow.summary,
    entrypoint: metadata.entrypoint,
    languageVersion: metadata.languageVersion,
    revision: snapshot.revision,
    contentDigest: snapshot.contentDigest,
    executionAuthorized: false,
  }
  if (selectedPath === undefined) {
    return { ...base, files: fileIndex(snapshot.files) }
  }
  const file = snapshot.files.find((item) => item.path === selectedPath)
  if (file === undefined) {
    return errorResult('draft_file_not_found', 'draft file was not found', {
      draftId: metadata.draftId,
      revision: snapshot.revision,
      contentDigest: snapshot.contentDigest,
      path: selectedPath,
    })
  }
  const [index] = fileIndex([file])
  return { ...base, file: { ...index, content: file.content } }
}

function workflowName(id) {
  const normalized = id.replace(/[.-]/g, '_')
  return /^[A-Za-z]/.test(normalized) ? normalized : `workflow_${normalized}`
}

function createTemplate(options) {
  if (!isPlainObject(options)) throw new TypeError('draft create options must be an object')
  for (const key of Object.keys(options)) {
    if (!['id', 'version', 'name', 'summary'].includes(key)) {
      throw new TypeError(`unsupported draft create option: ${key}`)
    }
  }
  if (
    typeof options.id !== 'string'
    || options.id.length > MAX_WORKFLOW_ID_LENGTH
    || !IDENTIFIER_PATTERN.test(options.id)
  ) {
    throw new TypeError(`id must be a lowercase workflow identifier of at most ${MAX_WORKFLOW_ID_LENGTH} characters`)
  }
  const version = options.version ?? '0.1.0'
  if (
    typeof version !== 'string'
    || version.length > MAX_WORKFLOW_VERSION_LENGTH
    || !SEMVER_PATTERN.test(version)
  ) {
    throw new TypeError(`version must be a semantic version of at most ${MAX_WORKFLOW_VERSION_LENGTH} characters`)
  }
  assertString(options.name, 'name', 1, 160)
  assertString(options.summary, 'summary', 1, 1000)
  const name = workflowName(options.id)
  const files = normalizeFiles([
    {
      path: DRAFT_ENTRYPOINT,
      role: 'workflow',
      content: `version ${DRAFT_LANGUAGE_VERSION}\n\nworkflow ${name} {\n  input {\n    String message\n  }\n\n  output {\n    String submitted_message = message\n  }\n}\n`,
    },
    {
      path: 'examples/inputs.json',
      role: 'example',
      content: `${JSON.stringify({ message: 'hello from dsh-bio-workflows' }, null, 2)}\n`,
    },
    {
      path: 'README.md',
      role: 'documentation',
      content: `# ${options.name}\n\n${options.summary}\n\nThis AI-authoring draft is untrusted and cannot be executed or promoted without separate validation and approval.\n`,
    },
  ])
  return Object.freeze({
    workflow: Object.freeze({ id: options.id, version, name: options.name, summary: options.summary }),
    files,
    contentDigest: computeDraftContentDigest(files),
  })
}

function ownerDirectoryName(ownerSession) {
  return createHash('sha256').update(ownerSession, 'utf8').digest('hex')
}

function revisionDirectoryName(revision) {
  return String(revision).padStart(8, '0')
}

async function ensureDirectory(path) {
  let metadata
  try {
    metadata = await lstat(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (mkdirError) {
      if (mkdirError?.code !== 'EEXIST') throw mkdirError
    }
    metadata = await lstat(path)
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`unsafe draft store path component: ${path}`)
  }
}

async function ensureStoreRoot(root) {
  const parsed = parse(root)
  let current = parsed.root
  for (const segment of root.slice(parsed.root.length).split(sep).filter(Boolean)) {
    current = join(current, segment)
    await ensureDirectory(current)
  }
  const identity = await inspectDirectoryIdentity(root, root)
  await assertProtectedPathAncestors(identity.path)
  return identity.path
}

async function inspectDirectoryIdentity(path, containmentRoot) {
  const initial = await lstat(path, { bigint: true })
  if (!initial.isDirectory() || initial.isSymbolicLink()) {
    throw new Error(`unsafe draft store directory: ${path}`)
  }
  const canonical = await realpath(path)
  const completed = await lstat(path, { bigint: true })
  if (
    !completed.isDirectory()
    || completed.isSymbolicLink()
    || completed.dev !== initial.dev
    || completed.ino !== initial.ino
    || !isContainedPath(containmentRoot, canonical)
  ) {
    throw new Error(`unsafe draft store directory: ${path}`)
  }
  if (canonical !== path) throw new Error(`unsafe non-canonical draft store directory: ${path}`)
  assertPrivateDirectory(completed, path)
  return directoryIdentity(canonical, completed)
}

async function inspectDirectory(path, containmentRoot) {
  return (await inspectDirectoryIdentity(path, containmentRoot)).path
}

async function assertDirectoryUnchanged(identity, containmentRoot) {
  const observed = await inspectDirectoryIdentity(identity.path, containmentRoot)
  if (
    observed.device !== identity.device
    || observed.inode !== identity.inode
    || observed.uid !== identity.uid
    || observed.mode !== identity.mode
  ) {
    throw new Error(`draft store directory changed during operation: ${identity.path}`)
  }
}

async function ensureSafeDirectoryChain(root, segments) {
  let current = root
  for (const segment of segments) {
    current = join(current, segment)
    await ensureDirectory(current)
    const canonical = await inspectDirectory(current, root)
    if (canonical !== current) throw new Error(`unsafe draft store path component: ${current}`)
  }
  return current
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
    const observed = await lstat(path)
    if (
      !opened.isFile()
      || observed.isSymbolicLink()
      || !observed.isFile()
      || opened.dev !== observed.dev
      || opened.ino !== observed.ino
      || !isContainedPath(containmentRoot, canonical)
    ) {
      throw new Error(`unsafe draft store destination: ${path}`)
    }
    await handle.writeFile(content, 'utf8')
    const completed = await handle.stat()
    if (!completed.isFile() || completed.dev !== opened.dev || completed.ino !== opened.ino) {
      throw new Error(`draft store destination changed while writing: ${path}`)
    }
  } finally {
    await handle?.close()
  }
}

async function readBoundedJson(path, containmentRoot, maxBytes) {
  const initial = await lstat(path, { bigint: true })
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > BigInt(maxBytes)) {
    throw new Error(`unsafe or oversized draft store file: ${path}`)
  }
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = await handle.stat({ bigint: true })
    const canonical = await realpath(path)
    if (
      !opened.isFile()
      || opened.dev !== initial.dev
      || opened.ino !== initial.ino
      || opened.size > BigInt(maxBytes)
      || !isContainedPath(containmentRoot, canonical)
    ) {
      throw new Error(`unsafe or changed draft store file: ${path}`)
    }
    const size = Number(opened.size)
    const buffer = Buffer.allocUnsafe(size)
    let offset = 0
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, offset, size - offset, offset)
      if (bytesRead === 0) throw new Error(`draft store file changed while reading: ${path}`)
      offset += bytesRead
    }
    const completed = await handle.stat({ bigint: true })
    if (
      completed.dev !== opened.dev
      || completed.ino !== opened.ino
      || completed.size !== opened.size
      || completed.mtimeNs !== opened.mtimeNs
      || completed.ctimeNs !== opened.ctimeNs
      || BigInt(buffer.length) !== opened.size
    ) {
      throw new Error(`draft store file changed while reading: ${path}`)
    }
    return JSON.parse(STRICT_UTF8_DECODER.decode(buffer))
  } finally {
    await handle?.close()
  }
}

function parseMetadata(value, expectedDraftId, expectedOwner) {
  if (!isPlainObject(value)) throw new Error('invalid draft metadata')
  const keys = ['schemaVersion', 'draftId', 'ownerSession', 'workflow', 'entrypoint', 'languageVersion', 'createdAt']
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error('invalid draft metadata')
  if (
    value.schemaVersion !== DRAFT_SCHEMA_VERSION
    || value.draftId !== expectedDraftId
    || value.ownerSession !== expectedOwner
    || value.entrypoint !== DRAFT_ENTRYPOINT
    || value.languageVersion !== DRAFT_LANGUAGE_VERSION
    || typeof value.createdAt !== 'string'
    || !isPlainObject(value.workflow)
  ) {
    throw new Error('invalid or mismatched draft metadata')
  }
  const template = createTemplate(value.workflow)
  return Object.freeze({ ...value, workflow: template.workflow })
}

function parseSnapshot(value, draftId, expectedRevision) {
  if (!isPlainObject(value)) throw new Error('invalid draft revision')
  if (Object.keys(value).some((key) => !['schemaVersion', 'draftId', 'revision', 'contentDigest', 'files'].includes(key))) {
    throw new Error('invalid draft revision')
  }
  if (
    value.schemaVersion !== DRAFT_SCHEMA_VERSION
    || value.draftId !== draftId
    || value.revision !== expectedRevision
    || !DIGEST_PATTERN.test(value.contentDigest)
  ) {
    throw new Error('invalid or mismatched draft revision')
  }
  const files = normalizeFiles(value.files)
  const actualDigest = computeDraftContentDigest(files)
  if (actualDigest !== value.contentDigest) throw new Error('draft revision content digest mismatch')
  return Object.freeze({ ...value, files })
}

async function ownerRoot(config, ownerSession, create) {
  if (config.root === null) return null
  let root
  try {
    root = create
      ? await ensureStoreRoot(config.root)
      : await inspectDirectory(config.root, resolve(config.root))
  } catch (error) {
    if (!create && error?.code === 'ENOENT') return null
    throw error
  }
  await assertProtectedPathAncestors(root)
  const segments = ['authoring', ownerDirectoryName(ownerSession)]
  if (create) return ensureSafeDirectoryChain(root, segments)
  let current = root
  try {
    for (const segment of segments) {
      current = join(current, segment)
      const canonical = await inspectDirectory(current, root)
      if (canonical !== current) throw new Error(`unsafe draft store path component: ${current}`)
    }
    return current
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function readDraft(config, ownerSession, draftId) {
  const root = await ownerRoot(config, ownerSession, false)
  if (root === null) return null
  const directory = join(root, draftId)
  try {
    const draftIdentity = await inspectDirectoryIdentity(directory, root)
    const metadata = parseMetadata(
      await readBoundedJson(join(directory, 'draft.json'), directory, MAX_METADATA_BYTES),
      draftId,
      ownerSession,
    )
    const revisions = join(directory, 'revisions')
    const revisionsIdentity = await inspectDirectoryIdentity(revisions, directory)
    return { root, directory, draftIdentity, revisions, revisionsIdentity, metadata }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function listRevisionNumbers(draft) {
  const revisions = []
  let entries = 0
  const directory = await opendir(draft.revisions)
  for await (const entry of directory) {
    entries += 1
    if (entries > MAX_DIRECTORY_ENTRIES) throw new Error('draft revision directory entry limit exceeded')
    if (TEMPORARY_DIRECTORY_PATTERN.test(entry.name)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('unsafe draft revision staging entry')
      continue
    }
    if (!REVISION_DIRECTORY_PATTERN.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`unsafe draft revision entry: ${entry.name}`)
    }
    const revision = Number(entry.name)
    validateRevision(revision)
    const path = join(draft.revisions, entry.name)
    if (await inspectDirectory(path, draft.directory) !== path) throw new Error(`unsafe draft revision: ${path}`)
    revisions.push(revision)
  }
  revisions.sort((left, right) => left - right)
  if (revisions.length === 0 || revisions.length > DRAFT_LIMITS.maxRevisions) {
    throw new Error('draft revision history is empty or exceeds its limit')
  }
  revisions.forEach((revision, index) => {
    if (revision !== index + 1) throw new Error('draft revision history is not contiguous')
  })
  return revisions
}

async function loadSnapshot(draft, revision) {
  const numbers = await listRevisionNumbers(draft)
  const selected = revision ?? numbers.at(-1)
  if (!numbers.includes(selected)) return null
  return parseSnapshot(
    await readBoundedJson(
      join(draft.revisions, revisionDirectoryName(selected), 'revision.json'),
      draft.directory,
      MAX_REVISION_JSON_BYTES,
    ),
    draft.metadata.draftId,
    selected,
  )
}

function applyPatch(snapshot, options) {
  const replacements = options.replacements ?? []
  const deletions = options.deletions ?? []
  if (!Array.isArray(replacements) || !Array.isArray(deletions)) {
    throw new TypeError('replacements and deletions must be arrays')
  }
  if (replacements.length + deletions.length === 0) {
    throw new TypeError('draft update must contain at least one replacement or deletion')
  }
  if (replacements.length > DRAFT_LIMITS.maxFiles || deletions.length > DRAFT_LIMITS.maxFiles) {
    throw new TypeError(`draft patch must contain at most ${DRAFT_LIMITS.maxFiles} replacements and deletions`)
  }

  const next = new Map(snapshot.files.map((file) => [file.path, file]))
  const replacementPaths = new Set()
  for (const [index, replacement] of replacements.entries()) {
    if (!isPlainObject(replacement)) throw new TypeError(`replacements[${index}] must be an object`)
    if (Object.keys(replacement).some((key) => !['path', 'role', 'content'].includes(key))) {
      throw new TypeError(`replacements[${index}] contains an unsupported property`)
    }
    const [normalized] = normalizeFiles([
      replacement.path === DRAFT_ENTRYPOINT
        ? replacement
        : replacement,
      ...(replacement.path === DRAFT_ENTRYPOINT ? [] : [next.get(DRAFT_ENTRYPOINT)]),
    ].filter(Boolean))
      .filter((file) => file.path === replacement.path)
    if (replacementPaths.has(normalized.path)) throw new TypeError(`duplicate replacement path: ${normalized.path}`)
    replacementPaths.add(normalized.path)
    next.set(normalized.path, normalized)
  }

  const deletionPaths = new Set()
  for (const [index, path] of deletions.entries()) {
    if (!isSafeBundlePath(path) || !hasWellFormedUnicode(path)) {
      throw new TypeError(`deletions[${index}] must be a safe relative POSIX path with well-formed Unicode`)
    }
    if (path === DRAFT_ENTRYPOINT) throw new TypeError(`${DRAFT_ENTRYPOINT} cannot be deleted`)
    if (deletionPaths.has(path)) throw new TypeError(`duplicate deletion path: ${path}`)
    if (replacementPaths.has(path)) throw new TypeError(`path cannot be replaced and deleted: ${path}`)
    if (!next.has(path)) throw new TypeError(`cannot delete missing draft file: ${path}`)
    deletionPaths.add(path)
    next.delete(path)
  }
  return normalizeFiles([...next.values()])
}

function capacitySlotName(index) {
  return `slot-${String(index).padStart(3, '0')}`
}

async function cleanupStaleCapacityReservations(capacityPath, ownerPath, signal) {
  const capacityIdentity = await inspectDirectoryIdentity(capacityPath, ownerPath)
  const ownerIdentity = await inspectDirectoryIdentity(ownerPath, ownerPath)
  let entries = 0
  const directory = await opendir(capacityPath)
  for await (const entry of directory) {
    entries += 1
    if (entries > MAX_DRAFTS_PER_OWNER) throw new Error('draft capacity slot limit exceeded')
    const match = CAPACITY_SLOT_PATTERN.exec(entry.name)
    if (
      match === null
      || Number(match[1]) >= MAX_DRAFTS_PER_OWNER
      || !entry.isDirectory()
      || entry.isSymbolicLink()
    ) {
      throw new Error(`unsafe draft capacity entry: ${entry.name}`)
    }
    const slot = join(capacityPath, entry.name)
    let metadata
    try {
      metadata = await lstat(slot)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (Date.now() - metadata.mtimeMs < STALE_STAGING_AGE_MS) continue
    throwIfAborted(signal)
    let record
    try {
      record = await readBoundedJson(join(slot, 'draft.json'), slot, MAX_CAPACITY_RECORD_BYTES)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (
      isPlainObject(record)
      && Object.keys(record).length === 1
      && DRAFT_ID_PATTERN.test(record.draftId)
    ) {
      try {
        const committed = await lstat(join(ownerPath, record.draftId))
        if (!committed.isDirectory() || committed.isSymbolicLink()) {
          throw new Error(`unsafe committed draft for capacity slot: ${record.draftId}`)
        }
        continue
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    } else if (record !== undefined) {
      throw new Error(`invalid draft capacity record: ${entry.name}`)
    }
    const completed = await lstat(slot)
    if (
      !completed.isDirectory()
      || completed.isSymbolicLink()
      || completed.dev !== metadata.dev
      || completed.ino !== metadata.ino
      || completed.mtimeMs !== metadata.mtimeMs
    ) {
      throw new Error(`draft capacity slot changed during recovery: ${entry.name}`)
    }
    await assertDirectoryUnchanged(ownerIdentity, ownerPath)
    await assertDirectoryUnchanged(capacityIdentity, ownerPath)
    await rm(slot, { recursive: true })
  }
}

async function reserveDraftCapacity(capacityPath, draftId, signal) {
  for (let index = 0; index < MAX_DRAFTS_PER_OWNER; index += 1) {
    throwIfAborted(signal)
    const slot = join(capacityPath, capacitySlotName(index))
    try {
      await mkdir(slot, { mode: 0o700 })
    } catch (error) {
      if (error?.code === 'EEXIST') continue
      throw error
    }
    try {
      if (await inspectDirectory(slot, capacityPath) !== slot) {
        throw new Error(`unsafe draft capacity slot: ${slot}`)
      }
      await writeExclusiveFile(
        join(slot, 'draft.json'),
        `${JSON.stringify({ draftId })}\n`,
        slot,
      )
      return slot
    } catch (error) {
      await rm(slot, { recursive: true, force: true })
      throw error
    }
  }
  throw new Error('draft owner limit exceeded')
}

async function cleanupStaleStagingDirectories(parent, containmentRoot, signal) {
  const parentIdentity = await inspectDirectoryIdentity(parent, containmentRoot)
  let entries = 0
  const directory = await opendir(parent)
  for await (const entry of directory) {
    entries += 1
    if (entries > MAX_DIRECTORY_ENTRIES) throw new Error('draft staging directory entry limit exceeded')
    if (!TEMPORARY_DIRECTORY_PATTERN.test(entry.name)) continue
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('unsafe draft staging entry')
    const path = join(parent, entry.name)
    let initial
    try {
      initial = await lstat(path)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (Date.now() - initial.mtimeMs < STALE_STAGING_AGE_MS) continue
    throwIfAborted(signal)
    let canonical
    try {
      canonical = await inspectDirectory(path, containmentRoot)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (canonical !== path || await realpath(parent) !== parent) {
      throw new Error(`unsafe draft staging directory: ${path}`)
    }
    let completed
    try {
      completed = await lstat(path)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (
      !completed.isDirectory()
      || completed.isSymbolicLink()
      || completed.dev !== initial.dev
      || completed.ino !== initial.ino
      || completed.mtimeMs !== initial.mtimeMs
    ) {
      throw new Error(`draft staging directory changed during recovery: ${path}`)
    }
    try {
      await assertDirectoryUnchanged(parentIdentity, containmentRoot)
      await rm(path, { recursive: true })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

async function writeRevision(directory, snapshot, containmentRoot) {
  await writeExclusiveFile(
    join(directory, 'revision.json'),
    `${JSON.stringify(snapshot)}\n`,
    containmentRoot,
  )
}

export function createDraftStore(configValue = {}, dependencies = {}) {
  const config = parseWorkflowStoreConfig(configValue)
  const now = typeof dependencies.now === 'function' ? dependencies.now : () => new Date()
  const createId = typeof dependencies.createId === 'function' ? dependencies.createId : () => randomUUID()

  function prepareCreate(options) {
    const template = createTemplate(options)
    return {
      ok: true,
      workflowId: template.workflow.id,
      version: template.workflow.version,
      name: template.workflow.name,
      summary: template.workflow.summary,
      contentDigest: template.contentDigest,
      files: fileIndex(template.files),
      executionAuthorized: false,
    }
  }

  async function get(options, operation = {}) {
    throwIfAborted(operation.signal)
    if (!isPlainObject(options)) throw new TypeError('draft get options must be an object')
    for (const key of Object.keys(options)) {
      if (!['draftId', 'revision', 'path'].includes(key)) throw new TypeError(`unsupported draft get option: ${key}`)
    }
    const draftId = validateDraftId(options.draftId)
    const ownerSession = validateOwnerSession(operation.ownerSession)
    const revision = options.revision === undefined ? undefined : validateRevision(options.revision)
    if (
      options.path !== undefined
      && (!isSafeBundlePath(options.path) || !hasWellFormedUnicode(options.path))
    ) {
      throw new TypeError('path must be a safe relative POSIX path with well-formed Unicode')
    }
    if (config.root === null) return errorResult('draft_store_unconfigured', 'draft store is not configured')
    const draft = await readDraft(config, ownerSession, draftId)
    if (draft === null) return errorResult('draft_not_found', 'draft was not found')
    const snapshot = await loadSnapshot(draft, revision)
    if (snapshot === null) {
      return errorResult('draft_revision_not_found', 'draft revision was not found', { draftId, revision })
    }
    return summarize(draft.metadata, snapshot, options.path)
  }

  async function resolveRevision(options, operation = {}) {
    throwIfAborted(operation.signal)
    if (!isPlainObject(options)) throw new TypeError('draft resolve options must be an object')
    for (const key of Object.keys(options)) {
      if (!['draftId', 'revision'].includes(key)) throw new TypeError(`unsupported draft resolve option: ${key}`)
    }
    const draftId = validateDraftId(options.draftId)
    const ownerSession = validateOwnerSession(operation.ownerSession)
    const revision = options.revision === undefined ? undefined : validateRevision(options.revision)
    if (config.root === null) return errorResult('draft_store_unconfigured', 'draft store is not configured')
    const draft = await readDraft(config, ownerSession, draftId)
    if (draft === null) return errorResult('draft_not_found', 'draft was not found')
    const snapshot = await loadSnapshot(draft, revision)
    if (snapshot === null) {
      return errorResult('draft_revision_not_found', 'draft revision was not found', { draftId, revision })
    }
    return {
      ok: true,
      metadata: Object.freeze({
        schemaVersion: draft.metadata.schemaVersion,
        draftId: draft.metadata.draftId,
        workflow: draft.metadata.workflow,
        entrypoint: draft.metadata.entrypoint,
        languageVersion: draft.metadata.languageVersion,
        createdAt: draft.metadata.createdAt,
      }),
      snapshot,
      executionAuthorized: false,
    }
  }

  async function prepareUpdate(options, operation = {}) {
    throwIfAborted(operation.signal)
    if (!isPlainObject(options)) throw new TypeError('draft update options must be an object')
    for (const key of Object.keys(options)) {
      if (!['draftId', 'expectedRevision', 'expectedContentDigest', 'replacements', 'deletions'].includes(key)) {
        throw new TypeError(`unsupported draft update option: ${key}`)
      }
    }
    const draftId = validateDraftId(options.draftId)
    const expectedRevision = validateRevision(options.expectedRevision, 'expectedRevision')
    const expectedContentDigest = validateDigest(options.expectedContentDigest, 'expectedContentDigest')
    const ownerSession = validateOwnerSession(operation.ownerSession)
    if (config.root === null) return errorResult('draft_store_unconfigured', 'draft store is not configured')
    const draft = await readDraft(config, ownerSession, draftId)
    if (draft === null) return errorResult('draft_not_found', 'draft was not found')
    const current = await loadSnapshot(draft)
    if (current.revision !== expectedRevision || current.contentDigest !== expectedContentDigest) {
      return errorResult('revision_conflict', 'draft head does not match the expected revision and content digest', {
        draftId,
        expectedRevision,
        expectedContentDigest,
        actualRevision: current.revision,
        actualContentDigest: current.contentDigest,
      })
    }
    if (current.revision >= DRAFT_LIMITS.maxRevisions) {
      return errorResult('revision_limit', 'draft revision limit has been reached', { draftId, revision: current.revision })
    }
    const files = applyPatch(current, options)
    const contentDigest = computeDraftContentDigest(files)
    if (contentDigest === current.contentDigest) {
      return errorResult('no_changes', 'draft update does not change the source snapshot', {
        draftId,
        revision: current.revision,
        contentDigest: current.contentDigest,
      })
    }
    return {
      ok: true,
      draft,
      current,
      next: Object.freeze({
        schemaVersion: DRAFT_SCHEMA_VERSION,
        draftId,
        revision: current.revision + 1,
        contentDigest,
        files,
      }),
      executionAuthorized: false,
    }
  }

  return Object.freeze({
    config,
    summary: Object.freeze({
      configured: config.root !== null,
      writesEnabled: config.writeEnabled,
      ownerScope: 'session',
      schemaVersion: DRAFT_SCHEMA_VERSION,
    }),
    prepareCreate,
    get,
    resolve: resolveRevision,
    async create(options, operation = {}) {
      throwIfAborted(operation.signal)
      if (!config.writeEnabled) return errorResult('store_writes_disabled', 'workflow store writes are disabled')
      const ownerSession = validateOwnerSession(operation.ownerSession)
      const template = createTemplate(options)
      const ownerPath = await ownerRoot(config, ownerSession, true)
      const ownerIdentity = await inspectDirectoryIdentity(ownerPath, ownerPath)
      await cleanupStaleStagingDirectories(ownerPath, ownerPath, operation.signal)
      const capacityPath = await ensureSafeDirectoryChain(ownerPath, ['.capacity'])
      await cleanupStaleCapacityReservations(capacityPath, ownerPath, operation.signal)

      for (let attempt = 0; attempt < 3; attempt += 1) {
        throwIfAborted(operation.signal)
        const draftId = `draft-${createId()}`
        validateDraftId(draftId)
        const reservation = await reserveDraftCapacity(capacityPath, draftId, operation.signal)
        let committed = false
        const target = join(ownerPath, draftId)
        const temporary = join(ownerPath, `.tmp-${randomUUID()}`)
        try {
          await ensureDirectory(temporary)
          const revisions = await ensureSafeDirectoryChain(temporary, ['revisions', revisionDirectoryName(1)])
          const metadata = {
            schemaVersion: DRAFT_SCHEMA_VERSION,
            draftId,
            ownerSession,
            workflow: template.workflow,
            entrypoint: DRAFT_ENTRYPOINT,
            languageVersion: DRAFT_LANGUAGE_VERSION,
            createdAt: now().toISOString(),
          }
          const snapshot = {
            schemaVersion: DRAFT_SCHEMA_VERSION,
            draftId,
            revision: 1,
            contentDigest: template.contentDigest,
            files: template.files,
          }
          await writeExclusiveFile(join(temporary, 'draft.json'), `${JSON.stringify(metadata)}\n`, temporary)
          await writeRevision(revisions, snapshot, temporary)
          throwIfAborted(operation.signal)
          parseMetadata(await readBoundedJson(join(temporary, 'draft.json'), temporary, MAX_METADATA_BYTES), draftId, ownerSession)
          parseSnapshot(await readBoundedJson(join(revisions, 'revision.json'), temporary, MAX_REVISION_JSON_BYTES), draftId, 1)
          await assertDirectoryUnchanged(ownerIdentity, ownerPath)
          await rename(temporary, target)
          committed = true
          const created = await readDraft(config, ownerSession, draftId)
          const createdSnapshot = await loadSnapshot(created, 1)
          return { ...summarize(created.metadata, createdSnapshot), status: 'created' }
        } catch (error) {
          if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error
        } finally {
          await rm(temporary, { recursive: true, force: true })
          if (!committed) await rm(reservation, { recursive: true, force: true })
        }
      }
      return errorResult('draft_id_conflict', 'could not mint a unique draft identifier')
    },
    prepareUpdate,
    async update(options, operation = {}) {
      throwIfAborted(operation.signal)
      if (!config.writeEnabled) return errorResult('store_writes_disabled', 'workflow store writes are disabled')
      const prepared = await prepareUpdate(options, operation)
      if (!prepared.ok) return prepared
      const { draft, next } = prepared
      await assertDirectoryUnchanged(draft.draftIdentity, draft.root)
      await assertDirectoryUnchanged(draft.revisionsIdentity, draft.directory)
      await cleanupStaleStagingDirectories(draft.revisions, draft.directory, operation.signal)
      const target = join(draft.revisions, revisionDirectoryName(next.revision))
      const temporary = join(draft.revisions, `.tmp-${randomUUID()}`)
      await ensureDirectory(temporary)
      try {
        await writeRevision(temporary, next, draft.directory)
        throwIfAborted(operation.signal)
        parseSnapshot(
          await readBoundedJson(join(temporary, 'revision.json'), draft.directory, MAX_REVISION_JSON_BYTES),
          draft.metadata.draftId,
          next.revision,
        )
        await assertDirectoryUnchanged(draft.draftIdentity, draft.root)
        await assertDirectoryUnchanged(draft.revisionsIdentity, draft.directory)
        try {
          await rename(temporary, target)
        } catch (error) {
          if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
            const current = await loadSnapshot(draft)
            return errorResult('revision_conflict', 'draft head changed before the approved update committed', {
              draftId: draft.metadata.draftId,
              expectedRevision: options.expectedRevision,
              expectedContentDigest: options.expectedContentDigest,
              actualRevision: current.revision,
              actualContentDigest: current.contentDigest,
            })
          }
          throw error
        }
        const committed = await loadSnapshot(draft, next.revision)
        return { ...summarize(draft.metadata, committed), status: 'updated' }
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    },
  })
}
