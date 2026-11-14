/** Purchased USD credits for paid inference. Separate from included/subscription tokens. */
export interface WalletEvent { type: "purchase" | "refund" | "dispute-opened" | "dispute-release"; webhookId: string; orderId: string | null; paymentId: string; sessionId: string | null; amountMicros: bigint; taxMicros?: bigint; now: number }
export type WalletEventResult = "credited" | "refunded" | "duplicate" | "review" | "not-ai-tokens";

export const WALLET_ORDER_PREFIX = "aiw_";
export const WALLET_MARKUP_PERCENT = 35;
/** The amounts offered as one-tap buttons. Any whole-dollar amount in the range below is accepted. */
export const WALLET_TOPUPS_CENTS = [1000, 2000, 5000, 10000] as const;
/**
 * A typed amount: whole dollars from $5 to $1,000 (owner's decision, 13 November 2026). Whole
 * dollars because the order is matched to the payment to the cent; $5 keeps the payment fee a
 * small share; $1,000 keeps a typo from becoming a large charge. The database checks the same range.
 */
export const WALLET_CUSTOM_MIN_CENTS = 500;
export const WALLET_CUSTOM_MAX_CENTS = 100_000;
export function isWalletAmount(cents: unknown): cents is number {
  return typeof cents === "number" && Number.isSafeInteger(cents) && cents % 100 === 0 && cents >= WALLET_CUSTOM_MIN_CENTS && cents <= WALLET_CUSTOM_MAX_CENTS;
}
export const WALLET_URL = "https://adcode.bluethenics.com/ai-tokens#wallet";
/** Where an editor too old for paid models gets the current release. */
export const DOWNLOAD_URL = "https://adcode.bluethenics.com/versions";
export interface WalletRates { inputPrice: number; outputPrice: number; cacheInputPrice?: number; cacheWritePrice?: number }
/** Peak rates are saved in admin; ordinary off-peak hours receive the provider's 50% reduction. */
export function walletRates(model: WalletRates & { pricingSchedule?: "deepseek"; provider?: string; upstreamModel?: string }, now: number, inputTokens = 0): WalletRates {
  const gptLuna = model.provider === "openai" && model.upstreamModel === "gpt-6-luna" || model.provider === "openrouter" && model.upstreamModel === "openai/gpt-6-luna";
  if (gptLuna) {
    const long = inputTokens > 272_000;
    const inputPrice = model.inputPrice * (long ? 2 : 1);
    return { inputPrice, outputPrice:model.outputPrice*(long?1.5:1), cacheInputPrice:(model.cacheInputPrice ?? model.inputPrice)*(long?2:1), cacheWritePrice:inputPrice*1.25 };
  }
  if (model.provider === "openrouter" && model.upstreamModel?.startsWith("anthropic/claude-")) return { ...model,cacheWritePrice:model.inputPrice*1.25 };
  if (model.pricingSchedule !== "deepseek") return model;
  const date = new Date(now);
  const hour = date.getUTCHours();
  const weekday = date.getUTCDay() > 0 && date.getUTCDay() < 6;
  const peak = weekday && (hour >= 1 && hour < 4 || hour >= 6 && hour < 10);
  return peak ? model : { inputPrice: model.inputPrice/2, outputPrice: model.outputPrice/2, cacheInputPrice: (model.cacheInputPrice ?? model.inputPrice)/2 };
}
export interface WalletView {
  balanceMicros: number; reservedMicros: number; availableMicros: number;
  orders: { orderId: string; priceCents: number; status: string; createdAt: number }[];
  activity: { id: string; deltaMicros: number; kind: string; model: string; createdAt: number; estimated: boolean }[];
}
export interface WalletStore {
  getModelWallet(uid: string, now: number): Promise<WalletView>;
  createWalletOrder(order: { orderId: string; uid: string; priceCents: number; createdAt: number }): Promise<boolean>;
  completeWalletOrder(orderId: string, sessionId: string): Promise<void>;
  applyWalletEvent(event: WalletEvent): Promise<WalletEventResult>;
  reserveModelWallet(id: string, uid: string, model: string, micros: number, now: number): Promise<boolean>;
  settleModelWallet(id: string, micros: number, estimated: boolean, now: number): Promise<void>;
  /** Paid top-ups since a time, for the admin's sales view; a store without it reports none. */
  walletSales?(sinceMs: number): Promise<WalletSalesDay[]>;
}

/** One UTC day of paid wallet top-ups. "Typed" are amounts other than the one-tap buttons. */
export interface WalletSalesDay { day: string; orders: number; typedOrders: number; revenueCents: number; refundedOrders: number }

/** Groups paid (and later refunded or disputed) orders by UTC day, newest first. Pending orders never count. */
export function summarizeWalletSales(orders: readonly { priceCents: number; status: string; createdAt: number }[]): WalletSalesDay[] {
  const days = new Map<string, WalletSalesDay>();
  for (const order of orders) {
    if (!["paid", "refunded", "disputed"].includes(order.status)) continue;
    const day = new Date(order.createdAt).toISOString().slice(0, 10);
    const row = days.get(day) ?? { day, orders: 0, typedOrders: 0, revenueCents: 0, refundedOrders: 0 };
    row.orders += 1;
    if (!(WALLET_TOPUPS_CENTS as readonly number[]).includes(order.priceCents)) row.typedOrders += 1;
    if (order.status === "paid") row.revenueCents += order.priceCents; else row.refundedOrders += 1;
    days.set(day, row);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * What a listed price is multiplied by: the markup, less any running price offer's percent
 * (see priceOffer.ts). Every price the service shows uses this, so it matches what is charged.
 */
export function walletPriceFactor(discountPercent = 0): number {
  const marked = (100 + WALLET_MARKUP_PERCENT) / 100;
  return discountPercent > 0 ? marked * (100 - discountPercent) / 100 : marked;
}

/**
 * Microdollars avoid rounding every request up to a cent. The markup applies once, and a running
 * price offer's percent comes off the marked-up charge.
 */
export function walletCharge(rates: WalletRates, input: number, output: number, cached = 0, providerCost?: number, cacheWritten = 0, discountPercent = 0): number {
  const cache = Math.max(0, Math.min(input, cached));
  const writes = Math.max(0, Math.min(input-cache,cacheWritten));
  const base = providerCost === undefined
    ? Math.max(0, input - cache - writes) * rates.inputPrice + cache * (rates.cacheInputPrice ?? rates.inputPrice) + writes*(rates.cacheWritePrice ?? rates.inputPrice) + Math.max(0, output) * rates.outputPrice
    : Math.max(0, providerCost) * 1_000_000;
  const marked = base * (100 + WALLET_MARKUP_PERCENT) / 100;
  return Math.ceil(discountPercent > 0 ? marked * (100 - discountPercent) / 100 : marked);
}
