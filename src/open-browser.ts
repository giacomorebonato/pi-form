import { spawn } from "node:child_process";

export interface OpenBrowserResult {
  opened: boolean;
  error?: string;
}

type SpawnFn = (cmd: string, args: string[]) => { on: (event: string, cb: (err: Error) => void) => void };

function defaultSpawn(cmd: string, args: string[]): ReturnType<SpawnFn> {
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
  return child;
}

/**
 * Open the user's default browser at `url`. Best-effort: never throws —
 * callers print the URL in the terminal as the fallback.
 */
export async function openBrowser(
  url: string,
  spawnFn: SpawnFn = defaultSpawn,
  platform: NodeJS.Platform = process.platform
): Promise<OpenBrowserResult> {
  let cmd: string;
  let args: string[];
  switch (platform) {
    case "darwin":
      cmd = "open";
      args = [url];
      break;
    case "win32":
      cmd = "cmd";
      args = ["/c", "start", "", url];
      break;
    default:
      cmd = "xdg-open";
      args = [url];
      break;
  }

  let errorMessage: string | undefined;
  try {
    const child = spawnFn(cmd, args);
    child.on("error", (err) => {
      errorMessage = err.message;
    });
  } catch (err) {
    return { opened: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Give the spawn error event (async, e.g. ENOENT) a chance to fire.
  await new Promise((resolve) => setImmediate(resolve));
  if (errorMessage !== undefined) {
    return { opened: false, error: errorMessage };
  }
  return { opened: true };
}
