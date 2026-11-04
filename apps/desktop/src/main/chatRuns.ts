/**
 * Which conversations are working right now, and what each has shown so far this turn.
 *
 * A turn belongs to its conversation, not to the window: it keeps going when the person opens
 * another chat, minimises the app or closes the browser tab. This registry is what lets that
 * be true and still be legible -
 *
 * - **Several at once, each once.** Every conversation may run one turn; a cap on how many run
 *   together keeps rate limits and the machine sane, and the refusal says how to make room.
 * - **A replay for whoever looks.** Opening a chat that is mid-turn has to show its timeline as
 *   if it had been watched all along, so each run keeps the events the timeline draws, with the
 *   streamed pieces of a thought or a reply joined into one, bounded on very long turns.
 * - **Keeping going lives here, not in a window.** A turn stopped by its step limit is picked up
 *   again by the main process, so a minimised window (whose timers the browser slows to once a
 *   minute) or a closed tab cannot stall it.
 *
 * Pure: no Electron, no IPC, no storage. `ai.ts` owns the agents and feeds this.
 */

/** How many conversations may work at the same time. */
export const MAX_PARALLEL_CHATS = 4;

/**
 * How many times a turn that hit its step limit is continued by itself. Each request runs up to
 * 50 steps, so this is a thousand steps of unattended work before a person is asked.
 */
export const KEEP_GOING_LIMIT = 20;

/** What the transcript draws. Usage and context readings feed meters, and are not replayed. */
const REPLAYED = new Set(["thinking", "text", "tool-call", "tool-result", "tool-draft", "status", "compacting", "continuing"]);

export interface ReplayEvent {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface RunInfo {
  readonly sessionId: string;
  readonly title: string;
  readonly startedAt: number;
  /** Times this run has kept going by itself after a step limit. */
  readonly continued: number;
}

export type BeginResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface ChatRuns {
  begin(sessionId: string, title: string, now: number): BeginResult;
  isRunning(sessionId: string): boolean;
  /** One agent event of a running turn; ignored for a conversation that is not running. */
  record(sessionId: string, event: ReplayEvent): void;
  /** The running turn so far, for a chat opened partway through it. */
  replay(sessionId: string): readonly ReplayEvent[];
  /** Count one automatic continuation; returns how many there have been. */
  noteContinued(sessionId: string): number;
  end(sessionId: string): void;
  list(): RunInfo[];
}

interface Run {
  info: RunInfo;
  events: ReplayEvent[];
}

export function createChatRuns(options: { readonly maxParallel: () => number; readonly maxEvents?: number }): ChatRuns {
  const runs = new Map<string, Run>();
  const maxEvents = options.maxEvents ?? 5_000;

  return {
    begin(sessionId, title, now) {
      if (runs.has(sessionId)) return { ok: false, reason: "This conversation is already working." };
      const limit = Math.max(1, options.maxParallel());
      if (runs.size >= limit) {
        // Reported as "1 chats are already working": with one slot, name the chat that holds it.
        const busy = runs.values().next().value?.info.title.trim();
        return { ok: false, reason: limit === 1
          ? `Another chat${busy ? ` ("${busy}")` : ""} is still working. Stop it, or wait for it to finish, then send again.`
          : `${String(limit)} chats are already working. Stop one, or wait for one to finish.` };
      }
      runs.set(sessionId, { info: { sessionId, title, startedAt: now, continued: 0 }, events: [] });
      return { ok: true };
    },
    isRunning: (sessionId) => runs.has(sessionId),
    record(sessionId, event) {
      const run = runs.get(sessionId);
      if (run === undefined || !REPLAYED.has(event.kind)) return;
      const last = run.events.at(-1);
      // A thought or a reply streams in pieces; the replay draws it whole.
      if (last !== undefined && last.kind === event.kind && (event.kind === "text" || event.kind === "thinking")) {
        run.events[run.events.length - 1] = { ...last, text: `${String(last["text"] ?? "")}${String(event["text"] ?? "")}` };
        return;
      }
      // A file being written streams as pieces of one edit; the replay holds it whole.
      if (last !== undefined && last.kind === "tool-draft" && event.kind === "tool-draft" && last["id"] === event["id"] && last["edit"] === event["edit"]) {
        run.events[run.events.length - 1] = {
          ...last,
          append: `${String(last["append"] ?? "")}${String(event["append"] ?? "")}`,
          path: event["path"] ?? last["path"] ?? null,
        };
        return;
      }
      run.events.push(event);
      if (run.events.length > maxEvents) run.events.splice(0, run.events.length - maxEvents);
    },
    replay: (sessionId) => [...(runs.get(sessionId)?.events ?? [])],
    noteContinued(sessionId) {
      const run = runs.get(sessionId);
      if (run === undefined) return 0;
      run.info = { ...run.info, continued: run.info.continued + 1 };
      return run.info.continued;
    },
    end(sessionId) {
      runs.delete(sessionId);
    },
    list: () => [...runs.values()].map((run) => run.info),
  };
}

/** A turn stopped by its step limit goes on by itself while Keep going until done is on. */
export function shouldKeepGoing(input: { readonly detail: string; readonly keepGoing: boolean; readonly continued: number; readonly limit?: number }): boolean {
  return input.keepGoing && /step limit/i.test(input.detail) && input.continued < (input.limit ?? KEEP_GOING_LIMIT);
}
