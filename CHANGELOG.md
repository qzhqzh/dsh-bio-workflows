# Changelog

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
