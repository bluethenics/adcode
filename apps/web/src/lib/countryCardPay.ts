/**
 * Per-country pay for Zeekend cards, as the admin edits it (2026-11-24).
 *
 * The server keeps the table (services/api adNetworkConfig.ts `countryPay`) and refuses any row
 * that pays more than a card there earns. This file is the admin side: reading a pasted sheet
 * into rows, and the margin each row leaves ADCode. Pure, so the rules are testable without
 * a browser.
 *
 * What a card earns comes from the network's country report, usually as a CPM - dollars per
 * thousand impressions. One card is one impression, so a $2.00 CPM is $0.002 a card.
 */
import { COUNTRY_CODES, isCountryCode } from "@adcode/api/src/regions.ts";
import { ZEEKEND_MAX_EARN_MICROS, ZEEKEND_MAX_PAID_PER_DAY, ZEEKEND_MAX_PAY_MICROS, type CountryCardPay } from "@adcode/api/src/adNetworkConfig.ts";

/** Below this share of a card's earnings kept by ADCode, a row is flagged as thin. */
export const THIN_MARGIN = 0.2;

/** The country's English name, or the code when the runtime has no names. */
export function countryName(code: string): string {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
}

const fold = (text: string): string => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");

/** Names a country report uses that are not the English display name. */
const ALIASES: Record<string, string> = {
  usa: "US", unitedstatesofamerica: "US", america: "US", us: "US", uk: "GB", greatbritain: "GB", england: "GB", britain: "GB",
  russianfederation: "RU", southkorea: "KR", korearepublicof: "KR", republicofkorea: "KR", korea: "KR", northkorea: "KP",
  vietnam: "VN", vietnamsocialistrepublicof: "VN", turkey: "TR", turkiye: "TR", czechrepublic: "CZ", czechia: "CZ",
  iran: "IR", iranislamicrepublicof: "IR", syria: "SY", laos: "LA", moldova: "MD", tanzania: "TZ", bolivia: "BO", venezuela: "VE",
  taiwan: "TW", taiwanprovinceofchina: "TW", hongkong: "HK", hongkongsar: "HK", hongkongsarchina: "HK", macau: "MO", macao: "MO",
  uae: "AE", emirates: "AE", unitedarabemirates: "AE", ivorycoast: "CI", cotedivoire: "CI", drc: "CD", democraticrepublicofthecongo: "CD",
  congodemocraticrepublic: "CD", congokinshasa: "CD", congo: "CG", republicofthecongo: "CG", congobrazzaville: "CG", palestine: "PS",
  palestinianterritories: "PS", northmacedonia: "MK", macedonia: "MK", myanmar: "MM", burma: "MM", eswatini: "SZ", swaziland: "SZ",
  capeverde: "CV", caboverde: "CV", kosovo: "XK", brunei: "BN", bruneidarussalam: "BN", vaticancity: "VA", holysee: "VA",
};
let names: Map<string, string> | null = null;
/** An ISO code for a cell that holds a code or a country's name, or null. */
export function countryCode(cell: string): string | null {
  const text = cell.trim();
  if (/^[A-Za-z]{2}$/.test(text) && isCountryCode(text.toUpperCase())) return text.toUpperCase();
  const key = fold(text);
  if (key === "") return null;
  if (names === null) {
    names = new Map();
    for (const code of COUNTRY_CODES) names.set(fold(countryName(code)), code);
  }
  return ALIASES[key] ?? names.get(key) ?? null;
}

/** Micros for a dollar amount as a sheet writes it: "$0.002", "1,250.50", "2.4 USD". Null if not one. */
export function dollarsToMicros(cell: string): number | null {
  const text = cell.trim().replace(/^\$|^usd\s*/i, "").replace(/\s*(?:usd|\$)$/i, "").replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const micros = Math.round(Number(text) * 1_000_000);
  return Number.isSafeInteger(micros) ? micros : null;
}

/** Cells of one line: tab-separated when pasted from a sheet, else comma or semicolon, with quotes. */
function cells(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === "\"" && line[i + 1] === "\"") { cell += "\""; i++; }
      else if (ch === "\"") quoted = false;
      else cell += ch;
    } else if (ch === "\"" && cell.trim() === "") { quoted = true; cell = ""; }
    else if (ch === delimiter) { out.push(cell.trim()); cell = ""; }
    else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

type Column = "country" | "cpm" | "earn" | "pay" | "cap" | "tier";
/** Which column a header names. CPM is dollars per thousand cards; the rest are per card. */
export function columnOf(header: string): Column | null {
  const h = header.toLowerCase();
  if (/\b(?:country|geo|iso|nation)\b|^code$|^region$/.test(h)) return "country";
  if (/\b(?:tier|colou?r|mark|band|group)\b/.test(h)) return "tier";
  if (/\b(?:cap|limit)\b|per day|a day|\/ ?day|daily/.test(h)) return "cap";
  if (/\bpay\b|payout|user|viewer|we pay/.test(h)) return "pay";
  if (/\b(?:e?cpm|rpm)\b|per (?:1,?000|thousand|mille)/.test(h)) return "cpm";
  if (/earn|revenue|income|per card|per impression|per ad\b/.test(h)) return "earn";
  return null;
}

/**
 * The owner marks countries in the sheet: green to pay more, red to pay less (2026-11-24). A paste
 * loses the cell colours, so the importer reads them from a Tier column - "green", "red", or
 * blank for the rest - and pays each tier its own share of what a card earns.
 */
export type Tier = "green" | "plain" | "red";
export function tierOf(cell: string | undefined): Tier {
  const value = (cell ?? "").trim().toLowerCase();
  if (/^(?:green|g|high|more|up|\+)$/.test(value)) return "green";
  if (/^(?:red|r|low|less|down|-)$/.test(value)) return "red";
  return "plain";
}
/**
 * A tier's share of what a card earns, or null to keep the connection's default pay (never more
 * than the card earns). Proposed to the owner on 2026-11-25: green 45%, red 30%, the rest
 * unchanged - green pays more, red less, and on the sheet's own figures ADCode keeps more than
 * at one flat rate, because the red countries show far more cards than the green ones.
 */
export type TierShares = Readonly<Record<Tier, number | null>>;
export const DEFAULT_SHARES: TierShares = { green: 0.45, plain: null, red: 0.3 };
/** A pay worked out from a share is rounded down to a tenth of a cent's tenth: $0.0001. */
export const PAY_STEP_MICROS = 100;
export const payFromShare = (earnMicros: number, share: number): number => Math.floor(earnMicros * share / PAY_STEP_MICROS) * PAY_STEP_MICROS;

/** A sheet's "none" or "-" for a country that earned nothing is an earning of $0, not a blank. */
const NOTHING = /^(?:none|nil|n\/?a|-|—|0)$/i;

export interface CountryPayImport {
  rows: CountryCardPay[];
  /** The tier each imported country was read as. */
  tiers: Record<string, Tier>;
  /** One line each, for the admin to read before saving. */
  problems: string[];
}

/**
 * A pasted country report as pay rows.
 *
 * The first line must name its columns: a country (code or name), and what a card earns there -
 * a CPM or a per-card figure. A pay column is taken as given; without one, each country is paid
 * its tier's share of what its card earns, rounded down to $0.0001 - or, for a tier with no share,
 * the default pay, lowered to what the card earns where that is less. A pasted pay above what the
 * card earns is never imported as it stands: that row is paid by its tier instead, and listed.
 * Lines that are not a country - a "16 other countries" total - are skipped and listed.
 */
export function importCountryPay(text: string, shares: TierShares = DEFAULT_SHARES, defaultPayMicros = 2_000): CountryPayImport {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim() !== "");
  const problems: string[] = [];
  const tiers: Record<string, Tier> = {};
  if (lines.length === 0) return { rows: [], tiers, problems: ["Paste the sheet's rows, with its header line first."] };
  const first = lines[0]!;
  const delimiter = first.includes("\t") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  const columns = cells(first, delimiter).map(columnOf);
  const at = (name: Column): number => columns.indexOf(name);
  if (at("country") < 0) return { rows: [], tiers, problems: ["The first line needs a Country column."] };
  if (at("cpm") < 0 && at("earn") < 0 && at("pay") < 0) return { rows: [], tiers, problems: ["The first line needs a CPM (per 1,000 cards), a per-card earnings column, or a pay column."] };
  const amount = (cell: string | undefined): number | null => NOTHING.test((cell ?? "").trim()) ? 0 : dollarsToMicros(cell ?? "");
  const rows = new Map<string, CountryCardPay>();
  for (const [index, line] of lines.slice(1).entries()) {
    const row = cells(line, delimiter);
    const lineNo = index + 2;
    const code = countryCode(row[at("country")] ?? "");
    if (code === null) { problems.push(`Line ${lineNo}: "${row[at("country")] ?? ""}" is not a country, skipped. Countries without a row pay the default.`); continue; }
    const tier = at("tier") < 0 ? "plain" : tierOf(row[at("tier")]);
    const share = shares[tier];
    const cpm = at("cpm") < 0 ? null : amount(row[at("cpm")]);
    const perCard = at("earn") < 0 ? null : amount(row[at("earn")]);
    const earn = perCard ?? (cpm === null ? null : Math.floor(cpm / 1000));
    if (earn !== null && earn > ZEEKEND_MAX_EARN_MICROS) { problems.push(`Line ${lineNo}: ${code} earns more than $1 a card - check the column, skipped.`); continue; }
    const given = at("pay") < 0 ? null : dollarsToMicros(row[at("pay")] ?? "");
    let pay: number;
    if (given !== null && (earn === null || given <= earn)) pay = given;
    else if (earn !== null) {
      pay = share === null ? Math.min(defaultPayMicros, earn) : payFromShare(earn, share);
      if (given !== null) problems.push(`Line ${lineNo}: ${code} would pay ${formatUsd(given)} a card but earns ${formatUsd(earn)} - a loss, so it pays ${formatUsd(pay)} instead.`);
    } else { problems.push(`Line ${lineNo}: ${code} has no earnings or pay figure, skipped.`); continue; }
    if (pay > ZEEKEND_MAX_PAY_MICROS) { problems.push(`Line ${lineNo}: ${code} would pay more than the $0.10 a card ceiling, so it pays $0.10.`); pay = ZEEKEND_MAX_PAY_MICROS; }
    if (earn === 0) problems.push(`Line ${lineNo}: ${code} earns nothing a card, so it pays nothing.`);
    const capCell = at("cap") < 0 ? "" : (row[at("cap")] ?? "").replace(/,/g, "");
    const cap = /^\d{1,4}$/.test(capCell) && Number(capCell) <= ZEEKEND_MAX_PAID_PER_DAY ? Number(capCell) : undefined;
    if (capCell !== "" && cap === undefined) problems.push(`Line ${lineNo}: ${code}'s cap "${capCell}" is not 0 to 1,000, so the default cap applies.`);
    if (rows.has(code)) problems.push(`Line ${lineNo}: ${code} appears again; the later line wins.`);
    tiers[code] = tier;
    rows.set(code, { country: code, payPerCardMicros: String(pay), ...(earn === null ? {} : { earnPerCardMicros: String(earn) }), ...(cap === undefined ? {} : { paidCardsPerDay: cap }) });
  }
  return { rows: [...rows.values()].sort((a, b) => a.country.localeCompare(b.country)), tiers, problems };
}

/** "$0.0035", "$0.10": whole cents as cents, anything finer to the micro without trailing zeros. */
export function formatUsd(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(micros);
  return `${sign}$${abs % 10_000 === 0 ? (abs / 1_000_000).toFixed(2) : (abs / 1_000_000).toFixed(6).replace(/0+$/, "")}`;
}

export type MarginState = "loss" | "thin" | "ok" | "unknown";
export interface Margin { state: MarginState; marginMicros: number | null; share: number | null }
/** What ADCode keeps from one card: earnings minus pay, and that as a share of the earnings. */
export function marginOf(payMicros: number, earnMicros: number | null | undefined): Margin {
  if (earnMicros === null || earnMicros === undefined) return { state: "unknown", marginMicros: null, share: null };
  const marginMicros = earnMicros - payMicros;
  const share = earnMicros === 0 ? (payMicros === 0 ? 0 : -1) : marginMicros / earnMicros;
  return { state: marginMicros < 0 ? "loss" : share < THIN_MARGIN && payMicros > 0 ? "thin" : "ok", marginMicros, share };
}

/** A row as the admin's table edits it: dollar strings, and a blank cap for the default. */
export interface CountryPayDraft { country: string; pay: string; earn: string; cap: string }
const dollars = (micros: string | undefined): string => micros === undefined ? "" : String(Number(micros) / 1_000_000);
export function toDraft(row: CountryCardPay): CountryPayDraft {
  return { country: row.country, pay: dollars(row.payPerCardMicros), earn: dollars(row.earnPerCardMicros), cap: row.paidCardsPerDay === undefined ? "" : String(row.paidCardsPerDay) };
}

/** The drafts as stored rows, or the first problem in words. Never a row that pays more than it earns. */
export function fromDrafts(drafts: readonly CountryPayDraft[]): CountryCardPay[] | string {
  const rows: CountryCardPay[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const name = `${countryName(draft.country)} (${draft.country})`;
    if (!isCountryCode(draft.country)) return `${draft.country} is not a country code.`;
    if (seen.has(draft.country)) return `${name} is listed twice.`;
    seen.add(draft.country);
    const pay = dollarsToMicros(draft.pay);
    if (pay === null || pay > ZEEKEND_MAX_PAY_MICROS || !/^\d*(?:\.\d{0,6})?$/.test(draft.pay.trim().replace(/^\$/, ""))) return `${name}: pay per card must be from $0 to $0.10, with at most six decimal places.`;
    const earn = draft.earn.trim() === "" ? null : dollarsToMicros(draft.earn);
    if (draft.earn.trim() !== "" && (earn === null || earn > ZEEKEND_MAX_EARN_MICROS)) return `${name}: what a card earns must be from $0 to $1.`;
    if (earn !== null && pay > earn) return `${name} would pay ${formatUsd(pay)} a card but a card there earns ${formatUsd(earn)}. Lower the pay: ADCode never pays more than a card earns.`;
    const cap = draft.cap.trim();
    if (cap !== "" && (!/^\d{1,4}$/.test(cap) || Number(cap) > ZEEKEND_MAX_PAID_PER_DAY)) return `${name}: the daily cap must be a whole number from 0 to 1,000, or blank for the default.`;
    rows.push({ country: draft.country, payPerCardMicros: String(pay), ...(earn === null ? {} : { earnPerCardMicros: String(earn) }), ...(cap === "" ? {} : { paidCardsPerDay: Number(cap) }) });
  }
  return rows.sort((a, b) => a.country.localeCompare(b.country));
}
