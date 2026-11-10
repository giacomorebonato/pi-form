# pi-form

A [pi](https://pi.dev) extension. When the agent needs structured input from
you mid-run, it authors a JSON Schema for the input, pi-form renders a form
from that schema in your **default browser**, you fill it in, the submission
is validated with [Zod](https://zod.dev), and the validated object is returned
to the agent so the run continues with real data.

```
agent: "I need a book title and a 1-5 rating"
   │
   ├─ calls request_input(title, schema)          (tool call)
   ├─ pi-form opens http://127.0.0.1:<port>/form  (default browser)
   ├─ you fill the form, submit
   └─ {"book_title":"Dune","rating":5}            (tool result → agent)
```

Terminal stays usable the whole time; the footer shows the form URL and
`Esc` cancels the form and closes the server.

## Install

**Option A — settings.json (recommended):** add the repo path to
`~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "/absolute/path/to/pi-form"
  ]
}
```

**Option B — extensions dir:** symlink it into pi's global extensions:

```sh
ln -s /absolute/path/to/pi-form ~/.pi/agent/extensions/pi-form
```

**One-off:** `pi -e /absolute/path/to/pi-form/index.ts`

Requires Node >= 20, pi >= 1.5.

## Usage

Just ask, e.g.:

> Before you continue, use request_input to ask me for the deployment target
> (enum: staging, production), a version string, and whether to notify the
> team (boolean).

The agent calls the `request_input` tool with a JSON Schema; your browser
opens the form. Fields render from the schema (labels from `description`,
defaults pre-filled, required fields marked). Invalid submissions show
per-field errors from server-side Zod validation and never reach the agent.

### Example schema

```json
{
  "type": "object",
  "required": ["book_title", "rating"],
  "properties": {
    "book_title": { "type": "string", "description": "Book title", "minLength": 2 },
    "rating": { "type": "integer", "description": "1-5", "minimum": 1, "maximum": 5 },
    "genres": { "type": "array", "items": { "type": "string", "enum": ["scifi", "fantasy", "noir"] } },
    "notes": { "type": "object", "properties": { "spoilery": { "type": "boolean" } } }
  }
}
```

## Supported schema subset

| Feature | Form rendering |
|---|---|
| `string` (+ `minLength`, `maxLength`, `pattern`) | text input with native hints |
| `number`, `integer` (+ `minimum`, `maximum`) | number input |
| `boolean` | checkbox |
| string `enum` | select |
| array of `string`/`number` | repeatable inputs |
| array of `enum` | checkbox group |
| one nested `object` level | fieldset |
| `description`, `default`, `required` | label/help text, prefill, `*` mark |

Anything outside the subset — `oneOf`/`anyOf`/`allOf`, `$ref`, conditionals,
arrays of objects, deeper nesting — is rejected with a path-qualified error the
agent reads and fixes. `title`, `format` and unknown metadata keys are ignored.

## Security

- The form server binds `127.0.0.1` only, on an ephemeral port, and guards
  every request with a random 32-byte token in the URL.
- The server closes after a valid submission, abort (`Esc`), or timeout
  (default 600s; the agent can pass `timeoutSeconds`).
- Everything the agent authored (title, description, schema) is untrusted:
  HTML-escaped in the page, `<`-neutralized inside the JSON payload.
- Submissions over 1 MiB are rejected. Only one form can be pending at a time.

## Development

```sh
npm install
npm test        # vitest, unit + live-server tests
```

Manual check: `pi -e "$(pwd)/index.ts"` and ask the agent to use
`request_input`.

Layout: `index.ts` (extension entry, `request_input` tool) · `src/subset.ts`
(schema subset checker) · `src/schema-to-zod.ts` (Zod conversion) ·
`src/form-html.ts` (self-contained form page) · `src/server.ts` (localhost
form server) · `src/open-browser.ts` (default-browser opener).
