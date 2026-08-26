import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDraftStore } from '../src/draft-store.js'
import {
  createDraftValidator,
  parseDraftValidationConfig,
} from '../src/draft-validation.js'

const OWNER = 'session-validation-owner'

class StaticReader {
  constructor(text, lossy = false) {
    this.text = text
    this.lossy = lossy
  }

  readFrom(offset) {
    const buffer = Buffer.from(this.text, 'utf8')
    return {
      text: buffer.subarray(offset).toString('utf8'),
      nextOffset: buffer.length,
      lossy: this.lossy,
    }
  }
}

function handle(outcome, stdout = '', stderr = '', lossy = false) {
  return {
    collected: {
      stdout: new StaticReader(stdout, lossy),
      stderr: new StaticReader(stderr, lossy),
    },
    done: Promise.resolve(outcome),
    waitForExit: async () => true,
  }
}

class FakeSubprocess {
  constructor(executable, options = {}) {
    this.executable = executable
    this.options = options
    this.spawns = []
  }

  async resolveExecutable(command) {
    if (command !== this.executable) throw new Error(`unexpected executable: ${command}`)
    return this.executable
  }

  spawn(spec) {
    this.spawns.push(spec)
    if (spec.argv[1] === '--version') {
      return handle(
        { exitCode: 0, signal: null },
        `miniwdl v${this.options.version ?? '1.15.0'}\n`,
      )
    }
    if (spec.argv[1] !== 'check') throw new Error(`unexpected argv: ${spec.argv.join(' ')}`)
    const exitCode = this.options.checkExitCode ?? 0
    const signal = this.options.checkSignal ?? null
    const stderr = typeof this.options.checkStderr === 'function'
      ? this.options.checkStderr(spec)
      : this.options.checkStderr ?? ''
    return handle(
      { exitCode: signal === null ? exitCode : null, signal },
      this.options.checkStdout ?? '',
      stderr,
      this.options.lossy === true,
    )
  }
}

async function withFixture(options, callback) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bio-draft-validation-test-'))
  try {
    const bin = join(root, 'bin')
    await mkdir(bin, { mode: 0o700 })
    const executable = join(bin, 'miniwdl')
    await writeFile(executable, '#!/bin/sh\nexit 0\n')
    await chmod(executable, 0o755)
    const store = createDraftStore({ root: join(root, 'store'), writeEnabled: true })
    const created = await store.create({
      id: 'variant-calling',
      version: '0.1.0',
      name: 'Variant calling',
      summary: 'Author a variant-calling workflow.',
    }, { ownerSession: OWNER })
    const subprocess = options?.subprocess === null
      ? undefined
      : options?.subprocess ?? new FakeSubprocess(executable, options)
    const validator = createDraftValidator({
      store,
      config: {
        validator: {
          executable,
          expectedVersion: options?.expectedVersion ?? '1.15.0',
        },
      },
      getSubprocess: () => subprocess,
      getEnvironment: () => ({ PATH: '/ambient/bin', MINIWDL_CFG: '/ambient/miniwdl.cfg' }),
    })
    return await callback({ root, executable, store, created, subprocess, validator })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('draft validator emits deterministic revision-bound miniwdl evidence without running tasks', async () => {
  await withFixture({}, async ({ created, subprocess, validator }) => {
    const first = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    const second = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    assert.equal(first.ok, true)
    assert.equal(first.validation.valid, true)
    assert.equal(first.validation.revision, 1)
    assert.equal(first.validation.contentDigest, created.contentDigest)
    assert.equal(first.validation.validator.version, '1.15.0')
    assert.equal(first.validation.validationDigest, second.validation.validationDigest)
    assert.equal(first.validation.executionAuthorized, false)
    assert.deepEqual(first.validation.checks.at(-1), { id: 'miniwdl-check', status: 'passed' })
    assert.equal(subprocess.spawns.length, 4)
    assert.deepEqual(subprocess.spawns[1].argv.slice(1), [
      'check',
      '--no-outside-imports',
      'main.wdl',
    ])
    assert.equal(subprocess.spawns.some((spawn) => spawn.argv.includes('run')), false)
    assert.equal(subprocess.spawns.some((spawn) => spawn.argv.some((arg) => /docker/i.test(arg))), false)
    assert.equal(subprocess.spawns[1].env.PATH, '/nonexistent')
    assert.equal(subprocess.spawns[1].env.MINIWDL_CFG, undefined)
  })
})

test('miniwdl diagnostic ordering is deterministic for canonically equivalent Unicode', async () => {
  let invocation = 0
  const composed = 'é diagnostic'
  const decomposed = 'é diagnostic'
  await withFixture({
    checkExitCode: 2,
    checkStderr: () => (
      invocation++ === 0
        ? `${composed}\n${decomposed}\n`
        : `${decomposed}\n${composed}\n`
    ),
  }, async ({ created, validator }) => {
    const first = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    const second = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    assert.deepEqual(first.validation.diagnostics, second.validation.diagnostics)
    assert.equal(first.validation.validationDigest, second.validation.validationDigest)
    assert.deepEqual(
      first.validation.diagnostics.map((item) => item.message),
      [decomposed, composed],
    )
  })
})

test('newline-heavy miniwdl output is bounded before diagnostic materialization and sorting', async () => {
  await withFixture({
    checkExitCode: 2,
    checkStderr: 'x\n'.repeat(60_000),
  }, async ({ created, validator }) => {
    const result = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    assert.equal(result.ok, true)
    assert.equal(result.validation.valid, false)
    assert.equal(result.validation.truncated, true)
    assert.equal(result.validation.diagnostics.length, 128)
  })
})

test('truncated miniwdl diagnostics select the same UTF-8 top set across input order', async () => {
  const lines = Array.from({ length: 200 }, (_, index) => (
    `${String(index).padStart(3, '0')}-${index % 2 === 0 ? 'é' : 'é'}`
  ))
  let invocation = 0
  await withFixture({
    checkExitCode: 2,
    checkStderr: () => `${(invocation++ === 0 ? lines : [...lines].reverse()).join('\n')}\n`,
  }, async ({ created, validator }) => {
    const first = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    const second = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    assert.equal(first.validation.truncated, true)
    assert.equal(first.validation.diagnostics.length, 128)
    assert.deepEqual(first.validation.diagnostics, second.validation.diagnostics)
    assert.equal(first.validation.validationDigest, second.validation.validationDigest)
  })
})

test('unsafe imports fail structural validation before miniwdl sees the source', async () => {
  await withFixture({}, async ({ created, store, subprocess, validator }) => {
    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: 'version 1.0\nimport "https://example.invalid/hostile.wdl"\nworkflow hostile {}\n',
      }],
    }, { ownerSession: OWNER })
    const result = await validator.validate(
      { draftId: created.draftId, revision: updated.revision },
      { ownerSession: OWNER },
    )
    assert.equal(result.ok, true)
    assert.equal(result.validation.valid, false)
    assert.equal(result.validation.validator, null)
    assert.equal(result.validation.checks.at(-1).status, 'skipped')
    assert.equal(result.validation.diagnostics.some((item) => item.code === 'external_import'), true)
    assert.equal(subprocess.spawns.length, 0)
  })
})

test('structural checks do not accept declarations hidden in commands or dynamic container suffixes', async () => {
  await withFixture({}, async ({ created, store, validator }) => {
    const misleading = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: 'task only {\n  command <<<\nversion 1.0\nworkflow fake {\n  >>>\n}\n',
      }],
    }, { ownerSession: OWNER })
    const misleadingResult = await validator.validate(
      { draftId: created.draftId, revision: misleading.revision },
      { ownerSession: OWNER },
    )
    assert.equal(misleadingResult.validation.valid, false)
    assert.equal(misleadingResult.validation.diagnostics.some((item) => item.code === 'wdl_version'), true)
    assert.equal(misleadingResult.validation.diagnostics.some((item) => item.code === 'workflow_declaration'), true)

    const pinned = 'ubuntu@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const dynamic = await store.update({
      draftId: created.draftId,
      expectedRevision: misleading.revision,
      expectedContentDigest: misleading.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: `version 1.0\ntask t {\n  command <<< true >>>\n  runtime { docker: "${pinned}"\n    + suffix }\n}\nworkflow dynamic { call t }\n`,
      }],
    }, { ownerSession: OWNER })
    const dynamicResult = await validator.validate(
      { draftId: created.draftId, revision: dynamic.revision },
      { ownerSession: OWNER },
    )
    assert.equal(dynamicResult.validation.valid, false)
    assert.equal(
      dynamicResult.validation.diagnostics.some((item) => item.code === 'container_reference_dynamic'),
      true,
    )
  })
})

test('single-quoted imports are policy checked and plain local imports remain valid', async () => {
  await withFixture({ subprocess: null }, async ({ created, store, validator }) => {
    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: "version 1.0\nimport 'https://example.invalid/hostile.wdl'\nworkflow hostile {}\n",
      }],
    }, { ownerSession: OWNER })
    const result = await validator.validate(
      { draftId: created.draftId, revision: updated.revision },
      { ownerSession: OWNER },
    )
    assert.equal(result.ok, true)
    assert.equal(result.validation.valid, false)
    assert.equal(result.validation.validator, null)
    assert.equal(result.validation.diagnostics.some((item) => item.code === 'external_import'), true)
  })

  await withFixture({}, async ({ created, store, validator }) => {
    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [
        {
          path: 'main.wdl',
          role: 'workflow',
          content: "version 1.0\nimport 'tasks/helper.wdl' as Helper\nworkflow local_import {}\n",
        },
        {
          path: 'tasks/helper.wdl',
          role: 'task',
          content: 'version 1.0\ntask helper { command <<< true >>> }\n',
        },
      ],
    }, { ownerSession: OWNER })
    const result = await validator.validate(
      { draftId: created.draftId, revision: updated.revision },
      { ownerSession: OWNER },
    )
    assert.equal(result.validation.valid, true)
    assert.equal(result.validation.diagnostics.some((item) => item.code === 'external_import'), false)
  })
})

test('container-like metadata strings are ignored while runtime expressions remain strict', async () => {
  await withFixture({}, async ({ created, store, validator }) => {
    const pinned = 'ubuntu@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: `version 1.0\ntask t {\n  command <<< true >>>\n  runtime { docker: '${pinned}', cpu: 1 }\n  meta { note: 'docker: "ubuntu:latest"' }\n}\nworkflow metadata { call t }\n`,
      }],
    }, { ownerSession: OWNER })
    const result = await validator.validate(
      { draftId: created.draftId, revision: updated.revision },
      { ownerSession: OWNER },
    )
    assert.equal(result.validation.valid, true)
    assert.equal(result.validation.diagnostics.some((item) => item.code.startsWith('container_')), false)
  })
})

test('brace commands with raw opening braces do not hide the following runtime policy', async () => {
  await withFixture({}, async ({ created, store, validator }) => {
    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: `version 1.0\ntask t {\n  command {\n    echo {\n    echo ~{ if true # {\n      then "x" else "y" }\n  }\n  runtime { docker: "ubuntu:latest" }\n}\nworkflow brace_command { call t }\n`,
      }],
    }, { ownerSession: OWNER })
    const result = await validator.validate(
      { draftId: created.draftId, revision: updated.revision },
      { ownerSession: OWNER },
    )
    assert.equal(result.validation.valid, false)
    assert.equal(result.validation.diagnostics.some((item) => item.code === 'workflow_declaration'), false)
    assert.equal(result.validation.diagnostics.some((item) => item.code === 'container_digest_unpinned'), true)
  })
})

test('heredoc placeholder strings cannot end command masking before a runtime block', async () => {
  await withFixture({}, async ({ created, store, validator }) => {
    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: `version 1.0\ntask t {\n  command <<<\n    echo ~{"literal >>>"}\n  >>>\n  runtime { docker: "ubuntu:latest" }\n}\nworkflow heredoc_placeholder { call t }\n`,
      }],
    }, { ownerSession: OWNER })
    const result = await validator.validate(
      { draftId: created.draftId, revision: updated.revision },
      { ownerSession: OWNER },
    )
    assert.equal(result.validation.valid, false)
    assert.equal(result.validation.diagnostics.some((item) => item.code === 'container_digest_unpinned'), true)
  })
})

test('raw dollar-brace text in WDL 1.0 heredoc commands cannot hide runtime policy', async () => {
  await withFixture({}, async ({ created, store, validator }) => {
    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: `version 1.0\nworkflow before_task {}\ntask t {\n  command <<<\n    echo \${UNFINISHED\n  >>>\n  runtime { docker: "ubuntu:latest" }\n}\n`,
      }],
    }, { ownerSession: OWNER })
    const result = await validator.validate(
      { draftId: created.draftId, revision: updated.revision },
      { ownerSession: OWNER },
    )
    assert.equal(result.validation.diagnostics.some((item) => item.code === 'container_digest_unpinned'), true)
  })
})

test('interpolated strings with nested quotes cannot hide later policy declarations', async () => {
  await withFixture({}, async ({ created, store, validator }) => {
    const runtimeRevision = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: `version 1.0\ntask t {\n  String note = "prefix ~{if true then "{" else "}"} suffix"\n  command <<< true >>>\n  runtime { docker: "ubuntu:latest" }\n}\nworkflow interpolated { call t }\n`,
      }],
    }, { ownerSession: OWNER })
    const runtimeResult = await validator.validate(
      { draftId: created.draftId, revision: runtimeRevision.revision },
      { ownerSession: OWNER },
    )
    assert.equal(runtimeResult.validation.diagnostics.some(
      (item) => item.code === 'container_digest_unpinned'
    ), true)

    const importRevision = await store.update({
      draftId: created.draftId,
      expectedRevision: runtimeRevision.revision,
      expectedContentDigest: runtimeRevision.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: `version 1.0\nString note = "prefix ~{if true then "{" else "}"} suffix"\nimport "https://example.invalid/hostile.wdl"\nworkflow interpolated_import {}\n`,
      }],
    }, { ownerSession: OWNER })
    const importResult = await validator.validate(
      { draftId: created.draftId, revision: importRevision.revision },
      { ownerSession: OWNER },
    )
    assert.equal(importResult.validation.diagnostics.some((item) => item.code === 'external_import'), true)
  })
})

test('commented imports are ignored while multiline floating container declarations are rejected', async () => {
  await withFixture({}, async ({ created, store, validator }) => {
    const updated = await store.update({
      draftId: created.draftId,
      expectedRevision: 1,
      expectedContentDigest: created.contentDigest,
      replacements: [{
        path: 'main.wdl',
        role: 'workflow',
        content: `version 1.0\n# import "https://example.invalid/comment.wdl"\ntask t {\n  command <<<\n    echo 'import "https://example.invalid/command.wdl"'\n  >>>\n  runtime {\n    docker:\n      "ubuntu:latest"\n  }\n}\nworkflow commented_import { call t }\n`,
      }],
    }, { ownerSession: OWNER })
    const result = await validator.validate(
      { draftId: created.draftId, revision: updated.revision },
      { ownerSession: OWNER },
    )
    assert.equal(result.validation.valid, false)
    assert.equal(result.validation.diagnostics.some((item) => item.code === 'external_import'), false)
    assert.equal(result.validation.diagnostics.some((item) => item.code === 'container_digest_unpinned'), true)
  })
})

test('miniwdl syntax failures are invalid evidence while unavailable or mismatched validators are operational errors', async () => {
  await withFixture({
    checkExitCode: 2,
    checkStderr: (spec) => `${join(spec.cwd, 'main.wdl')}:3: unexpected token\n`,
  }, async ({ created, validator }) => {
    const result = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    assert.equal(result.ok, true)
    assert.equal(result.validation.valid, false)
    assert.match(result.validation.diagnostics.find((item) => item.source === 'miniwdl').message, /^\$DRAFT\/main\.wdl/)
    assert.match(result.validation.validationDigest, /^sha256:[a-f0-9]{64}$/)
  })

  await withFixture({ subprocess: null }, async ({ created, validator }) => {
    const result = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    assert.equal(result.error.code, 'validator_unavailable')
    assert.equal(Object.hasOwn(result, 'validationDigest'), false)
  })

  await withFixture({ version: '1.14.0' }, async ({ created, validator }) => {
    const result = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    assert.equal(result.error.code, 'validator_unavailable')
    assert.match(result.reason, /version mismatch/)
  })

  await withFixture({ checkSignal: 'SIGKILL' }, async ({ created, validator }) => {
    const result = await validator.validate(
      { draftId: created.draftId, revision: 1 },
      { ownerSession: OWNER },
    )
    assert.equal(result.error.code, 'validator_unavailable')
    assert.match(result.reason, /normal exit code/)
  })
})

test('authoring validator configuration is strict and version-pinned', () => {
  assert.deepEqual(parseDraftValidationConfig(), {
    validator: { executable: 'miniwdl', expectedVersion: '1.15.0' },
  })
  assert.throws(
    () => parseDraftValidationConfig({ validator: { expectedVersion: 'latest' } }),
    /exact semantic version/,
  )
  assert.throws(
    () => parseDraftValidationConfig({ validator: { flags: ['--debug'] } }),
    /unsupported property/,
  )
})
