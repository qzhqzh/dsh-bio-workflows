# dsh-bio-workflows

Bioinformatics workflow catalog, WDL asset store, and preflight foundation for
[DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

`workflows` is intentionally plural: this package is intended to provide one
DSH integration surface for multiple workflow definitions and engines.

> `0.4.x` adds a non-executable Workflow Store and versioned WDL bundles. It can
> search, structurally validate, install, and scaffold workflow assets, but it
> does not probe engines or execute workflows.

## Install

Requirements:

- Node.js `^22.19.0` or `>=24.0.0`
- A DeepSeek Harness build compatible with `@deepseek-ai/dsh-tools@^0.1.1-rc.2`

Add the bundle to a DSH profile:

```bash
dsh plugin --profile web add dsh-bio-workflows
```

The bundle registers eight tools:

- `bio_workflows_info`: reports the installed package version and current
  capability flags without reading files, accessing the network, or starting
  processes.
- `bio_workflows_list`: lists manifest summaries, with optional exact filters
  for engine, status, and tag.
- `bio_workflows_get`: returns one complete manifest by workflow id.
- `bio_workflows_preflight`: validates supplied input values and compares the
  manifest engine requirement with the configured environment declaration.
- `bio_workflows_search`: searches built-in and configured local WDL bundles.
- `bio_workflows_validate`: verifies descriptor shape, file digests, local WDL
  imports, version declarations, and example JSON without running an engine.
- `bio_workflows_install`: installs an exact bundle `version + digest` into an
  explicitly configured local store after DSH approval.
- `bio_workflows_scaffold`: creates a minimal local WDL draft after DSH approval.

## Configure the catalog

The default catalog is empty. Override the `bio-workflows` row in a profile or
home-level `cordis.patch.yml` to add manifests:

```yaml
- id: bio-workflows
  config:
    manifests:
      - schemaVersion: "1"
        id: fastq-qc
        version: 1.0.0
        name: FASTQ quality control
        summary: Collect quality metrics for paired-end FASTQ files.
        status: ready
        engine:
          name: nextflow
          version: "24.04"
        inputs:
          - id: reads
            type: file
            required: true
            cardinality: many
        outputs:
          - id: report
            type: directory
        tags:
          - fastq
          - qc
    environment:
      engines:
        nextflow:
          available: true
          version: "24.04"
```

Workflow ids are unique within one catalog. Invalid manifests and duplicate ids
fail at plugin startup instead of producing a partially valid catalog.

The versioned contract is published as
[JSON Schema](https://unpkg.com/dsh-bio-workflows@0.4.0/schema/workflow-manifest.schema.json).
The zero-dependency runtime API is also available through package subpaths:

```js
import { createWorkflowCatalog } from 'dsh-bio-workflows/catalog'
import {
  parseWorkflowManifest,
  validateWorkflowManifest,
} from 'dsh-bio-workflows/manifest'
import {
  parsePreflightEnvironment,
  preflightWorkflow,
} from 'dsh-bio-workflows/preflight'
import { createWorkflowStore } from 'dsh-bio-workflows/store'
import {
  loadWdlBundle,
  validateWdlBundleDirectory,
} from 'dsh-bio-workflows/wdl-bundle'
```

The manifest is deliberately metadata-only. It has no command, script, or
entrypoint field, so catalog registration cannot grant execution authority.

## Workflow Store and WDL bundles

Two structurally checked starter bundles ship with the package:

- `fastq-qc@1.0.0`: FastQC scatter over one or more FASTQ files;
- `bam-qc@1.0.0`: `samtools flagstat` and `samtools stats` for one BAM file.

Both starters use WDL 1.0, pass `miniwdl v1.15.0 check`, and declare miniwdl plus
Cromwell compatibility. They remain `draft` assets until an actual engine run
promotes them. Validation therefore reports `executionReady: false`, missing
execution evidence, and other remaining limitations instead of claiming
production readiness. Both starter container images are fixed by registry
digest.

Search results label built-in entries as `trust: builtin` and writable local
entries as `trust: local`; publisher-declared verification metadata never
silently turns a local draft into a trusted built-in asset.

A bundle is a versioned directory containing `workflow.json`, a local
`main.wdl`, example inputs, documentation, and per-file SHA-256 digests. Remote
imports, path traversal, symlinked bundle files, undeclared files, and digest
mismatches fail closed. File, bundle, discovery, aggregate-byte, and diagnostic
limits keep malformed local stores from producing unbounded reads or output.
The descriptor contract is published as
[JSON Schema](https://unpkg.com/dsh-bio-workflows@0.4.0/schema/wdl-bundle.schema.json).

The built-in store is searchable without configuration. Local writes are off
by default. To enable install and scaffold operations, configure an absolute,
dedicated root:

```yaml
- id: bio-workflows
  config:
    store:
      root: /absolute/path/to/dsh-workflow-store
      writeEnabled: true
```

The write tools cannot choose an arbitrary destination: installed bundles go
under `installed/<id>/<version>` and drafts under `drafts/<id>/<version>`.
Existing versions are never overwritten. Even with writes enabled, DSH receives
an `ask` decision bound to the target version and bundle digest before either
mutation. `bio_workflows_install` therefore requires the exact `version` and
`expectedDigest` returned by search; if the source changes before the write, the
operation is rejected. Installing an asset never authorizes its execution.

The same invariant applies through the public store API:

```js
const store = createWorkflowStore({ root: '/absolute/store', writeEnabled: true })
const [workflow] = (await store.search({ query: 'fastq', source: 'builtin' })).workflows
await store.install({
  id: workflow.id,
  version: workflow.version,
  expectedDigest: workflow.digest,
})
```

## Preflight boundary

Preflight checks only declarations supplied to this package:

- required, unknown, scalar, and cardinality constraints for workflow inputs;
- whether the manifest engine is declared available;
- exact engine version equality when the manifest specifies a version.

It deliberately does not check whether a file exists or is readable, invoke an
engine version command, or submit a workflow. Every preflight result therefore
contains `executionReady: false` plus machine-readable limitation codes. A
`pass` means the supplied declarations are internally consistent, not that the
host is ready to execute the workflow.

## Roadmap

Releases add independently reviewable layers:

1. Workflow catalog and metadata schema — available in `0.2.0`
2. Input and declared-environment preflight — available in `0.3.0`
3. WDL bundles, local Workflow Store, and starter assets — available in `0.4.0`
4. Opt-in miniwdl execution adapter and run lifecycle
5. Cromwell/WES adapters, provenance, and report normalization

Execution support will remain explicit and auditable. It is not enabled by the
foundation package.

## Development

```bash
npm test
npm run pack:check
```

The package ships plain ESM and has no build or install lifecycle scripts.
See [Design and implementation status](./docs/design-and-status.md) for the
architecture boundary, completion assessment, and next milestones.

## 中文说明

`0.4.x` 增加 WDL Bundle 和本地 Workflow Store，可以搜索、校验、安装内置
工作流，也能生成自定义 WDL 草稿。写入默认关闭，开启后也必须经过 DSH 审批，
安装审批绑定搜索结果中的精确版本与 SHA-256 摘要，并且只能写入配置好的 Store
根目录。当前结构校验不会调用 miniwdl/Cromwell，
也不会执行 Nextflow、WDL 或 Snakemake；`executionReady` 仍固定为 `false`。

## License

[MIT](./LICENSE)
