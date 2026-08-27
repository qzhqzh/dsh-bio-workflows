# Isolated fixture runner

Status: released in `0.12.0` for
[issue #18](https://github.com/qzhqzh/dsh-bio-workflows/issues/18) and disabled
by default. The Mission contract remains authoring-only.

## Authority boundary

The fixture runner is a new, separately approved transition after a Mission has
already reached `ready_for_isolated_test`. It does not extend the Mission grant.
It cannot call `bio_workflows_run`, install or promote a draft, mutate the
production allowlist, or authorize production execution.

The lifecycle has five owner-session tools:

1. `bio_workflows_draft_test_prepare` recomputes one exact plan without running
   a task.
2. `bio_workflows_draft_test_start` requires the returned `planDigest` and a new
   Harness approval.
3. `bio_workflows_draft_test_get` reads bounded retained state and evidence.
4. `bio_workflows_draft_test_cancel` stops an active test without retry.
5. `bio_workflows_draft_test_report` returns a bounded test report with all
   production and promotion capabilities fixed to `false`.

The approval binds the ready Mission, draft id, revision, content digest,
validation digest, exact fixture digest, exact locally present container image,
runner identity, isolation-policy digest, assertions, and every resource/output
budget. `start` rebuilds the plan before launch; drift fails closed.

## Dedicated backend

Draft tests use `runner/dsh_fixture_runner.py`, a miniwdl `TaskContainer`
backend named `dsh_fixture_docker`. It is independent from the production
Docker Swarm adapter and its built-in workflow allowlist.

The controller accepts only fixed plugin-generated argv and configuration. A
WDL task may select only the single digest-pinned image already bound to the
approved Mission. The backend uses `docker container create --pull never`; it
never pulls an image, accepts a registry fallback, or passes model-selected
Docker flags, host paths, environment names, networks, retries, or assertion
programs.

The configured Python and Docker launch/target paths must be owned by root or
the DSH user, executable where applicable, protected from group/world writes,
and beneath replacement-protected ancestors. The packaged Python backend source
is SHA-256-checked during both plan builds, then copied byte-for-byte into the
new private test directory before Python executes it; the mutable checkout or
installation path is never the task-time script path.

The plan also binds the complete installed miniwdl dependency closure: package
names, versions, bounded file counts/bytes, per-distribution digests, and one
aggregate environment digest. CI creates that environment from
`requirements/miniwdl-1.15.0.txt` with `pip --require-hashes`. Runtime drift in
the wrapper or any dependency fails before WDL loading. The controller starts
with Python `-B -I -S`, disables bytecode writes, discovers only the exact interpreter environment, hashes
the dependency closure before adding its site-packages directory, and never
executes `.pth`, `sitecustomize`, or `usercustomize` startup code.

Before user WDL is loaded, the controller installs a kernel seccomp filter with
`no_new_privs` and `SECCOMP_FILTER_FLAG_TSYNC`, so the policy applies to every
controller thread. The architecture-specific filter permits creation of
`AF_UNIX` sockets needed by the fixed Docker CLI and returns `EPERM` for every
other socket domain. Its exact policy, architecture, syscall identity, and
filter digest are part of `planDigest`. Python socket/name-resolution guards
and a no-follow, regular-file-only, bounded local import reader add
defense-in-depth; URI schemes, absolute nested imports, traversal outside the
immutable WDL snapshot, symlinks, special files, changing files, and oversized
sources are rejected before their contents are accepted.

Each container is inspected before start. The accepted task configuration is:

- network mode `none`, read-only root filesystem, private PID/cgroup namespace,
  IPC `none`, no devices or supplementary groups;
- all Linux capabilities dropped, `no-new-privileges`, Docker builtin seccomp,
  and the `docker-default` AppArmor profile;
- non-root controller uid/gid, exact CPU/memory/swap/PID limits, `nofile` and
  `fsize` ulimits, log driver `none`, and a size-limited `/tmp` tmpfs;
- one size-limited local-driver tmpfs volume for task work/output;
- only the runner-created command and immutable fixture snapshots mounted
  read-only beneath the task root, with recursive bind mounting disabled;
- all image environment values first cleared, followed by fixed safe values for
  `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, and `PATH`.

The controller hashes the inspected daemon facts, public redacted controls,
output-storage configuration, output manifest, and each evidence event. The
Node manager independently checks the redacted controls against the approved
plan. No host mount source or retained absolute host path is returned to the
Agent.

Controller work is separately bounded by a plan-sized hard virtual-address-space
limit plus an RSS watchdog, CPU time, additional process/thread count,
open-file, file-size, and wall-time limits. A pre-limit Docker broker keeps the
fixed CLI usable under its own hard 4 GiB address-space and 128-additional-task
limits, applies the same thread-synchronized network seccomp policy, and accepts
only bounded exact-executable RPCs. Every created container and volume carries
exact owner, test, plan, and random-token labels. Normal exit, cancellation,
failure, and startup recovery remove only resources matching the approved
labels and require an absence probe. Recovery first matches a persisted
PID/start-time/process-group/session/uid/boot/executable/argv identity, then
terminates and proves absence of that exact controller process group before
Docker cleanup; ambiguity fails closed.

## Deterministic denial evidence

Every miniwdl process that reaches task execution performs one isolated
support-container probe before any WDL task. The evidence must contain exactly
15 successful container facts:

- fixture read and SHA-256 positive controls;
- bounded tmpfs write and loopback positive controls;
- only the loopback interface;
- public egress, Docker bridge gateway, and a live controller loopback service
  are unreachable;
- the root filesystem is read-only;
- effective capabilities are zero and `NoNewPrivs` is set;
- the Docker socket, common credential paths, and non-empty credential-like
  environment values are absent.

The controller contributes two additional required probes: kernel-enforced
non-Unix socket denial and name-resolution denial. It also verifies that the
positive host canary was reachable from the host exactly once. The combined
evidence therefore contains exactly 17 probes. Missing, duplicated, changed,
failed, or truncated evidence makes the trial fail.

## Fixture and evidence contracts

Fixture Bundle v1 is declarative. A fixture contains bounded files with exact
sizes and SHA-256 values, WDL input values whose file leaves are explicit
`{"$fixture":"path"}` references, and only `value_equals` or `file_digest`
assertions. Symlinks, path traversal, remote URL-like file inputs, executable
assertion hooks, duplicate fixture identities, and byte/digest drift are
rejected. miniwdl's file-I/O root is the private fixture snapshot; only
canonical paths beneath its immutable `data/` directory may become task input
binds, so plain relative `File`/`Directory` coercions cannot reach the WDL or
controller directories.

Before launch, fixture bytes and the exact immutable WDL revision are copied
into a new private owner/test directory. Output is scanned inside the trusted
support container and then copied out. A second host scan must match the first
manifest exactly. Symlinks, special files, path escapes, unexpected underlying
input bytes, and count or byte overflow fail closed.

Published contracts:

- [`Fixture Bundle v1`](../schema/fixture-bundle.schema.json)
- [`Draft Test Plan v1`](../schema/draft-test-plan.schema.json)
- [`Draft Test Evidence v1`](../schema/draft-test-evidence.schema.json)

Evidence includes exact identities, resource controls, isolation probes,
bounded sanitized stdout/stderr, artifact hashes, assertion results,
timeout/cancellation/ambiguity facts, stable failure evidence, and an aggregate
`evidenceDigest`. It excludes credentials and host-sensitive paths.

## Configuration

Prerequisites are Linux, a non-root DSH controller, Docker with cgroup v2,
builtin seccomp and AppArmor, miniwdl exactly `1.15.0`, and both exact images
already present in the local Docker store. Enabling this feature grants the DSH
controller access to the local Docker daemon; that daemon and the configured
runner files remain trusted operator infrastructure.

Use dedicated existing directories. `runsRoot` must be private and must not
overlap a fixture root or the authoring Store. Executable and directory ancestor
ownership/permissions are checked before use.

```yaml
- id: bio-workflows
  config:
    draftTesting:
      enabled: true
      runsRoot: /srv/dsh-bio/draft-tests
      fixtureRoots:
        - /srv/dsh-bio/fixtures
      runner:
        pythonExecutable: /opt/miniwdl-1.15/bin/python
        dockerExecutable: /usr/bin/docker
        expectedMiniwdlVersion: 1.15.0
        supportImage: python@sha256:540c7d91f98ff6880174c40e99067bf5941eb54d818a7a5e094d188b196a934d
      budgets:
        cpu: 1
        memoryBytes: 536870912
        pids: 64
        wallTimeMs: 300000
        taskTimeMs: 120000
        logBytes: 1048576
        artifactCount: 128
        artifactBytes: 16777216
        totalOutputBytes: 67108864
        fixtureBytes: 67108864
        taskCount: 16
```

Configured budgets are maxima. A tool request may lower them but cannot raise
them. At minimum, `artifactBytes <= totalOutputBytes` and
`taskTimeMs <= wallTimeMs` must remain true.

Workflow Center reports `Configured`, exact-plan `Verified`, and `Ready`
separately. Global configuration never claims readiness: `prepare` performs the
live identity/isolation preflight for one exact Mission plan, and only that
result may say `readyToStart`.

The package ships `text-roundtrip@1.0.0` as a deterministic acceptance fixture.
An operator may point one fixture root at a copied or installation-resolved
`fixtures/` directory; tools never accept a fixture root or host file path.

## Real acceptance

The acceptance command uses the real DSH Agent/session/subprocess/jobs services,
Mission and draft stores, miniwdl 1.15.0, Docker daemon, dedicated backend, and
immutable fixture. It covers success, task timeout, cancellation, output/log
overflow, controller expression-memory exhaustion, remote-import zero-connect
proof, traversal and symlink import denial before container creation, relative
`File` coercion denial, cross-owner denial, and false production/promotion
capabilities. Its restart case launches a live long-running controller and
Docker resources in a separate DSH process, kills that DSH process, and requires
a fresh manager startup scan to terminate the exact orphan controller before
restoring the Docker inventory. The emitted record includes source SHA-256
values for the runner, manager, contracts, schemas, fixture, acceptance scripts,
and hash-locked Python environment.

```bash
DSH_BIO_FIXTURE_PYTHON=/absolute/miniwdl-venv/bin/python \
DSH_BIO_DOCKER_EXECUTABLE=/usr/bin/docker \
DSH_BIO_FIXTURE_SUPPORT_IMAGE='python@sha256:540c7d91f98ff6880174c40e99067bf5941eb54d818a7a5e094d188b196a934d' \
DSH_BIO_FIXTURE_TASK_IMAGE='python@sha256:fde50be32b99989c47c97e62a30b972bf805baca108f81c9be36c3c57945cae1' \
DSH_BIO_DRAFT_TEST_ROOT=/absolute/private/acceptance-root \
npm run accept:draft-fixture-runner
```

The latest local acceptance is retained as a
[source-bound evidence record](./evidence/dsh-bio-workflows-0.12.0-fixture-runner.json).

CI preloads both exact images outside the runner and executes this suite on a
fresh Linux host. Any residual `dshbio-*` container or volume fails acceptance.

## Non-goals

A passing fixture test is evidence only for the exact approved revision,
fixture, container, runner, policy, assertions, and budgets. It is not an
independent review, immutable promotion, production trust admission, or general
workflow execution result. `Software Trial Report v1.success` remains fixed to
`false`; changing it requires a separate reviewed contract and release.
