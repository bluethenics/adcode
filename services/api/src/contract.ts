/**
 * Wire types for the serving contract, written from the spec.
 *
 * Spec D1: this is a third hand-written copy of the contract, alongside the client's and
 * the mock server's. That is deliberate. A server that imports the client's types cannot
 * catch a contract mismatch, and catching one is the main thing the separation buys.
 * `api-must-not-import-client` fails CI on any import from `packages/`. Do not refactor
 * this into a shared module.
 *
 * Money is a decimal string here for the reason it is everywhere else: JSON has no
 * bigint, and a JSON number would already have lost precision above 2^53.
 */

export type ThemeName = "light" | "dark";
export type CadenceName = "off" | "light" | "standard" | "max";
export type ReceiptOutcome = "impression" | "click" | "dismissed";

/** Independently re-declared under D1. Must stay in step with the client's vocabulary. */
export const TAG_VOCABULARY = [
  "lang:c", "lang:cpp", "lang:csharp", "lang:css", "lang:go", "lang:html",
  "lang:java", "lang:javascript", "lang:json", "lang:kotlin", "lang:lua",
  "lang:markdown", "lang:php", "lang:python", "lang:ruby", "lang:rust",
  "lang:shell", "lang:sql", "lang:swift", "lang:typescript", "lang:yaml",

  "fw:angular", "fw:django", "fw:express", "fw:laravel", "fw:next",
  "fw:nuxt", "fw:rails", "fw:react", "fw:spring", "fw:svelte", "fw:vue",

  "tool:cargo", "tool:docker", "tool:gradle", "tool:kubernetes", "tool:maven",
  "tool:npm", "tool:terraform", "tool:vite", "tool:webpack",

  "platform:backend", "platform:desktop", "platform:mobile", "platform:web",
] as const;

const TAG_SET: ReadonlySet<string> = new Set(TAG_VOCABULARY);

export function isTag(value: string): boolean {
  return TAG_SET.has(value);
}

/** Mirrors `packages/ads/src/validation.ts` exactly. A looser server produces creatives every client drops. */
export const LIMITS = {
  advertiser: 40,
  headline: 80,
  body: 160,
  creativeId: 64,
  url: 2048,
  maxCreatives: 50,
} as const;

export const CREATIVE_ID = /^[A-Za-z0-9_-]+$/;

const THEMES: ReadonlySet<string> = new Set<ThemeName>(["light", "dark"]);
const OUTCOMES: ReadonlySet<string> = new Set<ReceiptOutcome>(["impression", "click", "dismissed"]);

export interface ServeRequestBody {
  tags: string[];
  themeKind: ThemeName;
  count: number;
}

export interface ServedCreative {
  creativeId: string;
  advertiser: string;
  headline: string;
  body: string | null;
  clickUrl: string;
  logoLight: string;
  logoDark: string;
  ttlMs: number;
}

export interface ServeResponseBody {
  creatives: ServedCreative[];
}

export interface SubmittedReceipt {
  receiptId: string;
  creativeId: string;
  shownAt: number;
  dwellMs: number;
  themeKind: ThemeName;
  outcome: ReceiptOutcome;
}

export interface ReceiptsRequestBody {
  receipts: SubmittedReceipt[];
}

export interface ReceiptsResponseBody {
  acked: string[];
}

export interface BalanceResponseBody {
  availableMicros: string;
  lifetimeMicros: string;
}

export interface ConfigResponseBody {
  killSwitch: boolean;
  caps: { minIntervalMs?: number; dailyCap?: number };
  projections: Record<CadenceName, string>;
}

/** New in this slice. Additive, so no existing client is affected. */
export interface LedgerRow {
  entryId: string;
  kind: string;
  micros: string;
  description: string;
  createdAt: number;
  refId: string | null;
}

export interface LedgerResponseBody {
  rows: LedgerRow[];
  nextCursor: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && Number.isFinite(v);

export function parseServeRequest(raw: unknown): ServeRequestBody | null {
  if (!isRecord(raw)) return null;
  const { tags, themeKind, count } = raw;

  if (!Array.isArray(tags)) return null;
  if (typeof themeKind !== "string" || !THEMES.has(themeKind)) return null;
  if (!isFiniteInt(count)) return null;

  // An unknown tag is dropped rather than failing the request: a newer client sending a
  // tag this server has not shipped yet should still get ads, not a 400.
  const known = tags.filter((t): t is string => typeof t === "string" && isTag(t));

  return {
    tags: known,
    themeKind: themeKind as ThemeName,
    count: Math.max(0, Math.min(count, LIMITS.maxCreatives)),
  };
}

export function parseReceiptsRequest(raw: unknown): ReceiptsRequestBody | null {
  if (!isRecord(raw)) return null;
  const { receipts } = raw;
  if (!Array.isArray(receipts)) return null;

  const parsed: SubmittedReceipt[] = [];
  for (const item of receipts) {
    if (!isRecord(item)) return null;
    const { receiptId, creativeId, shownAt, dwellMs, themeKind, outcome } = item;

    if (typeof receiptId !== "string" || receiptId.length === 0 || receiptId.length > LIMITS.creativeId) return null;
    if (typeof creativeId !== "string" || !CREATIVE_ID.test(creativeId) || creativeId.length > LIMITS.creativeId) return null;
    if (!isFiniteInt(shownAt) || shownAt < 0) return null;
    if (!isFiniteInt(dwellMs) || dwellMs < 0) return null;
    if (typeof themeKind !== "string" || !THEMES.has(themeKind)) return null;
    if (typeof outcome !== "string" || !OUTCOMES.has(outcome)) return null;

    parsed.push({
      receiptId,
      creativeId,
      shownAt,
      dwellMs,
      themeKind: themeKind as ThemeName,
      outcome: outcome as ReceiptOutcome,
    });
  }

  return { receipts: parsed };
}

/* ── Reports ────────────────────────────────────────────────────────────── */

/**
 * Bug reports, feature requests, and help asks, from inside the editor.
 *
 * Additive, so no existing client is affected. The report carries the app version and
 * the platform because those are the first two things triage asks for - and carries
 * nothing else about the machine. File contents, paths, and workspace names never leave
 * the editor: a bug report is not a licence to read someone's source.
 */
export type ReportKind = "bug" | "feature" | "help" | "other";

export interface SubmitReportBody {
  kind: ReportKind;
  title: string;
  body: string;
  appVersion: string;
  platform: string;
}

export interface SubmitReportResponse {
  reportId: string;
}

export const REPORT_LIMITS = {
  title: 120,
  body: 4000,
  appVersion: 40,
  platform: 40,
} as const;

const REPORT_KINDS: ReadonlySet<string> = new Set<ReportKind>(["bug", "feature", "help", "other"]);

export function parseReportRequest(raw: unknown): SubmitReportBody | null {
  if (!isRecord(raw)) return null;
  const { kind, title, body, appVersion, platform } = raw;

  if (typeof kind !== "string" || !REPORT_KINDS.has(kind)) return null;

  // Trimmed before measuring, so "   " is empty rather than three characters long.
  const bounded = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    if (trimmed.length === 0 || trimmed.length > max) return null;
    return trimmed;
  };

  const t = bounded(title, REPORT_LIMITS.title);
  const b = bounded(body, REPORT_LIMITS.body);
  const v = bounded(appVersion, REPORT_LIMITS.appVersion);
  const p = bounded(platform, REPORT_LIMITS.platform);

  if (t === null || b === null || v === null || p === null) return null;

  return { kind: kind as ReportKind, title: t, body: b, appVersion: v, platform: p };
}
