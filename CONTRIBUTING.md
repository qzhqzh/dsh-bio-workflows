# Contributing

## Workflow

- Keep `main` releasable and use short-lived `feature/*` or `fix/*` branches.
- Use Conventional Commits such as `feat:`, `fix:`, `docs:`, and `test:`.
- Keep manifest registration and declaration-only preflight free of filesystem,
  network, subprocess, and workflow execution side effects.
- Keep Workflow Store writes confined to the configured root, non-overwriting,
  disabled by default, and behind a DSH approval decision.
- Treat npm publishing, remote creation, push, and tagging as separate actions.

## Required checks

Run before committing a release candidate:

```bash
npm test
npm run test:coverage
npm run pack:check
npm run smoke:pack
```

The integration test verifies the registry-ready tool schemas and fail-closed
argument validation. The pack smoke test installs the produced tarball in an
isolated temporary consumer and loads every public subpath. Public schema or API
changes require a compatibility review.

When the DSH CLI is installed, also run an isolated profile smoke test:

```bash
npm run smoke:dsh
```

This installs the tarball in an isolated profile, imports and applies the
installed plugin, checks all eight tool contracts, loads both built-in WDL
bundles, and boots the real DSH headless help path.

## Version synchronization

When bumping the package version, keep these values aligned:

- `package.json` version;
- `PACKAGE_VERSION` in `src/info.js`;
- both versioned JSON Schema `$id` values;
- README schema URL and release description;
- `CHANGELOG.md`.
