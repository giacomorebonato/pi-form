import { afterAll, describe, expect, it } from "vitest";
import { fieldErrors, startForm } from "../src/server.js";

const schema = {
  type: "object",
  required: ["title", "rating"],
  properties: {
    title: { type: "string", minLength: 2 },
    rating: { type: "integer", minimum: 1, maximum: 5 },
  },
} as never;

const handles: Array<{ close: () => void }> = [];
afterAll(() => {
  for (const h of handles) h.close();
});

async function makeForm(overrides: Record<string, unknown> = {}) {
  const handle = await startForm({
    title: "Test form",
    description: "fill me",
    schema,
    ...overrides,
  } as never);
  handles.push(handle);
  return handle;
}

describe("fieldErrors", () => {
  it("keeps errors for prototype-chain property names", () => {
    expect(fieldErrors([{ path: ["constructor"], message: "required" }])).toEqual({
      constructor: "required",
    });
    expect(fieldErrors([{ path: ["toString"], message: "bad" }])).toEqual({
      toString: "bad",
    });
  });
});

describe("startForm — serving the page", () => {
  it("GET with correct token returns the form page", async () => {
    const form = await makeForm();
    const res = await fetch(form.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<form");
    expect(body).toContain("Test form");
  });

  it("GET/POST with missing or wrong token returns 404", async () => {
    const form = await makeForm();
    const noToken = form.url.replace(/\?t=.*/, "");
    expect((await fetch(noToken)).status).toBe(404);
    expect((await fetch(`${noToken}?t=wrong`)).status).toBe(404);
    expect((await fetch(`${noToken}/submit?t=wrong`, { method: "POST" })).status).toBe(404);
  });
});

describe("startForm — submit flow", () => {
  it("valid POST resolves form.result with data and closes the server", async () => {
    const form = await makeForm();
    const submitUrl = new URL(form.url);
    submitUrl.pathname = "/submit";
    const res = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "hello", rating: 3 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ title: "hello", rating: 3 });
    expect(await form.result).toEqual({ title: "hello", rating: 3 });
    await expect(fetch(form.url)).rejects.toThrow();
  });

  it("invalid POST returns 422 with field errors and leaves result pending", async () => {
    const form = await makeForm();
    const submitUrl = new URL(form.url);
    submitUrl.pathname = "/submit";
    const res = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x", rating: 99 }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; errors: Record<string, string> };
    expect(body.ok).toBe(false);
    expect(typeof body.errors.title).toBe("string");
    expect(typeof body.errors.rating).toBe("string");
    const pending = await Promise.race([
      form.result.then(() => "settled"),
      new Promise((r) => setTimeout(() => r("pending"), 100)),
    ]);
    expect(pending).toBe("pending");
  });

  it("rejects non-JSON and oversized bodies", async () => {
    const form = await makeForm();
    const submitUrl = new URL(form.url);
    submitUrl.pathname = "/submit";
    const bad = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(bad.status).toBe(400);
    const big = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "a".repeat(2 * 1024 * 1024) }),
    });
    expect(big.status).toBe(413);
  });
});

describe("startForm — cancellation", () => {
  it("close() rejects result with 'aborted' and frees the port", async () => {
    const form = await makeForm();
    const url = form.url;
    form.close();
    await expect(form.result).rejects.toThrow("aborted");
    await expect(fetch(url)).rejects.toThrow();
    // Idempotent
    form.close();
  });

  it("pre-aborted signal rejects result with 'aborted'", async () => {
    const ac = new AbortController();
    ac.abort();
    const form = await makeForm({ signal: ac.signal });
    await expect(form.result).rejects.toThrow("aborted");
  });

  it("timeoutMs elapsing rejects result with 'timeout'", async () => {
    const form = await makeForm({ timeoutMs: 50 });
    await expect(form.result).rejects.toThrow("timeout");
  });
});

describe("startForm — concurrency isolation", () => {
  it("two concurrent forms use distinct ports and tokens", async () => {
    const a = await makeForm();
    const b = await makeForm();
    expect(a.url).not.toBe(b.url);

    const aUrl = new URL(a.url);
    const bUrl = new URL(b.url);
    expect(aUrl.port).not.toBe(bUrl.port);

    // b's token must not open a's form
    const crossUrl = `${aUrl.origin}${aUrl.pathname}?${bUrl.searchParams}`;
    expect((await fetch(crossUrl)).status).toBe(404);
    // and each valid token still works on its own server
    expect((await fetch(a.url)).status).toBe(200);
    expect((await fetch(b.url)).status).toBe(200);
  });
});
