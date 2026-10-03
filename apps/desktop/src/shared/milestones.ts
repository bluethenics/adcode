/**
 * The first-session milestones the editor reports - fixed words, nothing else.
 *
 * The service's own list is `services/api/src/milestones.ts`, which documents why these
 * exist; its tests fail if this copy drifts. A milestone carries its name and the time it
 * happened. There is no field for a prompt, a file, a key or a provider account, so no
 * future change can start sending one by accident.
 */
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

const KNOWN: ReadonlySet<string> = new Set(MILESTONES);

export function isMilestone(value: unknown): value is MilestoneName {
  return typeof value === "string" && KNOWN.has(value);
}

/** How long a new install waits for its first success before ads may start anyway. */
export const NEWCOMER_HOLD_MS = 15 * 60_000;

/** What this machine remembers about its own beginning. */
export interface FirstRunState {
  /** When this install first ran a version that knew to record it. */
  readonly firstLaunchAt: number;
  /** The first assistant turn that worked, or null while there has not been one. */
  readonly firstValueAt: number | null;
}

/**
 * Whether ads wait, because this install has not had anything from ADCode yet.
 *
 * Until the first assistant turn succeeds, and for at most fifteen minutes from the first
 * launch - so somebody who only ever uses the editor by hand still sees the cards that pay
 * for it, a quarter of an hour in rather than one minute in.
 */
export function newcomerHold(state: FirstRunState, now: number): boolean {
  return state.firstValueAt === null && now - state.firstLaunchAt < NEWCOMER_HOLD_MS;
}
