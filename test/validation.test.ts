import { afterAll, describe, expect, it } from "vitest";
import { startForm } from "../src/server.js";

/** Validation behavior through the live server, as the renderer submits. */
const handles: Array<{ close: () => void }> = [];
afterAll(() => {
  for (const h of handles) h.close();
});

async function postForm(schema: unknown, data: unknown) {
  const handle = await startForm({ title: "V", schema } as never);
  handles.push(handle);
  const url = new URL(handle.url);
  url.pathname = "/submit";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const errorsOf = (body: Record<string, unknown>) => body.errors as Record<string, string>;

describe("validation via pi-schema", () => {
  it('validates format:"date" server-side', async () => {
    const schema = { type: "object", properties: { go_live: { type: "string", format: "date" } } };
    const ok = await postForm(schema, { go_live: "2026-03-01" });
    expect(ok.status).toBe(200);
    const bad = await postForm(schema, { go_live: "03/01/2026" });
    expect(bad.status).toBe(422);
    expect(errorsOf(bad.body).go_live).toBeTruthy();
  });

  it("reports table row errors at rows.N.column", async () => {
    const schema = {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              environment: { type: "string", enum: ["staging", "production"] },
              go_live: { type: "string", format: "date" },
            },
            required: ["environment"],
          },
        },
      },
    };
    const r = await postForm(schema, { rows: [{ go_live: "2026-03-01" }] });
    expect(r.status).toBe(422);
    expect(errorsOf(r.body)["rows.0.environment"]).toBeTruthy();
  });

  it("does not materialize defaults on submit", async () => {
    const r = await postForm(
      { type: "object", properties: { name: { type: "string", default: "x" } } },
      {}
    );
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({});
  });

  it("reports nested required at the inner path", async () => {
    const r = await postForm(
      {
        type: "object",
        properties: {
          opts: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
        },
      },
      { opts: {} }
    );
    expect(r.status).toBe(422);
    expect(errorsOf(r.body)["opts.note"]).toBeTruthy();
  });

  it("reports scalar array item errors at list.N", async () => {
    const r = await postForm(
      { type: "object", properties: { tags: { type: "array", items: { type: "number" } } } },
      { tags: ["abc"] }
    );
    expect(r.status).toBe(422);
    expect(errorsOf(r.body)["tags.0"]).toBeTruthy();
  });
});
