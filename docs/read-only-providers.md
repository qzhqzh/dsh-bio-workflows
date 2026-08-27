# Revision-pinned read-only providers

Git and TRS providers are local snapshot adapters. The plugin performs no
network request, receives no provider credential, never updates a checkout,
and never writes a provider root. An external operator must synchronize the
snapshot before DSH starts.

## Layout and marker

Each configured root uses the normal bundle layout:

```text
<provider-root>/
  .dsh-provider.json
  <workflow-id>/
    <version>/
      workflow.json
      main.wdl
      ...
```

The bounded, no-follow marker must exactly match configuration:

```json
{
  "schemaVersion": "1",
  "id": "workflow-git",
  "kind": "git",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "readOnly": true
}
```

Git revisions must be full lowercase 40-character commit identities. TRS
revisions must be exact version identifiers. Provider roots must be absolute,
non-overlapping with each other and the writable Store, and non-symlinked.

## Trust and use

Search results have source `git` or `trs`, trust
`revision_pinned_read_only`, exact provider identity, and the normal SHA-256
bundle digest. Resolve, validate, or install operations for these sources must
also name the provider, preventing ambiguity across snapshots.

```json
{
  "id": "fastq-qc",
  "version": "1.2.0",
  "source": "git",
  "provider": "workflow-git",
  "expectedDigest": "sha256:..."
}
```

Installation copies the exact approved bundle into the local Store but still
returns `executionAuthorized: false`. Provider discovery never changes the
production allowlist, resolves remote WDL imports, promotes drafts, or calls
`bio_workflows_run`.
