/**
 * A turn's progress, saved while it works.
 *
 * A turn used to write the person's message when it started and the answer when it finished,
 * and nothing in between. Closing ADCode mid-task - or a crash, or an update restart - left a
 * conversation that ended in a prompt with no output, as if the assistant had never started;
 * people sent the same prompt again. Now the words so far and the steps taken are saved every
 * couple of seconds as an answer marked `interrupted`. The finished answer replaces it on the
 * same file; it only survives when the turn never got to finish.
 *
 * Pure apart from the timer: the caller says how to save, so this is tested without a disk.
 */

/** How often progress is written while a turn works. */
export const PROGRESS_SAVE_MS = 1_500;
/** Steps kept in the saved progress; older ones are counted, not listed. */
const MAX_STEPS = 40;

/** One line for a step, from a tool call's name and input: `run_command: npm test`. */
export function describeToolCall(name: string, input: Record<string, unknown>): string {
  const detail = ["command", "path", "file_path", "filePath", "query", "pattern", "url", "title"]
    .map((key) => input[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const flat = detail?.replace(/\s+/g, " ").trim() ?? "";
  return flat.length === 0 ? name : `${name}: ${flat.length > 120 ? `${flat.slice(0, 119)}…` : flat}`;
}

/** The saved text: what was written so far, then the steps, so the next turn knows them too. */
export function progressText(answer: string, steps: readonly string[]): string {
  const shown = steps.slice(-MAX_STEPS);
  const earlier = steps.length - shown.length;
  const list = shown.length === 0
    ? ""
    : `Steps taken before ADCode closed:\n${earlier > 0 ? `- …and ${String(earlier)} earlier step${earlier === 1 ? "" : "s"}\n` : ""}${shown.map((step) => `- ${step}`).join("\n")}`;
  return [answer.trim(), list].filter((part) => part.length > 0).join("\n\n");
}

export interface TurnProgress {
  /** A step the turn took: a tool call, a command a coding CLI ran. */
  step(line: string): void;
  /** Words were added to the answer. */
  wrote(): void;
  /** No more saves; resolves once a save already under way has landed, so the final write wins. */
  stop(): Promise<void>;
}

export function createTurnProgress(deps: {
  readonly answer: () => string;
  readonly save: (text: string) => Promise<void>;
  readonly delayMs?: number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}): TurnProgress {
  const steps: string[] = [];
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => { const timer = setTimeout(run, ms); timer.unref?.(); return timer; });
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let stopped = false;
  let writing: Promise<void> = Promise.resolve();
  let lastSaved = "";

  function flush(): void {
    timer = null;
    if (stopped) return;
    const text = progressText(deps.answer(), steps);
    if (text.length === 0 || text === lastSaved) return;
    lastSaved = text;
    // One save at a time, in order: a slow disk never lands an older progress over a newer one.
    writing = writing.then(() => (stopped ? undefined : deps.save(text))).catch(() => undefined);
  }

  function schedule(): void {
    if (stopped || timer !== null) return;
    timer = setTimer(flush, deps.delayMs ?? PROGRESS_SAVE_MS);
  }

  return {
    step(line) {
      if (stopped || line.trim().length === 0) return;
      if (steps[steps.length - 1] !== line) steps.push(line);
      schedule();
    },
    wrote() {
      schedule();
    },
    async stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      await writing;
    },
  };
}
