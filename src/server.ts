import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { SupportedSchema } from "./subset.js";
import { renderFormPage } from "./form-html.js";
import { toZodSchema } from "./schema-to-zod.js";
import type { FormPayload } from "./server-types.js";

export interface StartFormOptions {
  title: string;
  description?: string;
  schema: SupportedSchema;
  /** Aborting this signal cancels the form and closes the server. */
  signal?: AbortSignal;
  /** Give up and reject with Error("timeout") after this long. */
  timeoutMs?: number;
}

export interface FormHandle {
  /** URL of the form page, token included. */
  url: string;
  /** Resolves with validated data, rejects with Error("aborted"|"timeout"). */
  result: Promise<Record<string, unknown>>;
  /** Cancel the form and free the port. Idempotent. */
  close(): void;
}

const MAX_BODY_BYTES = 1024 * 1024;
const NO_CONTENT = { "Content-Type": "text/plain", "Connection": "close" };
const JSON_CONTENT = { "Content-Type": "application/json; charset=utf-8", "Connection": "close" };

/** Read the request body; resolves null when it exceeds MAX_BODY_BYTES.
 * Always drains the request so an early 413 response doesn't reset the
 * client's connection mid-upload. */
async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"] ?? 0);
  const overFromStart = declared > MAX_BODY_BYTES;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let over = overFromStart;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (over) return;
      if (total > MAX_BODY_BYTES) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function fieldErrors(issues: Array<{ path: PropertyKey[]; message: string }>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_";
    if (!Object.hasOwn(errors, key)) {
      errors[key] = issue.message;
    }
  }
  return errors;
}

export async function startForm(opts: StartFormOptions): Promise<FormHandle> {
  const token = randomBytes(32).toString("base64url");
  const zodSchema = toZodSchema(opts.schema);

  let settled = false;
  let server: Server | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let resolveResult!: (data: Record<string, unknown>) => void;
  let rejectResult!: (err: Error) => void;
  const result = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Cancellation is not a crash: a form the caller closed without awaiting
  // must not surface as an unhandled rejection. Callers that await still get
  // the rejection.
  result.catch(() => {});

  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort && opts.signal) opts.signal.removeEventListener("abort", onAbort);
  };

  const close = () => {
    const s = server;
    server = undefined;
    if (s) {
      s.close();
      s.closeAllConnections();
    }
    if (!settled) {
      settled = true;
      cleanup();
      rejectResult(new Error("aborted"));
    }
  };

  const finishError = (message: string) => {
    if (settled) return;
    settled = true;
    cleanup();
    closeServer();
    rejectResult(new Error(message));
  };

  const closeServer = () => {
    const s = server;
    server = undefined;
    if (s) {
      s.close();
      s.closeAllConnections();
    }
  };

  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.searchParams.get("t") !== token) {
      res.writeHead(404, NO_CONTENT);
      res.end();
      return;
    }
    const respond = (code: number, body: unknown, headers = JSON_CONTENT) => {
      res.writeHead(code, headers);
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };

    if (req.method === "GET") {
      const payload: FormPayload = {
        title: opts.title,
        description: opts.description,
        schema: opts.schema,
        token,
        port: (server?.address() as { port: number } | null)?.port ?? 0,
      };
      respond(200, renderFormPage(payload), {
        "Content-Type": "text/html; charset=utf-8",
        "Connection": "close",
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/submit") {
      readBody(req)
        .then((body) => {
          if (body === null) {
            respond(413, { ok: false, error: "body too large" });
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(body.toString("utf-8"));
          } catch {
            respond(400, { ok: false, error: "invalid JSON" });
            return;
          }
          const outcome = zodSchema.safeParse(parsed);
          if (!outcome.success) {
            respond(422, { ok: false, errors: fieldErrors(outcome.error.issues) });
            return;
          }
          settled = true;
          cleanup();
          respond(200, { ok: true, data: outcome.data });
          res.on("close", () => {
            closeServer();
            resolveResult(outcome.data as Record<string, unknown>);
          });
        })
        .catch(() => {
          respond(413, { ok: false, error: "body too large" });
        });
      return;
    }

    respond(404, { ok: false, error: "not found" });
  });

  await new Promise<void>((resolve, reject) => {
    const s = server!;
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (server!.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/form?t=${token}`;

  if (opts.signal) {
    if (opts.signal.aborted) {
      close();
      return { url, result, close };
    }
    onAbort = () => finishError("aborted");
    opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  if (opts.timeoutMs !== undefined) {
    timer = setTimeout(() => finishError("timeout"), opts.timeoutMs);
  }

  return { url, result, close };
}
