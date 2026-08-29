import bamQc100 from '../workflows/bam-qc/1.0.0/workflow.json' with { type: 'json' }
import fastqQc100 from '../workflows/fastq-qc/1.0.0/workflow.json' with { type: 'json' }
import fastqQc110 from '../workflows/fastq-qc/1.1.0/workflow.json' with { type: 'json' }
import fastqQc120 from '../workflows/fastq-qc/1.2.0/workflow.json' with { type: 'json' }

const BUILTIN_MANIFESTS = new Map(
  [bamQc100, fastqQc100, fastqQc110, fastqQc120].map((descriptor) => [
    `${descriptor.manifest.id}@${descriptor.manifest.version}`,
    descriptor.manifest,
  ]),
)

export function getBuiltinWorkflowFit(workflow) {
  const manifest = BUILTIN_MANIFESTS.get(`${workflow.id}@${workflow.version}`)
  if (manifest === undefined) return null
  return { inputs: manifest.inputs, outputs: manifest.outputs }
}
