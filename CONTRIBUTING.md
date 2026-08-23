# Contributing

## Workflow

- Keep `main` releasable and use short-lived `feature/*` or `fix/*` branches.
- Use Conventional Commits such as `feat:`, `fix:`, `docs:`, and `test:`.
- Keep manifest registration and declaration-only preflight free of filesystem,
  network, subprocess, and workflow execution side effects.
- Treat npm publishing, remote creation, push, and tagging as separate actions.

## Required checks

Run before committing a release candidate:

```bash
npm test
npm run test:coverage
npm run pack:check
npm run smoke:pack
```

The integration test compiles tool definitions with the real DSH peer. The pack
smoke test installs the produced tarball in an isolated temporary consumer and
loads every public subpath. Public schema or API changes require a compatibility
review.

## Version synchronization

When bumping the package version, keep these values aligned:

- `package.json` version;
- `PACKAGE_VERSION` in `src/info.js`;
- the versioned JSON Schema `$id`;
- README schema URL and release description;
- `CHANGELOG.md`.
