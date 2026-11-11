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

describe("renderer — date and range controls", () => {
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
    expect(document.querySelector("input:not([type=range])")!.type).toBe("text");
    expect(document.querySelector("select")).toBeTruthy();
  });

  it("leaves a non-ISO date default empty (no garbage prefill)", () => {
    mount({ go_live: { type: "string", format: "date", default: "03/01/2026" } });
    expect((document.querySelector("input") as HTMLInputElement).value).toBe("");
  });
});
