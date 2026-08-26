version 1.0

struct sample {
  String value
}

workflow graph_references {
  input {
    Boolean cond
    String foo
    String bar = foo
    Pair[Pair[String, String], String] nested_pair
    sample first sample second
  }

  Map[String, String] payload = object { foo: "literal" }
  Map[String, String] conditional_payload = if cond then { foo: "x" } else { bar: "y" }
  String struct_value = first.value
  String nested = nested_pair.left.left
}
