# Design and implementation status

## Executive assessment

`dsh-bio-workflows` has implemented the control-plane and local WDL asset-store
foundation, but it has **not implemented the main end-to-end product capability: executing and
managing a bioinformatics workflow**.

The current package can answer four questions safely:

1. Which workflow manifests are configured?
2. Is one manifest structurally valid?
3. Do supplied input values and a configured engine declaration agree with that
   manifest?
4. Which built-in or local WDL bundles are available, and are their files
   structurally intact?

It cannot yet prove that analysis input files exist, perform full WDL semantic
validation, discover an installed engine, submit a run, stream logs, cancel a
run, or collect provenance and artifacts.

## Architecture boundary

```mermaid
flowchart LR
  A[DSH agent] --> B[Control-plane tools]
  B --> C[Workflow catalog]
  C --> D[Manifest v1 validator]
  B --> K[Workflow Store tools]
  K --> L[Built-in WDL bundles]
  K --> M[Opt-in local install and drafts]
  L --> N[Structural validation and SHA-256]
  M --> N
  B --> E[Declarative preflight]
  E --> F[Input shape checks]
  E --> G[Configured engine snapshot]
  E -. executionReady is false .-> H[Future approval gate]
  H -. not implemented .-> I[Future engine adapters]
  I -. not implemented .-> J[Future run and provenance store]
```

Manifest v1 remains intentionally metadata-only. WDL source is carried by a
separate bundle descriptor whose install operation is confined to a configured
store root. Preflight does not read the host or start a process. Bundle
validation inventories the whole directory, rejects links and undeclared
entries, and reads local asset files through bounded file handles, but never
invokes a WDL engine. Install approval is bound to an exact source, version, and
bundle digest and is rechecked before writing. This keeps catalog, store, and
preflight operations below the execution boundary.

## Capability matrix

| Capability | Status | Evidence | Remaining gap |
| --- | --- | --- | --- |
| DSH bundle installation | Implemented | `npm run smoke:dsh` installs the tarball into an isolated headless profile and dumps its config | Run the smoke in CI |
| Manifest v1 schema | Implemented | JSON Schema plus zero-dependency runtime validator | Schema migration policy when v2 is needed |
| Workflow catalog | Implemented | Strict startup validation, unique ids, deterministic list/get | Dynamic provider registration if needed |
| WDL bundle descriptor | Implemented | Runtime validator, JSON Schema, local-only imports, file SHA-256 | Schema migration policy and engine-produced validation evidence |
| Workflow Store | Implemented foundation | Built-in search, opt-in immutable installs, local draft scaffold | Git/TRS providers and a visual store UI |
| Starter workflows | Implemented as drafts | `fastq-qc` and `bam-qc` WDL 1.0 bundles pass `miniwdl v1.15.0 check`; containers are digest-pinned | Real miniwdl/Cromwell execution tests |
| Input declaration preflight | Implemented | Required, unknown, scalar type, and cardinality checks | File existence, readability, size, and checksum checks |
| Environment declaration preflight | Implemented | Availability and exact-version comparison | Trusted live engine probing |
| Execution authorization | Not implemented | `executionReady` is always `false` | Explicit approval/policy contract |
| Engine execution adapters | Not implemented | No command or adapter surface exists | miniwdl, Cromwell/WES, Nextflow, and Snakemake adapters |
| Run lifecycle | Not implemented | No run id or persisted state | Submit, status, logs, cancellation, retries |
| Provenance and reports | Not implemented | No run artifacts are produced | Inputs, versions, checksums, outputs, normalized reports |

## Is the main functionality implemented?

The answer depends on which product boundary is being evaluated:

- **Foundation package:** yes. Installation metadata, manifest validation,
  catalog discovery, WDL asset management, structural bundle validation, and
  declaration-only preflight are implemented and tested.
- **Usable workflow runner:** no. The package cannot execute or manage a real
  bioinformatics workflow, so the primary end-user loop is incomplete.

The project is therefore at a safe control-plane milestone, not at an execution
MVP.

## Next milestones

### 1. Trusted preflight providers

Introduce an injected provider contract instead of embedding shell calls in the
model-facing tool. Providers can implement file metadata checks and engine
version discovery under an explicit host policy. The pure validator remains the
fallback and continues to work without a provider.

Acceptance criteria:

- every live check reports its source and timestamp;
- unavailable providers produce `incomplete`, never a false `pass`;
- probes are cancellable, bounded, and cannot execute workflow payloads;
- declaration-only mode remains the default.

### 2. Execution plan and approval gate

Add an adapter-neutral execution plan that resolves a manifest into a reviewable
command, environment, mounts, and expected outputs. Planning must not submit a
run. A separate operation crosses the execution boundary only after DSH policy or
user approval.

Store installation and draft creation already use a separate DSH approval gate,
but that grant applies only to bounded asset writes and never authorizes a run.

### 3. Engine adapters and run lifecycle

Implement one adapter first, preferably miniwdl for the WDL starter path, behind
the common contract.
Return an immutable run id and expose status, bounded log reads, cancellation,
and terminal outcome. Add Cromwell/WES, Nextflow, and Snakemake only after the
lifecycle contract is stable.

### 4. Store federation and visual authoring

Add Git and GA4GH TRS read providers after the local provider contract is
stable. A later UI may present the same search/install/update flow as a theme
store, while displaying workflow-specific trust, license, digest, container,
engine, and verification metadata. Source edits must use explicit version and
digest baselines; conflicts stop autosave and require user-controlled merging.

### 5. Provenance and normalized reports

Persist the manifest version, resolved inputs, engine/container versions,
checksums, timestamps, exit status, output inventory, and report links. This is
the point where a completed run becomes reproducible and auditable.

## Execution MVP definition of done

The main product functionality can be called implemented only when one supported
workflow can complete this loop:

1. discover a versioned manifest;
2. validate real inputs and the live environment;
3. render a reviewable execution plan;
4. receive explicit execution authorization;
5. submit, observe, and cancel by run id;
6. return a terminal result with provenance and output inventory.

Until all six are demonstrated in an integration test, releases should describe
themselves as control-plane or preview milestones rather than a workflow runner.

## Repository and release policy

The repository uses a mainline model with short-lived feature branches and
Conventional Commits. Every release candidate must pass `npm test`, coverage,
package export checks, `npm pack --dry-run`, and a review of public contracts.
Publishing to npm, creating a remote repository, pushing, and tagging remain
separate explicitly authorized actions.
