---
name: bio-wdl-authoring
description: Author or repair reviewable WDL drafts through dsh-bio-workflows deterministic, revision-bound tools. Use for bioinformatics workflow drafting, validation repair, graph inspection, Mission authoring, or an explicitly requested isolated fixture trial.
---

# Bio WDL authoring

Turn the user's bioinformatics intent into an exact, reviewable WDL draft while
keeping generation, validation, isolated testing, promotion, and production
execution as separate authorities.

## Choose the narrowest path

- For one or two explicit edits, use the owner-scoped draft tools directly.
- For a bounded autonomous repair loop, prepare a Mission and show its exact
  objectives, acceptance criteria, software/container identities, and budgets
  before starting it. Mission approval authorizes only draft creation, CAS
  updates, and deterministic validation.
- Start an isolated fixture test only when the user explicitly asks for it and
  approves the exact test plan. A Mission approval never authorizes a test.

## Authoring loop

1. Clarify the workflow inputs, outputs, reference data, task resources, WDL
   version, and digest-pinned task containers. Do not invent host paths,
   credentials, remote imports, floating image tags, shell fragments, or
   production authority.
2. Create the draft, then retain its `draftId`, `revision`, and
   `contentDigest` from the tool result.
3. Read the exact revision before editing. Every update must use both
   `expectedRevision` and `expectedContentDigest`; on conflict, stop and reload
   rather than overwriting newer work.
4. Make a bounded source patch. Keep imports local and inside the draft. Treat
   tool diagnostics as facts and model explanations as suggestions.
5. Validate the exact revision. Repair only concrete bounded diagnostics, then
   validate again. A validator outage or identity drift is not a WDL error and
   must fail closed.
6. Generate `WorkflowGraph v1` for the same exact revision when a visual review
   is useful. A partial graph must retain its diagnostics; never guess omitted
   edges or treat layout as authoritative.

## Isolated fixture trial

Use `bio_workflows_draft_test_prepare` only for a ready Mission revision and an
immutable configured fixture. Present the exact plan digest, draft/revision,
content and validation digests, fixture digest, runner/container identities,
assertions, and budgets before `bio_workflows_draft_test_start`.

After start, use get/report for bounded evidence and cancel when requested.
Never substitute `bio_workflows_run`, install the draft, mutate the production
allowlist, or claim that isolated evidence grants production execution.

## Report truthfully

State the exact terminal boundary reached:

- validation success: `ready_for_isolated_test` only;
- isolated fixture success: evidence for the exact approved trial only;
- `Software Trial Report v1.success` remains `false` under this package
  boundary;
- no draft is promoted, allowlisted, or production-executable by this skill.

Include the exact revision and digests needed for human review. If a required
identity, approval, or evidence binding is missing or stale, stop rather than
infer authority.
