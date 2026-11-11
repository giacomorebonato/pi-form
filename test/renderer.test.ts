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

describe("renderer — table arrays", () => {
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
  const tableNoDefault = { ...tableProp, default: undefined };

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
    mount({ rows: tableNoDefault });
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

  it("skips a row whose cells are all empty (emptiable columns only)", async () => {
    // Columns a cell can leave untouched: text and date. A required enum
    // select (auto-first-option) or range slider always has a value, so a
    // row with those columns can never be "all empty" — native semantics.
    mount({
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            environment: { type: "string", description: "Environment" },
            go_live: { type: "string", format: "date" },
          },
        },
      },
    });
    (document.querySelector(".btn-add") as HTMLElement).click(); // empty second row
    const calls = submitWith({ status: 200, body: { ok: true, data: {} } });
    await tick();
    expect(JSON.parse(calls[0].body)).toEqual({ rows: [] });
  });

  it("collects a boolean-only unchecked row as {notify: false}", async () => {
    mount({
      rows: {
        type: "array",
        items: { type: "object", properties: { notify: { type: "boolean" } } },
      },
    });
    (document.querySelector(".btn-add") as HTMLElement).click(); // untouched row: checkbox unchecked
    const calls = submitWith({ status: 200, body: { ok: true, data: {} } });
    await tick();
    // Both the seeded empty row and the added row submit as {notify: false}:
    // a boolean cell is never "empty", so such rows are always kept.
    expect(JSON.parse(calls[0].body)).toEqual({ rows: [{ notify: false }, { notify: false }] });
  });
});

describe("renderer — dotted error paths", () => {
  const tableProp = {
    type: "array",
    items: {
      type: "object",
      properties: {
        environment: { type: "string", enum: ["staging", "canary", "production"] },
        go_live: { type: "string", format: "date" },
      },
      required: ["environment"],
    },
    default: [{ environment: "staging" }, { environment: "canary" }],
  } as never;

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
});

describe("renderer — multi-error clear isolation", () => {
  it("clearing one field's error leaves the other field's error intact", async () => {
    mount({ aaa: { type: "string" }, bbb: { type: "string" } }, ["aaa", "bbb"]);
    submitWith({ status: 422, body: { ok: false, errors: { aaa: "fix aaa", bbb: "fix bbb" } } });
    await tick();
    const aaaField = document.querySelector('.field[data-field="aaa"]')!;
    const bbbField = document.querySelector('.field[data-field="bbb"]')!;
    expect(aaaField.querySelector(".err")!.textContent).toBe("fix aaa");
    expect(bbbField.querySelector(".err")!.textContent).toBe("fix bbb");
    const aaaInput = aaaField.querySelector("input")!;
    aaaInput.value = "typed";
    aaaInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(aaaField.querySelector(".err")).toBeNull();
    expect(bbbField.querySelector(".err")!.textContent).toBe("fix bbb");
  });
});
