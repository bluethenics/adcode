import { stat } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Validate an explicit `adcode open` target before doing an expensive build or replacing
 * a running editor's workspace. The launcher only accepts one target today; later
 * arguments remain reserved for launcher flags.
 */
export async function validateOpenTarget(arguments_, cwd) {
  const requested = arguments_[0];
  if (requested === undefined) return { ok: true, target: null };

  const target = resolve(cwd, requested);
  try {
    const info = await stat(target);
    if (info.isDirectory() || info.isFile()) return { ok: true, target };
  } catch {
    // The specific problem is deliberately collapsed into a stable user-facing message.
  }

  return {
    ok: false,
    message: `ADCode could not open "${target}" because it does not exist.`,
  };
}
