import { describe, expect, it } from "vitest";
import { checkSupportedSchema } from "../src/subset.js";

const ROOT_INVALID = 'schema must be a JSON Schema object with type "object" and "properties"';

describe("checkSupportedSchema — root shape", () => {
  it("rejects non-object / missing type object / missing properties", () => {
    expect(checkSupportedSchema(null)).toEqual({ ok: false, errors: [ROOT_INVALID] });
    expect(checkSupportedSchema("nope")).toEqual({ ok: false, errors: [ROOT_INVALID] });
    expect(checkSupportedSchema({})).toEqual({ ok: false, errors: [ROOT_INVALID] });
    expect(checkSupportedSchema({ properties: { a: { type: "string" } } })).toEqual({
      ok: false,
      errors: [ROOT_INVALID],
    });
    expect(checkSupportedSchema({ type: "object" })).toEqual({ ok: false, errors: [ROOT_INVALID] });
  });
});

describe("checkSupportedSchema — supported subset", () => {
  const full = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["title", "rating", "tags"],
    properties: {
      title: {
        type: "string",
        description: "Book title",
        minLength: 2,
        maxLength: 100,
        pattern: "^[\\w :'-]+$",
        default: "untitled",
      },
      rating: { type: "integer", description: "1-5", minimum: 1, maximum: 5 },
      price: { type: "number", minimum: 0 },
      read: { type: "boolean" },
      severity: { type: "string", enum: ["low", "medium", "high"] },
      tags: { type: "array", items: { type: "string" }, description: "free tags" },
      scores: { type: "array", items: { type: "number" } },
      genres: { type: "array", items: { type: "string", enum: ["scifi", "fantasy", "noir"] } },
      opts: {
        type: "object",
        description: "extra options",
        properties: {
          note: { type: "string" },
          loud: { type: "boolean" },
          level: { type: "integer", minimum: 0 },
          mode: { type: "string", enum: ["a", "b"] },
          labels: { type: "array", items: { type: "string" } },
        },
        required: ["note"],
      },
      format_ignored: { type: "string", format: "email" },
      title_meta: { type: "string", title: "ignored meta" },
    },
    additionalProperties: false,
  };

  it("accepts the full supported subset and echoes the same schema", () => {
    const result = checkSupportedSchema(full);
    expect(result).toEqual({ ok: true, schema: full });
    expect(result.ok && result.schema === full).toBe(true);
  });

  it("ignores title, format, $schema and unknown extra keys", () => {
    const r = checkSupportedSchema({
      type: "object",
      whatever: { deep: [1, 2] },
      properties: { a: { type: "string", unknownKeyword: true, title: "A" } },
    });
    expect(r.ok).toBe(true);
  });
});

describe("checkSupportedSchema — rejects with path-qualified keyword errors", () => {
  const cases: Array<[unknown, string[]]> = [
    [{ type: "object", properties: { a: { type: "string" } }, oneOf: [{ type: "string" }] }, ['schema: unsupported keyword "oneOf"']],
    [{ type: "object", properties: { a: { type: "string" } }, anyOf: [{}] }, ['schema: unsupported keyword "anyOf"']],
    [{ type: "object", properties: { a: { type: "string" } }, allOf: [{}] }, ['schema: unsupported keyword "allOf"']],
    [{ type: "object", properties: { a: { type: "string" } }, not: {} }, ['schema: unsupported keyword "not"']],
    [{ type: "object", properties: { a: { type: "string" } }, patternProperties: { "^x": { type: "string" } } }, ['schema: unsupported keyword "patternProperties"']],
    [{ type: "object", properties: { a: { type: "string", $ref: "#/$defs/x" } } }, ['properties.a: unsupported keyword "$ref"']],
    [{ type: "object", properties: { tags: { type: "string", oneOf: [{}, {}] } } }, ['properties.tags: unsupported keyword "oneOf"']],
    [{ type: "object", properties: { a: { type: "string" } }, if: {} }, ['schema: unsupported keyword "if"']],
    [{ type: "object", properties: { a: { type: "string" } }, then: {} }, ['schema: unsupported keyword "then"']],
    [{ type: "object", properties: { a: { type: "string" } }, else: {} }, ['schema: unsupported keyword "else"']],
    [{ type: "object", properties: { a: { type: "string" } }, propertyNames: {} }, ['schema: unsupported keyword "propertyNames"']],
    [{ type: "object", properties: { a: { type: "string", multipleOf: 2 } } }, ['properties.a: unsupported keyword "multipleOf"']],
    [{ type: "object", properties: { a: { type: "array", items: { type: "string" }, uniqueItems: true } } }, ['properties.a: unsupported keyword "uniqueItems"']],
    [{ type: "object", properties: { a: { type: "array", items: { type: "string" }, minItems: 1 } } }, ['properties.a: unsupported keyword "minItems"']],
    [{ type: "object", properties: { a: { type: "array", items: { type: "string" }, maxItems: 5 } } }, ['properties.a: unsupported keyword "maxItems"']],
  ];
  it.each(cases)("rejects %j", (schema, errors) => {
    expect(checkSupportedSchema(schema)).toEqual({ ok: false, errors });
  });

  it("rejects nested objects that carry unsupported keywords", () => {
    expect(
      checkSupportedSchema({
        type: "object",
        properties: { opts: { type: "object", properties: { b: { type: "string", anyOf: [] } } } },
      })
    ).toEqual({ ok: false, errors: ['properties.opts.properties.b: unsupported keyword "anyOf"'] });
    expect(
      checkSupportedSchema({
        type: "object",
        properties: { opts: { type: "object", oneOf: [], properties: {} } },
      })
    ).toEqual({ ok: false, errors: ['properties.opts: unsupported keyword "oneOf"'] });
  });
});

describe("checkSupportedSchema — arrays", () => {
  it("rejects array items that are arrays, and tables without properties", () => {
    expect(
      checkSupportedSchema({ type: "object", properties: { list: { type: "array", items: { type: "object" } } } })
    ).toEqual({ ok: false, errors: ['properties.list.items: table items require "properties"'] });
    expect(
      checkSupportedSchema({ type: "object", properties: { list: { type: "array", items: { type: "array" } } } })
    ).toEqual({ ok: false, errors: ['properties.list: unsupported array items type "array"'] });
  });

  it("rejects arrays without items and items without type or enum", () => {
    expect(checkSupportedSchema({ type: "object", properties: { list: { type: "array" } } })).toEqual({
      ok: false,
      errors: ['properties.list: array requires "items"'],
    });
    expect(
      checkSupportedSchema({ type: "object", properties: { list: { type: "array", items: {} } } })
    ).toEqual({ ok: false, errors: ["properties.list: array items require a type or enum"] });
  });
});

describe("checkSupportedSchema — nesting depth", () => {
  it("rejects nested objects deeper than one level", () => {
    expect(
      checkSupportedSchema({
        type: "object",
        properties: {
          opts: { type: "object", properties: { inner: { type: "object", properties: { x: { type: "string" } } } } },
        },
      })
    ).toEqual({
      ok: false,
      errors: ["properties.opts.properties.inner: nested objects are only supported one level deep"],
    });
  });

  it("rejects nested objects without properties", () => {
    expect(checkSupportedSchema({ type: "object", properties: { opts: { type: "object" } } })).toEqual({
      ok: false,
      errors: ['properties.opts: object requires "properties"'],
    });
  });
});

describe("checkSupportedSchema — enums and required", () => {
  it("rejects non-string or empty enum values", () => {
    expect(
      checkSupportedSchema({ type: "object", properties: { sev: { type: "string", enum: [1, 2] } } })
    ).toEqual({ ok: false, errors: ["properties.sev: enum values must be non-empty strings"] });
    expect(
      checkSupportedSchema({ type: "object", properties: { sev: { type: "string", enum: [] } } })
    ).toEqual({ ok: false, errors: ["properties.sev: enum values must be non-empty strings"] });
    expect(
      checkSupportedSchema({
        type: "object",
        properties: { g: { type: "array", items: { type: "string", enum: ["a", 2] } } },
      })
    ).toEqual({ ok: false, errors: ["properties.g: enum values must be non-empty strings"] });
  });

  it("rejects required entries referencing unknown properties", () => {
    expect(
      checkSupportedSchema({ type: "object", properties: { a: { type: "string" } }, required: ["bogus"] })
    ).toEqual({ ok: false, errors: ['required: unknown property "bogus"'] });
  });
  it("rejects invalid pattern regex, reserved property names, non-array required and const", () => {
    expect(checkSupportedSchema({ type: "object", properties: { x: { type: "string", pattern: "[" } } })).toEqual({
      ok: false,
      errors: ["properties.x: pattern is not a valid regular expression"],
    });
    expect(checkSupportedSchema({ type: "object", properties: { constructor: { type: "string" } } })).toEqual({
      ok: false,
      errors: ['properties.constructor: reserved property name "constructor"'],
    });
    expect(
      checkSupportedSchema(
        JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}')
      )
    ).toEqual({
      ok: false,
      errors: ['properties.__proto__: reserved property name "__proto__"'],
    });
    expect(checkSupportedSchema({ type: "object", properties: { a: { type: "string" } }, required: "a" })).toEqual({
      ok: false,
      errors: ["required must be an array of strings"],
    });
    expect(checkSupportedSchema({ type: "object", properties: { a: { type: "string", const: "yes" } } })).toEqual({
      ok: false,
      errors: ['properties.a: unsupported keyword "const"'],
    });
  });
  it("rejects non-numeric constraint values and misused enum", () => {
    expect(checkSupportedSchema({ type: "object", properties: { x: { type: "string", minLength: "3" } } })).toEqual({
      ok: false,
      errors: ["properties.x: minLength must be a number"],
    });
    expect(checkSupportedSchema({ type: "object", properties: { x: { type: "string", pattern: 123 } } })).toEqual({
      ok: false,
      errors: ["properties.x: pattern must be a string"],
    });
    expect(checkSupportedSchema({ type: "object", properties: { x: { type: "number", minimum: "1" } } })).toEqual({
      ok: false,
      errors: ["properties.x: minimum must be a number"],
    });
    expect(checkSupportedSchema({ type: "object", properties: { x: { type: "number", enum: [1, 2] } } })).toEqual({
      ok: false,
      errors: ["properties.x: enum is only supported on string type"],
    });
  });
});

describe("checkSupportedSchema — property types", () => {
  it("rejects unsupported and non-single types", () => {
    expect(checkSupportedSchema({ type: "object", properties: { x: { type: "null" } } })).toEqual({
      ok: false,
      errors: ['properties.x: unsupported type "null"'],
    });
    expect(
      checkSupportedSchema({ type: "object", properties: { x: { type: ["string", "null"] } } })
    ).toEqual({ ok: false, errors: ["properties.x: type must be a single supported type"] });
    expect(checkSupportedSchema({ type: "object", properties: { x: {} } })).toEqual({
      ok: false,
      errors: ["properties.x: type must be a single supported type"],
    });
  });

  it("rejects schema-valued additionalProperties", () => {
    expect(
      checkSupportedSchema({
        type: "object",
        properties: { a: { type: "string" } },
        additionalProperties: { type: "string" },
      })
    ).toEqual({ ok: false, errors: ["schema: additionalProperties must be a boolean"] });
    expect(
      checkSupportedSchema({
        type: "object",
        properties: {
          opts: { type: "object", properties: { b: { type: "string" } }, additionalProperties: { type: "string" } },
        },
      })
    ).toEqual({ ok: false, errors: ["properties.opts: additionalProperties must be a boolean"] });
  });
});

describe("checkSupportedSchema — tables (arrays of objects)", () => {
  const tableItems = {
    type: "object",
    properties: {
      environment: { type: "string", enum: ["staging", "canary", "production"] },
      go_live: { type: "string", description: "Go-live date" },
      notify: { type: "boolean" },
    },
    required: ["environment"],
  };

  it("accepts an array of flat objects as a table", () => {
    const r = checkSupportedSchema({
      type: "object",
      properties: { rows: { type: "array", items: tableItems } },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a table inside a nested object (fieldset)", () => {
    const r = checkSupportedSchema({
      type: "object",
      properties: {
        plan: { type: "object", properties: { rows: { type: "array", items: tableItems } } },
      },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a nested object or array inside table cells", () => {
    const r = checkSupportedSchema({
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { deep: { type: "object", properties: { x: { type: "string" } } } },
          },
        },
      },
    });
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors[0]).toContain("properties.rows.items.properties.deep");
  });

  it("rejects an items object without properties", () => {
    const r = checkSupportedSchema({
      type: "object",
      properties: { rows: { type: "array", items: { type: "object" } } },
    });
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors.join("\n")).toContain("properties.rows.items");
  });

  it("rejects reserved names as table columns", () => {
    const r = checkSupportedSchema({
      type: "object",
      properties: {
        rows: { type: "array", items: { type: "object", properties: { constructor: { type: "string" } } } },
      },
    });
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors.join("\n")).toContain("constructor");
  });

  it("rejects rejected keywords inside items objects", () => {
    const r = checkSupportedSchema({
      type: "object",
      properties: {
        rows: { type: "array", items: { type: "object", properties: { a: { type: "string" } }, oneOf: [] } },
      },
    });
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors.join("\n")).toContain("oneOf");
  });

  it("accepts structurally valid default rows, rejects bad ones", () => {
    const ok = checkSupportedSchema({
      type: "object",
      properties: { rows: { type: "array", items: tableItems, default: [{ environment: "staging" }, {}] } },
    });
    expect(ok.ok).toBe(true);

    const notArray = checkSupportedSchema({
      type: "object",
      properties: { rows: { type: "array", items: tableItems, default: { environment: "staging" } } },
    });
    expect(notArray.ok).toBe(false);

    const unknownKey = checkSupportedSchema({
      type: "object",
      properties: { rows: { type: "array", items: tableItems, default: [{ oops: "x" }] } },
    });
    expect(unknownKey.ok).toBe(false);

    const wrongType = checkSupportedSchema({
      type: "object",
      properties: { rows: { type: "array", items: tableItems, default: [{ notify: "yes" }] } },
    });
    expect(wrongType.ok).toBe(false);
  });
});
