// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderFormPage, RENDERER } from "../src/form-html.js";
import type { FormPayload } from "../src/server-types.js";

function mount(properties: Record<string, unknown>, required: string[] = []) {
  const payload: FormPayload = {
    title: "T",
    schema: { type: "object", properties, required } as never,
    token: "tok",
    port: 1234,
  };
  document.documentElement.innerHTML = renderFormPage(payload);
  (0, eval)(RENDERER);
}

function submitWith(response: { status: number; body: unknown }) {
  const calls: Array<{ url: string; body: string }> = [];
  window.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
    calls.push({ url: String(_url), body: init?.body ?? "" });
    return { status: response.status, json: async () => response.body } as never;
  }) as unknown as typeof window.fetch;
  document
    .getElementById("pi-form-form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return calls;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("renderer — defaults prefill", () => {
  it("boolean default true prefills the checkbox", () => {
    mount({ loud: { type: "boolean", default: true } });
    const cb = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("enum default preselects the option", () => {
    mount({ severity: { type: "string", enum: ["low", "high"], default: "high" } });
    const sel = document.querySelector("select") as HTMLSelectElement;
    expect(sel.value).toBe("high");
  });
});

describe("renderer — required nested object with optional inners", () => {
  it("submits {} for an untouched required nested object", async () => {
    mount(
      { opts: { type: "object", properties: { note: { type: "string" } } } },
      ["opts"]
    );
    const calls = submitWith({ status: 200, body: { ok: true, data: {} } });
    await tick();
    expect(JSON.parse(calls[0].body)).toEqual({ opts: {} });
  });

  it("still omits an untouched optional nested object", async () => {
    mount({ opts: { type: "object", properties: { note: { type: "string" } } } });
    const calls = submitWith({ status: 200, body: { ok: true, data: {} } });
    await tick();
    expect(JSON.parse(calls[0].body)).toEqual({});
  });
});

describe("renderer — error display", () => {
  it("shows the field error for a name containing a quote", async () => {
    mount({ 'we"ird': { type: "string" } }, ['we"ird']);
    submitWith({ status: 422, body: { ok: false, errors: { 'we"ird': "too short" } } });
    await tick();
    const err = document.querySelector(".err");
    expect(err?.textContent).toBe("too short");
  });

  it("regression: shows errors for plain names too", async () => {
    mount({ plain: { type: "string" } }, ["plain"]);
    submitWith({ status: 422, body: { ok: false, errors: { plain: "missing" } } });
    await tick();
    expect(document.querySelector(".err")?.textContent).toBe("missing");
  });
});
