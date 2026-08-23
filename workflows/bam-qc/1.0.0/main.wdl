version 1.0

task samtools_qc {
  input {
    File bam
    Int threads = 2
  }

  command <<<
    samtools flagstat --threads ~{threads} ~{bam} > flagstat.txt
    samtools stats --threads ~{threads} ~{bam} > stats.txt
  >>>

  output {
    File flagstat_report = "flagstat.txt"
    File stats_report = "stats.txt"
  }

  runtime {
    docker: "quay.io/biocontainers/samtools:1.20--h50ea8bc_0@sha256:d0ebd10e887e3ddd02d071f1ca7b649dc90dc6fb99a5ffd0f5ebf8611a1f92cc"
    cpu: threads
    memory: "4 GiB"
  }
}

workflow bam_qc {
  input {
    File bam
    Int threads = 2
  }

  call samtools_qc {
    input:
      bam = bam,
      threads = threads
  }

  output {
    File flagstat_report = samtools_qc.flagstat_report
    File stats_report = samtools_qc.stats_report
  }
}
