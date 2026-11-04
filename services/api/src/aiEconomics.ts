/** Provider quote supplied 31 October 2026. Prices are USD / million tokens.
 * Credits track list cost; the partner discount remains our margin, never a user promise.
 * Keep legacy balance units: existing 55M-token $10 packs become 5,000 credits.
 */
import { HEABSY_CATALOG } from "./heabsyCatalog.ts";
import { walletCharge, walletRates } from "./modelWallet.ts";
import type { TagflowModel } from "./tagflowTypes.ts";

export const CREDIT_UNITS = 11_000;
export const UNITS_PER_COST_MICRO = 11;
export const PARTNER_DISCOUNT = 0.15;
export const HEABSY_PRICES = HEABSY_CATALOG.map(m => [m.name, m.inputPrice, m.cacheInputPrice ?? m.inputPrice, m.outputPrice] as const);

export function includedCharge(model: { inputPrice: number; outputPrice: number; cacheInputPrice?: number }, input: number, output: number, cached = 0): number {
  const cache = Math.max(0, Math.min(input, cached));
  return Math.ceil((Math.max(0, input - cache) * model.inputPrice + cache * (model.cacheInputPrice ?? model.inputPrice) + Math.max(0, output) * model.outputPrice) * UNITS_PER_COST_MICRO);
}

export const creditAmount = (units: number): string => (units / CREDIT_UNITS).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Premium models use their existing displayed wallet rates, including the 35% markup. */
export function subscriptionCharge(model: TagflowModel, input: number, output: number, now: number, cached = 0, cacheWritten = 0, quote = false): number {
  if (model.billing !== "wallet") return includedCharge(model, input, output, cached);
  const rates = walletRates(model, now, input);
  return walletCharge(quote ? { ...rates, inputPrice: Math.max(rates.inputPrice, rates.cacheWritePrice ?? 0) } : rates, input, output, cached, undefined, cacheWritten) * UNITS_PER_COST_MICRO;
}
