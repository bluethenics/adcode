/**
 * What one Zeekend card pays this person, where they are (2026-11-25).
 *
 * Pay per card depends on the country Cloudflare places the person in (services/api
 * networkImpressions.ts `sponsoredCardRate`), so Earnings shows their own rate rather than one
 * number for everybody. The server answers `GET /v1/sponsored/rate` with only this person's
 * rate and daily cap - never the table, never what ADCode earns - and this file turns that into
 * the one line Earnings shows. Pure, so it is testable without a window.
 */
export interface SponsoredCardRate {
  readonly country: string | null;
  readonly countryRate: boolean;
  readonly payPerCardMicros: string;
  readonly paidCardsPerDay: number;
  readonly paying: boolean;
}

/** The server's answer, or null when it is not one. */
export function parseCardRate(raw: unknown): SponsoredCardRate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const country = value["country"], pay = value["payPerCardMicros"], perDay = value["paidCardsPerDay"];
  if (country !== null && (typeof country !== "string" || !/^[A-Z]{2}$/.test(country))) return null;
  if (typeof pay !== "string" || !/^\d{1,9}$/.test(pay) || typeof perDay !== "number" || !Number.isSafeInteger(perDay) || perDay < 0) return null;
  return { country, countryRate: value["countryRate"] === true, payPerCardMicros: pay, paidCardsPerDay: perDay, paying: value["paying"] === true };
}

/** "$0.0045", "$0.10": whole cents as cents, finer amounts without trailing zeros. */
export function formatCardPay(micros: number): string {
  return `$${micros % 10_000 === 0 ? (micros / 1_000_000).toFixed(2) : (micros / 1_000_000).toFixed(6).replace(/0+$/, "")}`;
}

function countryName(code: string): string {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
}

/** "$0.0045 a card in United Kingdom, up to 300 a day", or why cards pay nothing now. */
export function cardRateLabel(rate: SponsoredCardRate): string {
  if (!rate.paying) return "Cards are not paying right now";
  const where = rate.country === null ? "" : ` in ${countryName(rate.country)}`;
  return `${formatCardPay(Number(rate.payPerCardMicros))} a card${where}, up to ${rate.paidCardsPerDay.toLocaleString("en-US")} a day`;
}
