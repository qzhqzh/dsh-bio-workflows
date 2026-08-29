# Workflow Center lifecycle projection contract

Status: design gate accepted; runtime projection is intentionally deferred.

This contract defines the minimum safe read model needed for Workflow Center to
explain what the Agent is doing and to select recent owner-scoped lifecycle
objects without typing identifiers. It does not create another execution
control plane. Every mutation remains `session.prompt → Agent → tool/approval`.

## Transport and ownership

- Register one pure synchronous Host fold under `ctx.sessionProjections` with
  the client key `bioWorkflowsActivity`.
- Read it only from the current binding through
  `sessions.binding(sessionId).session.projections.faceOf(key)`.
- Do not add an HTTP endpoint, polling route, browser-owned lifecycle store, or
  client-side event fold.
- The bound DSH session is the owner boundary. A browser field, prompt argument,
  projected object id, or display marker must never supply or override owner
  identity.
- The projection is a read-only convenience view. Tool results, approval
  records, exact plans, revisions, digests, and server-side owner checks remain
  authoritative.

The DSH session-projection carrier supplies finished whole values and applies a
higher-sequence-wins rule. A missing projection key means the capability is not
available; it must not be presented as an empty, fresh, or successful history.

## Correlation gate

Tool lifecycle correlation is authoritative inside one session:

- `tool/call` supplies `callId`, `turn`, and `step`.
- `tool/result` links back to the exact `callId` in the same turn and step.
- A duplicated, missing, malformed, or cross-step result fails closed and is
  omitted from the user-facing activity rows.

Workflow Center intent correlation is not yet authoritative in DSH
`0.1.1-rc.2`:

- the Host already records the request envelope `rpcId` on the committed
  `user/message` as `source.rpcId`;
- the outward client `session.prompt()` face returns only `{ accepted: true }`
  and does not expose that same `rpcId` to the caller.

Runtime Slice C therefore remains blocked until the outward session face returns
the existing request `rpcId` with the acceptance result, allowing the UI and
committed message to share one durable value. No second id or log event is
needed. A random marker embedded in prompt text may be used only as an explicitly
labelled display hint. It is never authorization evidence; zero or multiple
matches are omitted rather than choosing one heuristically.

Returning that id does not by itself make every later tool call attributable.
Steering can commit more than one request `rpcId` inside one turn. For each
`tool/call`, the fold must derive the candidate set from request messages that
entered the exact model-input step owning the call. The call belongs to an
intent only when that set contains exactly one distinct `rpcId`. A zero- or
multiple-candidate call is omitted and increments
`omittedUncorrelatedCount`; the fold must never choose the newest, nearest, or
lexically first request. The same decision is retained for the matching
`tool/result` through the Host-only `callId` map.

## Intent aggregation

The user-facing unit is one row per `intentId` (the shared prompt `rpcId`), not
one row per tool call. The Host-only fold may keep a bounded `callId` map for
correlation, but individual calls, turns, and steps do not enter the wire value.
This prevents an Agent's internal tool sequence from becoming work the user has
to interpret.

The initial phase allowlist and mapping are:

| Phase | Deterministic source |
| --- | --- |
| `request` | accepted intent before a mapped tool call |
| `inspection` | `info`, `list`, `search`, `get`, graph, lifecycle get/list/report tools |
| `authoring` | draft create/update or Mission start |
| `validation` | bundle or exact-draft validation |
| `planning` | execution plan, Mission prepare, fixture-test prepare, or cleanup plan |
| `approval` | DSH approval requested/settled for a correlated call |
| `isolated-test` | separately approved fixture-test start |
| `execution` | approved `bio_workflows_run` only |
| `recovery` | explicit Mission/test cancellation or approved run cleanup |

Tool names must be explicitly allowlisted in the fold; prefix matching and prose
classification are forbidden. In particular, Mission activity never maps to
`execution`, because a Mission may not call `bio_workflows_run`.

For sequential calls, the greatest `(turn, step)` supplies the displayed phase.
For parallel calls in the same step, phase priority is `recovery > execution >
isolated-test > approval > planning > validation > authoring > inspection >
request`; ties use lexical `callId` only inside Host state.

Status is reduced across the whole intent and the Agent turn boundary, not from
the displayed phase alone:

- it is `queued` before the correlated turn starts and remains `running` until
  the matching `turn/end`, even when the latest tool result has already settled;
- an unresolved correlated call at `turn/end` is `interrupted`, and an explicit
  user/policy cancellation is `cancelled`;
- a failed call remains a failure latch. A later read-only inspection can update
  the phase but cannot clear it;
- only a later successful outcome-bearing call for the same exact object and
  operation may clear that latch (a bounded explicit retry/recovery); otherwise
  normal `turn/end` with no latched failure is `succeeded`.

An accepted intent may reach `turn/end` without any unambiguously correlated,
allowlisted lifecycle tool call—for example, the Agent only explains the
feature, or all candidate sets were ambiguous. Its temporary `request` row is
then removed instead of being retained or labelled successful. The Agent task
remains the record of that conversation. Ambiguous calls have already raised
the aggregate omission warning; an ordinary no-tool explanation does not.

These rules prevent `execution failed → run_get succeeded` from being shown as
a successful intent. They are deterministic presentation logic, never
authorization or scientific success evidence.

## Bounded wire value

The initial wire contract is a whole value with schema version `1` and at most
20 newest intent rows for the current session:

```json
{
  "schemaVersion": "1",
  "omittedUncorrelatedCount": 0,
  "items": [
    {
      "intentId": "durable-host-admission-id",
      "objects": [
        {
          "type": "run",
          "id": "run-00000000-0000-4000-8000-000000000000"
        }
      ],
      "workflow": { "id": "fastq-qc", "version": "1.2.0" },
      "phase": "execution",
      "status": "running",
      "summary": "Running approved FASTQ quality control",
      "updatedAt": "2026-08-29T00:00:00.000Z"
    }
  ]
}
```

The example illustrates shape only. `intentId` is an opaque correlation value,
not a permission. Each row carries at most four unique object references. Object
ids may populate a selector and an Agent prompt, but the receiving tool must
still derive owner identity from the current server session and reject any
mismatch.

Allowed fields are limited to:

- at most four object types and opaque object ids per intent;
- built-in workflow id and version;
- enum phase and status;
- bounded timestamp and count values;
- a stable allowlisted error code;
- a derived summary of at most 120 characters.

The wire value must omit raw prompts, tool arguments, tool results, arbitrary
error messages, WDL source, filesystem paths, logs, artifact bodies, environment
values, credentials, secrets, plan or content digests, and runner/container
identity. Adding a field requires a separate privacy and authority review; it is
not permitted merely because the same fact appears elsewhere in the session
log.

`omittedUncorrelatedCount` is a saturating bounded count. If non-zero, the UI
shows one generic warning that some activity is available only in the Agent
task. It never creates an `uncorrelated` row or reveals the omitted event.

## Client freshness

Freshness is not part of the Host projection value. `faceOf()` exposes the
domain value but not the carrier watermark, and a Host fold cannot observe a
browser disconnect. The UI must derive `fresh`, `stale`, or `unavailable` from
an authenticated client connection signal plus a comparable projection/session
watermark. The current narrow `SessionsFace` exposes neither, so runtime Slice C
also remains blocked on that client seam.

When the binding or connection is unavailable, Activity hides or disables
projected object selectors and says that progress remains in the Agent task. A
known lag may show one stale warning, but it never changes an intent to failed,
cancelled, or interrupted.

## State semantics

The only initial activity states are `queued`, `running`, `succeeded`, `failed`,
`cancelled`, and `interrupted`.

- A terminal tool result determines `succeeded` or `failed` from the tool's
  stable contract, never from prose.
- An explicit cancellation event determines `cancelled`.
- Session/turn termination with an unresolved call determines `interrupted`.
- Client disconnect or projection lag changes only the client freshness state;
  it never infers failure or cancellation.
- Unknown event versions, malformed data, ambiguous correlation, or impossible
  transitions are omitted, increment the bounded aggregate warning count, and
  are never presented as successful activity.

## Implementation gates

Runtime work may begin only after all of the following are true:

1. The outward DSH session face returns the existing prompt request `rpcId` that
   the committed `user/message.source.rpcId` already records.
2. The client exposes authenticated connection health and a comparable
   projection/session watermark so freshness is not guessed.
3. A module-augmented projection schema and pure fold pass deterministic replay,
   out-of-order carrier, unknown-version, collision, and impossible-transition
   tests.
4. Owner isolation tests prove that one session cannot read or select another
   session's drafts, Missions, fixture tests, or runs.
5. Redaction tests use adversarial prompt, path, error, log, and artifact values
   and prove that only the allowlist reaches the wire.
6. Bounds tests enforce 20 items, four object references per intent,
   120-character summaries, finite numeric ranges, and bounded serialized size.
7. UI tests cover unavailable, stale, queued, running, every terminal state,
   malformed payloads, reconnect, and ambiguous correlation.
8. Network tests prove no new browser endpoint exists and all actions still
   traverse the Agent and existing approval boundaries.

## Non-goals

- No direct browser execution, cancellation, retry, install, promotion, or
  allowlist mutation.
- No Mission call to `bio_workflows_run`.
- No production authority for an AI-authored WDL draft.
- No change to `Software Trial Report v1.success`; it remains `false`.
- No claim that validation or isolated fixture testing authorizes production
  execution.
