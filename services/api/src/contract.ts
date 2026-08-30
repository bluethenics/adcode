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
  /**
   * A logo may be a `data:` URI, so it gets its own ceiling.
   *
   * The portal resizes what you drop in to 128x128 before it is ever sent, which lands
   * well under this - 96,000 characters is roughly a 70KB image once base64 has added
   * its third. Large enough that a legitimate logo never trips it, small enough that a
   * creative row cannot become a file store.
   */
  logo: 96_000,
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
  /**
   * An admin test card, queued deliberately at somebody.
   *
   * Absent on every ordinary serve. The client uses it to skip the *pacing* rules - the
   * minimum gap and the daily cap - because a test that has to wait out a ten-minute
   * cadence is a test whose result arrives long after the person who asked for it has
   * concluded it is broken. It never skips the restraint rules: a test card still waits
   * for a pause, and still refuses to appear while somebody is typing or debugging.
   *
   * It bills nobody either way - `recordServe` already flags the serve, and the receipt
   * it produces is worth zero.
   */
  test?: boolean;
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

/* ── Editor activity ────────────────────────────────────────────────────── */

/**
 * One flush of editor activity: what happened since the last one.
 *
 * Every field is a count or a duration. There is deliberately no field that could carry
 * a file name, a path, a language, a prompt, or a line of code - see `activity.ts`.
 */
export interface ActivityBody {
  /** 'YYYY-MM-DD', UTC. The day the work happened on, not the day it was sent. */
  day: string;
  manualChars: number;
  agentChars: number;
  acceptedEdits: number;
  rejectedEdits: number;
  filesTouched: number;
  activeMs: number;
  sessions: number;
}

/**
 * Ceilings, not expectations.
 *
 * A day cannot hold more than 86,400,000 milliseconds, and a person cannot type ten
 * million characters in one. These exist so a client bug - or a client that is lying -
 * cannot write a number that makes every chart after it unreadable. A flush that exceeds
 * one is rejected whole rather than clamped: a silently corrected number is a number
 * nobody investigates.
 */
export const ACTIVITY_CEILINGS = {
  chars: 10_000_000,
  edits: 100_000,
  files: 10_000,
  activeMs: 86_400_000,
  sessions: 1_000,
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A whole, non-negative number no larger than `max`. Rejects NaN, Infinity, and 1.5. */
function count(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value < 0 || value > max ? null : value;
}

export function parseActivity(raw: unknown): ActivityBody | null {
  if (!isRecord(raw)) return null;

  const day = raw["day"];
  if (typeof day !== "string" || !DAY.test(day)) return null;
  // A string that matches the shape can still not be a date - '2026-13-45' does.
  if (Number.isNaN(Date.parse(`${day}T00:00:00.000Z`))) return null;

  const manualChars = count(raw["manualChars"], ACTIVITY_CEILINGS.chars);
  const agentChars = count(raw["agentChars"], ACTIVITY_CEILINGS.chars);
  const acceptedEdits = count(raw["acceptedEdits"], ACTIVITY_CEILINGS.edits);
  const rejectedEdits = count(raw["rejectedEdits"], ACTIVITY_CEILINGS.edits);
  const filesTouched = count(raw["filesTouched"], ACTIVITY_CEILINGS.files);
  const activeMs = count(raw["activeMs"], ACTIVITY_CEILINGS.activeMs);
  const sessions = count(raw["sessions"], ACTIVITY_CEILINGS.sessions);

  if (
    manualChars === null ||
    agentChars === null ||
    acceptedEdits === null ||
    rejectedEdits === null ||
    filesTouched === null ||
    activeMs === null ||
    sessions === null
  ) {
    return null;
  }

  return {
    day,
    manualChars,
    agentChars,
    acceptedEdits,
    rejectedEdits,
    filesTouched,
    activeMs,
    sessions,
  };
}

/* ── Advertiser portal ──────────────────────────────────────────────────── */

/**
 * Self-serve campaign management.
 *
 * Advertiser identity is not a Firebase custom claim, unlike `admin`. A claim only lands
 * when the token next refreshes, which would mean signing up and then waiting to be able
 * to do anything. Instead an advertiser is "a user who owns an advertiser record", which
 * is true the instant the record is written.
 */
export interface CreateAdvertiserBody {
  name: string;
}

export interface CampaignBody {
  name: string;
  cpmMicros: string;
  budgetMicros: string;
  targetTags: string[];
}

export interface CreativeBody {
  campaignId: string;
  advertiser: string;
  headline: string;
  body: string | null;
  clickUrl: string;
  logoLight: string;
  logoDark: string;
}

export const ADVERTISER_LIMITS = {
  name: 60,
  campaignName: 80,
  /** A CPM below this is not worth serving; above it, someone has fat-fingered a zero. */
  minCpmMicros: 100_000n,
  maxCpmMicros: 100_000_000n,
  minBudgetMicros: 1_000_000n,
  maxBudgetMicros: 100_000_000_000n,
} as const;

const boundedText = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
};

/** https only, and short enough that the client will accept it. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > LIMITS.url) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/**
 * A logo: an https URL, or an inline image.
 *
 * Inline is what the portal actually sends. Asking an advertiser to host a PNG somewhere
 * before they can run an ad is a step that loses people who were otherwise ready to pay,
 * so the portal resizes the file they drop in and sends the pixels.
 *
 * The allow-list of media types is the point of this function. `data:` is a URL scheme
 * that carries a payload, and the one that carries `text/html` or `image/svg+xml` carries
 * script - which would run wherever the card is rendered. Only the three raster formats
 * are accepted, and none of them can execute anything.
 */
const LOGO_DATA = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function logoSource(value: unknown): string | null {
  if (typeof value !== "string" || value.length > LIMITS.logo) return null;
  if (value.startsWith("data:")) return LOGO_DATA.test(value) ? value : null;
  return httpsUrl(value);
}

export function parseCreateAdvertiser(raw: unknown): CreateAdvertiserBody | null {
  if (!isRecord(raw)) return null;
  const name = boundedText(raw["name"], ADVERTISER_LIMITS.name);
  return name === null ? null : { name };
}

export function parseCampaign(raw: unknown): CampaignBody | null {
  if (!isRecord(raw)) return null;

  const name = boundedText(raw["name"], ADVERTISER_LIMITS.campaignName);
  if (name === null) return null;

  const cpm = raw["cpmMicros"];
  const budget = raw["budgetMicros"];
  if (typeof cpm !== "string" || typeof budget !== "string") return null;
  if (!/^[0-9]{1,19}$/.test(cpm) || !/^[0-9]{1,19}$/.test(budget)) return null;

  const cpmValue = BigInt(cpm);
  const budgetValue = BigInt(budget);
  if (cpmValue < ADVERTISER_LIMITS.minCpmMicros || cpmValue > ADVERTISER_LIMITS.maxCpmMicros) return null;
  if (budgetValue < ADVERTISER_LIMITS.minBudgetMicros || budgetValue > ADVERTISER_LIMITS.maxBudgetMicros) {
    return null;
  }

  const tags = raw["targetTags"];
  if (!Array.isArray(tags)) return null;
  // Unknown tags are dropped rather than rejected: the vocabulary can grow, and an
  // advertiser should not get a 400 for a tag a newer portal offered them.
  const known = [...new Set(tags.filter((t): t is string => typeof t === "string" && isTag(t)))];

  return { name, cpmMicros: cpm, budgetMicros: budget, targetTags: known };
}

export function parseCreative(raw: unknown): CreativeBody | null {
  if (!isRecord(raw)) return null;

  const campaignId = boundedText(raw["campaignId"], LIMITS.creativeId);
  const advertiser = boundedText(raw["advertiser"], LIMITS.advertiser);
  const headline = boundedText(raw["headline"], LIMITS.headline);
  if (campaignId === null || advertiser === null || headline === null) return null;

  const rawBody = raw["body"];
  let body: string | null = null;
  if (rawBody !== null && rawBody !== undefined) {
    body = boundedText(rawBody, LIMITS.body);
    if (body === null) return null;
  }

  const clickUrl = httpsUrl(raw["clickUrl"]);
  const logoLight = logoSource(raw["logoLight"]);
  const logoDark = logoSource(raw["logoDark"]);
  if (clickUrl === null || logoLight === null || logoDark === null) return null;

  return { campaignId, advertiser, headline, body, clickUrl, logoLight, logoDark };
}

/* ── Payouts ────────────────────────────────────────────────────────────── */

/**
 * Cashing out.
 *
 * The transfer itself is made by hand from a Wise account, so everything here exists to
 * put a correct, complete instruction in front of the person making it - and to refuse a
 * request that should never have reached them.
 */
/**
 * How the transfer is addressed.
 *
 * `bank` needs the coordinates that country uses, which is what a corridor describes.
 * `wise-email` needs none of them: Wise resolves the recipient from the address on their
 * account, so it works to any country and has no corridor at all. Somebody who already has
 * Wise should not be made to find their IBAN to be paid.
 */
export type PayoutMethod = "bank" | "wise-email";

export const PAYOUT_LIMITS = {
  /** Below this a transfer costs more in fees and attention than it moves. */
  minWithdrawalMicros: 50_000_000n, // $50
  /**
   * A cooling-off window between opening an account and taking money out of it.
   *
   * Seven days is not a fraud control on its own. It is time for the reversal path to
   * run: fake impressions are caught by the plausibility rules within a day, and a
   * clawback that lands after the money has left is not a clawback.
   */
  minAccountAgeMs: 7 * 86_400_000,
  legalName: 120,
  email: 320,
  bankDetails: 600,
  note: 400,
  providerRef: 120,
  /**
   * The most one admin action may move a balance, in either direction.
   *
   * Not a security boundary - an admin who wants to move more can do it twice - but a
   * typo boundary. Micros have six zeros on the end of every figure, and $10,000 is far
   * above any correction this system will ever legitimately need to make.
   */
  maxAdjustmentMicros: 10_000_000_000n,
} as const;

export interface PayoutProfileBody {
  method: PayoutMethod;
  legalName: string;
  country: string;
  currency: string;
  email: string | null;
  bankDetails: string | null;
  fields: Record<string, string>;
  /**
   * The holder affirming they are 18 or older, which the terms require to be paid.
   *
   * Required rather than optional, and rejected when false: an omitted or false value is a
   * form that was not completed, and accepting it would leave the profile in exactly the
   * state this field exists to prevent.
   */
  adultConfirmed: true;
}

export interface WithdrawalRequestBody {
  amountMicros: string;
}

const PAYOUT_METHODS: ReadonlySet<string> = new Set<PayoutMethod>(["bank", "wise-email"]);

/**
 * The currencies Wise can pay out in that this accepts.
 *
 * A list rather than "any three uppercase letters" because the value is typed once and
 * then read by a human making a transfer: a typo that produces a currency Wise has never
 * heard of is discovered at the bank, after the request was approved.
 */
export const PAYOUT_CURRENCIES = [
  "USD", "EUR", "GBP", "AUD", "CAD", "NZD", "SGD", "JPY", "CHF", "SEK", "NOK", "DKK",
  "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "AED", "INR", "PKR", "BDT", "LKR", "NPR",
  "PHP", "IDR", "MYR", "THB", "VND", "HKD", "KRW", "CNY", "ZAR", "NGN", "KES", "GHS",
  "EGP", "MAD", "BRL", "MXN", "ARS", "CLP", "COP", "PEN", "UYU", "ILS", "SAR", "QAR",
  "UAH", "GEL", "KZT",
] as const;

const CURRENCY_SET: ReadonlySet<string> = new Set(PAYOUT_CURRENCIES);

/**
 * An email address, to the extent an address can be checked without sending mail to it.
 *
 * Deliberately loose: the only thing worth refusing here is a value that plainly is not
 * an address at all. Whether the Wise account exists is discovered when the transfer is
 * made, and no regular expression was ever going to answer it.
 */
const EMAILISH = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

export function parsePayoutProfile(raw: unknown): PayoutProfileBody | null {
  if (!isRecord(raw)) return null;

  const method = raw["method"];
  if (typeof method !== "string" || !PAYOUT_METHODS.has(method)) return null;

  // Strictly `true`. "Truthy" would accept the string "false", which is what an HTML form
  // sends for an unchecked box that was serialised carelessly.
  if (raw["adultConfirmed"] !== true) return null;

  const legalName = boundedText(raw["legalName"], PAYOUT_LIMITS.legalName);
  if (legalName === null) return null;

  const country = raw["country"];
  if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) return null;

  const currency = raw["currency"];
  if (typeof currency !== "string" || !CURRENCY_SET.has(currency)) return null;

  // Paying to a Wise address needs the address and nothing else. Refusing bank fields here
  // rather than ignoring them keeps the stored record honest about which half was used.
  if (method === "wise-email") {
    const email = boundedText(raw["email"], PAYOUT_LIMITS.email);
    if (email === null || !EMAILISH.test(email)) return null;
    return {
      method: "wise-email",
      legalName,
      country,
      currency,
      email,
      bankDetails: null,
      fields: {},
      adultConfirmed: true,
    };
  }

  const rawFields = raw["fields"];
  if (!isRecord(rawFields)) return null;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    const parsed = boundedText(value, PAYOUT_LIMITS.bankDetails);
    if (parsed === null) return null;
    fields[key] = parsed;
  }
  if (Object.keys(fields).length === 0) return null;
  return {
    method: "bank",
    legalName,
    country,
    currency,
    email: null,
    bankDetails: null,
    fields,
    adultConfirmed: true,
  };
}

/**
 * The amount asked for, in micros.
 *
 * Whole cents only, for the same reason funding is: a bank moves cents, so a request for
 * a fraction of one would be paid at a different figure than it recorded - and the
 * difference would sit in the ledger forever as an unexplained rounding.
 */
export function parseWithdrawalAmount(raw: unknown): bigint | null {
  if (!isRecord(raw)) return null;
  const value = raw["amountMicros"];
  if (typeof value !== "string" || !/^[0-9]{1,19}$/.test(value)) return null;
  const micros = BigInt(value);
  if (micros < PAYOUT_LIMITS.minWithdrawalMicros) return null;
  if (micros % 10_000n !== 0n) return null;
  return micros;
}

/** Wise's own reference for the transfer, so a query years later can be traced to it. */
export function parseProviderRef(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  return boundedText(raw["providerRef"], PAYOUT_LIMITS.providerRef);
}

/** Why a request was refused. Shown to the person who made it, so it is never optional. */
export function parseDecisionNote(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  return boundedText(raw["note"], PAYOUT_LIMITS.note);
}

/**
 * A correction to somebody's balance, and the reason for it.
 *
 * Signed, because a correction runs both ways: crediting somebody the reversal job took
 * too much from, and clawing back earnings a fraud check caught late. Whole cents for the
 * same reason a withdrawal is - the ledger should never carry a figure a bank could not
 * move. The reason is mandatory: an adjustment nobody explained is indistinguishable from
 * an admin helping themselves, and this is the one kind that can raise a balance from
 * nothing.
 */
export function parseAdjustment(raw: unknown): { micros: bigint; reason: string } | null {
  if (!isRecord(raw)) return null;
  const value = raw["micros"];
  if (typeof value !== "string" || !/^-?[0-9]{1,19}$/.test(value)) return null;
  const micros = BigInt(value);
  if (micros === 0n || micros % 10_000n !== 0n) return null;
  if (micros > PAYOUT_LIMITS.maxAdjustmentMicros || micros < -PAYOUT_LIMITS.maxAdjustmentMicros) {
    return null;
  }
  const reason = boundedText(raw["reason"], PAYOUT_LIMITS.note);
  return reason === null ? null : { micros, reason };
}
