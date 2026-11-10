# pi-form: agent-authored browser forms for pi

Date: 2026-11-10
Status: approved (approach picked in conversation; user opted out of further questions)

## Intent

pi (terminal coding agent) sometimes needs structured input mid-run. Today the
agent can only ask in prose and parse free text, or use `ctx.ui` TUI prompts
which live in the terminal. Instead: the agent authors a schema for the input
it needs, a form is rendered in the user's **default browser**, the user fills
it and submits, the input is validated against that schema, and the validated
object is returned to the agent as the tool result so the run continues.

## Goals

- One generic tool `request_input(title, description?, schema, timeoutSeconds?)`
  that the LLM calls with a JSON Schema describing the input it needs.
- Default browser opens on a localhost page with a form generated from the schema.
- Server-side Zod validation is authoritative; field errors render in the form.
- Validated object returns to the LLM as JSON (tool result content).
- Terminal shows waiting status; Esc/abort cancels the form and closes the server.
- One pending form at a time (sequential execution).

## Non-goals (v1)

- Deep nesting: no arrays of objects, no `oneOf`/`anyOf`/`allOf`, no conditionals.
  Unsupported schema features fail fast with a clear error naming the keyword.
- No file upload, no persistence, no remote/lan access (localhost + token only).
- No mobile/remote tunneling.

## Why

User runs pi daily from the terminal. Terminal prompts are cramped for anything
beyond a line or a pick-list; the browser is where rich input naturally lives.
Dynamic (agent-authored) schemas because the agent, not the extension author,
knows mid-run what shape of input it needs.

## Approaches considered

1. **JSON Schema pipeline + hand-rolled form renderer (picked)** — agent emits
   JSON Schema (the same format pi uses for tool parameters, so LLMs are
   fluent); extension converts to Zod and validates; browser page is a single
   self-contained HTML+vanilla-JS file rendered from the same schema.
2. **JSON Schema + react-jsonschema-form** — full JSON Schema support for free,
   but a bundling step, ~300KB, dated styling. Escape hatch later: the protocol
   doesn't change, only the renderer.
3. **Simplified field DSL** — most predictable for the LLM, but not real JSON
   Schema, custom vocabulary to maintain, can't express nested shapes.

Picked 1: no build toolchain, single-file extension, full control of look, and
the agent already speaks JSON Schema.

## How (decided)

- **Schema transport:** `request_input` takes `schema` as a loose tool parameter
  (`Type.Any()`), validated in `execute()` against a supported-subset checker
  that produces clear "unsupported keyword: X at path Y" errors for the LLM.
- **Supported subset (v1):** top-level object; properties of type
  string (minLength/maxLength/format ignored, pattern supported), number,
  integer, boolean; string enums (→ select), enum arrays (→ checkboxes);
  arrays of string/number (→ repeatable inputs); one level of nested object
  (→ fieldset); `description` (→ label/help), `default`, `required`, min/max.
- **JSON Schema → Zod:** hand-rolled converter in `src/schema-to-zod.ts`.
  Not `z.fromJSONSchema` (experimental; subset is small enough to own).
  Zod v4 is the validation engine.
- **Browser page:** single HTML template with embedded CSS + vanilla JS
  (`src/form-html.ts`), schema embedded as JSON; POSTs to the same server.
- **Server:** `node:http` on 127.0.0.1, ephemeral port, random token in URL
  query checked on every request; closes after successful submit or abort.
  No third-party server dependency.
- **Browser launch:** `pi.exec` with `open` (macOS) / `xdg-open` (Linux) /
  `start` (Windows); URL printed in the TUI status as fallback.
- **Result:** `content` = `JSON.stringify(data)` (LLM reads it);
  `details` = `{ data }` for rendering; no dynamic `outputSchema` (pi's
  `outputSchema` is static per tool, cannot match a per-call schema).
- **Cancel/timeout:** `signal` listener closes server, tool returns
  "cancelled" error result; `timeoutSeconds` param, default 600.
- **TUI:** `ctx.ui.setStatus("pi-form", ...)` while the form is open; cleared
  on finish. Custom `renderCall`/`renderResult` keep the transcript compact.

## Layout

```
pi-form/
  package.json        # zod dep + "pi": {"extensions": ["./index.ts"]} manifest
  index.ts            # extension entry: registers request_input
  src/
    subset.ts         # supported-schema checker (clear rejects)
    schema-to-zod.ts  # subset → Zod
    form-html.ts      # self-contained form page (template + renderer)
    server.ts         # token-guarded localhost server + submit flow
    open-browser.ts   # platform opener
  test/               # vitest unit tests (subset, converter, server flow)
  README.md           # install: settings.json extensions path or ~/.pi/agent/extensions
```

## Testing

vitest. TDD on pure modules (subset checker, converter, server flow via fetch
against a live ephemeral server). Extension entry + browser flow verified
manually with a real pi run.

## Left to the builder

- Form styling details (clean dark/light-neutral, system font).
- Exact wording of tool `description`/`promptSnippet` that teaches the LLM
  when to reach for `request_input` instead of asking in prose.
