/**
 * A small population with one account per churn rule, plus people who stayed. Shared by the
 * rule tests and the SQL parity test, so both judge exactly the same events.
 */
import type { RetentionEvent } from "@adcode/retention";

export const DAY = 86_400_000;
/** Friday 20 November 2026, 12:00 UTC. */
export const NOW = Date.UTC(2026, 10, 20, 12);
const ago = (days: number, hours = 0): number => NOW - days * DAY - hours * 3_600_000;

type E = RetentionEvent;
const ev = (name: E["name"], at: number, code?: string, ms?: number): E => ({
  name, at, ...(code === undefined ? {} : { code }), ...(ms === undefined ? {} : { ms }),
});

/** A first session that got everywhere. */
const fullStart = (start: number): E[] => [
  ev("first_launch", start), ev("session_start", start, "2.6.3"), ev("day_active", start),
  ev("signed_in", start + 60_000, "google"), ev("project_opened", start + 120_000, "folder"),
  ev("ai_message", start + 180_000), ev("ai_turn_ok", start + 200_000, undefined, 4_000),
  ev("edit_applied", start + 210_000, "automatic"), ev("preview_opened", start + 300_000),
];

export const POPULATION: { uid: string; events: E[]; expected: string }[] = [
  // Crashed: the last session never recorded a quit.
  { uid: "u-crashed", expected: "crashed", events: [...fullStart(ago(20)), ev("day_active", ago(18)), ev("session_end", ago(18), "unclean", 600_000)] },
  // Renderer gone on the last day.
  { uid: "u-renderer", expected: "crashed", events: [...fullStart(ago(15)), ev("renderer_gone", ago(15, -1), "oom")] },
  // Hit the daily limit, then left.
  { uid: "u-limit", expected: "hit_limit", events: [...fullStart(ago(12)), ev("day_active", ago(10)), ev("limit_reached", ago(10), "daily"), ev("session_end", ago(10), "quit", 1_200_000)] },
  // Free AI asked for an account; never signed in, nothing worked.
  { uid: "u-signin", expected: "sign_in_dead_end", events: [ev("first_launch", ago(9)), ev("day_active", ago(9)), ev("project_opened", ago(9), "new"), ev("ai_message", ago(9)), ev("sign_in_needed", ago(9)), ev("sign_in_failed", ago(9), "github")] },
  // Picked a provider without a key.
  { uid: "u-nokey", expected: "no_api_key", events: [ev("first_launch", ago(8)), ev("day_active", ago(8)), ev("signed_in", ago(8), "github"), ev("project_opened", ago(8), "folder"), ev("no_api_key", ago(8), "key"), ev("turn_failed", ago(8), "setup")] },
  // The first turns failed and none ever worked.
  { uid: "u-firstfail", expected: "first_turn_failed", events: [ev("first_launch", ago(30)), ev("day_active", ago(30)), ev("project_opened", ago(30), "folder"), ev("ai_message", ago(30)), ev("cli_failed", ago(30), "opencode.stopped_part_way"), ev("turn_failed", ago(30), "auth")] },
  // Worked at first, then failed repeatedly on the last day.
  { uid: "u-failing", expected: "ai_failing", events: [...fullStart(ago(40)), ev("day_active", ago(33)), ev("turn_failed", ago(33), "network"), ev("turn_failed", ago(33), "network"), ev("turn_failed", ago(33), "server")] },
  // An update failed on the last day.
  { uid: "u-update", expected: "update_failed", events: [...fullStart(ago(60)), ev("day_active", ago(50)), ev("update_failed", ago(50), "download")] },
  // Slow first answers.
  { uid: "u-slow", expected: "slow_answers", events: [...fullStart(ago(25)), ev("slow_first_answer", ago(25, -2), undefined, 48_000)] },
  // Cancelled a turn and left.
  { uid: "u-cancel", expected: "gave_up_waiting", events: [...fullStart(ago(14)), ev("turn_cancelled", ago(14, -1), undefined, 30_000)] },
  // Launched and never opened a project.
  { uid: "u-noproject", expected: "no_project", events: [ev("first_launch", ago(5)), ev("session_start", ago(5), "2.6.3"), ev("day_active", ago(5))] },
  // Opened a project, never asked.
  { uid: "u-noask", expected: "no_ai_message", events: [ev("first_launch", ago(6)), ev("day_active", ago(6)), ev("project_opened", ago(6), "recent")] },
  // AI answered but no edit landed.
  { uid: "u-noedit", expected: "no_edit", events: [ev("first_launch", ago(11)), ev("day_active", ago(11)), ev("project_opened", ago(11), "folder"), ev("ai_message", ago(11)), ev("ai_turn_ok", ago(11), undefined, 9_000)] },
  // Used it fully for a while, then just stopped.
  { uid: "u-faded", expected: "faded", events: [...fullStart(ago(70)), ev("day_active", ago(60)), ev("day_active", ago(45)), ev("day_active", ago(31)), ev("session_end", ago(31), "quit", 3_000_000)] },
  // Long gone: outside the 90-day lookback, never counted as churned.
  { uid: "u-ancient", expected: "faded", events: [...fullStart(ago(120)), ev("day_active", ago(100))] },
  // Upgraded from an older version: no first_launch, still active.
  { uid: "u-upgrader", expected: "no_edit", events: [ev("session_start", ago(2), "2.6.3"), ev("day_active", ago(2)), ev("project_opened", ago(2), "recent"), ev("ai_message", ago(2)), ev("ai_turn_ok", ago(2)), ev("day_active", ago(0, 2))] },
  // New this week and active today.
  { uid: "u-new-active", expected: "faded", events: [...fullStart(ago(3)), ev("day_active", ago(1)), ev("day_active", ago(0, 1)), ev("limit_reached", ago(3), "tokens")] },
  // A loyal user since five weeks ago, active yesterday.
  { uid: "u-loyal", expected: "faded", events: [...fullStart(ago(36)), ev("day_active", ago(29)), ev("day_active", ago(8)), ev("day_active", ago(1)), ev("turn_failed", ago(8), "rate_limit")] },
];
