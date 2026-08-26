version 1.0

task legacy_echo {
  command <<< echo '~{value}' >>>
  String value
  output { String result = value }
}

workflow graph_legacy_inputs {
  String value
  call legacy_echo { input: value = value }
  output { String result = legacy_echo.result }
}
