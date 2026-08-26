import assert from 'node:assert/strict'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  computeDraftContentDigest,
  createDraftStore,
  DRAFT_LIMITS,
} from '../src/draft-store.js'

const OWNER = 'session-00000000-0000-4000-8000-000000000001'
const OTHER_OWNER = 'session-00000000-0000-4000-8000-000000000002'
const FIXED_UUID = '11111111-1111-4111-8111-111111111111'

async function withRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-draft-store-test-'))
  try {
    return await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function createOptions(overrides = {}) {
  return {
    id: 'rna-qc',
    version: '0.1.0',
    name: 'RNA QC',
    summary: 'Inspect RNA sequencing input quality.',
    ...overrides,
  }
}

test('draft content digests are canonical, role-bound, and Unicode-safe', () => {
  const files = [
    { path: 'main.wdl', role: 'workflow', content: 'version 1.0\nworkflow canonical {}\n' },
    { path: 'README.md', role: 'documentation', content: 'Canonical fixture.\n' },
  ]
  const digest = computeDraftContentDigest(files)
  assert.equal(digest, 'sha256:25cd6e542cd91232f6e17d3f918de218e9c93f0a59e71d06c4e4b1783dac03ac')
  assert.equal(computeDraftContentDigest([...files].reverse()), digest)
  assert.notEqual(
    computeDraftContentDigest(files.map((file) => (
      file.path === 'README.md' ? { ...file, role: 'license' } : file
    ))),
    digest,
  )
  const unicodePaths = [
    { path: 'main.wdl', role: 'workflow', content: 'version 1.0\nworkflow unicode {}\n' },
    { path: 'notes/é.md', role: 'documentation', content: 'composed\n' },
    { path: 'notes/é.md', role: 'documentation', content: 'decomposed\n' },
  ]
  const unicodeDigest = 'sha256:5752ca0b00aead83c64cc0ea6ca5c2ddf8e15f4088c78c7b82f76d57c26d6283'
  assert.equal(computeDraftContentDigest(unicodePaths), unicodeDigest)
  assert.equal(
    computeDraftContentDigest(unicodePaths),
    computeDraftContentDigest([...unicodePaths].reverse()),
  )
  assert.throws(
    () => computeDraftContentDigest([{ path: 'main.wdl', role: 'workflow', content: '\ud800' }]),
    /well-formed Unicode/,
  )
  for (const hostilePath of ['notes/\ud800.md', 'notes/\ud801.md']) {
    assert.throws(
      () => computeDraftContentDigest([
        { path: 'main.wdl', role: 'workflow', content: 'version 1.0\nworkflow unicode_path {}\n' },
        { path: hostilePath, role: 'documentation', content: 'hostile path\n' },
      ]),
      /well-formed Unicode/,
    )
  }
})

test('draft store creates immutable owner-scoped revisions and returns one bounded file body', async () => {
  await withRoot(async (root) => {
    const store = createDraftStore(
      { root, writeEnabled: true },
      {
        createId: () => FIXED_UUID,
        now: () => new Date('2026-08-26T00:00:00.000Z'),
      },
    )
    const created = await store.create(createOptions(), { ownerSession: OWNER })
    assert.equal(created.ok, true)
    assert.equal(created.status, 'created')
    assert.equal(created.draftId, `draft-${FIXED_UUID}`)
    assert.equal(created.revision, 1)
    assert.equal(created.files.length, 3)
    assert.equal(Object.hasOwn(created.files[0], 'content'), false)
    assert.equal(created.executionAuthorized, false)

    const selected = await store.get(
      { draftId: created.draftId, revision: 1, path: 'main.wdl' },
      { ownerSession: OWNER },
    )
    assert.equal(selected.ok, true)
    assert.match(selected.file.content, /^version 1\.0/m)
    assert.equal(Object.hasOwn(selected, 'files'), false)

    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: created.revision,
      expectedContentDigest: created.contentDigest,
      replacements: [
        {
          path: 'main.wdl',
          role: 'workflow',
          content: 'version 1.0\nimport "tasks/qc.wdl" as Qc\nworkflow rna_qc {}\n',
        },
        {
          path: 'tasks/qc.wdl',
          role: 'task',
          content: 'version 1.0\ntask qc { command <<< true >>> }\n',
        },
      ],
      deletions: ['README.md'],
    }, { ownerSession: OWNER })
    assert.equal(updated.ok, true)
    assert.equal(updated.status, 'updated')
    assert.equal(updated.revision, 2)
    assert.notEqual(updated.contentDigest, created.contentDigest)
    assert.deepEqual(updated.files.map((file) => file.path), [
      'examples/inputs.json',
      'main.wdl',
      'tasks/qc.wdl',
    ])

    const old = await store.get(
      { draftId: created.draftId, revision: 1, path: 'main.wdl' },
      { ownerSession: OWNER },
    )
    assert.equal(old.contentDigest, created.contentDigest)
    assert.doesNotMatch(old.file.content, /tasks\/qc\.wdl/)

    const foreign = await store.get({ draftId: created.draftId }, { ownerSession: OTHER_OWNER })
    assert.equal(foreign.error.code, 'draft_not_found')
    assert.equal(Object.hasOwn(foreign, 'ownerSession'), false)
  })
})

test('draft updates enforce dual CAS, reject no-ops, and allow only one concurrent writer', async () => {
  await withRoot(async (root) => {
    const store = createDraftStore({ root, writeEnabled: true })
    const created = await store.create(createOptions(), { ownerSession: OWNER })
    const staleDigest = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: `sha256:${'0'.repeat(64)}`,
      replacements: [{ path: 'README.md', role: 'documentation', content: 'changed\n' }],
    }, { ownerSession: OWNER })
    assert.equal(staleDigest.error.code, 'revision_conflict')
    assert.equal(staleDigest.actualRevision, 1)

    const noOp = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: (await store.get(
          { draftId: created.draftId, path: 'main.wdl' },
          { ownerSession: OWNER },
        )).file.content,
      }],
    }, { ownerSession: OWNER })
    assert.equal(noOp.error.code, 'no_changes')

    const base = {
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
    }
    const [left, right] = await Promise.all([
      store.update({
        ...base,
        replacements: [{ path: 'README.md', role: 'documentation', content: 'left\n' }],
      }, { ownerSession: OWNER }),
      store.update({
        ...base,
        replacements: [{ path: 'README.md', role: 'documentation', content: 'right\n' }],
      }, { ownerSession: OWNER }),
    ])
    assert.equal([left, right].filter((result) => result.ok).length, 1)
    assert.equal([left, right].filter((result) => result.error?.code === 'revision_conflict').length, 1)
    const head = await store.get({ draftId: created.draftId }, { ownerSession: OWNER })
    assert.equal(head.revision, 2)

    const ownerHash = await readdir(join(root, 'authoring'))
    const revisionEntries = await readdir(join(root, 'authoring', ownerHash[0], created.draftId, 'revisions'))
    assert.deepEqual(revisionEntries.sort(), ['00000001', '00000002'])
  })
})

test('draft writes remain default-off and cancellation commits nothing', async () => {
  await withRoot(async (root) => {
    const disabled = createDraftStore({ root })
    const denied = await disabled.create(createOptions(), { ownerSession: OWNER })
    assert.equal(denied.error.code, 'store_writes_disabled')

    const enabled = createDraftStore({ root, writeEnabled: true })
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await assert.rejects(
      enabled.create(createOptions(), { ownerSession: OWNER, signal: controller.signal }),
      (error) => error.name === 'AbortError',
    )
    await assert.rejects(access(join(root, 'authoring')), { code: 'ENOENT' })
  })
})

test('draft metadata rejects oversized identifiers and versions before persistence', async () => {
  await withRoot(async (root) => {
    const store = createDraftStore({ root, writeEnabled: true })
    await assert.rejects(
      store.create(createOptions({ id: `a-${'b'.repeat(64)}` }), { ownerSession: OWNER }),
      /at most 64 characters/,
    )
    await assert.rejects(
      store.create(createOptions({ version: `1.0.0+${'a'.repeat(128)}` }), { ownerSession: OWNER }),
      /at most 128 characters/,
    )
    await assert.rejects(access(join(root, 'authoring')), { code: 'ENOENT' })
  })
})

test('draft writes reject a group-or-world-writable store root', async () => {
  await withRoot(async (root) => {
    const insecureRoot = join(root, 'insecure-store')
    await mkdir(insecureRoot, { mode: 0o700 })
    await chmod(insecureRoot, 0o777)
    const store = createDraftStore({ root: insecureRoot, writeEnabled: true })
    await assert.rejects(
      store.create(createOptions(), { ownerSession: OWNER }),
      /must not be writable by group or other users/,
    )
  })
})

test('valid raw source budgets survive worst-case JSON string escaping', async () => {
  await withRoot(async (root) => {
    const store = createDraftStore({ root, writeEnabled: true })
    const created = await store.create(createOptions(), { ownerSession: OWNER })
    const escapedContent = '\0'.repeat(DRAFT_LIMITS.maxFileBytes)
    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: created.revision,
      expectedContentDigest: created.contentDigest,
      replacements: [
        { path: 'main.wdl', role: 'workflow', content: escapedContent },
        { path: 'README.md', role: 'documentation', content: escapedContent },
        { path: 'examples/inputs.json', role: 'example', content: escapedContent },
        { path: 'notes/four.txt', role: 'documentation', content: escapedContent },
      ],
    }, { ownerSession: OWNER })
    assert.equal(updated.ok, true)
    const selected = await store.get(
      { draftId: created.draftId, revision: updated.revision, path: 'notes/four.txt' },
      { ownerSession: OWNER },
    )
    assert.equal(selected.file.content.length, escapedContent.length)
  })
})

test('concurrent creates cannot exceed the per-owner hard ceiling', async () => {
  await withRoot(async (root) => {
    const store = createDraftStore({ root, writeEnabled: true })
    const attempts = await Promise.allSettled(Array.from(
      { length: 257 },
      (_, index) => store.create(createOptions({ id: `draft-${index}` }), { ownerSession: OWNER }),
    ))
    assert.equal(attempts.filter((item) => item.status === 'fulfilled' && item.value.ok).length, 256)
    assert.equal(attempts.filter((item) => (
      item.status === 'rejected' && /draft owner limit exceeded/.test(item.reason?.message)
    )).length, 1)
    const [ownerHash] = await readdir(join(root, 'authoring'))
    const entries = await readdir(join(root, 'authoring', ownerHash))
    assert.equal(entries.filter((entry) => entry.startsWith('draft-')).length, 256)
  })
})

test('a new approved mutation removes only stale orphaned staging directories', async () => {
  await withRoot(async (root) => {
    const store = createDraftStore({ root, writeEnabled: true })
    const created = await store.create(createOptions(), { ownerSession: OWNER })
    const [ownerHash] = await readdir(join(root, 'authoring'))
    const revisions = join(root, 'authoring', ownerHash, created.draftId, 'revisions')
    const stale = join(revisions, '.tmp-22222222-2222-4222-8222-222222222222')
    await mkdir(stale, { mode: 0o700 })
    const old = new Date(Date.now() - (2 * 60 * 60 * 1000))
    await utimes(stale, old, old)

    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{ path: 'README.md', role: 'documentation', content: 'recovered\n' }],
    }, { ownerSession: OWNER })
    assert.equal(updated.ok, true)
    await assert.rejects(access(stale), { code: 'ENOENT' })
  })
})

test('draft store rejects unsafe paths, oversized snapshots, and symlinked revision records', async () => {
  await withRoot(async (root) => {
    const store = createDraftStore({ root, writeEnabled: true })
    const created = await store.create(createOptions(), { ownerSession: OWNER })
    await assert.rejects(
      store.update({
        draftId: created.draftId,
        expectedRevision: 1,
        expectedContentDigest: created.contentDigest,
        replacements: [{ path: '../escape.wdl', role: 'task', content: 'version 1.0\n' }],
      }, { ownerSession: OWNER }),
      /safe relative POSIX path/,
    )
    await assert.rejects(
      store.update({
        draftId: created.draftId,
        expectedRevision: 1,
        expectedContentDigest: created.contentDigest,
        replacements: [{
          path: 'large.txt',
          role: 'documentation',
          content: 'x'.repeat(DRAFT_LIMITS.maxFileBytes + 1),
        }],
      }, { ownerSession: OWNER }),
      /at most 1048576 bytes/,
    )

    const [ownerHash] = await readdir(join(root, 'authoring'))
    const revisionPath = join(root, 'authoring', ownerHash, created.draftId, 'revisions', '00000001', 'revision.json')
    const hostile = join(root, 'hostile.json')
    await writeFile(hostile, '{}\n')
    await unlink(revisionPath)
    await symlink(hostile, revisionPath)
    await assert.rejects(
      store.get({ draftId: created.draftId }, { ownerSession: OWNER }),
      /unsafe or oversized draft store file/,
    )
  })
})
