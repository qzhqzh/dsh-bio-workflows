# FASTQ quality control

Runs FastQC independently for one or more FASTQ files and returns the HTML and
ZIP reports. Paths in `examples/inputs.json` are placeholders and must be
replaced before a run.

Version 1.1.0 is the executable bundle used by the opt-in miniwdl
adapter. The adapter snapshots approved inputs to safe run-owned filenames,
enforces a restrictive placeholder policy, and requires an already-active
Docker Swarm manager. The bundle passed structural checks, miniwdl `1.15.0`
semantic validation, and a container-backed FastQC acceptance run on
2026-08-25. The sanitized acceptance record ships in
`docs/evidence/fastq-qc-1.1.0-miniwdl-acceptance.json`.
