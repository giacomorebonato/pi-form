import { describe, expect, it } from "vitest";
import { openBrowser } from "../src/open-browser.js";

type FakeChild = { on: (event: string, cb: (err: Error) => void) => void };

function fakeSpawn(expectedCmd?: string, expectedArgs?: string[], error?: Error) {
  return (cmd: string, args: string[]) => {
    if (expectedCmd) expect(cmd).toBe(expectedCmd);
    if (expectedArgs) expect(args).toEqual(expectedArgs);
    return {
      on(event: string, cb: (err: Error) => void) {
        if (event === "error" && error) cb(error);
      },
    } satisfies FakeChild as FakeChild;
  };
}

describe("openBrowser — platform commands", () => {
  it("darwin uses open", async () => {
    const r = await openBrowser("http://x.dev", fakeSpawn("open", ["http://x.dev"]), "darwin");
    expect(r).toEqual({ opened: true });
  });

  it("linux uses xdg-open", async () => {
    const r = await openBrowser("http://x.dev", fakeSpawn("xdg-open", ["http://x.dev"]), "linux");
    expect(r).toEqual({ opened: true });
  });

  it("win32 uses cmd /c start", async () => {
    const r = await openBrowser(
      "http://x.dev",
      fakeSpawn("cmd", ["/c", "start", "", "http://x.dev"]),
      "win32"
    );
    expect(r).toEqual({ opened: true });
  });

  it("spawn failure never throws and reports the error", async () => {
    const r = await openBrowser("http://x.dev", fakeSpawn(undefined, undefined, new Error("ENOENT")), "darwin");
    expect(r.opened).toBe(false);
    expect(r.error).toContain("ENOENT");
  });
});
