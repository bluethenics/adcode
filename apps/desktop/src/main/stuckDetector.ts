/**
 * The stuck guard for agent runs.
 *
 * Fed each trace event as the agent works. It says "stuck" in two cases only:
 *  - the exact same call has failed four times with no success of that call in between, or
 *  - the exact same call was made six times in a row with nothing else in between.
 *
 * Running the tests again and again while fixing different failures is normal work, so a
 * success of the call resets its count and only an identical call (tool and target) counts.
 * Pure; the runner decides what to do about it.
 */
import type { AgentEventTrace } from "./aiEventTrace.ts";

export interface StuckDetector {
  /** A plain reason when the run looks stuck, otherwise null. */
  observe(trace: AgentEventTrace): string | null;
}

const FAILURES = 4;
const REPEATS = 6;

function describe(name: string, detail: string): string {
  if (name === "run_command") return detail || "a command";
  if (name === "edit_file" || name === "propose_edit") return detail ? `editing ${detail}` : "an edit";
  return detail ? `${name} on ${detail}` : name;
}

export function createStuckDetector(): StuckDetector {
  const pending: { readonly name: string; readonly detail: string; readonly key: string }[] = [];
  const failures = new Map<string, number>();
  let lastKey: string | null = null;
  let streak = 0;

  return {
    observe(trace): string | null {
      if (trace.kind === "tool-call") {
        const name = trace.summary.replace(/^Called /, "");
        const detail = trace.detail.trim();
        const key = `${name}\u0000${detail}`;
        streak = key === lastKey ? streak + 1 : 1;
        lastKey = key;
        pending.push({ name, detail, key });
        return streak >= REPEATS ? `${describe(name, detail)} was repeated ${streak} times in a row` : null;
      }
      if (trace.kind === "tool-result") {
        const done = pending.shift();
        if (done === undefined) return null;
        if (trace.outcome !== "failed") {
          failures.delete(done.key);
          return null;
        }
        const count = (failures.get(done.key) ?? 0) + 1;
        failures.set(done.key, count);
        return count >= FAILURES ? `${describe(done.name, done.detail)} kept failing (${count} tries)` : null;
      }
      return null;
    },
  };
}
