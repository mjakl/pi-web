import type { ToolParameter } from "./ports.ts";

// A tool's parameters, read out of the JSON Schema its definition carries.
// Only what a reader can act on is rendered: the name, whether it is
// required, a readable type, and whatever the schema says about allowed or
// default values.

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `string`, `string[]`, `"a" | "b"`, or `unknown` when the schema says nothing. */
export function schemaType(schema: unknown): string {
  const node = record(schema);
  if (!node) return "unknown";
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = node[key];
    if (Array.isArray(branches)) {
      const names = [...new Set(branches.map(schemaType))];
      return names.join(" | ");
    }
  }
  if ("const" in node) return stringify(node["const"]);
  const type = node["type"];
  if (typeof type === "string") {
    if (type === "array") {
      const items = node["items"];
      return items === undefined ? "unknown[]" : `${schemaType(items)}[]`;
    }
    return type;
  }
  if (Array.isArray(type)) return type.map(String).join(" | ");
  const values = node["enum"];
  if (Array.isArray(values)) {
    return [...new Set(values.map((value) => typeof value))].join(" | ");
  }
  const reference = node["$ref"];
  if (typeof reference === "string") {
    return reference.split("/").at(-1) ?? "unknown";
  }
  return "unknown";
}

export function toolParameters(schema: unknown): ToolParameter[] {
  const node = record(schema);
  const properties = record(node?.["properties"]);
  if (!properties) return [];
  const requiredList = node?.["required"];
  const required = new Set(
    Array.isArray(requiredList) ? requiredList.map(String) : [],
  );
  return Object.entries(properties).map(([name, value]) => {
    const field = record(value) ?? {};
    const description = field["description"];
    const values = field["enum"];
    const fallback = field["default"];
    return {
      name,
      required: required.has(name),
      type: schemaType(field),
      ...(typeof description === "string" ? { description } : {}),
      ...(Array.isArray(values) ? { enum: values.map(stringify) } : {}),
      ...(fallback === undefined ? {} : { default: stringify(fallback) }),
    };
  });
}
