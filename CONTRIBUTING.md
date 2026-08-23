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
node --test --experimental-test-coverage test/*.test.mjs
npm run pack:check
```

Also verify package self-references for every public subpath and inspect the npm
tarball allowlist. Public schema or API changes require a compatibility review.

## Version synchronization

When bumping the package version, keep these values aligned:

- `package.json` version;
- `PACKAGE_VERSION` in `src/info.js`;
- the versioned JSON Schema `$id`;
- README schema URL and release description;
- `CHANGELOG.md`.
