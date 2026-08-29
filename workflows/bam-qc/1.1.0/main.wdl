version 1.0

task samtools_qc {
  input {
    File bam
    File bai
  }

  command <<<
    set -euo pipefail
    ln -s '~{bam}' alignment.bam
    ln -s '~{bai}' alignment.bam.bai
    samtools quickcheck -v alignment.bam
    samtools index --threads 2 -b alignment.bam rebuilt.bai
    if ! cmp -s alignment.bam.bai rebuilt.bai; then
      echo 'BAI does not byte-match the index rebuilt from BAM by pinned samtools' >&2
      exit 42
    fi
    samtools idxstats alignment.bam > idxstats.txt
    samtools flagstat --threads 2 alignment.bam > flagstat.txt
    samtools stats --threads 2 alignment.bam > stats.txt
  >>>

  output {
    File flagstat_report = "flagstat.txt"
    File stats_report = "stats.txt"
    File idxstats_report = "idxstats.txt"
  }

  runtime {
    docker: "quay.io/biocontainers/samtools:1.20--h50ea8bc_0@sha256:d0ebd10e887e3ddd02d071f1ca7b649dc90dc6fb99a5ffd0f5ebf8611a1f92cc"
    cpu: 2
    memory: "4 GiB"
  }
}

workflow bam_qc {
  input {
    File bam
    File bai
  }

  call samtools_qc {
    input:
      bam = bam,
      bai = bai
  }

  output {
    File flagstat_report = samtools_qc.flagstat_report
    File stats_report = samtools_qc.stats_report
    File idxstats_report = samtools_qc.idxstats_report
  }
}
