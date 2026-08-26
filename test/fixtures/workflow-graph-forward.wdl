version 1.0

task echo_value {
  input { String value }
  command <<< echo '~{value}' >>>
  output { String result = value }
}

workflow graph_forward {
  String first = later
  call echo_value { input: value = first }
  String later = "ready"
  output { String result = echo_value.result }
}
