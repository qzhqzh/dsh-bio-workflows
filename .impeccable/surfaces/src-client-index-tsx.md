---
primaryTarget: src/client/index.tsx
relatedTargets:
  - src/client/WorkflowCenter.tsx
  - src/client/WorkflowGraphView.tsx
  - src/client/styles.ts
  - src/client/types.ts
---

# Workflow Center surface brief

## Purpose

Give bioinformaticians a visible, low-friction entry into the plugin without
creating a second control plane. Users discover workflows, start AI-assisted
WDL drafting, inspect runs, and diagnose setup from one native Harness panel.
Every material action is submitted as a request to the current Harness Agent;
the ordinary tool, approval, owner-scope, CAS, and execution policies remain
authoritative.

## Composition

- Use composition A from `.impeccable/mocks/workflow-center-options.png`.
- Register one `sidebar.footer.action` trigger and one `shell.overlay` surface.
- Inside the overlay use a compact four-item navigation rail, a broad main
  workspace, and a contextual inspector. Collapse the inspector beneath the
  main content on narrow screens.
- Analyze data is a dense searchable row list, not a grid of equal cards. Show
  accepted inputs, produced outputs, and execution availability in the scan path.
- Build workflow begins with an analysis brief: biological question, input data
  and types, desired outputs, constraints, and acceptance criteria. The Agent
  proposes internal draft naming; exact lifecycle identities stay in an advanced
  disclosure until the reviewed lifecycle projection contract's upstream
  correlation and freshness gates are satisfied.
- Activity prioritizes recent owner-scoped runs through the Agent. Exact run-id
  lookup is advanced. Setup is a secondary utility with one overall result and
  first actionable blocker; the full readiness list stays collapsed under
  operator details.
- The keyed `bio_workflows_draft_graph` tool view renders an actual read-only
  WorkflowGraph result; no decorative or guessed graph is shown as evidence.
- Keyed `bio_workflows_run_list` and `bio_workflows_run_get` views lead with
  lifecycle outcome, normalized technical QC, and declared checksummed outputs.
  Exact provenance and bounded file evidence are progressive; Host paths,
  owner identity, commands, environment values, and raw logs stay out of the
  card. Result views never add retry or execution controls.

## Visual world

- Inherit DeepSeek Harness tokens, typography, spacing rhythm, and dark/light
  themes. The plugin has no separate logo or brand palette.
- Keep the Workflow Center's outer surface opaque even when a host skin uses a
  transparent base-background token; retain the host tint over an opaque base.
- The signature motif is a restrained assay/workflow lane: fine tracks,
  compact status marks, and clearly typed WDL nodes.
- Use modest blue-violet only for primary interaction and selected state;
  success, warning, and error use host semantic tokens.
- No gradients, glass effects, giant titles, nested cards, emoji icons, or
  arbitrary shadows. SVG icons use one consistent 1.5 px stroke.

## Interaction and trust

- Buttons say the user outcome: `Prepare analysis`, `Check workflow package`,
  `Build workflow draft`, `Show graph`, `Show recent runs`, and `Diagnose setup`.
- Present scientific fit and declared input/output metadata before trust, engine,
  WDL version, and digest details. Technical details use progressive disclosure.
- Explain package checks before action: they validate descriptor shape, file
  digests, local imports, WDL declarations, example JSON, and container pins;
  they do not execute a workflow.
- Keep every accepted Agent handoff visible with its subject, requested action,
  queued state, and a clear way to continue in the current Harness task.
- Loading, empty, error, success, hover, disabled, focus-visible, and reduced
  motion states are required.
- Draft mutation prompts include the exact revision/digest baseline rule.
  Conflicts stop the flow; never imply autosave or last-write-wins.
- Graph cards verify draft id, revision, and digest shape before rendering.
- Owner-scoped drafts and runs are never fetched from an unauthenticated
  browser endpoint; the current Agent retrieves them through tools.

## Responsive and accessible behavior

- Desktop target: 1280–1600 px. Narrow target: 390 px.
- At narrow widths the nav becomes a horizontal tab row, the inspector moves
  below content, tables become stacked rows, and the overlay uses the full
  viewport.
- Maintain 4.5:1 body text contrast, 44 px touch targets where space permits,
  visible keyboard focus, labelled controls, semantic headings, and an SVG
  title/description plus a textual graph summary.
