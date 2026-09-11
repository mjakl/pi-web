import { schemaType, toolParameters } from "@core/tools";
import { describe, expect, it } from "vitest";

describe("schema types", () => {
  it("names the plain ones and arrays of them", () => {
    expect(schemaType({ type: "string" })).toBe("string");
    expect(schemaType({ type: "array", items: { type: "number" } })).toBe(
      "number[]",
    );
    expect(schemaType({ type: "array" })).toBe("unknown[]");
  });

  it("joins a union, deduplicated", () => {
    expect(
      schemaType({
        anyOf: [{ type: "string" }, { type: "number" }, { type: "string" }],
      }),
    ).toBe("string | number");
    expect(schemaType({ type: ["string", "null"] })).toBe("string | null");
  });

  it("shows a const as its value and a bare enum by its members' types", () => {
    expect(schemaType({ const: "edit" })).toBe('"edit"');
    expect(schemaType({ enum: ["a", "b", 1] })).toBe("string | number");
  });

  it("takes the last segment of a $ref", () => {
    expect(schemaType({ $ref: "#/definitions/EditInput" })).toBe("EditInput");
  });

  it("says unknown rather than guessing", () => {
    expect(schemaType({})).toBe("unknown");
    expect(schemaType(null)).toBe("unknown");
  });
});

describe("tool parameters", () => {
  it("reads names, requiredness, descriptions, enums and defaults", () => {
    expect(
      toolParameters({
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "Absolute path" },
          mode: { type: "string", enum: ["read", "write"], default: "read" },
        },
      }),
    ).toEqual([
      {
        name: "path",
        required: true,
        type: "string",
        description: "Absolute path",
      },
      {
        name: "mode",
        required: false,
        type: "string",
        enum: ['"read"', '"write"'],
        default: '"read"',
      },
    ]);
  });

  it("has nothing to show for a schema without properties", () => {
    expect(toolParameters({ type: "object" })).toEqual([]);
    expect(toolParameters(undefined)).toEqual([]);
  });
});
