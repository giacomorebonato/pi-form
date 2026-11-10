import { z } from "zod";
import type { SupportedProperty, SupportedSchema } from "./subset.js";

/**
 * Convert a checked SupportedSchema into a Zod schema.
 *
 * The subset checker (src/subset.ts) has already rejected everything this
 * converter cannot express faithfully, so conversion here is total:
 * every SupportedSchema converts without throwing.
 */

function propertyToZod(p: SupportedProperty): z.ZodTypeAny {
  switch (p.type) {
    case "string": {
      let s: z.ZodTypeAny = p.enum ? z.enum(p.enum as [string, ...string[]]) : z.string();
      if (typeof p.minLength === "number") {
        s = s.min(p.minLength);
      }
      if (typeof p.maxLength === "number") {
        s = s.max(p.maxLength);
      }
      if (typeof p.pattern === "string") {
        s = s.regex(new RegExp(p.pattern));
      }
      return s;
    }
    case "number":
    case "integer": {
      let n: z.ZodTypeAny = p.type === "integer" ? z.number().int() : z.number();
      if (typeof p.minimum === "number") {
        n = n.min(p.minimum);
      }
      if (typeof p.maximum === "number") {
        n = n.max(p.maximum);
      }
      return n;
    }
    case "boolean":
      return z.boolean();
    case "array": {
      const item = p.items.enum
        ? z.enum(p.items.enum as [string, ...string[]])
        : p.items.type === "number"
          ? z.number()
          : z.string();
      return z.array(item);
    }
    case "object":
      return objectToZod(p);
  }
}

function objectToZod(node: {
  properties: Record<string, SupportedProperty>;
  required?: string[];
}): z.ZodTypeAny {
  const required = new Set(node.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, prop] of Object.entries(node.properties)) {
    const base = propertyToZod(prop);
    if (required.has(name)) {
      shape[name] = base;
    } else if (prop.default !== undefined) {
      shape[name] = base.default(prop.default);
    } else {
      shape[name] = base.optional();
    }
  }
  return z.object(shape);
}

export function toZodSchema(schema: SupportedSchema): z.ZodType<Record<string, unknown>> {
  return objectToZod(schema) as z.ZodType<Record<string, unknown>>;
}
