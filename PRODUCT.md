# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are bioinformaticians and research engineers working inside DeepSeek Harness. They need to discover trusted WDL workflows, ask the Harness Agent to create or repair WDL, review deterministic validation and graph evidence, and inspect execution readiness without memorizing plugin tool names.

## Product Purpose

`dsh-bio-workflows` turns bioinformatics workflow operations into one auditable DeepSeek Harness experience. Success means a user can move from biological intent and existing data to a safe, interpretable analysis result while the plugin handles deterministic checks, approval boundaries, provenance, and the separation between generated source and the production execution allowlist.

## Positioning

The product combines Harness-owned AI reasoning and approvals with plugin-owned deterministic WDL facts. The model can author and explain; only revision, digest, validation, graph, promotion, and execution policies owned by the plugin establish technical authority.

## Operating Context

- The product is installed as one public npm package containing both Host and Web Client faces; only a compatible DeepSeek Harness Web profile activates the Client face.
- Users normally work from an existing Harness conversation. UI actions hand a clear request to the current Agent session; they do not call mutating or execution endpoints directly.
- WDL assets use immutable revisions and revision-plus-content-digest compare-and-swap.
- Workflow execution uses miniwdl and Docker only when explicitly configured and approved.
- The first graphical surface is a read-only workflow graph derived from exact WDL source.

## Capabilities and Constraints

- Catalog and Store discovery, manifest and WDL bundle validation, revisioned draft authoring, deterministic draft validation, execution planning, approved background execution, durable run history, and normalized results already exist in the Host package.
- The Workflow Center has four areas organized around user jobs: Analyze data,
  Build workflow, Activity, and contextual Setup.
- The UI may submit a natural-language request to the current Harness Agent. The Agent remains responsible for tool selection, argument construction, approval interaction, and conversational repair.
- UI reads expose only bounded built-in catalog and readiness data. Local workflow summaries, owner-scoped drafts, and runs remain behind the Agent/tool boundary.
- Settled `bio_workflows_run_list` and `bio_workflows_run_get` calls receive
  keyed, read-only Client views. They explicitly project bounded outcome,
  normalized QC, output, and provenance fields from the owner-scoped tool
  result; they never expose Host paths, owner identity, commands, environment
  values, or a direct retry/execution action.
- Missing or malformed scientific-fit metadata is explicitly unavailable, never
  inferred to mean that a workflow declares no inputs or outputs.
- Plan and Run affordances are enabled only when the exact built-in workflow release is in the Host execution allowlist and its scientific-fit metadata is available; Host readiness remains an independent gate.
- A future owner-scoped activity view must use the native DSH session projection
  and the reviewed lifecycle projection contract. It remains deferred until the
  outward session face exposes the prompt request `rpcId` already recorded in
  the committed user message, plus a trustworthy client freshness signal.
- Graphs are derived, read-only evidence. Layout, selection, zoom, and explanatory annotations never enter the authoritative graph digest.
- Missing concurrency baselines fail closed. Stale baselines produce conflicts; the product never silently applies last-write-wins.
- Draft validation and graph generation do not authorize task execution.
- One package carries both faces, while headless profiles load only the Host capabilities and remain independent of browser runtime dependencies.

## Brand Commitments

- Keep the product name `dsh-bio-workflows` and the plural `workflows` terminology.
- Preserve DeepSeek Harness native layout, typography, color tokens, approval language, and interaction expectations.
- Product copy is direct, technical, and calm. It distinguishes observed facts, unavailable capabilities, and actions that still require approval.

## Evidence on Hand

- Built-in WDL bundles and their metadata live under `workflows/`.
- Runtime schemas live under `schema/`.
- Real miniwdl, Docker, Agent-loop, and normalized-result evidence lives under `docs/evidence/`.
- The accepted AI authoring and graph boundary is documented in `docs/ai-assisted-wdl-and-visualization.md` and GitHub issue #13.
- No customer claims, usage metrics, or external marketplace inventory are available and must not be fabricated.

## Product Principles

1. Show the workflow before exposing implementation detail.
2. Let AI accelerate authoring, never replace deterministic evidence.
3. Keep every mutation and run inside the ordinary Harness approval and audit path.
4. Reveal complexity progressively: useful defaults first, exact WDL, digests, and diagnostics on demand.
5. Fail closed and explain the next recovery action when configuration, ownership, or concurrency is uncertain.

## Accessibility & Inclusion

The Web Client must support keyboard navigation, visible focus, semantic controls, reduced motion, host light/dark themes, text scaling, and status communication that does not rely on color alone.
