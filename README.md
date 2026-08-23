# dsh-bio-workflows

Bioinformatics workflow orchestration foundation for
[DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

`workflows` is intentionally plural: this package is intended to provide one
DSH integration surface for multiple workflow definitions and engines.

> `0.2.0` is a read-only catalog release. It validates configured workflow
> metadata and exposes discovery tools, but it does not resolve files or execute
> bioinformatics workflows.

## Install

Requirements:

- Node.js `^22.19.0` or `>=24.0.0`
- A DeepSeek Harness build compatible with `@deepseek-ai/dsh-tools@^0.1.1-rc.2`

Add the bundle to a DSH profile:

```bash
dsh plugin --profile web add dsh-bio-workflows
```

The bundle registers three tools:

- `bio_workflows_info`: reports the installed package version and current
  capability flags without reading files, accessing the network, or starting
  processes.
- `bio_workflows_list`: lists manifest summaries, with optional exact filters
  for engine, status, and tag.
- `bio_workflows_get`: returns one complete manifest by workflow id.

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
```

Workflow ids are unique within one catalog. Invalid manifests and duplicate ids
fail at plugin startup instead of producing a partially valid catalog.

The versioned contract is published as
[JSON Schema](https://unpkg.com/dsh-bio-workflows@0.2.0/schema/workflow-manifest.schema.json).
The zero-dependency runtime API is also available through package subpaths:

```js
import { createWorkflowCatalog } from 'dsh-bio-workflows/catalog'
import {
  parseWorkflowManifest,
  validateWorkflowManifest,
} from 'dsh-bio-workflows/manifest'
```

The manifest is deliberately metadata-only. It has no command, script, or
entrypoint field, so catalog registration cannot grant execution authority.

## Roadmap

Minor releases add independently reviewable layers:

1. Workflow catalog and metadata schema — available in `0.2.0`
2. Input and environment preflight validation — next
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

## 中文说明

`0.2.0` 提供严格校验的 workflow manifest v1、只读内存目录和查询工具。
manifest 只包含元数据，不包含命令或入口点；本版本仍不会读取工作流文件、
访问网络或执行 Nextflow、WDL、Snakemake。下一层再增加输入与环境预检。

## License

[MIT](./LICENSE)
