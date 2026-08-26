version 1.0

task fastqc_one {
  input {
    File read
    Int threads = 2
  }

  command <<<
    mkdir -p output
    fastqc --extract --threads '~{threads}' --outdir output '~{read}'
  >>>

  output {
    Array[File] html_reports = glob("output/*_fastqc.html")
    Array[File] zip_reports = glob("output/*_fastqc.zip")
    Array[File] summary_reports = glob("output/*_fastqc/summary.txt")
  }

  runtime {
    docker: "quay.io/biocontainers/fastqc:0.12.1--hdfd78af_0@sha256:e194048df39c3145d9b4e0a14f4da20b59d59250465b6f2a9cb698445fd45900"
    cpu: threads
    memory: "4 GiB"
  }
}

workflow fastq_qc {
  input {
    Array[File]+ reads
    Int threads = 2
  }

  scatter (read in reads) {
    call fastqc_one {
      input:
        read = read,
        threads = threads
    }
  }

  output {
    Array[File] html_reports = flatten(fastqc_one.html_reports)
    Array[File] zip_reports = flatten(fastqc_one.zip_reports)
    Array[File] summary_reports = flatten(fastqc_one.summary_reports)
  }
}
