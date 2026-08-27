# Contributing

## Workflow

- Keep `main` releasable and use short-lived `feature/*` or `fix/*` branches.
- Use Conventional Commits such as `feat:`, `fix:`, `docs:`, and `test:`.
- Keep manifest registration and declaration-only preflight free of filesystem,
  network, subprocess, and workflow execution side effects.
- Keep Workflow Store writes confined to the configured root, non-overwriting,
  disabled by default, and behind a DSH approval decision.
- Keep revisioned authoring roots process-owned, private, and protected against
  ancestor replacement; do not imply this new 0.8 invariant retroactively for
  the legacy install/scaffold storage contract.
- Keep workflow execution disabled by default, built-in-allowlisted, bound to
  exact bundle and plan digests, owner-scoped, and routed through the DSH
  subprocess/jobs seams without shell interpolation.
- Treat npm publishing, remote creation, push, and tagging as separate actions.

## Required checks

Run before committing a release candidate:

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
```

Fixture-runner changes additionally require the real, source-bound acceptance
with the pinned miniwdl 1.15.0 environment, digest-pinned images, Docker
executable, and private run root documented in
`docs/isolated-fixture-runner.md`:

```bash
npm run accept:draft-fixture-runner
```

The integration test verifies the registry-ready tool schemas and fail-closed
argument validation. The pack smoke test installs the produced tarball in an
isolated temporary consumer and loads every public subpath. Public schema or API
changes require a compatibility review.

The GitHub Actions workflow installs the pinned DSH CLI and runs the isolated
profile smoke. Locally, run it when the DSH CLI is installed:

```bash
npm run smoke:dsh
```

This installs the tarball in an isolated profile, imports and applies the
installed plugin, checks all twenty-seven tool contracts, loads all four versioned
built-in WDL bundles, and boots the real DSH headless help path.
The Agent-loop smoke additionally drives draft create/get/update/validate/graph
with two mutation approvals before the existing search/plan/run and
owner-disposal lifecycle. The Playwright check covers desktop catalog actions,
narrow viewport overflow, and keyboard-selectable graph nodes.

The CI WDL job also installs exact `miniwdl==1.15.0` and checks all built-in
entrypoints. Expanding the executable allowlist additionally requires a real
container-backed success and cancellation record for each new workflow.
Changes to result collection or a currently executable WDL revision also require
the real `accept:fastq-qc-result` check with explicit safe miniwdl and Docker
executable paths.

## Version synchronization

When bumping the package version, keep these values aligned:

- `package.json` version;
- `PACKAGE_VERSION` in `src/info.js`;
- all versioned JSON Schema `$id` values;
- README schema URL and release description;
- `CHANGELOG.md`.
