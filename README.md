# dsh-bio-workflows

Bioinformatics workflow catalog, WDL asset store, and preflight foundation for
[DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

`workflows` is intentionally plural: this package provides one DSH integration
surface for multiple workflow definitions, while execution adapters are added
one engine and one verified workflow at a time.

> `0.11.0` adds owner-session **Missions** for bounded autonomous WDL authoring
> and validation repair. One digest-bound approval can cover a fixed action,
> update, failure, fingerprint, and wall-time budget. This release does not run
> software containers from Missions: isolated draft testing and production
> execution remain explicitly unavailable.

> The next, unreleased development slice adds a default-off, separately
> approved isolated fixture runner. It does not change the published `0.11.x`
> Mission grant or its `Software Trial Report v1.success = false` boundary.

## Install

Requirements:

- Node.js `^22.19.0` or `>=24.0.0`
- DeepSeek Harness `>=0.1.1-rc.2 <0.2.0`; `dsh-v0.1.1-rc.2` is the currently verified
  integration target

To validate authoring drafts or enable execution, the DSH composition must
also provide `ctx.subprocess`. Execution additionally requires `ctx.jobs` and
the shared `job_output` / `job_kill` tools. The host needs
miniwdl `1.15.0` and an already-active Docker Swarm manager; the plugin never
initializes Swarm. The `0.7.x` execution preview targets Linux Docker on the
default local `unix:///var/run/docker.sock`; rootless, remote, and Docker
Desktop endpoints are not yet configurable. Linux procfs must expose
`/proc/self/fd` so the adapter can verify the path behind each opened file
descriptor. Catalog, Store, structural draft diagnostics, and declaration-only
preflight continue to work without those optional services; missing miniwdl
produces `validator_unavailable`, never a false validation success.

Add the bundle to a DSH profile:

```bash
dsh plugin --profile web add dsh-bio-workflows
```

The development bundle registers twenty-seven tools. Every tool also provides replay-safe,
human-readable pending and completed card presentations:

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
- `bio_workflows_mission_prepare`: returns a non-mutating autonomous-authoring
  plan and exact `planDigest` for one software name, version, digest-pinned
  container identity, objective, acceptance criteria, and bounded budget.
- `bio_workflows_mission_start`: asks once for the exact prepared plan, then
  creates an owner-session/runtime-scoped grant for draft create, update, and
  validation actions only.
- `bio_workflows_mission_get`: reads the Mission phase, remaining budget, bound
  draft revision, validation evidence, failure fingerprints, and stop reason.
- `bio_workflows_mission_cancel`: stops the Mission without deleting evidence
  or retrying an in-flight operation.
- `bio_workflows_mission_report`: returns a bounded `Software Trial Report v1`.
  In `0.11.0`, `success` is always false and a validated draft stops at
  `ready_for_isolated_test`.
- `bio_workflows_draft_test_prepare`: computes a non-executing test plan bound
  to one exact ready Mission, draft validation, immutable fixture, local
  digest-pinned image, runner identity, isolation policy, assertions, and
  resource/output budgets.
- `bio_workflows_draft_test_start`: recomputes the live plan, requires its exact
  `planDigest` and a separate DSH approval, then starts only the dedicated
  default-off fixture backend.
- `bio_workflows_draft_test_get`: reads one owner-session test and its bounded,
  digest-bound isolation, log, artifact, assertion, and failure evidence.
- `bio_workflows_draft_test_cancel`: stops one owner-session fixture test
  without automatic retry or evidence deletion.
- `bio_workflows_draft_test_report`: summarizes one exact isolated trial while
  keeping install, promotion, allowlist, and production capabilities false.
- `bio_workflows_draft_create`: creates revision 1 of a session-scoped,
  non-executable authoring draft after approval.
- `bio_workflows_draft_get`: reads the exact head/revision file index or one
  selected bounded file body without approval.
- `bio_workflows_draft_update`: replaces/deletes explicit files under both
  `expectedRevision` and `expectedContentDigest`, then commits one immutable
  full revision after approval.
- `bio_workflows_draft_validate`: performs bounded structural checks and an
  identity-checked, fixed-argv `miniwdl check` on one exact revision; it never
  runs WDL tasks.
- `bio_workflows_draft_graph`: parses one exact owner-scoped revision into
  deterministic `WorkflowGraph v1` nodes, proven edges, source ranges, and
  explicit partial-graph diagnostics without running or mutating WDL.
- `bio_workflows_plan`: checks canonical input files under configured roots,
  probes miniwdl and Docker, reruns `miniwdl check`, and returns a reviewable
  non-executing plan plus `planDigest`.
- `bio_workflows_run`: replans, requires the exact `planDigest`, crosses the
  execution boundary only after DSH approval, and returns `runId` plus `jobId`.
- `bio_workflows_run_get`: returns owner-scoped status, provenance, exit facts,
  output inventory, and `BioWorkflowResult v1` for new successful runs. Logs and
  cancellation use DSH's shared `job_output` and `job_kill` tools with the
  returned `jobId`.
- `bio_workflows_run_list`: returns bounded, newest-first, owner-scoped run
  summaries with exact status filtering and fixed cursor pagination. After a
  runtime restart it records definitively orphaned non-terminal runs as
  `interrupted`; it never retries them or signals a stale PID.

## Workflow Center

On a compatible DSH Web profile, installation of the same npm package also
loads the browser Client face. Open **Bio Workflows** from the sidebar footer.
The panel has four areas:

- **Workflows** searches the public built-in catalog, shows verification,
  digest, and exact execution-allowlist facts, and asks the Agent to validate.
  Planning is enabled only for allowlisted built-in releases; configured local
  bundles remain discoverable through the owner-bound Agent tools.
- **AI Drafts** creates owner-scoped drafts and asks for an exact revision graph
  or validation. Mutations always require the current revision and content
  digest; conflicts stop instead of silently overwriting.
- **Runs** asks the Agent for owner-scoped history, run provenance, or a safe
  plan. The UI never starts a task directly.
- **Setup** reports read-only host readiness and can ask the Agent to diagnose
  miniwdl, Docker, jobs, roots, and policy.

If no Harness task is current, Workflow Center shows **Open a Harness task**
and disables every Agent action. The bootstrap endpoint returns only bounded
public built-in catalog facts and normalized diagnostic codes/messages; it never
returns local workflow summaries, Store paths, validator details, drafts, or
runs. Requests without same-origin browser context fail closed. The panel traps
keyboard focus while open, closes with Escape, and restores focus to its launcher.

The `bio_workflows_draft_graph` result receives a native read-only graph card
inside the conversation. WDL source and its revision/content digest remain the
authority; layout, selection, and explanations are presentation only.

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
[JSON Schema](https://unpkg.com/dsh-bio-workflows@0.11.0/schema/workflow-manifest.schema.json).
The zero-dependency runtime API is also available through package subpaths:

```js
import { createWorkflowCatalog } from 'dsh-bio-workflows/catalog'
import { createDraftStore } from 'dsh-bio-workflows/draft-store'
import { createDraftValidator } from 'dsh-bio-workflows/draft-validation'
import {
  BIO_WORKFLOW_RESULT_LIMITS,
  BIO_WORKFLOW_RESULT_SCHEMA_VERSION,
  createExecutionManager,
  parseExecutionConfig,
  validateBioWorkflowResultSemantics,
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

Two workflow families and four structurally checked versioned bundles ship
with the package:

- `fastq-qc@1.0.0`: original non-executable FastQC draft;
- `fastq-qc@1.1.0`: hardened FastQC execution baseline;
- `fastq-qc@1.2.0`: checksummed results plus declared plain-text FastQC
  summaries;
- `bam-qc@1.0.0`: `samtools flagstat` and `samtools stats` for one BAM file.

All four bundles use WDL 1.0, pass `miniwdl v1.15.0 check`, and declare
miniwdl plus Cromwell compatibility. Versions `1.1.0` and `1.2.0` are marked
`ready` and `verified`. The retained `0.7.0` source-hash-bound
[result acceptance record](./docs/evidence/fastq-qc-1.2.0-result-acceptance.json)
captures a real miniwdl/Docker Swarm/FastQC completion, exact artifact digests,
parsed module summaries, and real LocalJobRegistry lifecycle states. A separate
[Agent-loop owner-disposal record](./docs/evidence/fastq-qc-1.2.0-agent-loop-owner-disposal.json)
uses DSH `0.1.1-rc.2`'s real Agent, approval, tool, job, session, and subprocess
services to prove model-driven `search -> plan -> run` and complete cleanup of a
long-running runner process tree when its Agent handle is disposed. The
execution adapter remains unchanged by the `0.8.0`–`0.10.0` authoring, graph,
and UI releases; root tool registration is covered by the new DSH integration
tests and the expanded Agent-loop smoke rather than relabeling historical
evidence. A separate
[`0.10.0` Agent-loop record](./docs/evidence/dsh-bio-workflows-0.10.0-agent-loop.json)
binds draft create/read/CAS update/validation, graph extraction, search/plan/run,
three approvals, and owner-disposal cleanup to the current source hashes. Structural
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
[JSON Schema](https://unpkg.com/dsh-bio-workflows@0.11.0/schema/wdl-bundle.schema.json).

The normalized result contract is published separately as
[`BioWorkflowResult v1`](https://unpkg.com/dsh-bio-workflows@0.11.0/schema/bio-workflow-result.schema.json).
It is additive to `run.json`: historical `0.5.x` and `0.6.x` records without a
`result` field remain readable. A complete
[example result](./docs/examples/bio-workflow-result-v1.json) ships with the
package. Apply the JSON Schema first, then
`validateBioWorkflowResultSemantics` for the cross-group 1024-artifact limit and
FastQC count/reference consistency that JSON Schema cannot express directly.

The built-in store is searchable without configuration. Local writes are off
by default. To enable install, legacy scaffold, and revisioned draft mutations,
configure an absolute, dedicated root:

```yaml
- id: bio-workflows
  config:
    store:
      root: /absolute/path/to/dsh-workflow-store
      writeEnabled: true
```

Revisioned authoring refuses to use the configured root unless it is owned by
the DSH process user and is not writable by group or other users (normally mode
`0700`). Its ancestor chain may use a shared writable directory only when
sticky-bit replacement protection is enabled, as on a correctly configured
`/tmp`. Legacy install/scaffold keep their existing 0.7 storage contract.

The write tools cannot choose an arbitrary destination: installed bundles go
under `installed/<id>/<version>`, legacy scaffolds under
`drafts/<id>/<version>`, and revisioned authoring state under a hashed
`authoring/<owner>/<draftId>` namespace.
Existing versions and revisions are never overwritten. Even with writes
enabled, DSH receives an `ask` decision bound to the target version/revision
and content digest before each mutation. `bio_workflows_install` therefore requires the exact `version` and
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

## AI-assisted WDL authoring

DeepSeek Harness owns the model, conversation, tool loop, and user approval;
the plugin does not embed a second LLM client. Model-authored source is always
untrusted. The authoring loop is:

1. Call `bio_workflows_draft_create` with the workflow intent.
2. Call `bio_workflows_draft_get` without `path` to inspect the bounded file
   index, then request one exact file body.
3. Call `bio_workflows_draft_update` with complete per-file replacements or
   deletions and the exact current revision plus digest.
4. Call `bio_workflows_draft_validate` for that exact immutable revision.
5. Repair diagnostics by repeating steps 2–4.

Ownership comes only from `exec.agent.session.id`; no tool argument can claim
another owner. Revisions begin at 1, are complete immutable snapshots, and are
limited to 128 files, 1 MiB per file, 4 MiB total, and 256 revisions. Concurrent
updates compete for the same next revision directory, so exactly one matching
CAS can commit. Atomic capacity reservations limit each owner to 256 drafts.
Cross-session reads return `draft_not_found`.

Validation first rejects unsafe paths, remote or escaping imports, invalid
example JSON, non-WDL-1.0 sources, and floating container literals. It then
copies the exact revision into a fresh private directory and invokes only:

```text
miniwdl check --no-outside-imports main.wdl
```

The executable is resolved to a canonical path, checked for safe ownership and
permissions, version-pinned, and rechecked before each fixed-argv invocation.
The child receives no ambient environment. A syntax or type error returns
revision-bound evidence with `valid: false`; a missing, changed, timed-out, or
wrong-version validator returns `validator_unavailable`. Neither result grants
test, promotion, installation, or execution authority.

Configure the validator independently of the default-off write switch:

```yaml
- id: bio-workflows
  config:
    store:
      root: /absolute/path/to/dsh-workflow-store
      writeEnabled: true
    authoring:
      validator:
        executable: /usr/local/bin/miniwdl
        expectedVersion: 1.15.0
```

The serialized contracts are published as
[`WDL Draft Revision v1`](https://unpkg.com/dsh-bio-workflows@0.11.0/schema/wdl-draft-revision.schema.json)
and
[`Draft Validation Evidence v1`](https://unpkg.com/dsh-bio-workflows@0.11.0/schema/draft-validation-evidence.schema.json) and
[`WorkflowGraph v1`](https://unpkg.com/dsh-bio-workflows@0.11.0/schema/workflow-graph.schema.json).
Workflow graph extraction, the keyed native graph card, and the read-only
Workflow Center are available in `0.10.0`. The unreleased fixture-test slice is
separately authorized and default-off. Canvas mutation, promotion, and remote
Store providers remain later, separately authorized stages.

Graph extraction currently reads only `main.wdl`. Any local or remote WDL
`import` is reported explicitly and returns `complete: false`; imported task or
workflow definitions are not expanded into the graph.

## Bounded autonomous authoring Missions

Missions let the Harness Agent repair WDL validation failures without asking
for every draft mutation. They are disabled by default and require the same
private, write-enabled Store used by revisioned drafts:

```yaml
- id: bio-workflows
  config:
    store:
      root: /absolute/path/to/dsh-workflow-store
      writeEnabled: true
    autonomy:
      enabled: true
      maxActions: 32
      maxDraftCreates: 1
      maxDraftUpdates: 8
      maxValidationFailures: 8
      maxSameFailureFingerprint: 3
      maxWallTimeMs: 2700000
```

The safe conversation flow is:

1. The Agent calls `bio_workflows_mission_prepare` with an exact software
   version and `image@sha256:...` identity.
2. The Agent calls `bio_workflows_mission_start` with the returned
   `planDigest`; Harness shows one approval containing the exact identity and
   maximum budgets.
3. The Agent passes `missionId` to `draft_create`, `draft_update`, and
   `draft_validate`. Every action consumes a durable reservation before the
   draft operation; exact-call replay is reported as unsafe.
4. Stable normalized diagnostics produce a `failureFingerprint`. Repeating the
   same fingerprint three times by default, exhausting another budget, losing
   validation infrastructure, cancellation, or runtime restart stops the loop
   without automatic retry.
5. Mission validation also requires every WDL task to declare exactly one
   pinned container and the normalized image set to equal the approved digest.
6. `bio_workflows_mission_report` summarizes the draft and evidence. Validation
   terminally revokes the Mission write grant and can only produce
   `ready_for_isolated_test`, not a successful software trial.

The Mission grant cannot call `bio_workflows_run`, install/promote a draft,
expand the production allowlist, or execute the declared container image. The
published `0.11.0` release therefore never crosses that boundary. The next
development slice uses a dedicated, separately approved fixture backend with
deterministic egress and host-service denial evidence; it does not extend or
reuse the Mission grant. See
[Autonomous software trial Missions](./docs/autonomous-software-trial-missions.md).

## Isolated fixture testing (unreleased)

Draft testing is disabled by default and independent from both Mission
authoring and the production Docker Swarm adapter. Five owner-session tools
implement `prepare -> start -> get/cancel -> report`; only `start` asks for a
new approval bound to the exact `planDigest`.

The dedicated miniwdl `dsh_fixture_docker` backend accepts only one locally
present digest-pinned task image, fixed plugin-generated Docker argv, immutable
read-only fixture snapshots, fixed scrubbed environment values, and bounded
tmpfs output. Before start it inspects and binds network `none`, read-only root,
non-root uid/gid, dropped capabilities, `no-new-privileges`, builtin seccomp,
AppArmor, CPU/memory/PID/ulimit/tmpfs limits, devices, mounts, and environment.
Before WDL loading, Python `-B -I -S` disables bytecode writes and verifies the
dependency closure without executing `.pth` or customization hooks, while a digest-bound, thread-synchronized
kernel seccomp filter permits only Unix socket creation. A separately bounded
Docker broker retains the fixed CLI under the same network filter, while remote,
traversal, and symlink imports are rejected before task creation. Seventeen
deterministic controller/container probes
must prove egress, Docker gateway, live host loopback service, Docker socket,
credential-path, and ambient-credential denial. The plan also binds the full
miniwdl dependency environment and controller/broker hard limits. Startup
recovery verifies and terminates the exact persisted controller process group
before proving absence of exactly labeled Docker resources.

A passing report remains test evidence only. It cannot install, promote,
allowlist, or production-run the draft, and it does not change
`Software Trial Report v1.success`. Configuration, threat model, contracts, and
the real Docker acceptance command are documented in
[Isolated fixture runner](./docs/isolated-fixture-runner.md).

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

The executable allowlist contains `fastq-qc@1.1.0` and `fastq-qc@1.2.0`; use
`1.2.0` for normalized results and FastQC summaries. `bam-qc`, the historical
`fastq-qc@1.0.0` draft, and
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
exit facts, miniwdl results, bounded output inventory, and an additive
`BioWorkflowResult v1` on successful new runs. Result artifact groups follow
manifest output order and preserve each miniwdl array order. Every file is
limited to 16 GiB, each result is limited to 1024 artifacts and 64 GiB of
aggregate hashing, repeated file entities are rejected, and hashing checks job
cancellation between chunks. SHA-256 is
calculated from a no-follow canonical target descriptor whose identity is
checked before and after streaming. Stable miniwdl-managed output symlinks are
accepted only while their path identity remains unchanged and their resolved
target stays inside the engine directory. Each FastQC summary is limited to
1 MiB, 512 lines, and 4096 bytes per line; all summaries in one result are
limited to 8 MiB and 16384 module lines. The host never extracts the ZIP report.
Provenance has a separate 32 MiB read/write limit and remains readable after
input mounts are removed.

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
6. Checksummed `BioWorkflowResult v1` and FastQC summaries — available in
   `0.7.0`
7. Session-scoped, revisioned custom-WDL authoring and non-executing validation
   — available in `0.8.0`
8. Replay-safe native tool presentations — available in `0.8.1`
9. Deterministic `WorkflowGraph v1` extraction — available in `0.9.0`
10. Responsive Workflow Center and keyed read-only graph card in the same npm
    package — available in `0.10.0`
11. Bounded owner-session autonomous WDL authoring and validation-repair
    Missions — available in `0.11.0`
12. Separately approved isolated draft-test runner and fixture/result
    assertions — implemented and locally accepted on the unreleased development
    branch; remote CI and release review remain required
13. Next: independent review/promotion, Git/TRS Store providers, and additional
    execution adapters

Execution support remains explicit, auditable, and disabled by default.

## Development

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
npm run test:ui
npm run pack:check
npm run smoke:pack
npm run smoke:dsh
npm run smoke:dsh-agent
npm run accept:draft-fixture-runner
```

The isolated fixture-runner acceptance requires a private root, miniwdl 1.15.0,
and two locally preloaded digest-pinned images; see
[its runbook](./docs/isolated-fixture-runner.md#real-acceptance). The real
production-result acceptance additionally requires safe absolute miniwdl and
Docker executable paths plus access to an already-active local Swarm manager:

```bash
DSH_BIO_MINIWDL_EXECUTABLE=/absolute/path/to/miniwdl \
DSH_BIO_DOCKER_EXECUTABLE=/absolute/path/to/docker \
npm run accept:fastq-qc-result
```

The two DSH smokes require the pinned global CLI
`@deepseek-ai/dsh@0.1.1-rc.2`. The Host ships as plain ESM; the browser Client
is compiled during `prepack`. There are no install-time lifecycle hooks.
See [Design and implementation status](./docs/design-and-status.md) for the
architecture boundary, completion assessment, and next milestones.

## 中文说明

`0.11.0` 在现有生信工作流入口上增加了有界自主 Mission：用户批准一次绑定精确
`planDigest` 的计划后，同一 session 的 Agent 可以在动作数、更新次数、失败次数、
重复错误指纹和总时长预算内，持续创建、修改和校验 WDL。相同错误默认重复三次、
校验基础设施不可用、预算耗尽、取消或运行时重启都会停止，且不会自动重试。
Mission 只授权草稿写作与确定性校验，不授权容器试跑、promotion 或生产执行；
即使 WDL 校验通过，报告也只会标记 `ready_for_isolated_test`，`success` 仍为 `false`。
未发布开发分支已另设默认关闭的 fixture runner，并要求新的精确 `planDigest` 审批；它以
控制器内核 seccomp、容器 `network none`、只读根文件系统、非 root 用户、固定环境、
硬资源上限、独立 Docker broker 和 17 项探针证明
外网及宿主服务不可达，不复用生产 runner 或白名单。试跑通过仍不会安装、promotion、
allowlist 或生产执行，也不会把 Mission report 的 `success` 改为 `true`。原有 npm 包
继续同时提供 Host 工具与响应式
Workflow Center。Agent 可以创建 session 隔离的 WDL 草稿、按 revision/digest
并发控制更新、逐文件读取、生成精确 revision 的非执行式 miniwdl 校验证据，并把
确定性 `WorkflowGraph v1` 渲染为只读流程图；创建与更新各自需要 DSH 审批。界面
只向当前 Agent 提交意图，不直接修改草稿或启动任务。自定义 WDL 仍不会自动进入
搜索结果、安装区或执行白名单；画布编辑与 promotion 尚未开放。
内置 `fastq-qc@1.1.0` 与 `1.2.0` 继续处于执行白名单，推荐使用 `1.2.0`；
`bam-qc` 和旧版 `fastq-qc@1.0.0` 仍不可执行。执行前会检查真实输入文件、探测
miniwdl/Docker 与已启用的 Swarm manager、生成 `planDigest`，并把审批绑定到精确
bundle 与 plan 摘要；审批后再次规划，将输入复制到运行目录并记录 SHA-256，
清除环境中的 miniwdl/Docker 覆盖项，随后以 DSH 后台任务运行。日志/取消复用 `job_output`、
`job_kill`，`run.json` 保存可审计 provenance；成功的新运行还会按 manifest 输出顺序
返回带 SHA-256 的 artifact 分组，并对 1.2.0 的声明式 `summary.txt` 做有界解析，宿主机
不会解压 FastQC ZIP。声明式
`bio_workflows_preflight` 的语义不变，`executionReady` 仍固定为 `false`，避免把
纯配置校验误报成真实可运行性。当前候选也已经通过完整 DSH Agent-loop 验收：
模型实际调用 `draft_create -> draft_get -> draft_update -> draft_validate -> draft_graph`，再调用
`search -> plan -> run`；两次草稿 mutation 与一次运行审批都进入 session 审计。销毁 owner 后，
Agent、Session、Job 以及 runner 父子进程树都会被清理。

## License

[MIT](./LICENSE)
