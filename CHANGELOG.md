# Changelog

## Unreleased

- Add a default-off, separately approved isolated fixture-test lifecycle for
  exact ready Mission revisions: `draft_test_prepare`, `start`, `get`, `cancel`,
  and `report`. The approval binds the draft/validation, declarative fixture,
  exact local images, runner and isolation identities, assertions, and hard
  resource/output budgets.
- Publish Fixture Bundle v1, Draft Test Plan v1, and Draft Test Evidence v1;
  add immutable fixture snapshotting, deterministic value/file assertions,
  owner-session fencing, restart interruption, bounded logs/artifacts, stable
  failure evidence, and replay-safe Workflow Center/tool presentations.
- Add the independent miniwdl `dsh_fixture_docker` backend with fixed Docker
  argv, no pulls, network `none`, read-only root, non-root uid/gid, dropped
  capabilities, seccomp/AppArmor/no-new-privileges, fixed scrubbed environment,
  CPU/memory/PID/time/ulimit/tmpfs/output limits, inspected container controls,
  kernel-enforced controller non-Unix-socket denial, and 17 deterministic
  controller/container egress/host-service/credential denial probes.
- Bind the hash-locked miniwdl dependency closure and controller seccomp-filter
  identity into each plan; start with Python `-B -I -S` without bytecode writes
  or startup hooks,
  reject remote/traversal/symlink imports and relative file coercions, enforce
  hard controller and bounded Docker-broker resource budgets, and prove
  exact-label Docker cleanup only after exact controller-group termination.
- Add unit, integration, adversarial, package/profile/UI checks and a real Linux
  miniwdl 1.15.0/Docker acceptance covering success, timeout, cancellation,
  overflow, controller memory exhaustion, remote-import zero-connect and local
  import-escape denial, owner isolation, real DSH/controller restart recovery,
  and residual-resource cleanup.
- Keep the published `0.11.x` Mission grant authoring-only and keep install,
  promotion, production allowlisting/execution, and
  `Software Trial Report v1.success` false.

## 0.11.0 - 2026-08-27

- Add default-off, owner-session/runtime-scoped autonomous authoring Missions.
  One DSH approval binds an exact software identity, digest-pinned container
  reference, objective, acceptance criteria, allowed draft actions, action and
  repair budgets, wall time, and immutable `planDigest`.
- Add `mission_prepare`, `mission_start`, `mission_get`, `mission_cancel`, and
  `mission_report` tools. Mission-bound draft create/update/validate calls
  reserve durable budget after DSH policy guards and do not ask per action;
  other draft mutations retain their existing one-shot approvals.
- Persist private integrity-bound Mission records, bind exactly one draft with
  revision/content-digest compare-and-swap, normalize validation diagnostics
  into stable failure fingerprints, and stop on repeated failures, aggregate
  limits, validator infrastructure failure, cancellation, wall time, or runtime
  restart. Ambiguous action outcomes explicitly forbid same-call replay.
- Publish `Mission v1`, `Failure Evidence v1`, and `Software Trial Report v1`
  schemas and add native tool-card summaries plus Workflow Center readiness.
- Keep the first slice authoring-only: model-authored WDL containers are not
  pulled or run, successful validation reports only
  `ready_for_isolated_test` and terminally revokes the Mission write grant,
  production execution/promotion remain false, and the existing built-in
  execution allowlist is unchanged. A separately proven container-and-host-
  isolated draft runner is required for the next phase.

## 0.10.0 - 2026-08-26

- Ship the Host and Web Client faces in the same `dsh-bio-workflows` npm
  package. Add a native `sidebar.footer.action` entry and `shell.overlay`
  Workflow Center with Workflows, AI Drafts, Runs, and Setup areas.
- Keep the UI behind the Harness control plane: catalog/readiness bootstrap is
  read-only, exposes only built-in summaries, requires same-origin browser
  context, sanitizes Store diagnostics, and excludes local workflows,
  owner-scoped drafts, and runs; every create, validate, graph, plan, and run-history/inspection action
  is queued into the current Agent. Without a current task, Agent actions are
  visibly unavailable and fail closed. A later run request still crosses the
  normal planning, approval, owner, and execution policies in conversation.
- Add a keyed `tool.call.toolview` renderer for
  `bio_workflows_draft_graph`, including digest/revision binding checks,
  bounded deep validation of replayed nodes/ports/edges, accessible SVG
  topology, node inspection, partial-graph diagnostics, and responsive
  desktop/mobile layouts.
- Enforce the graph contract at the public API boundary: exact draft identity,
  a 1 MiB source ceiling, schema-safe field lengths, 512 nodes, 2048 edges,
  128 diagnostics, 128 ports per node, and explicit partial-graph diagnostics
  instead of oversized or invalid payloads.
- Add TypeScript, production client bundling, browser interaction and modal
  keyboard-focus tests, visual review fixtures, source-map freshness checks,
  CI gates for typecheck and Chromium UI tests, and package/profile smoke
  assertions for the shipped `lib/client.js` artifact. Workflow Center now
  disables Plan/Run affordances for every bundle outside the exact built-in
  execution allowlist.

## 0.9.0 - 2026-08-26

- Publish `WorkflowGraph v1` and the read-only
  `bio_workflows_draft_graph` tool. Graphs are deterministically parsed from
  one exact owner-scoped WDL revision and bind `draftId`, `revision`, and
  `contentDigest` into a stable `graphDigest`.
- Extract workflow inputs/outputs, declarations, calls, scatters,
  conditionals, typed ports, data/control/containment edges, and source ranges.
  Unsupported WDL returns a bounded `complete: false` graph with explicit
  diagnostics and never guesses topology.
- Extend unit, ToolRuntime, package, profile, and model-driven Agent-loop
  coverage through graph generation without adding draft execution authority.

## 0.8.1 - 2026-08-26

- Add replay-safe `presentCall` and `presentResult` projections for every
  bio-workflow tool. Harness clients now show human-readable titles, operation
  categories, salient inputs, and concise outcome summaries while the model
  continues to receive the complete unmodified tool result.

## 0.8.0 - 2026-08-26

- Add session-scoped `bio_workflows_draft_create`, `draft_get`, `draft_update`,
  and `draft_validate` tools for AI-assisted WDL authoring without embedding a
  second model client or expanding the production execution allowlist.
- Persist complete immutable draft revisions under opaque plugin-minted IDs.
  Bind every update and its DSH approval to both the expected revision and a
  versioned, length-delimited source digest; concurrent writers compete for one
  atomic next-revision commit instead of using last-write-wins.
- Enforce safe relative paths, well-formed Unicode, 128-file / 1 MiB-per-file /
  4 MiB-total / 256-revision ceilings, one-file model reads, silent owner
  isolation, no-follow bounded file access, private-root ownership/permission
  checks, atomic per-owner capacity slots, bounded directory discovery, and
  recovery cleanup for uncommitted staging directories.
- Add non-executing WDL 1.0 validation with local-import checks, example JSON
  parsing, digest-pinned container policy, private source snapshots, and an
  exact-version, identity-rechecked `miniwdl check --no-outside-imports` argv.
  Syntax failures return revision-bound `valid: false` evidence; operational
  validator failures return `validator_unavailable`.
- Publish `WDL Draft Revision v1` and `Draft Validation Evidence v1` schemas,
  retain the legacy immutable `bio_workflows_scaffold`, and defer graph UI,
  draft tests, promotion, and any custom-draft execution authority.
- Extend the real DSH Agent-loop smoke through draft create/get/update/validate,
  two mutation approvals, exact revision/digest evidence, and the existing
  search/plan/run plus owner-disposal lifecycle.

## 0.7.0 - 2026-08-26

- Add additive `BioWorkflowResult v1` objects to new successful runs while
  retaining the existing miniwdl outputs and inventory and keeping historical
  records without `result` readable.
- Group artifacts deterministically by manifest output and array ordinal, then
  calculate SHA-256 through confined canonical file descriptors. Enforce 1024
  artifacts, 16 GiB per-file and 64 GiB aggregate limits, no-follow target
  opens, stable miniwdl-output symlink identity, cancellable chunked hashing,
  repeated-file rejection, and before/after metadata checks.
- Add the immutable, executable `fastq-qc@1.2.0` bundle with declared extracted
  FastQC summary files. Parse bounded UTF-8 module states into namespaced PASS,
  WARN, and FAIL reports without extracting ZIP archives on the host.
- Publish the result JSON Schema and explicit limits, add fail-closed tests for
  escaped, oversized, aggregate-over-budget, malformed, and invalid
  UTF-8 outputs, enforce 8 MiB / 16384-line aggregate FastQC parser limits, add
  cross-field semantic validation, and retain source-hash-bound real
  miniwdl/Docker/DSH evidence.

## 0.6.0 - 2026-08-26

- Add bounded, newest-first `bio_workflows_run_list` discovery with fixed
  cursor pagination, exact status filters, and silent owner isolation.
- Reconcile persisted `prepared`, `running`, and `stopping` records after a
  runtime restart. An exact owner/job/kind/label match preserves the live run;
  a definitive missing match is atomically recorded as `interrupted` without
  retrying the workflow or signaling a stale PID. Unavailable job discovery
  leaves provenance unchanged.
- Bound run discovery by directory entries, record count, aggregate bytes, and
  diagnostics while rejecting symlinked, escaped, malformed, and oversized
  records.

## 0.5.0 - 2026-08-26

- Add default-off trusted execution planning for the built-in
  `fastq-qc@1.1.0` bundle, including canonical input-root checks, filesystem
  identity facts, anchored absolute executables, active Docker Swarm-manager
  probes, and deterministic plan digests. Preserve `fastq-qc@1.0.0` as the
  original non-executable draft.
- Add an approval-bound miniwdl adapter over the optional DSH subprocess and
  jobs services. Execution uses fixed argv, stages the validated WDL snapshot,
  snapshots approved inputs through no-follow file handles, inherits no ambient
  child environment, fixes and binds the local Docker host and Engine ID,
  disables automatic Swarm initialization, replans after approval, and returns
  both run and background-job ids.
- Add owner-scoped durable `run.json` provenance, bounded runner output,
  process-tree cancellation through shared DSH job controls, terminal exit
  facts, input snapshot hashes, and confined output inventory. Reject unowned
  execution and guarantee that a registered background job id is returned even
  if a later provenance update fails. Remove fresh run artifacts when launch
  fails or is cancelled before background-job registration, including
  synchronous job admission rejection.
- Bound input copying to the exact approved file lengths and 1 TiB total per
  run, reject concurrent growth, require a 512 MiB free-space reserve, surface
  total bytes in approval, and align durable provenance reads/writes at 32 MiB
  independently of input mounts. Enforce WDL memory declarations as hard
  container limits; the preview supports the Linux default Docker socket.
- Verify actual Linux procfs descriptor paths for inputs and executables,
  protect runner/runs-root ancestor chains against entry replacement, and
  recheck both run directories immediately before background-job admission.
- Add GitHub Actions gates for Node.js 22/24 tests, coverage thresholds,
  package/profile/Agent-loop smokes, and pinned miniwdl 1.15.0 checks for all
  versioned built-in bundles.
- Add a source-hash-bound DSH 0.1.1-rc.2 Agent-loop acceptance in which a
  deterministic model drives `search -> plan -> run`, the real approval service
  records an `allowed-once` audit pair, and owner disposal removes the Agent,
  Session, and Job while terminating the runner process tree and persisting a
  killed terminal run.
- Add `fastq-qc@1.1.0` as a hardened, verified bundle and retain a
  source-hash-bound miniwdl 1.15.0 / Docker 29.3.1 / FastQC success plus real
  LocalJobRegistry cancellation acceptance record.
- Keep declaration-only preflight semantics unchanged and keep `bam-qc`, local
  installs, and custom drafts outside the executable allowlist.

## 0.4.0 - 2026-08-23

- Add a versioned WDL bundle descriptor, JSON Schema, bounded structural
  validator, local-import closure checks, and per-file SHA-256 verification.
- Add the non-executable Workflow Store with built-in search, opt-in immutable
  local installs, and conflict-safe custom WDL scaffolding.
- Add `fastq-qc` and `bam-qc` WDL 1.0 starter bundles as structurally checked,
  `miniwdl v1.15.0 check`-validated drafts with example inputs and explicit execution
  limitations. Pin both starter container images by registry digest.
- Add search, validation, install, and scaffold DSH tools. Mutations are denied
  by default and require both store configuration and a DSH approval decision;
  install approval is bound to an exact version and bundle digest.
- Keep Manifest v1 compatible and keep workflow execution disabled.

## 0.3.1 - 2026-08-23

- Remove the runtime import of `@deepseek-ai/dsh-tools` so an isolated DSH
  profile can load the plugin without copying the host's peer dependency graph.
- Compile equivalent registry-ready JSON Schema tool definitions locally while
  preserving fail-closed argument validation and structured `INVALID_ARGS`
  results through the DSH execution hook.
- Extend the DSH profile smoke test to import and apply the installed plugin,
  verify all four tool contracts, and boot the real headless help path.

## 0.3.0 - 2026-08-23

- Add deterministic workflow input validation for required values, types, and cardinality.
- Add strict configured environment declarations for engine availability and exact versions.
- Add the read-only `bio_workflows_preflight` tool and public preflight API.
- Keep filesystem inspection, engine probing, and workflow execution explicitly disabled.

## 0.2.0 - 2026-08-23

- Add the metadata-only workflow manifest v1 JSON Schema and runtime validator.
- Add a strict, deterministic in-memory workflow catalog.
- Add read-only `bio_workflows_list` and `bio_workflows_get` tools.
- Allow manifests to be supplied through the bundle row configuration.

## 0.1.0 - 2026-08-23

- Add the DeepSeek Harness bundle manifest.
- Add the read-only `bio_workflows_info` foundation tool.
- Add zero-dependency package tests and an npm package allowlist.
