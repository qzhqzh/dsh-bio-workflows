# FASTQ quality control

Runs FastQC independently for one or more FASTQ files and returns HTML, ZIP,
and extracted plain-text summary reports. Paths in `examples/inputs.json` are
placeholders and must be replaced before a run.

Version 1.2.0 keeps the pinned FastQC container and execution policy from
1.1.0, and adds declared `summary.txt` outputs for bounded host-side parsing.
The plugin never extracts FastQC ZIP archives on the host. Every declared file
artifact is confined to the run directory and receives a streaming SHA-256
digest in `BioWorkflowResult v1`.
