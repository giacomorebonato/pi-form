import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkSupportedSchema } from "../src/subset.js";
import { toZodSchema } from "../src/schema-to-zod.js";

function convert(schema: unknown) {
  const checked = checkSupportedSchema(schema);
  if (!checked.ok) throw new Error(`subset check failed: ${checked.errors.join("; ")}`);
  return toZodSchema(checked.schema);
}

describe("toZodSchema — strings", () => {
  const schema = convert({
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 2, maxLength: 10, pattern: "^[a-z]+$" },
    },
  });

  it("accepts a valid required string", () => {
    expect(schema.safeParse({ name: "abc" }).success).toBe(true);
  });

  it("enforces minLength, maxLength and pattern", () => {
    expect(schema.safeParse({ name: "a" }).success).toBe(false);
    expect(schema.safeParse({ name: "abcdefghijklmnop" }).success).toBe(false);
    expect(schema.safeParse({ name: "ABC" }).success).toBe(false);
  });

  it("rejects a missing required string", () => {
    expect(schema.safeParse({}).success).toBe(false);
  });
});

describe("toZodSchema — optional and defaults", () => {
  it("optional property absent → parse succeeds without the key", () => {
    const schema = convert({ type: "object", properties: { note: { type: "string" } } });
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.success && "note" in result.data).toBe(false);
  });

  it("default fills in when value absent", () => {
    const schema = convert({
      type: "object",
      properties: { mood: { type: "string", default: "calm" } },
    });
    const result = schema.safeParse({});
    expect(result).toMatchObject({ success: true, data: { mood: "calm" } });
  });
});

describe("toZodSchema — numbers", () => {
  const schema = convert({
    type: "object",
    required: ["rating"],
    properties: {
      rating: { type: "integer", minimum: 1, maximum: 5 },
      ratio: { type: "number", minimum: 0, maximum: 1 },
    },
  });

  it("integer rejects non-integer and out-of-range values", () => {
    expect(schema.safeParse({ rating: 0.5 }).success).toBe(false);
    expect(schema.safeParse({ rating: 6 }).success).toBe(false);
    expect(schema.safeParse({ rating: 3 }).success).toBe(true);
  });

  it("number accepts fractions within range", () => {
    expect(schema.safeParse({ rating: 3, ratio: 0.25 }).success).toBe(true);
    expect(schema.safeParse({ rating: 3, ratio: 1.5 }).success).toBe(false);
  });
});

describe("toZodSchema — enums and arrays", () => {
  const schema = convert({
    type: "object",
    required: ["severity", "genres"],
    properties: {
      severity: { type: "string", enum: ["low", "high"] },
      genres: { type: "array", items: { type: "string", enum: ["scifi", "noir"] } },
      tags: { type: "array", items: { type: "string" } },
      scores: { type: "array", items: { type: "number" } },
    },
  });

  it("enum rejects non-members", () => {
    expect(schema.safeParse({ severity: "mid", genres: ["scifi"] }).success).toBe(false);
  });

  it("array of enum rejects non-member items", () => {
    expect(schema.safeParse({ severity: "low", genres: ["western"] }).success).toBe(false);
    expect(schema.safeParse({ severity: "low", genres: ["scifi", "noir"] }).success).toBe(true);
  });

  it("arrays of string/number validate element types", () => {
    const ok = schema.safeParse({ severity: "low", genres: [], tags: ["a"], scores: [1, 2.5] });
    expect(ok.success).toBe(true);
    const badTags = schema.safeParse({ severity: "low", genres: [], tags: [1] });
    expect(badTags.success).toBe(false);
  });
});

describe("toZodSchema — nested objects", () => {
  const schema = convert({
    type: "object",
    properties: {
      opts: {
        type: "object",
        required: ["note"],
        properties: { note: { type: "string" }, loud: { type: "boolean" } },
      },
    },
  });

  it("absent optional nested object → ok", () => {
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("present nested object with bad inner value → issue names the inner field", () => {
    const result = schema.safeParse({ opts: {} });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i: z.core.$ZodIssue) => i.path.includes("note"));
      expect(issue).toBeDefined();
    }
  });
});

describe("toZodSchema — unknown keys stripped", () => {
  it("strips keys not in the schema", () => {
    const schema = convert({
      type: "object",
      required: ["keep"],
      properties: { keep: { type: "string" } },
    });
    const result = schema.safeParse({ keep: "yes", evil: "<script>" });
    expect(result).toMatchObject({ success: true, data: { keep: "yes" } });
  });
});
