version 1.0

workflow graph_interpolation {
  input {
    String sample
  }

  String label = "sample_~{sample}"

  output {
    String result = label
  }
}
