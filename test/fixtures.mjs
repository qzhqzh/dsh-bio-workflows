export function makeManifest(overrides = {}) {
  return {
    schemaVersion: '1',
    id: 'fastq-qc',
    version: '1.2.0',
    name: 'FASTQ quality control',
    summary: 'Collect quality metrics for paired-end FASTQ files.',
    status: 'ready',
    engine: {
      name: 'nextflow',
      version: '24.04',
    },
    inputs: [
      {
        id: 'reads',
        type: 'file',
        required: true,
        cardinality: 'many',
        description: 'Paired-end FASTQ files.',
      },
    ],
    outputs: [
      {
        id: 'report',
        type: 'directory',
        description: 'Quality-control report directory.',
      },
    ],
    tags: ['fastq', 'qc'],
    ...overrides,
  }
}
