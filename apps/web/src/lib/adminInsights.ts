/**
 * Browser helpers for Admin > Analytics and the model data on Admin > ADCode models: date
 * ranges, how figures read, and downloads of the files the API builds.
 *
 * The figures themselves are computed in services/api/src/modelInsights.ts and
 * websiteInsights.ts, so the page, an export and a test can never disagree.
 */
import type { ModelFilter, SortKey } from "@adcode/api/src/modelInsights.ts";

export type { ModelDetail, ModelFilter, ModelInsightRow, RawInsightDay, SortKey, ModelKind, ModelStatus } from "@adcode/api/src/modelInsights.ts";
export { DEFAULT_MODEL_FILTER, SORT_KEYS, SORT_LABELS, filterModelRows, modelInsightKey, requestChange, rowsForCatalogue, sortModelRows } from "@adcode/api/src/modelInsights.ts";

const DAY_MS = 86_400_000;
export const utcDate = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** The ranges the pages offer: today, and whole days ending today (UTC). */
export const RANGE_PRESETS = [
  { id: "1", label: "Today", days: 1 },
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]["id"];

export interface DayRange { from: string; to: string }

export function presetRange(days: number, now: number): DayRange {
  return { from: utcDate(now - (days - 1) * DAY_MS), to: utcDate(now) };
}

/** "13 Nov – 20 Nov 2026 (UTC)" or "20 Nov 2026 (UTC)"; "today so far" when it ends today. */
export function rangeLabel(range: DayRange, now: number = Date.now()): string {
  const show = (day: string, year: boolean): string => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  const body = range.from === range.to ? show(range.to, true) : `${show(range.from, !sameYear)} – ${show(range.to, true)}`;
  return `${body} (UTC)${range.to === utcDate(now) ? ", today so far" : ""}`;
}

/** The previous window of the same length, for "vs previous" labels. */
export function previousRange(range: DayRange): DayRange {
  const from = Date.parse(`${range.from}T00:00:00Z`), to = Date.parse(`${range.to}T00:00:00Z`);
  const length = to - from + DAY_MS;
  return { from: utcDate(from - length), to: utcDate(from - DAY_MS) };
}

/* ── How figures read ─────────────────────────────────────────────────────────────────── */

export const count = (value: number): string => value.toLocaleString("en-US");
/** 1,234 → "1.2K", 3,400,000 → "3.4M"; exact below 10,000. */
export function compact(value: number): string {
  if (Math.abs(value) < 10_000) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}
export const share = (value: number | null, digits = 1): string => (value === null ? "—" : `${(value * 100).toFixed(digits)}%`);
export function usd(micros: number): string {
  const dollars = micros / 1_000_000;
  if (dollars === 0) return "$0";
  if (Math.abs(dollars) < 1) return `$${dollars.toFixed(dollars < 0.01 ? 4 : 2)}`;
  const digits = Math.abs(dollars) >= 1000 ? 0 : 2;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
export function ms(value: number | null): string {
  if (value === null) return "—";
  return value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value).toLocaleString("en-US")} ms`;
}
/** "+12.4%", "−3.0%", or null when there is nothing to compare with. */
export function change(current: number, previous: number): string | null {
  if (previous <= 0) return current > 0 ? "new" : null;
  const delta = (current - previous) / previous * 100;
  return `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}%`;
}

/* ── Addresses ────────────────────────────────────────────────────────────────────────── */

export function modelsQuery(range: DayRange, filter?: ModelFilter, sort?: { key: SortKey; direction: "asc" | "desc" }): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (filter !== undefined) {
    if (filter.q.trim()) params.set("q", filter.q.trim());
    if (filter.provider !== "all") params.set("provider", filter.provider);
    if (filter.kind !== "all") params.set("kind", filter.kind);
    if (filter.status !== "all") params.set("status", filter.status);
  }
  if (sort !== undefined) { params.set("sort", sort.key); params.set("dir", sort.direction); }
  return params.toString();
}

export function modelQuery(range: DayRange, model: { provider: string; modelId: string; upstreamModel: string }): string {
  return new URLSearchParams({ from: range.from, to: range.to, provider: model.provider, model: model.modelId, upstream: model.upstreamModel }).toString();
}

/** The error an insights request came back with, in words; `migration` when the tables are missing. */
export async function insightsFailure(response: Response): Promise<{ kind: "migration" | "range" | "auth" | "server"; message: string }> {
  let body: { error?: string; message?: string } = {};
  try { body = await response.json() as typeof body; } catch { /* not JSON */ }
  if (response.status === 503 && body.error === "insights-unavailable") return { kind: "migration", message: body.message ?? "The insight tables are not in the database yet." };
  if (response.status === 400) return { kind: "range", message: body.message ?? "Those dates cannot be read." };
  if (response.status === 401 || response.status === 403) return { kind: "auth", message: "Sign in again as an administrator." };
  return { kind: "server", message: body.message ?? "The server did not answer. Retry in a moment." };
}

/**
 * Fetches an export the server built and saves it. The browser never assembles the file, so a
 * 90-day export cannot freeze the page; `signal` cancels a download that is no longer wanted.
 */
export async function downloadInsightsExport(query: string, token: string | null, signal?: AbortSignal): Promise<{ ok: true; filename: string } | { ok: false; message: string }> {
  if (token === null) return { ok: false, message: "Sign in again as an administrator." };
  let response: Response;
  try {
    response = await fetch(`/v1/admin/insights/export?${query}`, { headers: { authorization: `Bearer ${token}` }, ...(signal === undefined ? {} : { signal }) });
  } catch {
    return { ok: false, message: signal?.aborted ? "Cancelled." : "Could not reach the server. Nothing was downloaded." };
  }
  if (!response.ok) return { ok: false, message: (await insightsFailure(response)).message };
  const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "adcode-export";
  const blob = await response.blob();
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, filename };
}
