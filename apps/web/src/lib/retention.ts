/**
 * The admin Retention page's wire types and words. The API's types live in
 * `services/api/src/retention.ts`; the rules behind the numbers are specified in
 * `packages/retention/src/rules.ts`.
 */

export interface RetentionPoint { readonly eligible: number; readonly retained: number }

export interface RetentionSummary {
  readonly builtAt: number;
  readonly silentDays: number;
  readonly totals: { readonly users: number; readonly newInstalls: number; readonly active1d: number; readonly active7d: number; readonly active30d: number; readonly churned: number };
  readonly cohorts: readonly { readonly weekStart: string; readonly users: number; readonly d1: RetentionPoint; readonly d7: RetentionPoint; readonly d30: RetentionPoint }[];
  readonly funnel: { readonly base: number; readonly steps: readonly { readonly step: string; readonly users: number }[] };
  readonly reasons: readonly { readonly reason: string; readonly users: number }[];
  readonly friction: readonly { readonly name: string; readonly churned: number; readonly users: number; readonly topCodes: readonly { readonly code: string; readonly churned: number }[] }[];
}

export interface RetentionUser {
  readonly uid: string;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly activeDays: number;
  readonly newInstall: boolean;
  readonly furthestStep: string | null;
  readonly reason: string;
  readonly lastError: { readonly name: string; readonly code: string | null; readonly at: number } | null;
  readonly lastSession: { readonly code: string | null; readonly ms: number | null; readonly at: number } | null;
  readonly version: string | null;
}

export interface RetentionChurned { readonly total: number; readonly users: readonly RetentionUser[] }

export interface RetentionTimeline {
  readonly user: (RetentionUser & { readonly counts: Readonly<Record<string, number>> }) | null;
  readonly daily: readonly { readonly day: string; readonly events: number; readonly counts: Readonly<Record<string, number>> }[];
  readonly events: readonly { readonly name: string; readonly code: string | null; readonly ms: number | null; readonly at: number }[];
}

export const SILENT_DAY_CHOICES = [3, 7, 14, 30] as const;

export const REASON_LABELS: Readonly<Record<string, string>> = {
  crashed: "Crashed, then left",
  hit_limit: "Hit a limit, then left",
  sign_in_dead_end: "Could not get signed in",
  no_api_key: "Needed an API key, never got a working model",
  first_turn_failed: "First AI turn failed, never had one work",
  ai_failing: "AI kept failing in the last session",
  update_failed: "An update failed",
  slow_answers: "Answers were slow in the last session",
  gave_up_waiting: "Cancelled a turn in the last session",
  no_project: "Never opened a project",
  no_ai_message: "Opened a project, never asked the AI",
  no_edit: "AI answered, but no edit was ever applied",
  faded: "No friction recorded - use faded",
};

/** What to look at for each reason - the fix the page points the team to. */
export const REASON_HINTS: Readonly<Record<string, string>> = {
  crashed: "Read the debug reports for the crash; check the version column.",
  hit_limit: "The limit screen was the last thing they saw. Review allowances and the upgrade path.",
  sign_in_dead_end: "The free-AI sign-in step lost them. Check the sign-in flow and its error states.",
  no_api_key: "They picked a provider that needs a key. Make Free AI the obvious first choice.",
  first_turn_failed: "Their very first request failed. Top friction codes show which error.",
  ai_failing: "Requests failed repeatedly at the end. Check model health for those days.",
  update_failed: "The updater failed. Check the release for that platform.",
  slow_answers: "First answers took over 20 seconds. Check the model they used and its latency.",
  gave_up_waiting: "They stopped a turn and did not come back. Usually slowness or a wrong direction.",
  no_project: "They never opened a folder. The empty state is the problem.",
  no_ai_message: "They opened a project and never asked anything. The chat is not inviting enough.",
  no_edit: "Answers arrived but nothing changed in their files. Check edit approval and apply.",
  faded: "Nothing went visibly wrong. Re-engagement, not a bug fix.",
};

export const STEP_LABELS: Readonly<Record<string, string>> = {
  first_launch: "Installed and launched",
  signed_in: "Signed in",
  project_opened: "Opened a project",
  ai_message: "Sent a first AI message",
  ai_turn_ok: "Got a working AI answer",
  edit_applied: "Had an AI edit applied",
  preview_opened: "Opened a preview",
  returned_day1: "Came back on a later day",
  returned_day7: "Came back a week or more later",
};

export const EVENT_LABELS: Readonly<Record<string, string>> = {
  first_launch: "First launch",
  signed_in: "Signed in",
  project_opened: "Project opened",
  ai_message: "AI message sent",
  ai_turn_ok: "AI answer worked",
  edit_applied: "AI edit applied",
  preview_opened: "Preview opened",
  day_active: "Active day",
  session_start: "Session started",
  session_end: "Session ended",
  turn_failed: "AI turn failed",
  cli_failed: "CLI agent failed",
  limit_reached: "Limit reached",
  no_api_key: "No API key",
  sign_in_needed: "Sign-in needed for free AI",
  sign_in_failed: "Sign-in failed",
  slow_first_answer: "Slow first answer",
  turn_cancelled: "Turn cancelled",
  crash: "Crash",
  renderer_gone: "Window crashed",
  update_failed: "Update failed",
};

export const SESSION_END_LABELS: Readonly<Record<string, string>> = {
  quit: "quit normally",
  update: "restarted to update",
  unclean: "never quit (crash, kill or power loss)",
};

export const label = (map: Readonly<Record<string, string>>, key: string): string => map[key] ?? key.replaceAll("_", " ");

export function percent(part: number, whole: number): string {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

export function duration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}
