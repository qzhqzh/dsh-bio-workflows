# BAM quality control

Runs bounded technical checks for one BAM file and its adjacent BAI index. The
paths in `examples/inputs.json` are placeholders and must be replaced before a
run.

Version 1.1.0 is an immutable production-admission candidate. Planning binds
the canonical BAM and BAI identities, optional pre-approval SHA-256 digests,
the pinned container, an internal per-run network, and fixed compute limits.
The task uses the pinned samtools 1.20 image to run `quickcheck`, rebuild a BAI,
and require a byte-for-byte match with the submitted index before running
`idxstats`. This rejects corrupt, stale, or mismatched inputs before producing
`flagstat`, `stats`, and `idxstats` reports. The strict byte match intentionally
defines one canonical index representation for this candidate revision.

The plugin confines every declared output to the run directory, hashes it
without following a replacement target, and publishes bounded technical counts
in `BioWorkflowResult v1`. A completed result describes execution and file QC;
it does not establish biological significance or downstream suitability.
