# Changelog

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
