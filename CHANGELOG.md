# Changelog

## 0.3.1 - 2026-08-23

- Remove the runtime import of `@deepseek-ai/dsh-tools` so an isolated DSH
  profile can load the plugin without copying the host's peer dependency graph.
- Compile equivalent registry-ready JSON Schema tool definitions locally while
  preserving fail-closed argument validation.
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
