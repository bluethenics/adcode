/**
 * What one sponsored card pays this person where they are (2026-11-25), as the dashboard says it.
 *
 * The answer comes from `GET /v1/sponsored/rate` (services/api networkImpressions.ts): only this
 * person's rate and daily cap, never the table or what ADCode earns. Self-contained on purpose -
 * the web version's account panel compiles this file into the desktop bundle, where the
 * dependency firewall keeps `@adcode/api` out. The desktop's own copy is main/cardRate.ts.
 */
export interface SponsoredCardRate {
  readonly country: string | null;
  readonly countryRate: boolean;
  readonly payPerCardMicros: string;
  readonly paidCardsPerDay: number;
  readonly paying: boolean;
}

/** "$0.0045 a card in United Kingdom, up to 300 a day", or why cards pay nothing now. */
export function cardRateLabel(rate: SponsoredCardRate): string {
  if (!rate.paying) return "Cards are not paying right now";
  const micros = Number(rate.payPerCardMicros);
  const pay = `$${micros % 10_000 === 0 ? (micros / 1_000_000).toFixed(2) : (micros / 1_000_000).toFixed(6).replace(/0+$/, "")}`;
  let where = "";
  if (rate.country !== null) {
    let name = rate.country;
    try { name = new Intl.DisplayNames(["en"], { type: "region" }).of(rate.country) ?? rate.country; } catch { /* the code will do */ }
    where = ` in ${name}`;
  }
  return `${pay} a card${where}, up to ${rate.paidCardsPerDay.toLocaleString("en-US")} a day`;
}
