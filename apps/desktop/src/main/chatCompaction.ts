/**
 * The settings and bookkeeping around compaction that belong to the shell, not the agent.
 *
 * The agent decides how to compact; this decides when the user asked it to (the two
 * settings), how big the model's context is (the catalogue, or a safe guess), and how a
 * compaction maps onto the saved transcript. Pure, so it is tested without a window.
 */
import { DEFAULT_CONTEXT_WINDOW, contextWindowOf, type CatalogueProvider, type Message } from "@adcode/ai";

const THRESHOLDS: ReadonlySet<string> = new Set(["70", "80", "90"]);

/** The share of the context at which to compact, or null when automatic compaction is off. */
export function compactThreshold(values: Readonly<Record<string, unknown>>): number | null {
  if (values["adcode.ai.autoCompact"] === false) return null;
  const at = values["adcode.ai.autoCompactAt"];
  return typeof at === "string" && THRESHOLDS.has(at) ? Number(at) : 80;
}

/** How many tokens the model reads, from the catalogue or assumed when it does not say. */
export function contextWindowFor(catalogue: readonly CatalogueProvider[], providerId: string, modelId: string): number {
  return contextWindowOf(catalogue, providerId, modelId) ?? DEFAULT_CONTEXT_WINDOW;
}

/** What `/compact <focus>` asked for: trimmed text, undefined for none, null when invalid. */
export function parseCompactFocus(raw: unknown): string | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || raw.length > 500) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * How many of the user's own turns survived a compaction word for word.
 *
 * Counted in the newest `keptMessages` messages of the compacted history: a user message
 * with words in it and no tool results. The summary's own message counts when the user's
 * turn was merged into it, which is exactly when that turn was kept.
 */
export function keptUserTurns(history: readonly Message[], keptMessages: number): number {
  return history
    .slice(Math.max(0, history.length - keptMessages))
    .filter(
      (message) =>
        message.role === "user" &&
        message.content.some((block) => block.type === "text") &&
        !message.content.some((block) => block.type === "tool-result"),
    ).length;
}
