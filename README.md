# dsh-bio-workflows

Bioinformatics workflow orchestration foundation for
[DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

`workflows` is intentionally plural: this package is intended to provide one
DSH integration surface for multiple workflow definitions and engines.

> `0.3.0` is a read-only catalog and declarative preflight release. It validates
> configured workflow metadata, supplied input values, and a configured engine
> snapshot, but it does not inspect files, probe engines, or execute workflows.

## Install

Requirements:

- Node.js `^22.19.0` or `>=24.0.0`
- A DeepSeek Harness build compatible with `@deepseek-ai/dsh-tools@^0.1.1-rc.2`

Add the bundle to a DSH profile:

```bash
dsh plugin --profile web add dsh-bio-workflows
```

The bundle registers four tools:

- `bio_workflows_info`: reports the installed package version and current
  capability flags without reading files, accessing the network, or starting
  processes.
- `bio_workflows_list`: lists manifest summaries, with optional exact filters
  for engine, status, and tag.
- `bio_workflows_get`: returns one complete manifest by workflow id.
- `bio_workflows_preflight`: validates supplied input values and compares the
  manifest engine requirement with the configured environment declaration.

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
[JSON Schema](https://unpkg.com/dsh-bio-workflows@0.3.0/schema/workflow-manifest.schema.json).
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
```

The manifest is deliberately metadata-only. It has no command, script, or
entrypoint field, so catalog registration cannot grant execution authority.

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

Minor releases add independently reviewable layers:

1. Workflow catalog and metadata schema — available in `0.2.0`
2. Input and declared-environment preflight — available in `0.3.0`
3. Opt-in adapters for established workflow engines
4. Run status, provenance, and report normalization

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

`0.3.0` 在只读目录上增加输入与声明式环境预检。它会检查输入类型、必填项、
集合基数和配置中声明的引擎版本，但不会检查文件是否存在、探测本机引擎或
执行 Nextflow、WDL、Snakemake。即使预检通过，`executionReady` 仍固定为
`false`，直到后续显式实现安全探测和执行授权链路。

## License

[MIT](./LICENSE)
