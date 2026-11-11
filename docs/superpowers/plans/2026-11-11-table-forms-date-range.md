# Table Forms, Date/Range Widgets, pi-schema Swap, README Hero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render arrays of flat objects as editable tables of native inputs, honor `format:"date"` and `x-widget:"range"`, swap Zod for pi's own schema validator, and advertise it all with a real README hero screenshot.

**Architecture:** The subset checker (`subset.ts`) stays the renderability gate and grows two acceptance rules. Validation drops the hand-rolled Zod conversion entirely: the same agent-authored JSON Schema is compiled with `@earendil-works/pi-schema` and validates submissions server-side, error paths converted from JSON Pointers to dotted keys. The vanilla-JS renderer gains a shared scalar-control builder (used by top-level fields and table cells), a table branch for object-item arrays, and a general dotted-path error resolver. README gets a hero composite captured from the live extension.

**Tech Stack:** TypeScript, Bun, vitest (+ jsdom for renderer tests), `@earendil-works/pi-schema` (new peerDependency), zero new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-table-forms-date-range-design.md`

## Global Constraints

- Bun is the package manager; never create or regenerate `package-lock.json`; `package.json` keeps `overrides.tldts = "7.4.19"`.
- Form page stays self-contained: inline CSS + vanilla JS, no CDN, no external requests; `RENDERER` is a TS template literal — no backticks inside it; everything agent-authored stays escaped (`escapeHtml`, `escapeJsonForScript`) and `<`-neutralized in the payload.
- Subset rejections are path-qualified and LLM-fixable; harmless extras (`title`, unknown `x-*` keys, unknown `format` values) stay ignored.
- Existing top-level rendering behavior is unchanged, with two documented exceptions: `format:"date"` / `x-widget:"range"` are now honored, and defaults are no longer materialized server-side on submit (cleared prefilled fields submit as absent).
- `zod` dependency is removed; `@earendil-works/pi-schema` becomes a peerDependency `"*"` (host pi ≥ 1.5.2 ships it).
- Tests: `bun run test` (vitest run). Commit after every task; messages follow the repo's conventional style (`feat:`, `fix:`, `chore:`, `docs:`).
- Renderer tests mount schemas with `as never` casts (they bypass `subset.ts`); subset tests exercise acceptance separately.

## Review Focus

Failure modes the spec implies but tasks could miss — each pinned by a test in its owning task:

1. **Reserved property names as table columns** (`constructor`, `__proto__`) — must be rejected by the subset checker, not reach the renderer's row-object builder. → Task 1 test.
2. **Boolean-only row** (every scalar cell empty, unchecked checkbox cell) — collects as `{notify: false}`, never silently dropped. → Task 5 test.
3. **Non-ISO date default** — leaves the date cell empty (prefill only assigns ISO-shaped defaults), never a raw garbage value. → Task 5 test.
4. **Cleared prefilled default** submits as absent — no server-side re-materialization. → Task 3 test.
5. **Dotted error key matching nothing** (row removed after a 422, or fully unknown path) — lands on the nearest resolvable ancestor, else the status line; never silently vanishes. → Task 6 test.

---

### Task 1: subset accepts arrays of flat objects (tables) with structural default check

**Files:**
- Modify: `src/subset.ts`
- Test: `test/subset.test.ts`

**Interfaces:**
- Produces: `SupportedArrayItems` gains an object variant — `| { type: "object"; properties: Record<string, SupportedProperty>; required?: string[] }` where every property is scalar (string / number / integer / boolean; string `enum` allowed). Later tasks treat `prop.items.type === "object"` as the table marker.
- Produces: default check on table arrays — `default` must be an array of plain objects whose keys are known item properties with primitive values of the right JS type; partial rows fine.

- [ ] **Step 1: Write the failing tests** (new describe `checkSupportedSchema — tables (arrays of objects)` in `test/subset.test.ts`):

```ts
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
    properties: { plan: { type: "object", properties: { rows: { type: "array", items: tableItems } } } },
  });
  expect(r.ok).toBe(true);
});

it("rejects a nested object or array inside table cells", () => {
  const r = checkSupportedSchema({
    type: "object",
    properties: { rows: { type: "array", items: { type: "object", properties: { deep: { type: "object", properties: { x: { type: "string" } } } } } } },
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
    properties: { rows: { type: "array", items: { type: "object", properties: { constructor: { type: "string" } } } } },
  });
  expect(r.ok).toBe(false);
  expect((r as { errors: string[] }).errors.join("\n")).toContain("constructor");
});

it("rejects rejected keywords inside items objects", () => {
  const r = checkSupportedSchema({
    type: "object",
    properties: { rows: { type: "array", items: { type: "object", properties: { a: { type: "string" } }, oneOf: [] } } },
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
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test -- subset`
Expected: FAIL — new cases rejected as today (`unsupported array items type "object"`).

- [ ] **Step 3: Implement in `src/subset.ts`**

- Extend `SupportedArrayItems` with the object variant (scalar-only properties).
- In `checkArrayItems`: when `items.type === "object"` → require `items.properties` to be a plain non-empty object; run `checkKeywords` on the items node; for each column run the existing scalar property checks (reuse `checkProperty` with a depth that makes object/array children fail — a dedicated scalar-only check that reports `properties.<p>.items.properties.<x>: table cells must be scalars`); reject reserved column names; validate `required` entries against column names.
- Table default check (in the array branch of `checkProperty`): `default` must be an array; every row a plain object; every key a known column; every value a primitive of the column's JS type (`string`→string, `number`/`integer`→number, `boolean`→boolean; enum columns expect string).

- [ ] **Step 4: Run tests**

Run: `bun run test -- subset`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/subset.ts test/subset.test.ts
git commit -m "feat: accept arrays of flat objects as renderable tables in the schema subset"
```

### Task 2: subset honors format:"date" and x-widget:"range" at every depth

**Files:**
- Modify: `src/subset.ts`
- Test: `test/subset.test.ts`

**Interfaces:**
- Produces: on `SupportedProperty` — string variant gains `format?: string`; integer variant gains `"x-widget"?: string`; table column properties inherit both.
- Produces (consumed by Tasks 4/5): the renderer keys off `prop.format === "date"` and `prop["x-widget"] === "range"`.

- [ ] **Step 1: Write the failing tests** (new describe `checkSupportedSchema — date and range widgets`):

```ts
it("accepts format:\"date\" on strings at top level, in fieldsets, and in table cells", () => {
  const r = checkSupportedSchema({
    type: "object",
    properties: {
      when: { type: "string", format: "date" },
      opts: { type: "object", properties: { when: { type: "string", format: "date" } } },
      rows: { type: "array", items: { type: "object", properties: { when: { type: "string", format: "date" } } } },
    },
  });
  expect(r.ok).toBe(true);
});

it("rejects format:\"date\" combined with enum, pattern, minLength or maxLength", () => {
  for (const extra of [{ enum: ["a"] }, { pattern: "a" }, { minLength: 1 }, { maxLength: 5 }]) {
    const r = checkSupportedSchema({
      type: "object",
      properties: { when: { type: "string", format: "date", ...extra } },
    });
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors[0]).toContain("properties.when");
  }
});

it("ignores format:\"date\" on non-strings and other format values", () => {
  const r = checkSupportedSchema({
    type: "object",
    properties: {
      n: { type: "integer", format: "date" },
      e: { type: "string", format: "email" },
    },
  });
  expect(r.ok).toBe(true);
});

it("accepts x-widget:\"range\" only on bounded integers", () => {
  const ok = checkSupportedSchema({
    type: "object",
    properties: { certainty: { type: "integer", minimum: 0, maximum: 100, "x-widget": "range" } },
  });
  expect(ok.ok).toBe(true);
});

it("rejects x-widget:\"range\" on unbounded or non-integer properties", () => {
  for (const p of [
    { type: "integer", "x-widget": "range" },
    { type: "integer", minimum: 0, "x-widget": "range" },
    { type: "number", minimum: 0, maximum: 1, "x-widget": "range" },
    { type: "string", "x-widget": "range" },
  ]) {
    const r = checkSupportedSchema({ type: "object", properties: { w: p } });
    expect(r.ok).toBe(false);
    expect((r as { errors: string[] }).errors[0]).toContain("properties.w");
  }
});

it("ignores x-widget with values other than \"range\"", () => {
  const r = checkSupportedSchema({
    type: "object",
    properties: { s: { type: "string", "x-widget": "textarea" } },
  });
  expect(r.ok).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test -- subset`
Expected: FAIL — date and range cases rejected or ignored incorrectly today.

- [ ] **Step 3: Implement in `src/subset.ts`**

- String branch: when `p.format === "date"` and the property is a string without `enum`/`pattern`/`minLength`/`maxLength` → accepted; with any of those four → error `properties.<p>: format "date" cannot be combined with enum/pattern/minLength/maxLength`. Non-`"date"` string formats and `format` on non-strings stay ignored.
- Integer/number branch (and only there): `p["x-widget"] === "range"` requires `type === "integer"` with numeric `minimum` and `maximum`; otherwise error `properties.<p>: x-widget "range" requires an integer with minimum and maximum`. Other `x-widget` values ignored.
- Both rules live in `checkProperty` (depth-agnostic) so fieldset children and table columns inherit them.

- [ ] **Step 4: Run tests**

Run: `bun run test`
Expected: PASS — full suite, including the existing `format_ignored: email` fixture.

- [ ] **Step 5: Commit**

```bash
git add src/subset.ts test/subset.test.ts
git commit -m "feat: honor format:\"date\" and x-widget:\"range\" in the schema subset"
```

### Task 3: swap Zod for pi-schema (compile + date format), pointer→dotted error keys

**Files:**
- Delete: `src/schema-to-zod.ts`, `test/schema-to-zod.test.ts`
- Modify: `src/server.ts`, `test/server.test.ts`, `package.json`
- Test: `test/validation.test.ts` (new)

**Interfaces:**
- Produces: `fieldErrors(errors: ReadonlyArray<{ path: string; message: string }>): Record<string, string>` — converts pi-schema JSON Pointer paths (`/rows/2/go_live`) to dotted keys (`rows.2.go_live`); `""` → `"_")`; first error per key wins.
- Consumes: `@earendil-works/pi-schema` — `compile(schema, { formats: { date: formats.date } })` → `Validator`; `validator.validate(value)` → `{ ok: true, value } | { ok: false, errors: ValidationError[] }` with `ValidationError = { path, keyword, message }`. Only the `date` format is checked; every other `format` stays an annotation (matches the design's "other formats ignored").
- Task 6 consumes the dotted keys this task produces.

- [ ] **Step 1: Write the failing tests**

Update the `fieldErrors` unit tests in `test/server.test.ts`:

```ts
it("converts JSON Pointer paths to dotted keys", () => {
  expect(fieldErrors([{ path: "/constructor", message: "required" }])).toEqual({ constructor: "required" });
  expect(fieldErrors([{ path: "/rows/2/go_live", message: "expected date" }])).toEqual({ "rows.2.go_live": "expected date" });
  expect(fieldErrors([{ path: "", message: "root" }])).toEqual({ _: "root" });
});
```

Create `test/validation.test.ts` (live server, same `makeForm` pattern as `server.test.ts` — one `startForm` per case, `POST /submit`):

```ts
// date format: "2026-03-01" → 200; "03/01/2026" → 422 with errors.go_live
// table required column: schema rows{items object, required:["environment"]},
//   POST {rows:[{go_live:"2026-03-01"}]} → 422 with errors["rows.0.environment"]
// default NOT materialized: schema {name:{type:"string",default:"x"}},
//   POST {} → 200 with data {}
// nested required: {opts:{type:"object",properties:{note:{type:"string"}},required:["note"]}},
//   POST {opts:{}} → 422 with errors["opts.note"]
// scalar array item type: {tags:{type:"array",items:{type:"number"}}},
//   POST {tags:["abc"]} → 422 with errors["tags.0"]
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test -- validation server`
Expected: FAIL — `validation.test.ts` imports fail (no such behavior yet); `fieldErrors` cases fail on signature.

- [ ] **Step 3: Implement**

- `package.json`: remove `"zod"` from `dependencies`; add `"@earendil-works/pi-schema": "*"` to `peerDependencies`; update `description` to `"pi extension: agent-authored browser forms validated by pi's schema engine"` and replace the `"zod"` keyword with `"json-schema"`.
- `src/server.ts`: delete the `toZodSchema` import; `import { compile } from "@earendil-works/pi-schema"` and `import { formats } from "@earendil-works/pi-schema/formats"`; in `startForm`: `const validator = compile(opts.schema, { formats: { date: formats.date } })`; in the POST handler replace `safeParse` with `const outcome = validator.validate(parsed)` — `!outcome.ok` → 422 with `fieldErrors(outcome.errors)`, else 200 with `outcome.value`.
- Rewrite `fieldErrors` to the new signature (pointer→dotted conversion: `path.replace(/^\//, "").split("/").join(".")`, `""` → `"_")`).
- Delete `src/schema-to-zod.ts` and `test/schema-to-zod.test.ts`.
- Run `bun install` (lockfile updates, no `package-lock.json`).

- [ ] **Step 4: Run tests**

Run: `bun run test`
Expected: PASS — full suite. Top-level error keys (`title`, `rating`) unchanged in `server.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: validate submissions with pi-schema instead of Zod; dotted error paths"
```

### Task 4: renderer — shared scalar control builder, date input, range slider

**Files:**
- Modify: `src/form-html.ts` (RENDERER + CSS)
- Test: `test/renderer.test.ts`

**Interfaces:**
- Produces (inside RENDERER): `buildScalarControl(prop)` → the control element: `<input type="date">` for `prop.format === "date"` strings; for `prop["x-widget"] === "range"` integers a `.range-line` div containing `<input type="range" min max step="1">` plus `<output class="range-val">` showing the live value; text/number/enum-select unchanged. Date prefill assigns the default only when it matches `/^\d{4}-\d{2}-\d{2}$/`. Task 5 reuses this builder for table cells.
- Consumes: nothing new from earlier tasks (renderer reads raw schema JSON).

- [ ] **Step 1: Write the failing tests** (new describe `renderer — date and range controls`):

```ts
it("renders a date input prefilled from default", () => {
  mount({ go_live: { type: "string", format: "date", default: "2026-03-01" } });
  const input = document.querySelector("input") as HTMLInputElement;
  expect(input.type).toBe("date");
  expect(input.value).toBe("2026-03-01");
});

it("renders a range slider with min/max and live readout", () => {
  mount({ certainty: { type: "integer", minimum: 0, maximum: 100, "x-widget": "range", default: 60 } });
  const input = document.querySelector("input[type=range]") as HTMLInputElement;
  expect(input.min).toBe("0");
  expect(input.max).toBe("100");
  const out = document.querySelector("output.range-val") as HTMLOutputElement;
  expect(out.textContent).toBe("60");
  input.value = "75";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(out.textContent).toBe("75");
});

it("submits the range value as a number", async () => {
  mount({ certainty: { type: "integer", minimum: 0, maximum: 100, "x-widget": "range", default: 60 } });
  const calls = submitWith({ status: 200, body: { ok: true, data: {} } });
  await tick();
  expect(JSON.parse(calls[0].body).certainty).toBe(60);
});

it("keeps format:\"email\" and enum strings as text/select", () => {
  mount({ e: { type: "string", format: "email" }, s: { type: "string", enum: ["a", "b"] } });
  expect(document.querySelector('input:not([type=range])')!.type).toBe("text");
  expect(document.querySelector("select")).toBeTruthy();
});

it("leaves a non-ISO date default empty (no garbage prefill)", () => {
  mount({ go_live: { type: "string", format: "date", default: "03/01/2026" } });
  expect((document.querySelector("input") as HTMLInputElement).value).toBe("");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test -- renderer`
Expected: FAIL — date renders as text input, no range output.

- [ ] **Step 3: Implement in `src/form-html.ts`**

- Extract the current else-branch control construction (text/number/select + attrs + prefill) into `buildScalarControl(prop)`; top-level `buildField` calls it.
- Add the date branch (`format === "date"` → `type=date`, ISO-guarded prefill) and range branch (`x-widget === "range"` → `.range-line` wrapper, range input with `min`/`max`/`step="1"`, output initialized to the input's value, `input` event listener updating the output; integer valueOf semantics already apply via the existing number branch — range counts as the field's `input`).
- CSS: `input[type="date"]` fit-width, `.range-line` flex with gap, `.range-val` mono font min-width, dark-mode-safe colors.

- [ ] **Step 4: Run tests**

Run: `bun run test -- renderer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/form-html.ts test/renderer.test.ts
git commit -m "feat: render date pickers and range sliders via shared scalar control builder"
```

### Task 5: renderer — table branch for arrays of flat objects

**Files:**
- Modify: `src/form-html.ts` (RENDERER + CSS)
- Test: `test/renderer.test.ts`

**Interfaces:**
- Consumes: `buildScalarControl(prop)` from Task 4.
- Produces (markup conventions Task 6 depends on): inside the `.field[data-field="<name>"]` wrap —
  `<table class="pi-table" data-array="<name>" data-kind="object-array">` with `thead > tr > th[data-col="<prop>"]` per column (label = `description` falling back to the key), `tbody > tr` rows of `td[data-col="<prop>"]` each holding the scalar control, plus a trailing `td.action` with a remove button; an "Add row" `.btn-add` button after the table.
- Produces (collect semantics): rows seeded from `prop.default` (else one empty row); collect walks `tbody` rows, builds a row object per row (per-cell scalar semantics identical to top-level fields: empty string/number cells omit the key, date cells submit their ISO string or omit when empty, booleans always present), a row with zero defined values is skipped, boolean-only rows submit `{notify: false}`.

- [ ] **Step 1: Write the failing tests** (new describe `renderer — table arrays`; schemas use `as never` mounts like existing tests):

```ts
const tableProp = {
  type: "array",
  items: {
    type: "object",
    properties: {
      environment: { type: "string", enum: ["staging", "canary", "production"], description: "Environment" },
      go_live: { type: "string", format: "date" },
      certainty: { type: "integer", minimum: 0, maximum: 100, "x-widget": "range", description: "Certainty (%)" },
      notify: { type: "boolean", description: "Notify team" },
    },
    required: ["environment"],
  },
  default: [
    { environment: "staging", go_live: "2026-03-01", certainty: 80 },
    { environment: "canary", certainty: 50, notify: true },
  ],
};
const tableNoBool = { ...tableProp, items: { ...tableProp.items, properties: { environment: tableProp.items.properties.environment, go_live: tableProp.items.properties.go_live, certainty: tableProp.items.properties.certainty } }, default: undefined };

it("builds thead labels from descriptions with key fallback", () => {
  mount({ rows: tableProp });
  const ths = [...document.querySelectorAll("th")];
  expect(ths.map((t) => t.textContent)).toEqual(["Environment", "go_live", "Certainty (%)", "Notify team"]);
});

it("seeds tbody from default rows and prefills cells", () => {
  mount({ rows: tableProp });
  const trs = document.querySelectorAll("tbody tr");
  expect(trs.length).toBe(2);
  const first = trs[0].querySelector('td[data-col="environment"] select') as HTMLSelectElement;
  expect(first.value).toBe("staging");
  expect((trs[0].querySelector('td[data-col="go_live"] input') as HTMLInputElement).value).toBe("2026-03-01");
  const range = trs[0].querySelector('td[data-col="certainty"] input') as HTMLInputElement;
  expect(range.type).toBe("range");
  expect(range.value).toBe("80");
  expect(trs[0].querySelector('td[data-col="certainty"] output.range-val')!.textContent).toBe("80");
});

it("seeds one empty row when no default", () => {
  mount({ rows: tableNoBool });
  expect(document.querySelectorAll("tbody tr").length).toBe(1);
});

it("add/remove row buttons work", () => {
  mount({ rows: tableProp });
  (document.querySelector(".btn-add") as HTMLElement).click();
  expect(document.querySelectorAll("tbody tr").length).toBe(3);
  (document.querySelector("td.action .btn-remove") as HTMLElement).click();
  expect(document.querySelectorAll("tbody tr").length).toBe(2);
});

it("collects typed row values", async () => {
  mount({ rows: tableProp });
  const calls = submitWith({ status: 200, body: { ok: true, data: {} } });
  await tick();
  expect(JSON.parse(calls[0].body)).toEqual({
    rows: [
      { environment: "staging", go_live: "2026-03-01", certainty: 80, notify: false },
      { environment: "canary", certainty: 50, notify: true },
    ],
  });
});

it("skips a row whose cells are all empty (no boolean column)", async () => {
  mount({ rows: tableNoBool });
  (document.querySelector(".btn-add") as HTMLElement).click(); // empty second row
  const calls = submitWith({ status: 200, body: { ok: true, data: {} } });
  await tick();
  expect(JSON.parse(calls[0].body)).toEqual({ rows: [] });
});

it("collects a boolean-only unchecked row as {notify: false}", async () => {
  mount({ rows: tableProp });
  (document.querySelector(".btn-add") as HTMLElement).click(); // untouched row: checkbox unchecked
  const calls = submitWith({ status: 200, body: { ok: true, data: {} } });
  await tick();
  const body = JSON.parse(calls[0].body);
  expect(body.rows[body.rows.length - 1]).toEqual({ notify: false });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test -- renderer`
Expected: FAIL — array branch renders value-array rows, no table.

- [ ] **Step 3: Implement in `src/form-html.ts`**

- In `buildField`'s array branch: when `prop.items && prop.items.type === "object"` build the table per the Interfaces markup; one `buildRow()` helper creates a `tr` with a `td[data-col]` per column holding `buildScalarControl(innerProp)` (prefilled from the row's default value when given) plus the `td.action` remove cell; seed rows from `prop.default`, else one empty row; "Add row" appends `buildRow()`; remove buttons drop the `tr`.
- Extract scalar cell valueOf into a helper shared with `valueOfField` (empty text/number → omitted; integer/number → `Number()`; boolean → always boolean) and use it in the collect path for `data-kind === "object-array"`; skip rows with zero defined values.
- CSS: `.pi-table` full width, compact padding, `th` small muted, in-cell controls auto width, `td.action` narrow, dark-mode variants, wrapper `div.table-scroll` with `overflow-x: auto` around the table.

- [ ] **Step 4: Run tests**

Run: `bun run test -- renderer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/form-html.ts test/renderer.test.ts
git commit -m "feat: render arrays of flat objects as editable tables of native inputs"
```

### Task 6: renderer — general dotted-path error resolution

**Files:**
- Modify: `src/form-html.ts` (RENDERER + CSS)
- Test: `test/renderer.test.ts`

**Interfaces:**
- Consumes: Task 3's 422 wire format (`{ ok: false, errors: Record<string, string> }` with dotted keys) and Task 5's markup conventions (`data-array`, `data-kind="object-array"`, `td[data-col]`, `tr` rows, `data-item` inputs).
- Produces: `showErrors` resolves each dotted key by walking segments — plain name → `.field[data-field]`; `name.prop` → nested fieldset child; `list.0` → nth `input[data-item]` row of the array list; `rows.2.prop` → `tbody tr:nth(2)`'s `td[data-col="prop"]` — appending the `.err` div to the resolved target (cell, field wrap, or item row). When a path resolves only partially, the `.err` attaches to the deepest resolved node; when nothing resolves, the message is appended to `#pi-form-status` as `<key>: <message>`.

- [ ] **Step 1: Write the failing tests** (new describe `renderer — dotted error paths`):

```ts
it("lands rows.N.prop errors in the matching cell", async () => {
  mount({ rows: tableProp });
  submitWith({ status: 422, body: { ok: false, errors: { "rows.1.go_live": "expected date" } } });
  await tick();
  const err = document.querySelector('tbody tr:nth-child(2) td[data-col="go_live"] .err');
  expect(err?.textContent).toBe("expected date");
});

it("resolves nested-object dotted keys to the inner field", async () => {
  mount({ opts: { type: "object", properties: { note: { type: "string" } }, required: ["note"] } }, ["opts"]);
  submitWith({ status: 422, body: { ok: false, errors: { "opts.note": "missing" } } });
  await tick();
  const inner = document.querySelector('.field[data-field="note"] .err');
  expect(inner?.textContent).toBe("missing");
});

it("resolves scalar-array item errors to the item row", async () => {
  mount({ tags: { type: "array", items: { type: "number" } } });
  submitWith({ status: 422, body: { ok: false, errors: { "tags.0": "expected number" } } });
  await tick();
  const err = document.querySelector('[data-array="tags"] .row .err');
  expect(err?.textContent).toBe("expected number");
});

it("falls back to the nearest ancestor when the row is gone", async () => {
  mount({ rows: tableProp });
  submitWith({ status: 422, body: { ok: false, errors: { "rows.9.environment": "missing" } } });
  await tick();
  const err = document.querySelector('.field[data-field="rows"] .err');
  expect(err?.textContent).toBe("missing");
});

it("shows unresolvable keys in the status line", async () => {
  mount({ rows: tableProp });
  submitWith({ status: 422, body: { ok: false, errors: { "nope.deep": "broken" } } });
  await tick();
  expect(document.getElementById("pi-form-status")!.textContent).toContain("nope.deep: broken");
});

it("regression: plain top-level names keep working", async () => {
  mount({ plain: { type: "string" } }, ["plain"]);
  submitWith({ status: 422, body: { ok: false, errors: { plain: "missing" } } });
  await tick();
  expect(document.querySelector(".err")?.textContent).toBe("missing");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test -- renderer`
Expected: FAIL — cell, nested, item-row, ancestor and status-line cases.

- [ ] **Step 3: Implement in `src/form-html.ts`**

- Replace `showErrors`' name matching with a segment walker: split the key on `.`; at each step resolve one segment against the current scope (`.field[data-field]` wrap → its fieldset/list/table as the next scope; numeric segment in a `data-kind="value-array"` list → nth `[data-item]` input's `.row`; numeric segment in an `object-array` table → nth `tbody tr`, next segment → its `td[data-col]`). Attach `.err` to the deepest resolved element; partial resolution attaches to the deepest resolved node; zero resolution appends `<key>: <message>` to the status line. Clear-on-input behavior stays (bind to the resolved control, `once`).

- [ ] **Step 4: Run tests**

Run: `bun run test`
Expected: PASS — full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/form-html.ts test/renderer.test.ts
git commit -m "feat: resolve dotted validation paths to fields, array items and table cells"
```

### Task 7: tool copy, README rewrite, demo assets capture

**Files:**
- Modify: `index.ts`, `README.md`
- Create: `assets/hero.png`, `assets/form-table.png` (committed binaries; no generation script ships)

**Interfaces:**
- Consumes: everything landed; the demo schema below is the single source for the README snippet and the screenshots.

- [ ] **Step 1: Update `index.ts` tool copy**

- `description` gains after the supported-types sentence: `"Arrays of flat objects render as an editable table of inputs; string format \"date\" renders a native date picker; x-widget \"range\" on a bounded integer renders a range slider."`
- The second `promptGuidelines` bullet gains: `"format: \"date\" is validated server-side; x-widget is the only custom keyword honored (\"range\")."`

- [ ] **Step 2: Write the README**

- Intro paragraph stays; insert the hero image right after it: `![pi-form: form in the browser, CLI still usable](assets/hero.png)`.
- New "Showcase" section after "Usage": the demo schema (below, as JSON) + `assets/form-table.png` + one line on what the agent asked for and what came back.
- Supported-subset table: add rows — `array of flat objects` → editable table (native controls per cell); `string format "date"` → native date picker; `x-widget: "range"` (bounded integer) → range slider. Drop the "`format` … ignored" wording (keep "title and unknown metadata keys are ignored").
- Replace "Zod" wording throughout with pi-schema wording: intro ("validated with [Zod](https://zod.dev)" → "validated by [pi's schema engine](https://github.com/earendil-works/pi)"), the security bullet, the dev layout line (`src/schema-to-zod.ts` removed, `src/subset.ts` keeps), and the flow diagram result line if needed.
- Dev section gains: "Regenerating `assets/`: start a one-off form via `startForm` with the showcase schema (see README), screenshot the page at ~900px width; hero composites that shot with a terminal mock. No script ships — it's a manual capture."

Demo schema (exact, used for README snippet and screenshots):

```json
{
  "type": "object",
  "required": ["rollout", "rows"],
  "properties": {
    "rollout": { "type": "string", "description": "Rollout name", "minLength": 2, "default": "v2.1 launch" },
    "rows": {
      "type": "array",
      "description": "Deployment rollout plan",
      "items": {
        "type": "object",
        "required": ["environment", "go_live"],
        "properties": {
          "environment": { "type": "string", "description": "Environment", "enum": ["staging", "canary", "production"] },
          "go_live": { "type": "string", "description": "Go-live date", "format": "date" },
          "certainty": { "type": "integer", "description": "Certainty (%)", "minimum": 0, "maximum": 100, "x-widget": "range" },
          "notify": { "type": "boolean", "description": "Notify team" }
        }
      },
      "default": [
        { "environment": "staging", "go_live": "2026-03-01", "certainty": 80, "notify": true },
        { "environment": "canary", "go_live": "2026-03-04", "certainty": 50 }
      ]
    }
  }
}
```

- [ ] **Step 3: Capture assets (executor has browser automation)**

- Write an untracked temp script (outside the repo, e.g. `/tmp/pi-form-demo.ts`) importing `startForm` from the repo's `src/server.ts` with the demo schema and title "Deployment rollout plan"; run it with `bun /tmp/pi-form-demo.ts`; it prints the form URL and stays alive.
- Open the URL in the automation browser, viewport 900px wide; the defaults prefilled rows are the shot; screenshot the form card → `assets/form-table.png`.
- Compose the hero: an untracked temp HTML page with a terminal-pane mock (pi TUI look: the `request_input` call, status footer `pi-form: Form "Deployment rollout plan" waiting in browser — http://127.0.0.1:<port>/form?t=… (Esc cancels)`) beside the captured form image; screenshot the composite at ~1400px wide → `assets/hero.png`.
- Verify both PNGs exist, non-trivial size, dark-mode-safe (capture with `prefers-color-scheme: light` default is fine; page supports both).

- [ ] **Step 4: Verify everything**

Run: `bun install && bun run test`
Expected: install clean (no `package-lock.json`), full suite PASS.
Run: `ls -la assets/`
Expected: `hero.png`, `form-table.png`, `icon.svg` present.
Read `README.md` rendered links: both image paths resolve.

- [ ] **Step 5: Commit**

```bash
git add index.ts README.md assets/hero.png assets/form-table.png
git commit -m "docs: README hero + showcase; teach request_input the table/date/range shapes"
```
