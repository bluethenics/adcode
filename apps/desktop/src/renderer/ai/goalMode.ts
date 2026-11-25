/**
 * /goal: keep working until it is done.
 *
 * Brought over from T3 Code, where `/goal all tests in packages/api pass` keeps the agent going
 * across turns until it judges the goal met. Heavy users set a goal and walk away; the chat
 * should not stop after one turn to ask "shall I continue?".
 *
 * The assistant is asked to end its reply with GOAL MET once the goal is met and checked, or
 * GOAL BLOCKED: <reason> when it needs the person. Anything else is progress, and the chat sends
 * the next "keep going" by itself - up to a cap, so a goal that cannot be met does not run all
 * night on somebody's bill. Stop pauses the goal; /goal resume picks it up again.
 *
 * Pure state: the chat owns sending and drawing.
 */

export const GOAL_MAX_TURNS = 30;
export const GOAL_MET = "GOAL MET";
export const GOAL_BLOCKED = "GOAL BLOCKED";
/** Every automatic message starts with this, so a reopened chat can show it as a note. */
export const GOAL_CONTINUE_LEAD = "Keep working toward the goal:";

export type GoalStatus = "working" | "paused" | "met" | "blocked" | "limit";

export interface GoalState {
  readonly goal: string;
  /** The conversation it belongs to; null until the first turn names it. */
  readonly sessionId: string | null;
  /** Automatic turns sent so far. */
  readonly turns: number;
  readonly max: number;
  readonly status: GoalStatus;
  /** Why it is paused or blocked, in a few words. */
  readonly reason?: string;
}

export type GoalCommand =
  | { readonly kind: "show" }
  | { readonly kind: "clear" }
  | { readonly kind: "pause" }
  | { readonly kind: "resume" }
  | { readonly kind: "set"; readonly goal: string };

/** What the words after /goal ask for. */
export function parseGoalCommand(rest: string): GoalCommand {
  const words = rest.trim();
  const lower = words.toLowerCase();
  if (words.length === 0) return { kind: "show" };
  if (lower === "clear" || lower === "stop" || lower === "off" || lower === "cancel") return { kind: "clear" };
  if (lower === "pause") return { kind: "pause" };
  if (lower === "resume" || lower === "continue") return { kind: "resume" };
  return { kind: "set", goal: words.slice(0, 2_000) };
}

export function newGoal(goal: string, sessionId: string | null, max = GOAL_MAX_TURNS): GoalState {
  return { goal, sessionId, turns: 0, max, status: "working" };
}

const ENDINGS = `When the goal is fully met and you have checked it (run the tests, build, or look at the result), end your reply with a line that says exactly ${GOAL_MET}. If you cannot go on without me - a decision, an account, something only I can do - end with ${GOAL_BLOCKED}: and the reason. Otherwise end your turn whenever it suits and you will be asked to continue.`;

/** The message that starts work on a goal. */
export function goalStartPrompt(goal: string): string {
  return `Work toward this goal, across as many turns as it takes, until it is met: ${goal}\n\n${ENDINGS}`;
}

/** The message that continues it after a turn that made progress. */
export function goalContinuePrompt(state: GoalState): string {
  return `${GOAL_CONTINUE_LEAD} ${state.goal}\n\nPick up where you left off (automatic turn ${String(state.turns + 1)} of ${String(state.max)}). End with ${GOAL_MET} once it is met and checked, or ${GOAL_BLOCKED}: <reason> if you need me.`;
}

/** What a finished reply says about the goal. Only a closing line counts, not a mention mid-reply. */
export function judgeReply(reply: string): { readonly kind: "met" } | { readonly kind: "blocked"; readonly reason: string } | { readonly kind: "continue" } {
  const lines = reply.trim().split(/\r?\n/).map((line) => line.replace(/[*_`#>]/g, "").trim()).filter((line) => line.length > 0);
  for (const line of lines.slice(-3).reverse()) {
    if (/^GOAL MET\.?$/i.test(line)) return { kind: "met" };
    const blocked = /^GOAL BLOCKED\s*:?\s*(.*)$/i.exec(line);
    if (blocked !== null) return { kind: "blocked", reason: (blocked[1] ?? "").trim().slice(0, 300) || "it needs you" };
  }
  return { kind: "continue" };
}

/**
 * After a turn on this goal ended. `queued` is true when the person queued a message of their
 * own: theirs goes first, and the goal continues after it.
 */
export function afterGoalTurn(state: GoalState, reply: string, options: { readonly queued: boolean; readonly sessionId: string | null }): { readonly state: GoalState; readonly send: string | null } {
  const adopted: GoalState = state.sessionId === null && options.sessionId !== null ? { ...state, sessionId: options.sessionId } : state;
  if (adopted.status !== "working") return { state: adopted, send: null };
  const verdict = judgeReply(reply);
  if (verdict.kind === "met") return { state: { ...adopted, status: "met" }, send: null };
  if (verdict.kind === "blocked") return { state: { ...adopted, status: "blocked", reason: verdict.reason }, send: null };
  if (options.queued) return { state: adopted, send: null };
  if (adopted.turns >= adopted.max) return { state: { ...adopted, status: "limit", reason: `reached ${String(adopted.max)} automatic turns` }, send: null };
  return { state: { ...adopted, turns: adopted.turns + 1 }, send: goalContinuePrompt(adopted) };
}

/** The person stopped the turn, or it failed: the goal waits for /goal resume. */
export function pauseGoal(state: GoalState, reason: string): GoalState {
  return state.status === "working" ? { ...state, status: "paused", reason } : state;
}

/** Resume a paused, blocked or capped goal, with a fresh allowance of turns. */
export function resumeGoal(state: GoalState): GoalState {
  if (state.status === "met") return state;
  const { reason: _reason, ...rest } = state;
  void _reason;
  return { ...rest, status: "working", turns: 0 };
}

/** One line for the strip above the composer. */
export function goalSummary(state: GoalState): string {
  switch (state.status) {
    case "working": return state.turns === 0 ? "Working on it" : `Automatic turn ${String(state.turns)} of ${String(state.max)}`;
    case "paused": return `Paused${state.reason === undefined ? "" : `: ${state.reason}`}`;
    case "met": return "Met";
    case "blocked": return `Needs you: ${state.reason ?? "see the last reply"}`;
    case "limit": return `Stopped after ${String(state.max)} automatic turns`;
  }
}
