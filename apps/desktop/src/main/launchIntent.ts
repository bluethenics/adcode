import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SessionState } from "./sessionStore.ts";

const OPEN_MARKER = "--adcode-open";

/** Resolve the optional path passed by `adcode open` into the normal session shape. */
export async function launchSessionFromArguments(
  arguments_: readonly string[],
  cwd: string,
): Promise<SessionState | null> {
  const marker = arguments_.indexOf(OPEN_MARKER);
  const requested = marker < 0 ? undefined : arguments_[marker + 1];
  if (requested === undefined || requested.length === 0) return null;

  const target = resolve(cwd, requested);
  try {
    const info = await stat(target);
    if (info.isDirectory()) return { root: target, openFiles: [], activeFile: null };
    if (info.isFile()) {
      return { root: dirname(target), openFiles: [target], activeFile: target };
    }
  } catch {
    // A missing command-line target must not prevent ADCode from opening normally.
  }
  return null;
}
