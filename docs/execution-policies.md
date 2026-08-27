# Production execution policies

These controls apply only to the existing trusted built-in execution allowlist.
They do not authorize a Mission draft, fixture-tested draft, installed bundle,
Git snapshot, or TRS snapshot for production execution.

## Configuration

`execution.policy` is optional. Its defaults preserve the earlier execution
behavior: metadata-bound inputs, advisory network isolation, package-maximum
budgets, and disabled retention cleanup.

```yaml
execution:
  enabled: true
  runsRoot: /srv/dsh-bio/runs
  inputRoots: [/srv/dsh-bio/inputs]
  runner:
    executable: /usr/local/bin/miniwdl
    dockerExecutable: /usr/bin/docker
  policy:
    inputChecksum: sha256
    networkIsolation:
      mode: ephemeral_internal
    budgets:
      maxInputSnapshotBytes: 1099511627776
      maxRunStorageBytes: 2199023255552
      maxResultArtifactBytes: 17179869184
      maxTotalResultArtifactBytes: 68719476736
      maxJobOutputBytes: 262144
      maxSpillBytes: 16777216
    retention:
      enabled: true
      minimumAgeDays: 30
      retainLatest: 100
      maxDeletesPerCall: 50
```

Configuration is strict: unknown keys, unsafe integers, expanded package
maxima, and inconsistent byte limits fail plugin startup.

## Pre-approval input integrity

With `inputChecksum: sha256`, planning opens every regular input with no-follow
semantics, streams its exact bytes, rechecks descriptor identity and metadata,
and places `contentSha256` in the plan. After approval, snapshotting computes
the digest again and fails with `input_content_changed_after_plan` on a
mismatch. The default `metadata` mode retains the earlier filesystem-identity
binding and advertises `input_content_not_hashed` in the plan.

## Ephemeral internal network

`ephemeral_internal` creates a unique labeled Docker Swarm overlay after the
exact execution plan is approved. Admission requires Docker to report an
`overlay`, `swarm`, internal, non-attachable, non-ingress network with no
services. The generated miniwdl configuration permits only that network and
injects it as the task runtime default. The exact network identity is recorded
in `run.json` and removed after miniwdl exits.

This is a deployable egress control for digest-pinned built-in workflows. It is
not accepted as isolation evidence for untrusted AI-authored WDL: the fixture
runner keeps its separate `--network none`, seccomp, controller, canary, egress,
Docker-gateway, and live host-service probes.

## Budgets

The approved plan binds all configured limits. Input copying, per-artifact and
aggregate result hashing, DSH output capture, and per-stream spill fail closed
at those values. Total run storage is measured from allocated filesystem blocks
every second and once after process exit; overflow terminates the runner and
records `run_storage_budget_exceeded`.

The storage monitor is not a kernel filesystem quota and a short-lived burst
can exceed the threshold between scans. This limitation is explicit in every
plan. Operators needing a hard instantaneous ceiling must also place
`runsRoot` on an independently enforced quota filesystem.

## Retention cleanup

Retention never deletes automatically. Use this sequence as the same owner
session that owns the runs:

1. Call `bio_workflows_run_cleanup_plan`.
2. Review its exact terminal candidates and `cleanupPlanDigest`.
3. Call `bio_workflows_run_cleanup` with that digest.
4. Approve the separate DSH deletion request.

Planning protects the newest `retainLatest` terminal runs, requires all
candidates to be at least `minimumAgeDays` old, and caps one action at
`maxDeletesPerCall`. Execution replans and then rechecks owner, terminal state,
provenance digest, directory identity, and runs-root identity before deletion.
Unreadable or incomplete discovery fails closed.

