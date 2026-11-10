import { describe, expect, it } from "vitest";
import { renderFormPage } from "../src/form-html.js";

const baseSchema = {
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string", description: "Book title" },
    rating: { type: "integer", minimum: 1, maximum: 5 },
  },
};

const payload = {
  title: "Book details",
  schema: baseSchema as never,
  token: "tok123",
  port: 4567,
};

describe("renderFormPage — escaping", () => {
  it("escapes hostile title in <title> and body", () => {
    const html = renderFormPage({ ...payload, title: "<script>alert(1)</script>" });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("neutralizes script-breaking sequences inside the JSON payload", () => {
    const html = renderFormPage({
      ...payload,
      schema: {
        type: "object",
        properties: {
          note: { type: "string", description: "</script><b>x</b>" },
        },
      } as never,
    });
    expect(html).not.toContain("</script><");
    expect(html).toContain("\\u003c/script\\u003e");
  });

  it("escapes hostile description in the page body", () => {
    const html = renderFormPage({
      ...payload,
      description: "<img src=x onerror=alert(2)>",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");
  });
});

describe("renderFormPage — structure", () => {
  const html = renderFormPage(payload);

  it("contains a form element and the schema's property names", () => {
    expect(html).toContain("<form");
    expect(html).toContain("title");
    expect(html).toContain("rating");
  });

  it("embeds token and port in the payload", () => {
    expect(html).toContain("tok123");
    expect(html).toContain("4567");
  });

  it("renders title and description for the user", () => {
    expect(html).toContain("Book details");
    expect(html).toContain("<h1");
  });

  it("submits to /submit with the token under the t param", () => {
    expect(html).toContain("/submit?t=");
    expect(html).not.toContain("token=");
  });
});
