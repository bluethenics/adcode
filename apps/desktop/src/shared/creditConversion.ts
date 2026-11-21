/**
 * Ad earnings into AI credits: what the earnings card shows before and after a conversion.
 *
 * The server (services/api/src/earningsConversion.ts) owns the rate, the limits and both
 * balances, and it does the move. This module only reads what the server quoted, checks a
 * typed amount against those limits so the card can say what is wrong before anything is
 * sent, and formats the result. Nothing computed here is sent back: the request carries an
 * amount and a request id, and the server works out the credit itself.
 *
 * Integer arithmetic on bigint only, like the ledger (§1): no floating point anywhere money
 * is parsed or shown. Pure: no DOM, no Electron, no clock.
 */

/** The website page where earnings are withdrawn (apps/web DashboardBody, section #payouts). */
export const WITHDRAW_URL = "https://adcode.bluethenics.com/dashboard#payouts";

const MICROS_PER_CENT = 10_000n;
const MICROS_PER_DOLLAR = 1_000_000n;
const DIGITS = /^[0-9]{1,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why nothing can be converted right now. */
export type ConversionBlock = "verify-email" | "blocked" | "below-minimum" | "daily-cap" | "unavailable";

/** `GET /v1/earnings/convert`, as the main process hands it over. Micros stay decimal strings. */
export interface CreditConversionQuote {
  readonly availableMicros: string;
  readonly creditBalanceMicros: string;
  readonly convertedTodayMicros: string;
  readonly minMicros: string;
  readonly maxMicros: string;
  readonly dailyCapMicros: string;
  readonly stepMicros: string;
  readonly convertibleMaxMicros: string;
  readonly rate: { readonly earningsMicros: string; readonly creditMicros: string };
  readonly blocked: ConversionBlock | null;
}

/** What the card gets back from asking for a quote. */
export type CreditConversionQuoteResult =
  | { readonly ok: true; readonly quote: CreditConversionQuote }
  | { readonly ok: false; readonly reason: "signed-out" | "offline" };

export interface CreditConversionRequest {
  /** One per confirmation, kept across retries of it, so a retry can never pay twice. */
  readonly requestId: string;
  readonly amountMicros: string;
}

/** What the card gets back from a conversion. */
export type CreditConversionResult =
  | {
      readonly ok: true;
      readonly status: "converted" | "replayed";
      readonly earningsMicros: string;
      readonly creditMicros: string;
      readonly availableMicros: string;
      readonly creditBalanceMicros: string;
    }
  | {
      readonly ok: false;
      /** The server's error code, or "offline" when it could not be reached. */
      readonly error: string;
      /** Whether trying again with the same request id is safe and might work. */
      readonly retryable: boolean;
    };

const isDigits = (value: unknown): value is string => typeof value === "string" && DIGITS.test(value);
const BLOCKS: readonly ConversionBlock[] = ["verify-email", "blocked", "below-minimum", "daily-cap", "unavailable"];

/** The server's quote, or null if it is not one. The main process checks before it trusts. */
export function parseConversionQuote(raw: unknown): CreditConversionQuote | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const rate = body["rate"] as Record<string, unknown> | undefined;
  const fields = ["availableMicros", "convertedTodayMicros", "minMicros", "maxMicros", "dailyCapMicros", "stepMicros", "convertibleMaxMicros"] as const;
  if (!fields.every((key) => isDigits(body[key]))) return null;
  // A credit balance can be negative after a refunded top-up, so it alone may carry a sign.
  const credit = body["creditBalanceMicros"];
  if (typeof credit !== "string" || !/^-?[0-9]{1,19}$/.test(credit)) return null;
  if (typeof rate !== "object" || rate === null || !isDigits(rate["earningsMicros"]) || !isDigits(rate["creditMicros"])) return null;
  if (BigInt(rate["earningsMicros"]) === 0n || BigInt(body["stepMicros"] as string) === 0n) return null;
  const blocked = body["blocked"];
  if (blocked !== null && !BLOCKS.includes(blocked as ConversionBlock)) return null;
  return {
    availableMicros: body["availableMicros"] as string,
    creditBalanceMicros: credit,
    convertedTodayMicros: body["convertedTodayMicros"] as string,
    minMicros: body["minMicros"] as string,
    maxMicros: body["maxMicros"] as string,
    dailyCapMicros: body["dailyCapMicros"] as string,
    stepMicros: body["stepMicros"] as string,
    convertibleMaxMicros: body["convertibleMaxMicros"] as string,
    rate: { earningsMicros: rate["earningsMicros"], creditMicros: rate["creditMicros"] },
    blocked: blocked as ConversionBlock | null,
  };
}

/** The server's answer to a conversion, or null if it is not one. */
export function parseConversionResponse(raw: unknown): Extract<CreditConversionResult, { ok: true }> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (body["status"] !== "converted" && body["status"] !== "replayed") return null;
  if (!isDigits(body["earningsMicros"]) || !isDigits(body["creditMicros"]) || !isDigits(body["availableMicros"])) return null;
  const credit = body["creditBalanceMicros"];
  if (typeof credit !== "string" || !/^-?[0-9]{1,19}$/.test(credit)) return null;
  return {
    ok: true,
    status: body["status"],
    earningsMicros: body["earningsMicros"],
    creditMicros: body["creditMicros"],
    availableMicros: body["availableMicros"],
    creditBalanceMicros: credit,
  };
}

/** Whether a request is shaped the way the server accepts, checked before it is sent. */
export function isConversionRequest(raw: unknown): raw is CreditConversionRequest {
  if (typeof raw !== "object" || raw === null) return false;
  const body = raw as Record<string, unknown>;
  return typeof body["requestId"] === "string" && UUID.test(body["requestId"]) && isDigits(body["amountMicros"]);
}

/**
 * A typed dollar amount as micros: "5", "5.5", "$1,234.50". Null for anything else,
 * including more than two decimal places - credits are moved in whole cents.
 */
export function parseDollarAmount(text: string): bigint | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^([0-9]{0,7})(?:\.([0-9]{0,2}))?$/.exec(cleaned);
  if (match === null) return null;
  const whole = match[1] ?? "";
  const cents = match[2] ?? "";
  if (whole === "" && cents === "") return null;
  return BigInt(whole === "" ? "0" : whole) * MICROS_PER_DOLLAR + BigInt(cents.padEnd(2, "0")) * MICROS_PER_CENT;
}

/** The amount as it reads in the box: "12.50", no symbol, no separators. */
export function dollarInputText(micros: bigint | string): string {
  const value = typeof micros === "string" ? BigInt(micros) : micros;
  const cents = value / MICROS_PER_CENT;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** "$1,234.56", truncated to the cent so a shown amount is never more than is there. */
export function formatUsd(micros: bigint | string): string {
  const value = typeof micros === "string" ? BigInt(micros) : micros;
  const negative = value < 0n;
  const cents = (negative ? -value : value) / MICROS_PER_CENT;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** The credit the server's rate gives for this much earnings, for showing before confirming. */
export function creditsAtRate(quote: CreditConversionQuote, amountMicros: bigint): bigint {
  if (amountMicros <= 0n) return 0n;
  return (amountMicros * BigInt(quote.rate.creditMicros)) / BigInt(quote.rate.earningsMicros);
}

/** What the card shows for the amount in the box. */
export type ConversionPreview =
  | { readonly ok: true; readonly amountMicros: string; readonly amountLabel: string; readonly creditLabel: string }
  | { readonly ok: false; readonly message: string };

/**
 * Checks a typed amount against the quote and says what it buys, or what is wrong.
 *
 * The same limits the server enforces, so a refusal reads here first; the server checks
 * them again and has the last word, because the balance can move between quote and click.
 */
export function previewConversion(quote: CreditConversionQuote, text: string): ConversionPreview {
  if (text.trim() === "") return { ok: false, message: "Enter an amount." };
  const amount = parseDollarAmount(text);
  if (amount === null) return { ok: false, message: "Enter a dollar amount, like 5 or 12.50." };
  const min = BigInt(quote.minMicros);
  const max = BigInt(quote.convertibleMaxMicros);
  if (amount < min) return { ok: false, message: `The smallest conversion is ${formatUsd(min)}.` };
  if (amount > max) {
    const reason = max === BigInt(quote.maxMicros) ? "at a time" : max === BigInt(quote.dailyCapMicros) - BigInt(quote.convertedTodayMicros) ? "today" : "available";
    return { ok: false, message: `You can convert up to ${formatUsd(max)} ${reason}.` };
  }
  return { ok: true, amountMicros: amount.toString(), amountLabel: formatUsd(amount), creditLabel: formatUsd(creditsAtRate(quote, amount)) };
}

/** Why the card cannot offer a conversion, in words. */
export function blockedMessage(block: ConversionBlock, quote?: CreditConversionQuote): string {
  switch (block) {
    case "verify-email":
      return "Sign in with Google or GitHub, or confirm your email, to convert earnings to AI credits.";
    case "blocked":
      return "Paid models are turned off for this account, so earnings cannot be converted. Contact support.";
    case "below-minimum":
      return `You can convert once you have ${quote === undefined ? "a little more" : formatUsd(quote.minMicros)} available.`;
    case "daily-cap":
      return `You have converted the most allowed today${quote === undefined ? "" : ` (${formatUsd(quote.dailyCapMicros)})`}. Try again tomorrow.`;
    case "unavailable":
      return "Converting earnings is not available right now.";
  }
}

/** A failed conversion, in words. Nothing moved in any of these cases. */
export function conversionErrorMessage(error: string): string {
  switch (error) {
    case "insufficient-funds":
      return "Your available earnings changed and no longer cover that amount. Nothing was converted.";
    case "daily-cap":
      return "That would go over today's conversion limit. Nothing was converted.";
    case "below-minimum":
    case "above-maximum":
    case "not-whole-cents":
      return "That amount is outside the conversion limits. Nothing was converted.";
    case "verify-email":
      return blockedMessage("verify-email");
    case "blocked":
      return blockedMessage("blocked");
    case "signed-out":
      return "Sign in to convert earnings.";
    case "offline":
      return "Could not reach ADCode. Try again - a repeat can never convert twice.";
    default:
      return "The conversion did not go through. Try again - a repeat can never convert twice.";
  }
}
