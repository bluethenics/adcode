/** Purchased USD credits for paid inference. Separate from included/subscription tokens. */
export interface WalletEvent { type: "purchase" | "refund" | "dispute-opened" | "dispute-release"; webhookId: string; orderId: string | null; paymentId: string; sessionId: string | null; amountMicros: bigint; taxMicros?: bigint; now: number }
export type WalletEventResult = "credited" | "refunded" | "duplicate" | "review" | "not-ai-tokens";

export const WALLET_ORDER_PREFIX = "aiw_";
export const WALLET_MARKUP_PERCENT = 35;
export const WALLET_TOPUPS_CENTS = [1000, 2000, 5000, 10000] as const;
export const WALLET_URL = "https://adcode.bluethenics.com/ai-tokens#wallet";
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
}

/** Microdollars avoid rounding every request up to a cent. The markup applies once. */
export function walletCharge(rates: WalletRates, input: number, output: number, cached = 0, providerCost?: number, cacheWritten = 0): number {
  const cache = Math.max(0, Math.min(input, cached));
  const writes = Math.max(0, Math.min(input-cache,cacheWritten));
  const base = providerCost === undefined
    ? Math.max(0, input - cache - writes) * rates.inputPrice + cache * (rates.cacheInputPrice ?? rates.inputPrice) + writes*(rates.cacheWritePrice ?? rates.inputPrice) + Math.max(0, output) * rates.outputPrice
    : Math.max(0, providerCost) * 1_000_000;
  return Math.ceil(base * (100 + WALLET_MARKUP_PERCENT) / 100);
}
