# AI-assisted WDL authoring and visualization

Status: accepted for [issue #13](https://github.com/qzhqzh/dsh-bio-workflows/issues/13);
the authoring core (`0.8.0`), deterministic graph (`0.9.0`), native Workflow
Center (`0.10.0`), and packaged on-demand Agent Skill are implemented.
The integration notes are verified against the immutable DeepSeek Harness
[`dsh-v0.1.1-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2)
release (`b150a551b8`). This document defines no new execution authority.

## Decision summary

| Decision | RFC position |
| --- | --- |
| Model ownership | DeepSeek Harness owns the model, Agent loop, conversation, and human interaction. |
| Domain ownership | `dsh-bio-workflows` owns draft revisions, deterministic validation, graphs, tests, promotion, and execution policy. |
| Model integration | Use the current DSH Agent, packaged on-demand `bio-wdl-authoring` Skill, and narrow plugin tools. Do not embed another LLM client. |
| Draft trust | Every generated or edited source is an untrusted, owner-scoped draft. |
| Concurrency | Every mutation uses compare-and-swap over both `expectedRevision` and `expectedContentDigest`. |
| Validation | Evidence is derived by the plugin from an exact revision, validator policy, and toolchain; model claims are never evidence. |
| Visualization | `WorkflowGraph v1` is parsed from exact WDL source. The model may explain it but cannot create authoritative graph edges. |
| First native UI | Ship a browser Client face in the same npm package: a keyed `tool.call.toolview` renderer plus a responsive Workflow Center. A correlated Conversation Node is deferred. |
| Execution | Draft validation and graph generation cannot run WDL tasks. Test, promotion, and production execution remain separate approvals. |
| Implemented slices | `0.8.0` create/get/update/validate; `0.8.1` replay-safe presentations; `0.9.0` graph; `0.10.0` Workflow Center; `0.11.0` bounded owner-session Mission authoring and validation repair; `0.12.0` packaged Skill and default-off, separately approved isolated fixture test. No graph editor, promotion, or new production execution allowlist. |

## Product boundary

DeepSeek Harness owns intent clarification, model selection, iterative reasoning,
tool calling, conversation history, and approval interaction.
`dsh-bio-workflows` owns the deterministic bioinformatics boundary: source
budgets, immutable revisions, WDL and bundle validation, graph extraction,
fixture evidence, immutable promotion, execution planning, and provenance.

The plugin must not embed a second DeepSeek or OpenAI-compatible API client.
The configured Harness model already receives registered tool schemas and can
iterate over their results. Keeping model credentials and routing in Harness
also keeps every material operation in the ordinary DSH tool and approval
audit trail.

AI-authored WDL is always untrusted input. Generation, validation, testing,
review, promotion, and execution are distinct transitions. Creating,
validating, visualizing, or installing a draft never grants execution authority.

## Alternatives considered

| Option | Result | Reason |
| --- | --- | --- |
| Plugin-owned LLM client | Rejected | Duplicates credentials, routing, conversation state, retries, and audit behavior while creating a second control plane. |
| DSH Agent + Skill + deterministic tools | Selected | Uses the existing model-tool-model loop and keeps domain facts reproducible and policy-controlled. |
| Standalone browser WDL IDE | Deferred | Adds a second application and state synchronization problem before the authoring and graph contracts are stable. |

## Confirmed Harness integration surfaces

The following statements were checked against the pinned release above, not
inferred from current `master` alone:

- `ctx.tools` is the scoped tool registry. Registered schemas join prompt
  assembly, and calls pass through `tools/pre-execute`, `tools/execute`, and
  `tools/post-execute`. The plugin already uses this surface in `0.7.0`.
- `ctx.skills` is an optional layered registry with runtime `register()` and
  filesystem providers. The authoring Skill can therefore be packaged with the
  plugin and registered only when the service is present; it does not need to
  become an always-on system prompt.
- `ctx.systemPrompt` exists, but the first slice does not require a new prompt
  section. Safety rules belong in code and policy, while tool descriptions and
  the optional Skill carry model guidance.
- `ctx.approval` exists, but plugin tools should continue to return `kind: ask`
  from the standard `tools/pre-execute` waterfall. They must not call approval
  as a second, nested authorization path.
- `ctx.workflowEngine` runs model-written orchestration scripts which may start
  subagents. It is optional and is not a security sandbox or a WDL engine. It
  is unnecessary for the MVP; a later large-workflow review mode may use it
  without changing validation authority.
- The Web Client has a keyed `tool.call.toolview` slot for one tool's durable
  call/result, while DSH's native session-projection seam carries bounded
  Host-computed per-session read models. The graph tool already supplies a
  stable business object, so its keyed tool card is the smaller first
  integration. A correlated lifecycle projection is justified only when
  authoring, test, and run events must be folded together, and only after the
  outward prompt contract exposes the request `rpcId` already stored in the
  committed user message. See
  [Workflow Center lifecycle projection contract](workflow-center-lifecycle-projection.md).

Relevant upstream references, pinned to the verified release:

- [DeepSeek Harness architecture](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/docs/architecture.md)
- [Skills subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/docs/subsystems/skills.md)
- [Dynamic workflows](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/docs/subsystems/workflow.md)
- [Conversation Node cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.2/docs/cookbook/adding-a-conversation-node.md)

Harness is a developer preview with compatibility-breaking changes. Host
authoring contracts must remain independent of optional Client APIs, and every
supported Harness release needs an integration smoke test.

## Proposed authoring loop

```text
natural-language requirement or Workflow Center action
  -> current Harness Agent clarifies the request
  -> clarify inputs, outputs, references, resources, and target engine
  -> create an owner-scoped untrusted draft
  -> read exact revision and content digest
  -> compare-and-swap one bounded source patch
  -> deterministic validation of that exact revision
  -> Agent repairs bounded diagnostics
  -> deterministic WorkflowGraph v1 preview
  -> human review and explicitly approved fixture test
  -> explicitly approved immutable promotion
  -> ordinary plan -> approval -> run
```

One ordinary Agent is sufficient for the MVP. Optional requirement, author,
and independent-review subagents may be added later, but their conclusions do
not replace deterministic validation or human promotion.

## Draft and revision contract

The revisioned authoring store is separate from the current executable bundle
store because an invalid or incomplete WDL file must still be storable and
repairable. In particular, an authoring draft is not discoverable by the
production execution allowlist.

`Draft v1` has these invariants:

- `draftId` is an opaque plugin-minted UUID identifier and never derives from a
  workflow id or filesystem path.
- The owner is derived from `exec.agent.session.id`; no tool argument may claim
  or override ownership.
- Revision numbers are positive, monotonic integers beginning at `1`. A
  committed revision is immutable and the head pointer changes atomically.
- Each revision contains a complete logical source snapshot made from bounded,
  well-formed UTF-8 files with safe relative POSIX paths and declared roles.
- `contentDigest` is SHA-256 over a versioned, length-delimited canonical source
  set sorted by path. Path, role, exact UTF-8 bytes, and byte lengths enter the
  digest. Canonicalization fixtures must be frozen before implementation.
- Every update supplies both `expectedRevision` and
  `expectedContentDigest`. Either mismatch returns `revision_conflict` and
  performs no write; last-write-wins is forbidden.
- The first slice supports source patching but not deletion of a draft,
  ownership transfer, collaboration, or history rewriting.
- Existing bundle limits remain hard ceilings: at most 128 files, 1 MiB per
  file, and 4 MiB total. Model-visible reads are narrower: list metadata first
  and request one exact file body by path, so a large draft is never injected
  into one tool result.

The existing `bio_workflows_scaffold` remains backward compatible as a
one-shot immutable bundle scaffold. It does not become an alias for the new
revision store in `0.8.0`; a later deprecation requires a separate migration
decision.

## Finalized tool names and authorities

| Tool | Exact contract | Approval |
| --- | --- | --- |
| `bio_workflows_draft_create` | Create revision 1 from a deterministic template and return `draftId`, revision, digest, and file index. | Store writes enabled + `tools/pre-execute` ask |
| `bio_workflows_draft_get` | Read owner-scoped head or one exact revision; return the file index or one selected file body. | None |
| `bio_workflows_draft_update` | Apply explicit file replacements/deletions under revision-and-digest CAS, then atomically commit one immutable revision. | Store writes enabled + `tools/pre-execute` ask |
| `bio_workflows_draft_validate` | Validate one exact revision without running WDL tasks and return bound evidence. | None |
| `bio_workflows_draft_graph` | Produce `WorkflowGraph v1` for one exact revision. | None; implemented in `0.9.0` |
| `bio_workflows_draft_test_prepare` | Build an exact non-executing plan for one ready Mission revision and immutable fixture. | None; `0.12.0` |
| `bio_workflows_draft_test_start` | Run only the approved fixture in the dedicated bounded backend using the exact live plan digest. | Separate ask; `0.12.0` |
| `bio_workflows_draft_test_get` | Read one owner-session test and bounded evidence. | None; `0.12.0` |
| `bio_workflows_draft_test_cancel` | Stop one active owner-session test without retry. | None; owner-fenced mutation |
| `bio_workflows_draft_test_report` | Return the bounded trial report with all production/promotion capabilities false. | None; `0.12.0` |
| `bio_workflows_draft_promote` | Recheck current evidence and materialize one immutable promoted bundle digest. | Separate ask; deferred |

Mutation tools accept structured data, never a model-authored host command,
environment variable, shell fragment, engine flag, or output path. Approval
preparation reads the current head; execution repeats the CAS check so the
approved mutation cannot land on a newer revision.

## Deterministic validation evidence

`bio_workflows_draft_validate` is a non-executing validator. Its exact pipeline
is:

1. load the immutable owner-scoped revision and verify its content digest;
2. enforce file, UTF-8, path, import-closure, and source budgets;
3. validate any manifest and bundle metadata that are present;
4. reject remote or escaping imports before an engine sees the source;
5. require WDL 1.0 in the first slice and check container references against
   the digest-pin policy;
6. snapshot sources into a fresh private validation directory;
7. run one configured, identity-checked `miniwdl check` with fixed argv,
   environment, timeout, output bounds, and no task execution;
8. sort, bound, and normalize diagnostics before returning evidence.

The result distinguishes an invalid draft from an operationally unavailable
validator. A syntax error returns a completed validation with `valid: false`;
a missing or changed validator returns `validator_unavailable` and cannot be
mistaken for validation evidence.

The evidence core binds:

- schema version, `draftId`, revision, and `contentDigest`;
- plugin version and validator policy version;
- miniwdl version and approved executable identity;
- ordered checks, normalized diagnostics, `valid`, and truncation facts.

`validationDigest` hashes the canonical evidence core and excludes display
timestamps. Evidence is fresh only when its draft revision and content digest
are still current and its policy and toolchain identities still match the
promotion policy. Promotion will recheck those facts and may rerun validation;
the model cannot provide a validation digest as authority.

## WorkflowGraph v1

Visualization is derived from parsed WDL, never from generated prose. AI may
explain or annotate the graph, but it is not the graph's source of truth.

The UI-neutral graph envelope contains:

- `schemaVersion`, `draftId`, revision, `contentDigest`, WDL version, exact
  workflow name, graph completeness, and `graphDigest`;
- nodes with stable ids, kind, label, source range, optional parent group, and
  typed input/output ports;
- `workflow-input`, `workflow-output`, `declaration`, `call`, `scatter`, and
  `conditional` node kinds;
- data, control, and containment edges with stable ids and explicit endpoints;
- bounded parser, compatibility, and unsupported-syntax diagnostics.

The public parser accepts at most 1 MiB of UTF-8 source and validates the exact
draft id, revision, and content digest. Output is capped at 512 nodes, 2048
edges, 128 diagnostics, and 128 ports per node. Schema-field shortening or
port omission is always accompanied by `complete: false` diagnostics.

The `0.10.0` extractor reads only `main.wdl`. It does not expand either local or
remote imports; every `import` produces an explicit diagnostic and
`complete: false` so a multi-file graph is never presented as complete.

Stable ids derive from canonical AST addresses and source locations, not from
model labels or rendered layout. Layout coordinates, colors, collapsed state,
and AI explanations are presentation data and never enter `graphDigest`.

When syntax is unsupported, the graph returns `complete: false`, preserves the
supported subgraph, emits an explicit diagnostic and source range, and omits
every edge it cannot prove. It must never guess topology. A partial graph is
useful for review but has no validation or promotion authority.

Canvas editing is deferred because WDL expressions, imports, declarations,
scatters, and conditionals do not round-trip losslessly through a basic
node/edge editor. A future canvas action must create a revision-bound source
patch, show the WDL diff, rerun validation, and cross the same write approval.

## Native DSH visualization

The optional browser Client is delivered from the same npm package while the
Host entry remains independent of browser runtime dependencies:

1. `bio_workflows_draft_graph` returns bounded graph JSON in its durable tool
   result.
2. The Client face registers keyed `tool.call.toolview` entries for that graph
   result plus owner-scoped `bio_workflows_run_list` and
   `bio_workflows_run_get` results, and a Workflow Center in the official
   sidebar/overlay slots.
3. The renderer reads only the call arguments and settled result supplied by
   the slot, verifies the revision/digest binding, and renders a read-only graph,
   diagnostics, and exact source coordinates.
4. The renderer never mutates the draft and is never an authority for workflow
   state.
5. Workflow Center actions enqueue natural-language intent on the current DSH
   Session; only the Agent can select tools and cross ordinary approvals.

The run views consume only settled tool-result blocks already authorized by the
current Agent session. They explicitly project bounded lifecycle outcome,
normalized QC, declared output counts, and checksums; they omit absolute Host
paths, owner identity, commands, environment values, and raw logs. They contain
no direct start, retry, cancellation, or cleanup control and therefore do not
replace the deferred owner-scoped Activity projection.

Once the prompt admission correlation gate is satisfied, one bounded native
session projection may fold authoring, fixture-test, and run facts into the
Activity view. It must use stable business ids and replayable Session events;
it must not assign an update to the latest visually open card or expose a new
browser control endpoint.

## Security and reproducibility rules

- Use WDL 1.0 initially; new language versions require explicit compatibility
  gates and fixtures.
- Keep remote imports disabled even for revision-pinned Git/TRS snapshots;
  providers must expose a complete local, digest-verified import closure.
- Require digest-pinned containers before test or promotion.
- Never expose arbitrary shell, environment variables, network options,
  engine flags, host paths, or execution commands in authoring arguments.
- Restrict the authoring Agent to draft/read/validate/graph capabilities;
  testing, promotion, and execution remain distinct tools and approvals.
- Treat WDL comments, README text, imported metadata, and diagnostics as
  untrusted data, not prompt instructions.
- Bound file sizes, histories, diagnostics, validator output, graph nodes and
  edges, model-visible output, test resources, and retained provenance.
- Validation uses a private snapshot and never invokes a WDL task, Docker, or a
  container runtime.
- Drafts never enter the production execution allowlist. Promotion materializes
  a new immutable bundle; it does not mutate a draft into an executable object.

## Delivery order

1. **RFC / issue #13:** contracts and the three discussion choices were
   accepted; the RFC PR was merged before implementation.
2. **`0.8.0` authoring core — complete:** owner-scoped create/get/update plus
   deterministic validation, CAS and recovery tests, and no new executable
   bundle.
3. **`0.8.1` presentations — complete:** replay-safe pending/result summaries
   for all registered tools.
4. **`0.9.0` graph — complete:** JSON Schema, deterministic extraction,
   unsupported-syntax fixtures, and exact revision/digest binding.
5. **`0.10.0` native UI — complete:** same-package browser Client, Workflow
   Center, Agent intent bridge, readiness endpoint, and keyed read-only graph
   card.
6. **Packaged Skill — complete:** register `bio-wdl-authoring` through the
   optional DSH `ctx.skills` service with revision/CAS and authority guidance.
7. **`0.12.0` — implemented and accepted:** dedicated bounded
   draft-test sandbox, declarative fixtures, independent approval, denial
   probes, resource/output limits, owner lifecycle, and real Docker acceptance.
8. Add independent review evidence and immutable promotion with another independent
   approval.
9. **Read-only provider discovery — complete in `0.12.0`:** exact
   Git/TRS revision markers and provider-scoped bundle digests; richer Store UI
   remains separate and grants no execution authority.

The `0.7.0` result and execution MVP is already complete. The sequence above
keeps AI-generated assets outside its production allowlist while making the
Agent useful early.

## Accepted implementation choices

The following bounded defaults were accepted before implementation:

1. Owner scope is the creating DSH Session; cross-session sharing
   and ownership transfer are deferred.
2. Updates are explicit per-file replacements/deletions under dual CAS, while
   each stored revision remains a complete immutable snapshot.
3. The first visualization is the keyed graph tool card; a custom correlated
   Conversation Node comes only after multi-event lifecycle data exists.

Changing any of these choices materially changes persistence, authorization,
or Client scope and requires a new issue/RFC decision.
