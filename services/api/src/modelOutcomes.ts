/**
 * How assistant turns end, per model - the evidence behind "this model works".
 *
 * "All AI models must be working" needs to know which ones are not, for real people rather
 * than in a test. Each editor reports finished turns as provider, model, one fixed word from
 * the list below and how long the turn took. The service keeps daily counts per model and
 * outcome with no account attached (`model_outcomes`), and the admin panel's Models page shows
 * how often each model works, which is what a decision to hide one rests on.
 *
 * No prompt, reply, file, key or provider message: the wire has no field that could carry one.
 * The desktop app keeps its own copy of this list in `apps/desktop/src/shared/modelOutcomes.ts`;
 * `test/modelOutcomes.test.ts` fails if the two drift.
 */
import { utcDay } from "./day.ts";

export const MODEL_OUTCOMES = [
  "ok",
  "refused",
  "cancelled",
  "auth",
  "credits",
  "rate_limit",
  "too_large",
  "model_missing",
  "no_tools",
  "tool_format",
  "network",
  "server",
  "output_limit",
  "thinking_limit",
  "history",
  "other",
] as const;

export type ModelOutcome = (typeof MODEL_OUTCOMES)[number];

const KNOWN: ReadonlySet<string> = new Set(MODEL_OUTCOMES);

export interface ModelOutcomeItem {
  provider: string;
  model: string;
  outcome: ModelOutcome;
  ms: number;
}

/** One stored row: a model's count of one outcome on one day. */
export interface ModelOutcomeRow {
  day: string;
  provider: string;
  model: string;
  outcome: string;
  count: number;
  totalMs: number;
}

export interface ModelHealth {
  provider: string;
  model: string;
  /** Turns that ran to an answer or an error - stopped ones are the person's choice, not the model's. */
  turns: number;
  ok: number;
  /** Average time of a working turn, or null when none worked. */
  okAvgMs: number | null;
  outcomes: Record<string, number>;
}

export const MAX_OUTCOMES_PER_REQUEST = 50;
const ITEM_FIELDS = new Set(["provider", "model", "outcome", "ms"]);

/** `{ outcomes: [{ provider, model, outcome, ms }] }`, every field checked, or null. */
export function parseModelOutcomes(raw: unknown): ModelOutcomeItem[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const list = (raw as Record<string, unknown>)["outcomes"];
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_OUTCOMES_PER_REQUEST) return null;

  const items: ModelOutcomeItem[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).some((key) => !ITEM_FIELDS.has(key))) return null;
    const { provider, model, outcome, ms } = record;
    if (typeof provider !== "string" || !/^[a-z0-9._-]{1,40}$/.test(provider)) return null;
    if (typeof model !== "string" || model.length === 0 || model.length > 200 || /[\0\r\n]/.test(model)) return null;
    if (typeof outcome !== "string" || !KNOWN.has(outcome)) return null;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0 || ms > 3_600_000) return null;
    items.push({ provider, model, outcome: outcome as ModelOutcome, ms: Math.round(ms) });
  }
  return items;
}

export interface ModelOutcomeStore {
  recordModelOutcomes(day: string, items: readonly ModelOutcomeItem[]): Promise<void>;
  modelOutcomesSince(day: string): Promise<ModelOutcomeRow[]>;
}

export async function recordModelOutcomes(
  deps: { store: ModelOutcomeStore; clock: { now(): number } },
  items: readonly ModelOutcomeItem[],
): Promise<void> {
  await deps.store.recordModelOutcomes(utcDay(deps.clock.now()), items);
}

/** Daily rows, added up per model: how often it works, busiest first. */
export function summarizeModelHealth(rows: readonly ModelOutcomeRow[]): ModelHealth[] {
  const byModel = new Map<string, ModelHealth & { okMs: number }>();
  for (const row of rows) {
    const key = `${row.provider}:${row.model}`;
    const health = byModel.get(key) ?? { provider: row.provider, model: row.model, turns: 0, ok: 0, okAvgMs: null, outcomes: {}, okMs: 0 };
    health.outcomes[row.outcome] = (health.outcomes[row.outcome] ?? 0) + row.count;
    if (row.outcome !== "cancelled") health.turns += row.count;
    if (row.outcome === "ok") {
      health.ok += row.count;
      health.okMs += row.totalMs;
    }
    byModel.set(key, health);
  }
  return [...byModel.values()]
    .map(({ okMs, ...health }) => ({ ...health, okAvgMs: health.ok > 0 ? Math.round(okMs / health.ok) : null }))
    .sort((a, b) => b.turns - a.turns || a.model.localeCompare(b.model));
}

export async function readModelHealth(
  deps: { store: ModelOutcomeStore; clock: { now(): number } },
  days: number,
): Promise<ModelHealth[]> {
  const since = utcDay(deps.clock.now() - (Math.max(1, days) - 1) * 86_400_000);
  return summarizeModelHealth(await deps.store.modelOutcomesSince(since));
}
