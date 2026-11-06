import { parsePaidConfig } from "@adcode/api/src/paidTokens.ts";
import { readApi } from "./apiRead";
import { STANDARD_PRICING, type IncludedModelRate, type PaidModelRate, type PricingOffer } from "./pricing";

/**
 * The included models the service offers now, with their credit rates. The page used to list the
 * whole provider catalogue - 37 models, 26 of them not offered - from a static import.
 */
export function offeredModels(raw: unknown): IncludedModelRate[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rate = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const models: IncludedModelRate[] = [];
  for (const one of raw) {
    if (typeof one !== "object" || one === null) continue;
    const model = one as Record<string, unknown>;
    const input = rate(model["inputCreditsPer1k"]), output = rate(model["outputCreditsPer1k"]), cached = rate(model["cacheCreditsPer1k"]);
    if (model["billing"] === "wallet" || typeof model["name"] !== "string" || input === null || output === null || input + output === 0) continue;
    const date = typeof model["releaseDate"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(model["releaseDate"]) ? model["releaseDate"] : undefined;
    models.push({ name: model["name"], input, cached: cached ?? input, output, ...(date === undefined ? {} : { releaseDate: date }) });
  }
  return models.length > 0 ? models : undefined;
}

/** The models paid from USD credits, with the service's own marked-up prices, and the free ones. */
export function paidAndFreeModels(raw: unknown): { paidModels: PaidModelRate[]; freeModels: string[] } | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rate = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const paidModels: PaidModelRate[] = [];
  const freeModels: string[] = [];
  for (const one of raw) {
    if (typeof one !== "object" || one === null) continue;
    const model = one as Record<string, unknown>;
    if (typeof model["id"] !== "string" || typeof model["name"] !== "string") continue;
    const name = model["name"].replace(/\s*·\s*Paid credits$/, "");
    if (model["billing"] === "wallet") {
      const input = rate(model["inputPrice"]), output = rate(model["outputPrice"]), cached = rate(model["cacheInputPrice"]);
      if (input === null || output === null) continue;
      paidModels.push({ id: model["id"], name, provider: typeof model["providerName"] === "string" ? model["providerName"] : "Provider", input, output, cached: cached ?? input });
    } else if (model["paid"] === false) freeModels.push(name);
  }
  return { paidModels, freeModels };
}

/** Source catalogue is always renderable; successful live changes are cached for one minute. */
export async function pricingOffer(): Promise<PricingOffer> {
  try {
    const response = await readApi("/v1/ai/tagflow/config", 60);
    if (!response.ok) return STANDARD_PRICING;
    const raw: unknown = await response.json();
    if (typeof raw !== "object" || raw === null || !("paid" in raw) || typeof raw.paid !== "object" || raw.paid === null) return STANDARD_PRICING;
    const paid = raw.paid as Record<string, unknown>;
    const config = parsePaidConfig({ enabled: paid["enabled"], accounting: paid["accounting"], providers: paid["providers"], freeWeeklyTokens: paid["freeWeeklyTokens"], packs: paid["packs"] });
    const models = offeredModels("models" in raw ? raw.models : undefined);
    const lists = paidAndFreeModels("models" in raw ? raw.models : undefined);
    return config === null || config.accounting !== "cost-v1" ? STANDARD_PRICING : { freeWeeklyTokens: config.freeWeeklyTokens, packs: config.packs, available: config.enabled, ...(models === undefined ? {} : { models }), ...(lists ?? {}) };
  } catch {
    return STANDARD_PRICING;
  }
}
