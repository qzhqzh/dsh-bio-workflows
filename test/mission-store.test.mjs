import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createMissionStore } from '../src/mission-store.js'

const OWNER = 'session-mission-owner'
const MISSION_UUID = '11111111-1111-4111-8111-111111111111'
const DRAFT_ID = 'draft-22222222-2222-4222-8222-222222222222'
const CONTENT_DIGEST = `sha256:${'a'.repeat(64)}`
const VALIDATION_DIGEST = `sha256:${'b'.repeat(64)}`
const CONTAINER_IMAGE = `quay.io/biocontainers/fastqc@sha256:${'c'.repeat(64)}`
const REQUEST = Object.freeze({
  software: Object.freeze({
    name: 'FastQC',
    version: '0.12.1',
    containerImage: CONTAINER_IMAGE,
  }),
  objective: 'Author and validate a bounded WDL wrapper for FastQC.',
  acceptanceCriteria: Object.freeze(['The exact WDL draft passes deterministic validation.']),
})

function operation(ownerSession = OWNER) {
  return { ownerSession }
}

async function startMission(store, request = REQUEST) {
  const prepared = await store.prepare(request)
  assert.equal(prepared.ok, true)
  const mission = await store.start(
    { ...request, expectedPlanDigest: prepared.planDigest },
    operation(),
  )
  assert.equal(mission.ok, true)
  return { prepared, mission }
}

async function bindDraft(store, missionId) {
  const request = {
    id: 'fastqc-trial',
    name: 'FastQC trial',
    summary: 'Bounded FastQC authoring draft.',
  }
  const reserved = await store.reserveAction(missionId, 'draft_create', request, operation())
  assert.equal(reserved.ok, true)
  const recorded = await store.recordDraftResult(
    missionId,
    'draft_create',
    reserved.reservation,
    { ok: true, draftId: DRAFT_ID, revision: 1, contentDigest: CONTENT_DIGEST },
    operation(),
  )
  assert.equal(recorded.ok, true)
  assert.deepEqual(recorded.draft, {
    draftId: DRAFT_ID,
    revision: 1,
    contentDigest: CONTENT_DIGEST,
  })
  return recorded
}

test('Mission support is default-off and read-only misses do not create store directories', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-bio-mission-off-test-'))
  const root = join(parent, 'missing-store')
  try {
    const disabled = createMissionStore({ root, writeEnabled: true })
    const prepared = await disabled.prepare(REQUEST)
    assert.equal(prepared.ok, false)
    assert.equal(prepared.error.code, 'autonomy_disabled')

    const enabled = createMissionStore(
      { root, writeEnabled: true },
      { enabled: true },
    )
    const missing = await enabled.get(
      'mission-33333333-3333-4333-8333-333333333333',
      operation(),
    )
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'mission_not_found')
    await assert.rejects(access(root), { code: 'ENOENT' })
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('Mission start binds one approval to an exact plan digest and interrupts on runtime restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-mission-restart-test-'))
  try {
    const first = createMissionStore(
      { root, writeEnabled: true },
      { enabled: true },
      { createId: () => MISSION_UUID, runtimeId: 'runtime-one' },
    )
    const prepared = await first.prepare(REQUEST)
    const mismatched = await first.start({
      ...REQUEST,
      expectedPlanDigest: `sha256:${'0'.repeat(64)}`,
    }, operation())
    assert.equal(mismatched.ok, false)
    assert.equal(mismatched.error.code, 'mission_plan_digest_mismatch')

    const started = await first.start({
      ...REQUEST,
      expectedPlanDigest: prepared.planDigest,
    }, operation())
    assert.equal(started.planDigest, prepared.planDigest)
    assert.equal(started.capabilities.isolatedDraftTest, false)
    assert.equal(started.capabilities.productionExecution, false)

    const wrongOwner = await first.get(started.missionId, operation('different-session'))
    assert.equal(wrongOwner.ok, false)
    assert.equal(wrongOwner.error.code, 'mission_not_found')

    const restarted = createMissionStore(
      { root, writeEnabled: true },
      { enabled: true },
      { runtimeId: 'runtime-two' },
    )
    const interrupted = await restarted.get(started.missionId, operation())
    assert.equal(interrupted.status, 'interrupted')
    assert.equal(interrupted.stop.code, 'runtime_restarted')
    assert.equal(interrupted.stop.automaticRetry, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Mission tracks deterministic validation failures and opens the repeated-failure circuit breaker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-mission-circuit-test-'))
  try {
    const store = createMissionStore(
      { root, writeEnabled: true },
      { enabled: true, maxSameFailureFingerprint: 3 },
      { createId: () => MISSION_UUID, runtimeId: 'runtime-circuit' },
    )
    const { mission } = await startMission(store)
    await bindDraft(store, mission.missionId)

    const validationResult = {
      ok: true,
      validation: {
        valid: false,
        validationDigest: VALIDATION_DIGEST,
        diagnostics: [
          {
            path: '$.files[0].content',
            code: 'container_digest_unpinned',
            message: 'Image must be digest-pinned.',
            severity: 'error',
            source: 'structural',
          },
        ],
      },
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const request = { draftId: DRAFT_ID, revision: 1 }
      const reserved = await store.reserveAction(
        mission.missionId,
        'draft_validate',
        request,
        operation(),
      )
      assert.equal(reserved.ok, true)
      const recorded = await store.recordValidationResult(
        mission.missionId,
        reserved.reservation,
        validationResult,
        operation(),
      )
      assert.equal(recorded.budget.used.validationFailures, attempt)
    }

    const exhausted = await store.get(mission.missionId, operation())
    assert.equal(exhausted.status, 'exhausted')
    assert.equal(exhausted.stop.code, 'repeated_failure')
    assert.equal(exhausted.failures.length, 3)
    assert.equal(new Set(exhausted.failures.map((item) => item.failureFingerprint)).size, 1)
    assert.deepEqual(exhausted.failures.map((item) => item.occurrence), [1, 2, 3])

    const denied = await store.reserveAction(
      mission.missionId,
      'draft_validate',
      { draftId: DRAFT_ID, revision: 1 },
      operation(),
    )
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'mission_grant_inactive')

    const report = await store.report(mission.missionId, operation())
    assert.equal(report.report.outcome, 'exhausted')
    assert.equal(report.report.success, false)
    assert.equal(report.report.readiness.isolatedTestCompleted, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Mission reports a validated draft as ready only for a separately isolated test', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-mission-valid-test-'))
  try {
    const store = createMissionStore(
      { root, writeEnabled: true },
      { enabled: true },
      { createId: () => MISSION_UUID, runtimeId: 'runtime-valid' },
    )
    const { mission } = await startMission(store)
    await bindDraft(store, mission.missionId)
    const wrongRevisionReservation = await store.reserveAction(
      mission.missionId,
      'draft_validate',
      { draftId: DRAFT_ID, revision: 1 },
      operation(),
    )
    const wrongRevision = await store.recordValidationResult(
      mission.missionId,
      wrongRevisionReservation.reservation,
      {
        ok: true,
        validation: {
          draftId: DRAFT_ID,
          revision: 2,
          contentDigest: CONTENT_DIGEST,
          valid: true,
          validationDigest: VALIDATION_DIGEST,
          containerImages: [CONTAINER_IMAGE],
          containerPolicy: { taskCount: 1, tasksWithSingleContainer: 1, complete: true },
        },
      },
      operation(),
    )
    assert.equal(wrongRevision.phase, 'diagnosing')
    assert.equal(
      wrongRevision.failures[0].diagnostics[0].code,
      'mission_validation_identity_mismatch',
    )
    const mismatchedReservation = await store.reserveAction(
      mission.missionId,
      'draft_validate',
      { draftId: DRAFT_ID, revision: 1 },
      operation(),
    )
    const mismatched = await store.recordValidationResult(
      mission.missionId,
      mismatchedReservation.reservation,
      {
        ok: true,
        validation: {
          draftId: DRAFT_ID,
          revision: 1,
          contentDigest: CONTENT_DIGEST,
          valid: true,
          validationDigest: VALIDATION_DIGEST,
          containerImages: [CONTAINER_IMAGE],
          containerPolicy: { taskCount: 2, tasksWithSingleContainer: 1, complete: false },
        },
      },
      operation(),
    )
    assert.equal(mismatched.phase, 'diagnosing')
    assert.equal(
      mismatched.failures.at(-1).diagnostics[0].code,
      'mission_container_identity_mismatch',
    )

    const wrongImageReservation = await store.reserveAction(
      mission.missionId,
      'draft_validate',
      { draftId: DRAFT_ID, revision: 1 },
      operation(),
    )
    const wrongImage = await store.recordValidationResult(
      mission.missionId,
      wrongImageReservation.reservation,
      {
        ok: true,
        validation: {
          draftId: DRAFT_ID,
          revision: 1,
          contentDigest: CONTENT_DIGEST,
          valid: true,
          validationDigest: VALIDATION_DIGEST,
          containerImages: [`example.invalid/other@sha256:${'d'.repeat(64)}`],
          containerPolicy: { taskCount: 1, tasksWithSingleContainer: 1, complete: true },
        },
      },
      operation(),
    )
    assert.equal(wrongImage.phase, 'diagnosing')

    const reserved = await store.reserveAction(
      mission.missionId,
      'draft_validate',
      { draftId: DRAFT_ID, revision: 1 },
      operation(),
    )
    const validated = await store.recordValidationResult(
      mission.missionId,
      reserved.reservation,
      {
        ok: true,
        validation: {
          draftId: DRAFT_ID,
          revision: 1,
          contentDigest: CONTENT_DIGEST,
          valid: true,
          validationDigest: VALIDATION_DIGEST,
          containerImages: [CONTAINER_IMAGE],
          containerPolicy: { taskCount: 1, tasksWithSingleContainer: 1, complete: true },
        },
      },
      operation(),
    )
    assert.equal(validated.status, 'ready')
    assert.equal(validated.phase, 'validated')

    const denied = await store.reserveAction(
      mission.missionId,
      'draft_update',
      {
        draftId: DRAFT_ID,
        expectedRevision: 1,
        expectedContentDigest: CONTENT_DIGEST,
      },
      operation(),
    )
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'mission_grant_inactive')

    const restarted = createMissionStore(
      { root, writeEnabled: true },
      { enabled: true },
      { runtimeId: 'runtime-after-ready' },
    )
    const stillReady = await restarted.get(mission.missionId, operation())
    assert.equal(stillReady.status, 'ready')
    assert.equal(stillReady.stop, null)

    const report = await store.report(mission.missionId, operation())
    assert.equal(report.report.outcome, 'ready_for_isolated_test')
    assert.equal(report.report.success, false)
    assert.equal(report.report.readiness.draftValidated, true)
    assert.equal(report.report.readiness.isolatedTestCompleted, false)
    assert.match(report.report.recommendedNextAction, /isolated draft-test runner/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Mission exhausts a failed one-shot draft-create budget instead of remaining active', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-mission-create-budget-test-'))
  try {
    const store = createMissionStore(
      { root, writeEnabled: true },
      { enabled: true, maxDraftCreates: 1 },
      { createId: () => MISSION_UUID, runtimeId: 'runtime-create-budget' },
    )
    const { mission } = await startMission(store)
    const reserved = await store.reserveAction(
      mission.missionId,
      'draft_create',
      { id: 'failed-create', name: 'Failed create', summary: 'Expected failure.' },
      operation(),
    )
    const recorded = await store.recordDraftResult(
      mission.missionId,
      'draft_create',
      reserved.reservation,
      { ok: false, error: { code: 'draft_write_failed', message: 'write failed' } },
      operation(),
    )
    assert.equal(recorded.status, 'exhausted')
    assert.equal(recorded.stop.code, 'draft_create_budget_exhausted')
    assert.equal(recorded.draft, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Mission blocks an ambiguous draft mutation without replaying the action', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-mission-ambiguous-test-'))
  try {
    const store = createMissionStore(
      { root, writeEnabled: true },
      { enabled: true, maxDraftCreates: 2 },
      { createId: () => MISSION_UUID, runtimeId: 'runtime-ambiguous' },
    )
    const { mission } = await startMission(store)
    const reserved = await store.reserveAction(
      mission.missionId,
      'draft_create',
      { id: 'ambiguous-create', name: 'Ambiguous create', summary: 'Unknown outcome.' },
      operation(),
    )
    const recorded = await store.recordDraftResult(
      mission.missionId,
      'draft_create',
      reserved.reservation,
      {
        ok: false,
        error: {
          code: 'mission_action_outcome_unknown',
          message: 'the write outcome could not be proven',
        },
      },
      operation(),
    )
    assert.equal(recorded.status, 'blocked')
    assert.equal(recorded.stop.code, 'mission_action_outcome_unknown')
    assert.equal(recorded.stop.automaticRetry, false)

    const denied = await store.reserveAction(
      mission.missionId,
      'draft_create',
      { id: 'replay', name: 'Replay', summary: 'Must not execute.' },
      operation(),
    )
    assert.equal(denied.error.code, 'mission_grant_inactive')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Mission blocks a draft update result that is not the exact next revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-mission-revision-conflict-test-'))
  try {
    const store = createMissionStore(
      { root, writeEnabled: true },
      { enabled: true },
      { createId: () => MISSION_UUID, runtimeId: 'runtime-revision-conflict' },
    )
    const { mission } = await startMission(store)
    await bindDraft(store, mission.missionId)
    const request = {
      draftId: DRAFT_ID,
      expectedRevision: 1,
      expectedContentDigest: CONTENT_DIGEST,
      replacements: [{ path: 'main.wdl', role: 'workflow', content: 'version 1.0\nworkflow changed {}\n' }],
    }
    const reserved = await store.reserveAction(
      mission.missionId,
      'draft_update',
      request,
      operation(),
    )
    const recorded = await store.recordDraftResult(
      mission.missionId,
      'draft_update',
      reserved.reservation,
      { ok: true, draftId: DRAFT_ID, revision: 1, contentDigest: VALIDATION_DIGEST },
      operation(),
    )
    assert.equal(recorded.status, 'blocked')
    assert.equal(recorded.stop.code, 'mission_draft_conflict')
    assert.deepEqual(recorded.draft, {
      draftId: DRAFT_ID,
      revision: 1,
      contentDigest: CONTENT_DIGEST,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Mission cancellation remains terminal when an in-flight draft action completes later', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-mission-cancel-race-test-'))
  try {
    const store = createMissionStore(
      { root, writeEnabled: true },
      { enabled: true },
      { createId: () => MISSION_UUID, runtimeId: 'runtime-cancel-race' },
    )
    const { mission } = await startMission(store)
    const reserved = await store.reserveAction(
      mission.missionId,
      'draft_create',
      { id: 'cancelled-create', name: 'Cancelled create', summary: 'In-flight action.' },
      operation(),
    )
    const cancelled = await store.cancel(mission.missionId, operation())
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.phase, 'stopped')

    const recorded = await store.recordDraftResult(
      mission.missionId,
      'draft_create',
      reserved.reservation,
      { ok: true, draftId: DRAFT_ID, revision: 1, contentDigest: CONTENT_DIGEST },
      operation(),
    )
    assert.equal(recorded.status, 'cancelled')
    assert.equal(recorded.phase, 'stopped')
    assert.equal(recorded.stop.code, 'cancelled_by_owner')
    assert.equal(recorded.draft, null)

    const persisted = await store.get(mission.missionId, operation())
    assert.equal(persisted.status, 'cancelled')
    assert.equal(persisted.phase, 'stopped')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
