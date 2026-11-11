# pi-form: table forms (arrays of objects), native date/range inputs, README hero

Date: 2026-11-11
Status: drafted — awaiting user approval (builder check done; answers folded in)

## Intent and why

Two goals, from the human partner:

1. The README must *show* what pi-form does — not only explain it — and make
   it look cool to try. The pitch: "use the CLI without giving up nicely
   rendered custom forms". A hero image carries it.
2. The showcase form renders an array of objects — the one schema shape
   pi-form still rejects outright — as an editable **table of inputs**, with
   native browser controls (date picker, range slider) in the cells.

The screenshot advertises real capability: features land first, the hero is
captured from the live extension. No mockups of things that don't exist.

## Goals

- `{"type":"array","items":{"type":"object","properties":{...}}}` renders as an
  editable table: rows = items, columns = item properties, native control per
  cell (text, number, select, date picker, range slider, checkbox).
- String `format: "date"` → `<input type="date">`, validated server-side as
  `YYYY-MM-DD` by pi-schema's `date` format check.
- `x-widget: "range"` on a bounded integer → `<input type="range">` with a
  live value readout next to it.
- Per-cell server-side validation: 422 responses carry path-keyed errors
  (`rows.2.go_live`), the cell is highlighted and its message shown in-cell.
- Prefill: `default` on a table property renders initial rows (also makes the
  hero form look alive on open).
- README: hero image near the top + showcase section with the demo schema +
  updated supported-subset documentation.
- `index.ts` tool description + `promptGuidelines` teach the LLM the new shapes.
- Existing single-field rendering is unchanged for existing schemas, except
  `format:"date"` / `x-widget:"range"` now being honored.

## Non-goals

- Nested objects/arrays inside table items: item properties are scalars only;
  deeper shapes keep being rejected with path-qualified errors.
- `minItems`/`maxItems`/`uniqueItems` keep being rejected; an empty table
  submits as `[]`.
- Other `format` values (email, uuid, date-time, …): remain ignored → plain
  text input.
- Row reordering/drag-and-drop; add/remove only.
- Animated GIF/MP4 demo: optional follow-up, not in scope here.
- Multi-form concurrency, file upload, persistence: untouched.

## Anti-goals

- Mockup screenshots advertising features that don't exist.
- Breaking changes to how existing schemas render.

## Constraints (inherited from v1 design, unchanged)

- Self-contained HTML page: no CDN, no build step, vanilla JS in a TS
  template literal (no backticks inside), `RENDERER` exported for jsdom tests.
- Agent-authored content is untrusted: HTML-escape, `<`-neutralize the JSON
  payload, token-guarded 127.0.0.1 server, 1 MiB submission cap, one pending
  form at a time.
- The subset checker rejects unsupported shapes with path-qualified errors the
  LLM can act on; harmless extras (`title`, unknown `x-*` keys) stay ignored.
- **Validation engine: `@earendil-works/pi-schema`** (pi's own JSON Schema
  validator, drafts 2020-12 and 7, zero deps, always co-installed with pi).
  It replaces Zod and the hand conversion entirely: the same agent-authored
  JSON Schema that drives the renderer is compiled with
  `compile(schema, { formats })` and validates the submission. Zod is
  removed from dependencies; pi-schema becomes a peerDependency.
- Bun + vitest.

## Approaches considered (array-of-objects rendering)

1. **Editable table of inputs (picked)** — rows = items, columns = item
   properties, native controls in cells. Compact, visually scales to ~10 rows,
   prior art in json-editor's `format: "table"`. Strongest hero image; the
   human partner picked it in conversation.
2. **Repeated fieldsets** (react-jsonschema-form style) — could reuse
   `buildField` per item, least renderer work, but tall and repetitive; weak
   showcase.
3. **Accordion/grid of cards per item** — same collect logic as 2 with a
   wrapper; still vertical, wasteful for 1–3 scalar properties per item.

## Approaches considered (README hero)

1. **Side-by-side composite PNG (picked)** — left: terminal pane showing pi
   mid-run (`request_input` call, status footer with the form URL); right: the
   real browser form screenshot. Tells the whole story — "terminal stays
   usable, the form renders in the browser" — in one glance.
2. **Form-only screenshot** — simpler, but doesn't tell the CLI story; keep it
   as a secondary image next to the demo schema.
3. **Animated GIF** — coolest and autoplays on GitHub, but higher effort and
   size risk; optional follow-up after this lands.

## How (decided)

### Schema acceptance (`src/subset.ts`)

- Array items may now be a **flat object**: `properties` of scalar types only
  (string / number / integer / boolean; string `enum` allowed), plus a
  `required` list and per-property `description`, `default`, `format`,
  `x-widget`. Objects or arrays inside items keep being rejected
  (`properties.<name>.items.properties.<x>: table cells must be scalars`).
- **Position:** tables are accepted at every position arrays are accepted
  today, including as children of nested objects (fieldsets). Scalar arrays
  are already depth-agnostic; object arrays follow the same rule so the
  subset stays position-consistent for the LLM.
- **Widget/date rules are depth-agnostic too:** `format:"date"` and
  `x-widget:"range"` apply to top-level fields, fieldset children, and
  table cells alike — `checkProperty` already validates all depths
  uniformly.
- `format: "date"` is valid only on enum-less strings. On a string combined
  with `enum`, `pattern`, `minLength` or `maxLength` → reject with a
  path-qualified error. On non-string properties → ignore (`format` is a
  string annotation in JSON Schema). All other `format` values stay
  ignored.
- `x-widget` is honored only when its value is exactly `"range"`, on an
  `integer` property that has both `minimum` and `maximum`. There it
  renders a slider. The value `"range"` on anything else (non-integer,
  or missing bounds) → **reject** with a path-qualified error: the agent
  explicitly asked for a slider we cannot render, and a silent text/number
  input would betray the intent. `x-widget` with any other value →
  ignore, like unknown `x-*` keys today.
- `default` on a table array: must be an array of plain objects whose keys
  are known item properties with primitive values of the right JS type —
  **structural check only**, mirroring today's scalar defaults (which are
  never constraint-checked). Constraint violations in prefilled rows
  surface through normal pi-schema validation on submit; a non-ISO date
  default simply leaves that date cell empty. Partial rows are fine.
- Unknown other `x-*` keys stay ignored.

### Validation (`src/server.ts`; `src/schema-to-zod.ts` deleted)

- `src/schema-to-zod.ts` is **deleted**. `startForm` compiles the checked
  schema once with `compile(schema, { formats })` from
  `@earendil-works/pi-schema`; the `formats` map enables the `date` check.
  The checked subset only contains constructs pi-schema fully supports, so
  compilation is total. Item-level `required` is enforced per row by the
  same compiled schema.
- `default` is an annotation to pi-schema: validation never inserts it.
  Cleared prefilled fields submit as absent (Zod's `.default()` used to
  re-materialize them server-side; that silent re-insertion goes away —
  more honest, and normal submits are unchanged since the form prefills
  client-side).
- `fieldErrors` in `server.ts` currently keys issues by `issue.path[0]`
  (top-level property only) — nested errors collapse. Change it to convert
  pi-schema's JSON Pointer paths (`/rows/2/go_live`) to dotted keys
  (`rows.2.go_live`, `notes.spoilery`, `tags.0`) so table cells, fieldset
  children, and scalar-array items can all be addressed; first error per
  path wins (as today).
- This re-keys **existing** shapes too, so the renderer must resolve dotted
  paths generally, not just `rows.N.prop`: `showErrors` walks the path
  segments against the DOM (`data-field` wraps, `data-array` lists with
  indexed `data-item` rows, table `tbody` rows) and highlights the deepest
  element it can resolve. If a path no longer matches anything (user
  removed that row after a 422), the error attaches to the nearest
  resolvable ancestor wrap; if none resolves, it goes to the status line.
  This keeps existing nested-object and scalar-array forms rendering errors
  exactly as before — the anti-goal demands it.

### Renderer (`src/form-html.ts`)

- Extract a scalar-control builder shared by top-level fields and table cells
  (text, number, select, date, range + `<output>` readout, checkbox).
- New table branch in `buildField` for arrays with object items: `<table>`
  with `<thead>` labels from item properties (`description`, falling back to
  the key — same convention as labels today), `<tbody>` rows seeded from
  `default` (else one empty row), an "Add row" button, and a remove button
  per row.
- Collect: walk `tbody` rows; per column apply the same scalar valueOf
  semantics as top-level fields; a row where every cell is empty is skipped;
  a kept row includes its boolean cells (false when unchecked); date cells
  submit `YYYY-MM-DD` strings; range cells submit integers.
- Errors: `showErrors` resolves dotted paths generally (see Validation):
  `rows.N.prop` targets a cell — input highlighted, message shown in the
  cell; `notes.spoilery` targets a fieldset child; `tags.0` targets an
  array item row. Plain top-level names keep working.
- CSS: table styles, compact in-cell controls, slider readout, horizontal
  scroll when columns overflow, dark-mode variants.

### Tool surface (`index.ts`)

- `description` and `promptGuidelines` gain: arrays of flat objects render as
  an editable table; `format:"date"` renders a date picker; `x-widget:"range"`
  renders a slider.
- `package.json`: drop the `zod` dependency, add `@earendil-works/pi-schema`
  to `peerDependencies` (`"*"`, like the other pi peers — always provided by
  the host pi install); description/keywords drop "Zod" wording; `bun
  install` verified after the change.

### README + assets

- Hero image right after the intro paragraph: composite PNG, committed to
  `assets/hero.png`. Secondary form-only shot (`assets/form-table.png`) next
  to the showcase schema.
- Showcase section: the demo schema + what it renders to. Supported-subset
  table gains rows for array-of-flat-objects, `format:"date"`,
  `x-widget:"range"`; the "`format` ignored" wording goes; "Zod"
  references become pi-schema wording throughout (intro, security section,
  dev layout section).
- Demo schema ("deployment rollout plan"): table rows
  `{environment: enum staging/canary/production (required), go_live: format:"date" (required),
  certainty: integer 0–100 with x-widget:"range", notify: boolean}`,
  plus one scalar field (rollout name) so the shot shows mixed single fields
  and table.
- Hero capture: the implementing agent performs the capture itself — its
  session has real browser automation (this environment can run a real
  browser, no repo tooling needed). Start the real server (the same path the
  tests use), open it in the automation browser at ~900px width, schema
  `default` prefills two rows, screenshot the form; compose side-by-side
  with a terminal-pane mock (HTML styled as the pi TUI: the `request_input`
  call and the status footer with the form URL). No generation script ships
  in the repo; the dev section notes how to recapture manually (start a
  one-off script against `startForm`, screenshot the page).

## Testing

- `subset.test.ts`: flat-object items accepted; nested object/array inside
  items rejected with path; table inside a nested object accepted;
  `format:"date"` accepted (all depths), combined with enum/pattern/
  minLength/maxLength rejected, ignored on non-strings; `x-widget:"range"`
  accepted on bounded integer (all depths), rejected on unbounded/
  non-integer with value `"range"`, ignored with other values; structurally
  bad `default` rows rejected, partial rows accepted.
- `schema-to-zod.test.ts` is **deleted**; its cases move to a
  `validation.test.ts` exercising the compiled pi-schema validator through
  the server path: array-of-objects parse and miss cases; required inside a
  row produces `rows.N.<prop>`-style paths; `date` format accepts
  `2026-03-01`, rejects `03/01/2026`; range bounds enforced; cleared
  defaults submit as absent.
- `renderer.test.ts` (jsdom): table builds from `default` rows; add/remove
  row; cell control types (date, range, select, checkbox); collect returns
  rows and skips all-empty rows; per-cell error render for `rows.1.go_live`;
  dotted-path errors for fieldset children and scalar-array items still
  render (existing behavior preserved).
- `server.test.ts`: live 422 with path-keyed `rows.N.<prop>` errors; 200 with
  a validated array payload.

## Left to the builder

- Exact CSS polish: spacing, slider readout placement, dark-mode values.
- Wording of the new subset rejection messages.
- Terminal-pane mock fidelity: plausible pi TUI look, not pixel-perfect.
