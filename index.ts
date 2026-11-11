import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { checkSupportedSchema } from "./src/subset.js";
import { startForm } from "./src/server.js";
import { openBrowser } from "./src/open-browser.js";

const DEFAULT_TIMEOUT_SECONDS = 600;

/**
 * pi-form: lets the agent collect structured input from the human via a
 * browser form. The agent authors a JSON Schema; pi-form renders the form in
 * the default browser, validates the submission with Zod, and returns the
 * data to the agent as JSON.
 */
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "request_input",
    label: "Request input",
    description:
      "Ask the human for structured input via a form rendered in their default browser. " +
      "Provide a JSON Schema (type: object) describing the fields you need; the human fills " +
      "the form in the browser and the validated JSON is returned to you. " +
      "Supported: string, number, integer, boolean, string enums, arrays of string/number/enum, " +
      "one level of nested object, description, default, required, min/max, minLength/maxLength/pattern. " +
      "Arrays of flat objects render as an editable table of inputs; string format \"date\" renders a native " +
      "date picker; x-widget \"range\" on a bounded integer renders a range slider.",
    promptSnippet: "Collect structured input from the human via a browser form (request_input)",
    promptGuidelines: [
      "Use request_input when you need structured input with multiple fields, enums or validation " +
        "from the human; for a single quick question, ask in prose instead.",
      "request_input schemas must be plain JSON Schema objects: type object with string/number/integer/" +
        "boolean/enum/array properties, at most one nesting level; oneOf/anyOf/$ref and deep nesting are rejected. " +
        "format: \"date\" is validated server-side; x-widget is the only custom keyword honored (\"range\").",
    ],
    executionMode: "sequential",
    parameters: Type.Object({
      title: Type.String({ description: "Short human-readable form title" }),
      description: Type.Optional(
        Type.String({ description: "Explain to the user why this input is needed" })
      ),
      schema: Type.Any({
        description:
          'JSON Schema for the input you need: { "type": "object", "required": [...], "properties": {...} }',
      }),
      timeoutSeconds: Type.Optional(
        Type.Number({ description: `Give up after this long (default ${DEFAULT_TIMEOUT_SECONDS})` })
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const title: string = params.title;
      const timeoutMs = (params.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;

      const checked = checkSupportedSchema(params.schema);
      if (!checked.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                "request_input schema rejected:\n" +
                checked.errors.map((e) => `- ${e}`).join("\n") +
                "\nFix the schema and call request_input again.",
            },
          ],
          details: { title, errors: checked.errors },
        };
      }

      const form = await startForm({
        title,
        description: params.description,
        schema: checked.schema,
        signal: signal ?? undefined,
        timeoutMs,
      });

      const status = (text: string | undefined) => {
        if (ctx.hasUI) ctx.ui.setStatus("pi-form", text);
      };
      status(`Form "${title}" waiting in browser — ${form.url} (Esc cancels)`);

      const opened = await openBrowser(form.url);
      if (!opened.opened) {
        status(`Open this form in your browser: ${form.url}`);
      }

      try {
        const data = await form.result;
        status(undefined);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(data) }],
          details: { title, data },
        };
      } catch (err) {
        form.close();
        status(undefined);
        const timedOut = err instanceof Error && err.message === "timeout";
        const message = timedOut
          ? `Form input timed out after ${params.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS}s`
          : "Form input cancelled (browser form closed)";
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
          details: { title },
        };
      }
    },

    renderCall(args, theme) {
      return new Text(theme.fg("accent", `⏳ Form: ${String(args.title)}`), 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = (result as { details?: { title?: string } }).details;
      const isError = (result as { isError?: boolean }).isError;
      const label = details?.title ?? "form";
      const text = isError ? `✗ Form cancelled: ${label}` : `✓ Form submitted: ${label}`;
      return new Text(theme.fg("accent", text), 0, 0);
    },
  });
}
