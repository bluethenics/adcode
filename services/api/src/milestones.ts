/**
 * The first-session milestones: how far a new person got before they left.
 *
 * Production on 2026-10-03 could say that 394 of 419 installs were gone within five
 * minutes, but not why: nothing recorded whether the person saw the welcome, connected a
 * model, sent a prompt, or got anything back. These names are that funnel, and nothing
 * else - each is a fixed word from the list below, with the time it first and last
 * happened. No prompt, no file name, no model output, no key, no provider account: the
 * wire has no field that could carry one, the same promise `activity.ts` keeps.
 *
 * The desktop app keeps its own copy of this list in `apps/desktop/src/shared/milestones.ts`;
 * `test/milestones.test.ts` fails if the two drift.
 */
import type { Clock, Store } from "./store.ts";

export const MILESTONES = [
  "welcome_shown",
  "welcome_done",
  "welcome_skipped",
  "project_created",
  "folder_opened",
  "ai_needed",
  "ai_connected_free",
  "ai_connected_local",
  "ai_connected_key",
  "prompt_sent",
  "turn_ok",
  "turn_failed",
  "preview_opened",
] as const;

export type MilestoneName = (typeof MILESTONES)[number];

export interface MilestoneItem {
  name: MilestoneName;
  at: number;
}

const KNOWN: ReadonlySet<string> = new Set(MILESTONES);

/** A flush carries at most this many. The client sends each name once per batch. */
export const MAX_MILESTONES_PER_REQUEST = 40;

/** `{ milestones: [{ name, at }] }`, every name from the list, or null. */
export function parseMilestones(raw: unknown): MilestoneItem[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const list = (raw as Record<string, unknown>)["milestones"];
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MILESTONES_PER_REQUEST) return null;

  const items: MilestoneItem[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) return null;
    const { name, at } = entry as Record<string, unknown>;
    if (typeof name !== "string" || !KNOWN.has(name)) return null;
    if (typeof at !== "number" || !Number.isSafeInteger(at) || at <= 0) return null;
    items.push({ name: name as MilestoneName, at });
  }
  return items;
}

/**
 * Records a flush, with each time clamped to the last week.
 *
 * A wrong clock - or a client trying it on - must not be able to put a first prompt in
 * 2030 or in 1970, where it would sit at the edge of every funnel forever.
 */
export async function recordMilestones(
  deps: { store: Store; clock: Clock },
  uid: string,
  items: readonly MilestoneItem[],
): Promise<void> {
  const now = deps.clock.now();
  const earliest = now - 7 * 86_400_000;
  await deps.store.recordMilestones(
    uid,
    items.map((item) => ({ name: item.name, at: Math.min(now, Math.max(earliest, item.at)) })),
  );
}
