import { rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

/** Windows readers/scanners can briefly lock an otherwise valid atomic replacement. */
export async function atomicReplace(
  temporary: string,
  target: string,
  deps: {
    readonly replace: (from: string, to: string) => Promise<void>;
    readonly wait: (milliseconds: number) => Promise<unknown>;
  } = { replace: rename, wait: delay },
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await deps.replace(temporary, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (attempt >= 5 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
      // Never delete the destination to work around a lock: the last complete state
      // remains recoverable even if all attempts fail or the process exits.
      await deps.wait(50 * 2 ** attempt);
    }
  }
}
