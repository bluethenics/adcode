// Numeric encodings shared with the relay and database; zero remains disabled.
export const UNLIMITED_DAILY_REQUESTS = 1_000_000;
export const UNLIMITED_REQUESTS_PER_MINUTE = 1000;
export const AUDIENCE_ROLES = ["unknown", "student", "hobbyist", "professional-developer", "founder", "designer", "researcher", "other"] as const;
export const AUDIENCE_EXPERIENCE = ["unknown", "beginner", "intermediate", "advanced"] as const;
export const DECLARED_USES = ["unknown", "build-product", "debugging", "testing", "code-review", "learning", "documentation", "ui-design", "other"] as const;
export interface TagflowAudienceInput { role: typeof AUDIENCE_ROLES[number]; experience: typeof AUDIENCE_EXPERIENCE[number]; primaryUse: typeof DECLARED_USES[number]; consent: boolean }
export type TagflowAudienceResult = { ok: true; profile: TagflowAudienceInput | null } | { ok: false; message: string };
/** Only a fixed starter category is reported, never a custom agent name or instructions. */
export function includedAiPersona(source: string, roleId?: string): string {
  if (source === "chat") return "coding-assistant";
  if (source === "edit" || source === "completion") return "inline-assistant";
  if (source !== "agent") return "unknown";
  if (roleId === "default-agent") return "coding-assistant";
  return new Map([["starter-reviewer","reviewer"], ["starter-tester","tester"], ["starter-ui-polish","ui-polish"], ["starter-bug-fixer","bug-fixer"], ["starter-docs-writer","docs-writer"]]).get(roleId ?? "") ?? "custom-agent";
}

export interface TagflowFeedbackInput {
  requestId: string;
  rating: "helpful" | "not-helpful" | null;
  category: "quality" | "instructions" | "tools" | "speed" | "reliability" | "other";
  comment: string;
  shareWithProvider: boolean;
}
export type TagflowFeedbackResult = { ok: true } | { ok: false; message: string };

/** One credit window as the relay reports it, in credits. Null times: no window open yet. */
export interface CreditWindowView { limit: number; used: number; held: number; remaining: number; startedAt: number | null; resetsAt: number | null }

/** Free AI credits: one balance for every included model, a session window and a weekly one. */
export interface CreditsAllowance {
  plan: { sessionCredits: number; weeklyCredits: number; sessionHours: number };
  session: CreditWindowView;
  weekly: CreditWindowView;
  /** Credits per 1,000 tokens, by model ID. */
  rates: Record<string, number>;
}

/** Included AI's account-wide allowance, separate from this machine's usage history. */
export interface TagflowAllowanceView {
  unlimited?: boolean;
  available: boolean;
  blocked: boolean;
  limits: { dailyRequests: number; dailyTokens: number; dailyCostMicros: number; requestsPerMinute: number };
  usage: { day: string; requests: number; inputTokens: number; outputTokens: number; costMicros: number; estimatedRequests: number; reservedTokens: number; reservedCostMicros: number };
  resetsAt: number;
  /** Partner models with their own daily allowance, counted apart from the main one. Older servers omit it. */
  pools?: { provider: string; name: string; models: string[]; limits: TagflowAllowanceView["limits"]; usage: TagflowAllowanceView["usage"] }[];
  /** Relays from 2026-10-15 meter free AI in credits; older ones omit it and count tokens per day. */
  credits?: CreditsAllowance;
  /** Paid tokens (relays from 2026-10-21): the free week on paid models, purchased tokens, and which models draw on them. */
  tokens?: { enabled: boolean; free: { limit: number; used: number; held: number; remaining: number; resetsAt: number | null }; purchased: number; paidModels?: string[]; plan?: { id: string; endsAt: number; source: string } | null };
}

/** Where people buy AI tokens for paid models. */
export const BUY_TOKENS_URL = "https://adcode.bluethenics.com/ai-tokens";

const shortTokens = (tokens: number): string => {
  const trim = (value: number): string => (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10));
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${trim(tokens / 1_000)}k`;
  return String(Math.max(0, Math.round(tokens)));
};

/** A current, recognised plan name. Older relays omit plans. */
export function aiPlanName(plan: NonNullable<TagflowAllowanceView["tokens"]>["plan"], now: number): string | null {
  if (plan == null || plan.endsAt <= now) return null;
  return plan.id === "weekly" ? "Weekly" : plan.id === "monthly" ? "Monthly" : plan.id === "pro" ? "Pro" : null;
}

/** The usage dialog's one line about paid tokens: the weekly allowance on Heabsy's models, then what was bought. */
export function paidTokensSummary(tokens: NonNullable<TagflowAllowanceView["tokens"]>, now: number): string {
  const free = tokens.free;
  const plan = aiPlanName(tokens.plan, now);
  const kind = plan === null ? "free" : "included";
  const week = free.resetsAt === null
    ? `${shortTokens(free.limit)} ${kind} tokens a week, starting with your first request on them`
    : `${shortTokens(free.remaining)} of ${shortTokens(free.limit)} ${kind} tokens left this week (refill in ${untilText(free.resetsAt, now)})`;
  const bought = tokens.purchased > 0 ? `, then ${shortTokens(tokens.purchased)} purchased tokens` : "";
  return `Heabsy models: ${plan === null ? "" : `${plan} plan, `}${week}${bought}. Tagflow AI stays unlimited.`;
}

/** "3 hr 12 min", "45 min", "under a minute": how long until a credit window refills. */
export function untilText(at: number, now: number): string {
  const minutes = Math.ceil((at - now) / 60_000);
  if (minutes <= 1) return "under a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `${days} day${days === 1 ? "" : "s"}${hours > 0 ? ` ${hours} hr` : ""}`;
  return hours > 0 ? `${hours} hr${rest > 0 ? ` ${rest} min` : ""}` : `${rest} min`;
}

/** A credit window as a meter reads it: whole credits, a percent used, and when it refills. */
export function creditWindowSummary(window: CreditWindowView, now: number) {
  const spent = Math.max(0, window.used) + Math.max(0, window.held);
  const percent = window.limit <= 0 || spent >= window.limit ? 100 : Math.min(99, Math.round(spent / window.limit * 100));
  const remaining = Math.max(0, Math.floor(window.remaining));
  const refill = window.resetsAt === null ? null : { in: untilText(window.resetsAt, now), at: new Date(window.resetsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) };
  return { percent, remaining, refill, open: window.resetsAt !== null };
}

/**
 * Why free AI could not get a sign-in token for a request.
 *
 * A token refresh that fails because the network dropped is not a sign-in problem: called
 * one, a signed-in person mid-task was asked to sign in again. That becomes the same
 * "fetch failed" a dropped request raises, which the turn retries by itself; only a real
 * refusal asks the person to sign in.
 */
export function includedTokenError(detail: string): Error {
  if (/transport failure|fetch failed|socket hang up|E(?:CONN\w+|NOTFOUND|TIMEDOUT|AI_AGAIN|NETUNREACH|HOSTUNREACH)|UND_ERR_|network|timed? ?out/i.test(detail)) {
    const code = /\b(E[A-Z_]{3,}|UND_ERR_[A-Z_]+)\b/.exec(detail)?.[1];
    return Object.assign(new TypeError("fetch failed"), code === undefined ? {} : { cause: Object.assign(new Error(detail), { code }) });
  }
  return new Error("Sign in in Account to use included AI.");
}

/** The allowance a model draws from: its partner's own pool when it has one, otherwise the main allowance. */
export function allowanceForModel(view: TagflowAllowanceView, modelId: string | null): TagflowAllowanceView & { poolName: string | null } {
  const pool = modelId === null ? undefined : view.pools?.find((one) => Array.isArray(one.models) && one.models.includes(modelId));
  return pool === undefined ? { ...view, poolName: null } : { ...view, limits: pool.limits, usage: pool.usage, poolName: pool.name };
}
