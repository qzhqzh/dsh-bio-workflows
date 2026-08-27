# Autonomous software trial Missions

## 0.11.0 decision

The first autonomous slice is a bounded **WDL authoring Mission**, not an
arbitrary software runner. DeepSeek Harness remains the model, conversation,
approval, and tool scheduler. `dsh-bio-workflows` supplies deterministic state,
budgets, owner fencing, revision compare-and-swap, validation evidence, circuit
breaking, and a truthful final report.

A Mission may:

- create one owner-scoped WDL draft;
- update only that draft from its exact revision and content digest;
- validate one exact immutable revision;
- inspect normalized diagnostics and author a different next revision;
- stop and summarize when a configured threshold is reached.

A Mission may not pull or run the declared container, execute WDL tasks,
install/promote the draft, change the production execution allowlist, or call
`bio_workflows_run` under its grant.

## Control flow

```text
chat intent
  -> mission_prepare (no mutation)
  -> planDigest + bounded policy
  -> mission_start (one Harness approval)
  -> draft_create(missionId)
  -> draft_get
  -> draft_update(missionId, exact revision + digest)
  -> draft_validate(missionId, exact revision)
       | valid=false -> normalized fingerprint -> repair or stop
       | valid=true  -> terminal ready + grant revoked
  -> mission_report
```

Every Mission action is reserved durably after the ordinary DSH pre-execute and
guard stages, but before the draft operation. A returned outcome completes that
reservation. If the outcome is ambiguous, the tool says
`sameCallRetryAllowed: false`; a runtime restart interrupts active Missions and
never reconstructs an in-memory grant or retries an action.

## Authorization and budgets

`mission_prepare` binds these facts into `planDigest`:

- exact software name and version;
- exact `repository/image@sha256:<digest>` identity;
- objective and acceptance criteria;
- allowed actions: `draft_create`, `draft_update`, `draft_validate`;
- maximum actions, creates, updates, validation failures, occurrences of the
  same failure fingerprint, and wall time;
- explicit false capabilities for isolated draft testing, production
  execution, and promotion.

Entering `validated` additionally requires deterministic evidence that every
top-level WDL task has exactly one static digest-pinned container declaration
and that the normalized container set is exactly the single image approved in
the Mission. A missing declaration, extra image, or different digest becomes a
stable `mission_container_identity_mismatch` repair failure.

`mission_start` recomputes the plan and refuses a stale or altered digest. Its
approval creates a grant only for `exec.agent.session.id` in the current plugin
runtime. Owner identity is never accepted as a tool argument. Another session
gets `mission_not_found` for reads or `mission_grant_inactive` for actions.

Defaults are 32 total actions, one create, eight updates, eight validation
failures, three repeats of one fingerprint, and 45 minutes. Operators may
configure lower or bounded higher maxima; each Mission request may only lower
the configured limits.

## Diagnosis and circuit breaking

Validation diagnostics are normalized to bounded `{path, code, severity}`
facts and sorted before hashing. `failureFingerprint` intentionally excludes
free-form messages and the draft revision, so the same semantic problem remains
stable across retries. `evidenceDigest` additionally binds the exact draft and
normalized evidence.

The Mission stops fail-closed when:

- one fingerprint reaches `maxSameFailureFingerprint`;
- aggregate validation failures reach `maxValidationFailures`;
- total actions or wall time are exhausted;
- miniwdl validation infrastructure is unavailable or changes identity;
- the user cancels;
- the owning runtime disappears or restarts.

Stopping preserves evidence. It does not delete drafts and does not grant a
retry, test, promotion, or production-run capability.

Successful validation is terminal too: the Mission enters `ready`, revokes its
write grant, and reports only `ready_for_isolated_test`.

## Why container testing is off in 0.11.x

The existing production adapter is intentionally allowlist-only. miniwdl's
Docker network setting attaches task containers to a selected Docker network,
but this alone is not evidence of complete isolation. Docker documents that an
`--internal` network blocks external access while the host can still communicate
with container addresses and the network gateway remains available. Therefore
`0.11.0` does not treat an internal bridge as both egress and host-service
isolation, and model-authored WDL never enters the existing runner.

The post-`0.11.0` development slice now implements that separate boundary as a
default-off miniwdl `dsh_fixture_docker` backend. It uses deterministic
fixtures, read-only snapshots, a scrubbed fixed environment, hard resource and
output limits, network `none`, container-configuration inspection, and
positive/negative egress and host-service probes. It requires a new approval
bound to a Draft Test Plan digest and does not inherit the Mission grant or
reuse the production adapter. See [Isolated fixture runner](./isolated-fixture-runner.md).

This implementation status does not retroactively change the published
`0.11.x` contract. A separate release and acceptance review are required before
operators should enable it.

## Public contracts

- [`Mission v1`](../schema/mission.schema.json)
- [`Failure Evidence v1`](../schema/failure-evidence.schema.json)
- [`Software Trial Report v1`](../schema/software-trial-report.schema.json)
- [`Fixture Bundle v1`](../schema/fixture-bundle.schema.json)
- [`Draft Test Plan v1`](../schema/draft-test-plan.schema.json)
- [`Draft Test Evidence v1`](../schema/draft-test-evidence.schema.json)

`Software Trial Report v1.success` is fixed to `false` in this release. A valid
WDL draft produces `ready_for_isolated_test`; this is not evidence that the
software ran or that any acceptance criterion passed.
