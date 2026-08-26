# dsh-bio-workflows

Bioinformatics workflow catalog, WDL asset store, and preflight foundation for
[DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

`workflows` is intentionally plural: this package provides one DSH integration
surface for multiple workflow definitions, while execution adapters are added
one engine and one verified workflow at a time.

> `0.6.0` adds bounded, owner-scoped durable run history and fail-closed restart
> reconciliation to the opt-in miniwdl execution MVP for built-in
> `fastq-qc@1.1.0`. Execution remains disabled by default and requires real
> input checks, live miniwdl/Docker probes, an exact plan digest, DSH user
> approval, background-job controls, and durable provenance.

## Install

Requirements:

- Node.js `^22.19.0` or `>=24.0.0`
- A DeepSeek Harness build compatible with `@deepseek-ai/dsh-tools@^0.1.1-rc.2`

To enable execution, the DSH composition must also provide `ctx.subprocess`,
`ctx.jobs`, and the shared `job_output` / `job_kill` tools. The host needs
miniwdl `1.15.0` and an already-active Docker Swarm manager; the plugin never
initializes Swarm. The `0.6.x` execution preview targets Linux Docker on the
default local `unix:///var/run/docker.sock`; rootless, remote, and Docker
Desktop endpoints are not yet configurable. Linux procfs must expose
`/proc/self/fd` so the adapter can verify the path behind each opened file
descriptor. Catalog, Store, validation, and declaration-only preflight
continue to work without those optional services.

Add the bundle to a DSH profile:

```bash
dsh plugin --profile web add dsh-bio-workflows
```

The bundle registers twelve tools:

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
- `bio_workflows_plan`: checks canonical input files under configured roots,
  probes miniwdl and Docker, reruns `miniwdl check`, and returns a reviewable
  non-executing plan plus `planDigest`.
- `bio_workflows_run`: replans, requires the exact `planDigest`, crosses the
  execution boundary only after DSH approval, and returns `runId` plus `jobId`.
- `bio_workflows_run_get`: returns owner-scoped status, provenance, exit facts,
  and output inventory. Logs and cancellation use DSH's shared `job_output` and
  `job_kill` tools with the returned `jobId`.
- `bio_workflows_run_list`: returns bounded, newest-first, owner-scoped run
  summaries with exact status filtering and fixed cursor pagination. After a
  runtime restart it records definitively orphaned non-terminal runs as
  `interrupted`; it never retries them or signals a stale PID.

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
[JSON Schema](https://unpkg.com/dsh-bio-workflows@0.6.0/schema/workflow-manifest.schema.json).
The zero-dependency runtime API is also available through package subpaths:

```js
import { createWorkflowCatalog } from 'dsh-bio-workflows/catalog'
import {
  createExecutionManager,
  parseExecutionConfig,
} from 'dsh-bio-workflows/execution'
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

Two workflow families and three structurally checked versioned bundles ship
with the package:

- `fastq-qc@1.0.0`: original non-executable FastQC draft;
- `fastq-qc@1.1.0`: hardened FastQC execution candidate;
- `bam-qc@1.0.0`: `samtools flagstat` and `samtools stats` for one BAM file.

All three bundles use WDL 1.0, pass `miniwdl v1.15.0 check`, and declare
miniwdl plus Cromwell compatibility. Version `1.1.0` is marked `ready` and
`verified` after a real miniwdl/Docker Swarm/FastQC completion; its sanitized
[acceptance record](./docs/evidence/fastq-qc-1.1.0-miniwdl-acceptance.json)
also records real LocalJobRegistry output and cancellation behavior and ships
with the package. A separate
[Agent-loop owner-disposal record](./docs/evidence/fastq-qc-1.1.0-agent-loop-owner-disposal.json)
uses DSH `0.1.1-rc.2`'s real Agent, approval, tool, job, session, and subprocess
services to prove model-driven `search -> plan -> run` and complete cleanup of a
long-running runner process tree when its Agent handle is disposed. Structural
Store validation still reports
`executionReady: false` for every bundle because publisher metadata never grants
runtime authority; only the exact internal execution allowlist does so. All
container images are fixed by registry digest.

Search results label built-in entries as `trust: builtin` and writable local
entries as `trust: local`; publisher-declared verification metadata never
silently turns a local draft into a trusted built-in asset.

A bundle is a versioned directory containing `workflow.json`, a local
`main.wdl`, example inputs, documentation, and per-file SHA-256 digests. Remote
imports, path traversal, symlinked bundle files, undeclared files, and digest
mismatches fail closed. File, bundle, discovery, aggregate-byte, and diagnostic
limits keep malformed local stores from producing unbounded reads or output.
The descriptor contract is published as
[JSON Schema](https://unpkg.com/dsh-bio-workflows@0.6.0/schema/wdl-bundle.schema.json).

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

## Opt-in miniwdl execution

Execution is a separate configuration boundary. Create dedicated, existing
directories for inputs and runs; they must be absolute, non-symlinked, and must
not overlap. `runsRoot` must be owned by the DSH process user, must not be
group/world-writable, and must use config-safe path characters. Runner paths
must be canonical absolute paths to root- or process-owned executables that are
not group/world-writable. Every ancestor of `runsRoot` and both runner paths
must be owned by the filesystem-root owner or the DSH process user; a
group/world-writable ancestor is accepted only when its sticky bit prevents
entry replacement. Violations fail with `runs_root_unsafe`,
`miniwdl_executable_unsafe`, or `docker_executable_unsafe`:

```yaml
- id: bio-workflows
  config:
    execution:
      enabled: true
      runsRoot: /srv/dsh-bio/runs
      inputRoots:
        - /srv/dsh-bio/inputs
      runner:
        executable: /usr/local/bin/miniwdl
        dockerExecutable: /usr/bin/docker
```

The first executable allowlist contains only `fastq-qc@1.1.0`. `bam-qc`, the
historical `fastq-qc@1.0.0` draft, and
custom/local bundles remain searchable and structurally validatable, but cannot
cross this execution adapter yet. A normal run is:

1. Search the built-in workflow and retain its exact `version` and bundle
   `digest`.
2. Call `bio_workflows_plan` with those values and real inputs. The plan uses
   canonical input paths, file size/timestamps/inode facts, resolved executable
   paths, miniwdl/Docker executable identities and versions, the fixed Docker
   host and Engine ID, active Swarm-manager state, expected outputs, environment
   policy, total snapshot bytes, and a deterministic `planDigest`. The execution
   preview caps copied inputs at 1 TiB per run.
3. Call `bio_workflows_run` with the same selection and inputs plus
   `expectedPlanDigest`. DSH asks for approval with the bundle and plan digests,
   then the tool replans before starting anything.
4. Use `job_output` and `job_kill` with `jobId`; use
   `bio_workflows_run_get` with `runId` for durable status and provenance, or
   `bio_workflows_run_list` to discover the current owner's historical runs.

Each run receives a new mode-`0700` directory. After approval, the adapter opens
each input with no-follow semantics, checks its approved filesystem identity,
copies exactly its approved byte length to a safe run-owned filename, rejects
concurrent growth and intermediate-directory symlink swaps by checking the
opened descriptor path, and records the snapshot SHA-256. It
then stages the validated WDL source, writes qualified miniwdl inputs and a
restrictive runner config, removes all ambient child environment variables,
sets a minimal fixed environment and local Docker socket, uses argv execution
without a host shell, and never overwrites an existing run. Automatic Swarm
initialization is disabled, task memory declarations become hard container
limits, and snapshotting requires the approved bytes plus a 512 MiB free-space
reserve. Failures before job registration remove the fresh
private run directory. `run.json` records
the approved plan, input snapshots, command policy, owner session, lifecycle,
exit facts, miniwdl results, and bounded output inventory. Provenance has a
separate 32 MiB read/write limit and remains readable after input mounts are
removed.

Current security limits are explicit in every plan: approval binds large
biological inputs by canonical path and filesystem identity/metadata rather
than precomputing full content hashes; the post-approval run-owned snapshot is
hashed for provenance. The adapter blocks privileged/runtime-selected Docker
networks but does not enforce complete container egress isolation. Use only the
shipped digest-pinned workflow and container assets on an isolated host.

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
4. Opt-in miniwdl execution adapter and run lifecycle — MVP available in `0.5.0`
5. Owner-scoped durable run history and restart reconciliation — available in
   `0.6.0`
6. Extend the execution allowlist, add Cromwell/WES adapters, and normalize reports

Execution support remains explicit, auditable, and disabled by default.

## Development

```bash
npm test
npm run test:coverage
npm run pack:check
npm run smoke:pack
npm run smoke:dsh
npm run smoke:dsh-agent
```

The two DSH smokes require the pinned global CLI
`@deepseek-ai/dsh@0.1.1-rc.2`. The package ships plain ESM and has no build or
install lifecycle scripts.
See [Design and implementation status](./docs/design-and-status.md) for the
architecture boundary, completion assessment, and next milestones.

## 中文说明

`0.6.0` 在默认关闭的 miniwdl 执行 MVP 上增加了 owner 隔离、资源有界的运行
历史，以及重启后 fail-closed 的 `interrupted` 状态收敛。目前只有内置
`fastq-qc@1.1.0` 进入执行白名单；`bam-qc`、旧版
`fastq-qc@1.0.0` 和自定义
WDL 仍只能搜索、校验、安装或生成草稿。执行前会检查真实输入文件、探测
miniwdl/Docker 与已启用的 Swarm manager、生成 `planDigest`，并把审批绑定到精确
bundle 与 plan 摘要；审批后再次规划，将输入复制到运行目录并记录 SHA-256，
清除环境中的 miniwdl/Docker 覆盖项，随后以 DSH 后台任务运行。日志/取消复用 `job_output`、
`job_kill`，`run.json` 保存可审计 provenance。声明式
`bio_workflows_preflight` 的语义不变，`executionReady` 仍固定为 `false`，避免把
纯配置校验误报成真实可运行性。当前候选也已经通过完整 DSH Agent-loop 验收：
模型实际调用 `search -> plan -> run`，审批事件进入 session 审计；销毁 owner 后，
Agent、Session、Job 以及 runner 父子进程树都会被清理。

## License

[MIT](./LICENSE)
