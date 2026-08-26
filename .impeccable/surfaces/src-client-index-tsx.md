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
- Workflows is a dense searchable row list, not a grid of equal cards.
- AI Drafts and Runs are focused action workbenches. Setup is a readiness list.
- The keyed `bio_workflows_draft_graph` tool view renders an actual read-only
  WorkflowGraph result; no decorative or guessed graph is shown as evidence.

## Visual world

- Inherit DeepSeek Harness tokens, typography, spacing rhythm, and dark/light
  themes. The plugin has no separate logo or brand palette.
- The signature motif is a restrained assay/workflow lane: fine tracks,
  compact status marks, and clearly typed WDL nodes.
- Use modest blue-violet only for primary interaction and selected state;
  success, warning, and error use host semantic tokens.
- No gradients, glass effects, giant titles, nested cards, emoji icons, or
  arbitrary shadows. SVG icons use one consistent 1.5 px stroke.

## Interaction and trust

- Buttons say the real next action: `Ask Agent to validate`, `Create with
  Agent`, `Show graph`, `List my runs`, and `Diagnose setup`.
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
