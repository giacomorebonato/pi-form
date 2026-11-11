/**
 * Supported JSON Schema subset checker for pi-form.
 *
 * The agent (LLM) authors a JSON Schema for the input it needs. This module
 * narrows it to the subset pi-form can faithfully render as a form and
 * validate with Zod, rejecting anything else with a path-qualified error.
 */

export interface SupportedArrayItems {
  type: "string" | "number" | "object";
  enum?: string[];
  /** Present when type is "object": the flat table columns. */
  properties?: Record<string, unknown>;
  required?: string[];
}

export type SupportedProperty =
  | {
      type: "string";
      enum?: string[];
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      description?: string;
      default?: string;
      format?: string;
    }
  | {
      type: "number" | "integer";
      minimum?: number;
      maximum?: number;
      description?: string;
      default?: number;
      "x-widget"?: string;
    }
  | { type: "boolean"; description?: string; default?: boolean }
  | { type: "array"; items: SupportedArrayItems; description?: string; default?: unknown[] }
  | {
      type: "object";
      properties: Record<string, SupportedProperty>;
      required?: string[];
      description?: string;
    };

export interface SupportedSchema {
  type: "object";
  properties: Record<string, SupportedProperty>;
  required?: string[];
  [key: string]: unknown;
}

export type SubsetResult =
  | { ok: true; schema: SupportedSchema }
  | { ok: false; errors: string[] };

const ROOT_INVALID = 'schema must be a JSON Schema object with type "object" and "properties"';

const REJECTED_KEYWORDS = [
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "$ref",
  "if",
  "then",
  "else",
  "patternProperties",
  "propertyNames",
  "multipleOf",
  "uniqueItems",
  "minItems",
  "maxItems",
  "const",
  "dependencies",
  "dependentSchemas",
] as const;

const SCALAR_TYPES = new Set(["string", "number", "integer", "boolean"]);
const RESERVED_PROPERTY_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/** Scalar constraint checks shared by object properties and table columns. */
function checkScalarConstraints(p: Record<string, unknown>, type: string, path: string, errors: string[]): void {
  if (
    p["x-widget"] === "range" &&
    !(type === "integer" && typeof p.minimum === "number" && typeof p.maximum === "number")
  ) {
    errors.push(`${path}: x-widget "range" requires an integer with minimum and maximum`);
    return;
  }
  switch (type) {
    case "string": {
      if (p.format === "date" && ("enum" in p || "pattern" in p || "minLength" in p || "maxLength" in p)) {
        errors.push(`${path}: format "date" cannot be combined with enum/pattern/minLength/maxLength`);
        return;
      }
      if ("enum" in p) {
        checkEnum(p.enum, path, errors);
      }
      checkStringConstraints(p, path, errors);
      return;
    }
    case "number":
    case "integer": {
      if ("enum" in p) {
        errors.push(`${path}: enum is only supported on string type`);
      }
      checkNumericConstraints(p, path, errors);
      return;
    }
    case "boolean": {
      return;
    }
  }
}

/**
 * Check a flat-object array items node (a table): scalar columns only,
 * reserved names rejected, rejected keywords rejected, required entries
 * must name known columns.
 */
function checkTableItems(items: Record<string, unknown>, path: string, errors: string[]): void {
  checkKeywords(items, path, errors);
  const properties = items.properties;
  if (!isPlainObject(properties) || Object.keys(properties).length === 0) {
    errors.push(`${path}: table items require "properties"`);
    return;
  }
  for (const [name, child] of Object.entries(properties)) {
    const childPath = `${path}.properties.${name}`;
    if (RESERVED_PROPERTY_NAMES.has(name)) {
      errors.push(`${childPath}: reserved property name "${name}"`);
      continue;
    }
    if (!isPlainObject(child)) {
      errors.push(`${childPath}: table cells must be scalars (string, number, integer, boolean)`);
      continue;
    }
    checkKeywords(child, childPath, errors);
    const type = child.type;
    if (typeof type !== "string" || !SCALAR_TYPES.has(type)) {
      errors.push(`${childPath}: table cells must be scalars (string, number, integer, boolean)`);
      continue;
    }
    checkScalarConstraints(child, type, childPath, errors);
  }
  if ("required" in items && !Array.isArray(items.required)) {
    errors.push(`${path}.required: must be an array of strings`);
  } else if ("required" in items) {
    for (const entry of items.required) {
      if (typeof entry !== "string") {
        errors.push(`${path}.required: must be an array of strings`);
        break;
      }
      if (!(entry in properties)) {
        errors.push(`${path}.required: unknown property "${entry}"`);
      }
    }
  }
}

/** Structural check for a table array's `default`: an array of plain
 * objects with known keys and primitive values of the column's JS type.
 * Constraints are NOT checked (Zod-era parity: scalar defaults were never
 * constraint-checked); pi-schema re-validates on submit. */
function checkTableDefault(def: unknown, items: Record<string, unknown>, path: string, errors: string[]): void {
  if (!Array.isArray(def)) {
    errors.push(`${path}.default: must be an array of row objects`);
    return;
  }
  const columns = (isPlainObject(items.properties) ? items.properties : {}) as Record<string, unknown>;
  def.forEach((row, i) => {
    if (!isPlainObject(row)) {
      errors.push(`${path}.default.${i}: must be an object`);
      return;
    }
    for (const [key, value] of Object.entries(row)) {
      const col = columns[key];
      const childPath = `${path}.default.${i}.${key}`;
      if (!isPlainObject(col)) {
        errors.push(`${childPath}: unknown table column "${key}"`);
        continue;
      }
      const colType = col.type;
      const expected = colType === "string" ? "string" : colType === "boolean" ? "boolean" : "number";
      if (typeof value !== expected) {
        errors.push(`${childPath}: expected ${expected}`);
      }
    }
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkKeywords(node: Record<string, unknown>, path: string, errors: string[]): void {
  for (const kw of REJECTED_KEYWORDS) {
    if (kw in node) {
      errors.push(`${path}: unsupported keyword "${kw}"`);
    }
  }
  if ("additionalProperties" in node && typeof node.additionalProperties !== "boolean") {
    errors.push(`${path}: additionalProperties must be a boolean`);
  }
}

function checkStringConstraints(p: Record<string, unknown>, path: string, errors: string[]): void {
  for (const key of ["minLength", "maxLength"] as const) {
    if (key in p && typeof p[key] !== "number") {
      errors.push(`${path}: ${key} must be a number`);
    }
  }
  if ("pattern" in p) {
    if (typeof p.pattern !== "string") {
      errors.push(`${path}: pattern must be a string`);
    } else {
      try {
        new RegExp(p.pattern);
      } catch {
        errors.push(`${path}: pattern is not a valid regular expression`);
      }
    }
  }
}

function checkNumericConstraints(p: Record<string, unknown>, path: string, errors: string[]): void {
  for (const key of ["minimum", "maximum"] as const) {
    if (key in p && typeof p[key] !== "number") {
      errors.push(`${path}: ${key} must be a number`);
    }
  }
}

function checkEnum(values: unknown, path: string, errors: string[]): void {
  const ok =
    Array.isArray(values) &&
    values.length > 0 &&
    values.every((v) => typeof v === "string" && v.length > 0);
  if (!ok) {
    errors.push(`${path}: enum values must be non-empty strings`);
  }
}

function checkArrayItems(items: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(items) || Object.keys(items).length === 0) {
    errors.push(`${path}: array items require a type or enum`);
    return;
  }
  const hasEnum = "enum" in items;
  const hasType = "type" in items && typeof items.type === "string";
  if (!hasEnum && !hasType) {
    errors.push(`${path}: array items require a type or enum`);
    return;
  }
  if (hasEnum) {
    checkEnum(items.enum, path, errors);
  }
  if (hasType && items.type === "object") {
    checkTableItems(items, `${path}.items`, errors);
    return;
  }
  if (hasType && items.type !== "string" && items.type !== "number") {
    errors.push(`${path}: unsupported array items type "${String(items.type)}"`);
  }
}

/**
 * Check a property node. `depth` is the object-nesting depth of the object
 * that contains this property (0 = top level).
 */
function checkProperty(p: unknown, path: string, depth: number, errors: string[]): void {
  if (!isPlainObject(p)) {
    errors.push(`${path}: type must be a single supported type`);
    return;
  }
  checkKeywords(p, path, errors);

  const type = p.type;
  if (type === undefined || typeof type !== "string") {
    errors.push(`${path}: type must be a single supported type`);
    return;
  }
  if (!SCALAR_TYPES.has(type) && type !== "array" && type !== "object") {
    errors.push(`${path}: unsupported type "${type}"`);
    return;
  }

  switch (type) {
    case "string": {
      checkScalarConstraints(p, "string", path, errors);
      return;
    }
    case "number":
    case "integer": {
      checkScalarConstraints(p, type, path, errors);
      return;
    }
    case "boolean": {
      return;
    }
    case "array": {
      if (!("items" in p)) {
        errors.push(`${path}: array requires "items"`);
        return;
      }
      checkArrayItems(p.items, path, errors);
      if (
        isPlainObject(p.items) &&
        p.items.type === "object" &&
        "default" in p &&
        p.default !== undefined
      ) {
        checkTableDefault(p.default, p.items, path, errors);
      }
      return;
    }
    case "object": {
      if (depth >= 1) {
        errors.push(`${path}: nested objects are only supported one level deep`);
        return;
      }
      checkObjectNode(p, path, depth + 1, errors);
      return;
    }
  }
}

function checkObjectNode(
  node: unknown,
  path: string,
  depth: number,
  errors: string[]
): void {
  // Keyword checks are done by the caller (checkSupportedSchema for the root,
  // checkProperty for nested objects) to avoid duplicate errors.
  if (!isPlainObject(node)) {
    errors.push(depth === 0 ? ROOT_INVALID : `${path}: object requires "properties"`);
    return;
  }

  const properties = node.properties;
  if (!isPlainObject(properties)) {
    errors.push(depth === 0 ? ROOT_INVALID : `${path}: object requires "properties"`);
    return;
  }

  for (const [name, child] of Object.entries(properties)) {
    if (RESERVED_PROPERTY_NAMES.has(name)) {
      errors.push(`properties.${name}: reserved property name "${name}"`);
      continue;
    }
    const childPath = depth === 0 ? `properties.${name}` : `${path}.properties.${name}`;
    checkProperty(child, childPath, depth, errors);
  }

  if ("required" in node && !Array.isArray(node.required)) {
    errors.push("required must be an array of strings");
  } else if ("required" in node) {
    for (const entry of node.required) {
      if (typeof entry !== "string") {
        errors.push("required must be an array of strings");
        break;
      }
      if (!(entry in properties)) {
        errors.push(`required: unknown property "${entry}"`);
      }
    }
  }
}

/**
 * Validate an agent-authored schema against the supported subset.
 * Unknown extra keys (title, format, $schema, metadata) are ignored.
 */
export function checkSupportedSchema(schema: unknown): SubsetResult {
  const errors: string[] = [];

  if (!isPlainObject(schema) || schema.type !== "object") {
    return { ok: false, errors: [ROOT_INVALID] };
  }
  checkKeywords(schema, "schema", errors);
  checkObjectNode(schema, "schema", 0, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, schema: schema as SupportedSchema };
}
