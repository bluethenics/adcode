import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PricingPage, { metadata } from "../src/app/pricing/page";
import { PricingContent } from "../src/app/pricing/PricingContent";
import { FreePlan } from "../src/components/FreePlan";
import { checkoutIntent, selectedPricingPlan } from "../src/app/ai-tokens/AiTokens";
import { PlanCards } from "../src/app/ai-tokens/Plans";
import { pricingOffer } from "../src/lib/pricingOffer";
import { PLANS, PLANS_ON_SALE, STANDARD_PRICING } from "../src/lib/pricing";
import { readApi } from "../src/lib/apiRead";
import { FAQ } from "../src/lib/schema";
import { url } from "../src/lib/site";

vi.mock("../src/lib/apiRead", () => ({ readApi: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("public pricing and existing checkout", () => {
  it("renders without sign-in or a successful API call, and sells no plan or pack", async () => {
    vi.mocked(readApi).mockRejectedValue(new Error("offline"));
    const html = renderToStaticMarkup(await PricingPage());
    expect(metadata.alternates?.canonical).toBe(url("/pricing"));
    for (const amount of ["$10", "$20", "$50", "$100", "35%"]) expect(html).toContain(amount);
    expect(html).toContain("Pay only for the models you use");
    expect(html).toContain("The live price list could not be loaded");
    expect(html).toContain("Plans ended on 6 November 2026");
    expect(PLANS_ON_SALE).toEqual([]);
    for (const gone of ["$29", "$59", "Practically unlimited", "ai-tokens?plan=", "#packs", "100 extra credits"]) expect(html).not.toContain(gone);
    expect(html).not.toContain("Sign in to see");
  });

  it("lists every paid model with its marked-up price, and the free Tagflow models, from the live list", async () => {
    vi.mocked(readApi).mockResolvedValue(Response.json({
      paid: { enabled: true, providers: ["custom-heabsy"], freeWeeklyTokens: 1_540_000, accounting: "cost-v1", packs: [{ id: "starter", priceCents: 300, tokens: 16_500_000 }] },
      models: [
        { id: "tagflow-code-27b", name: "Tagflow Code 27B", paid: false, providerName: "Tagflow AI" },
        { id: "heabsy-qwen38-queen", name: "Qwen3.8 27B Queen · Paid credits", billing: "wallet", paid: true, providerName: "Heabsy", inputPrice: 0.135, outputPrice: 0.8235, cacheInputPrice: 0.0675 },
      ],
    }));
    const offer = await pricingOffer();
    expect(readApi).toHaveBeenCalledWith("/v1/ai/tagflow/config", 60);
    expect(offer.paidModels).toEqual([{ id: "heabsy-qwen38-queen", name: "Qwen3.8 27B Queen", provider: "Heabsy", input: 0.135, output: 0.8235, cached: 0.0675 }]);
    expect(offer.freeModels).toEqual(["Tagflow Code 27B"]);
    const html = renderToStaticMarkup(<PricingContent offer={offer} />);
    expect(html).toContain("Qwen3.8 27B Queen");
    expect(html).toContain("$0.135"); expect(html).toContain("$0.8235");
    expect(html).toContain("Tagflow Code 27B: free for every signed-in account");
    expect(html).not.toContain("Cache writes");
  });

  it("explains a paused sale", () => {
    const html = renderToStaticMarkup(<PricingContent offer={{ ...STANDARD_PRICING, available: false }} />);
    expect(html).toContain("Credit purchases are temporarily paused");
  });

  it("falls back safely instead of rendering malformed or unsafe advertised products", async () => {
    for (const body of [null, { paid: null }, { paid: { enabled: true, providers: ["custom-heabsy"], freeWeeklyTokens: 5_000_000, packs: [{ id: "https://bad.example", priceCents: 1, tokens: -1 }] } }]) {
      vi.mocked(readApi).mockResolvedValue(Response.json(body));
      expect(await pricingOffer()).toBe(STANDARD_PRICING);
    }
    vi.mocked(readApi).mockResolvedValue(new Response(null, { status: 503 }));
    expect(await pricingOffer()).toBe(STANDARD_PRICING);
  });

  it("opens checkout straight from a Pricing click, and only then", () => {
    expect(checkoutIntent("?plan=pro&go=1")).toEqual({ plan: "pro", pack: null });
    expect(checkoutIntent("?pack=starter&go=1")).toEqual({ plan: null, pack: "starter" });
    expect(checkoutIntent("?plan=pro")).toBeNull();
    expect(checkoutIntent("?plan=invalid&go=1")).toBeNull();
    expect(checkoutIntent("?plan=pro&go=1&order=aip_123")).toBeNull();
  });

  it("carries only a recognized plan to review and does not confuse it with a paid checkout return", () => {
    expect(selectedPricingPlan("?plan=pro")).toBe("pro");
    expect(selectedPricingPlan("?plan=monthly")).toBe("monthly");
    expect(selectedPricingPlan("?plan=invalid")).toBeNull();
    expect(selectedPricingPlan("?plan=pro&order=aip_123")).toBeNull();
    const html = renderToStaticMarkup(<PlanCards plans={PLANS} current={null} busy={null} selected="pro" onChoose={() => undefined} />);
    expect(html.match(/data-selected="true"/g)).toHaveLength(1);
    expect(html).toContain("Selected from pricing");
    expect(html).toContain("Choose Pro");
    expect(html).not.toContain("Opening checkout");
  });

  it("keeps homepage and search answers honest about free access and paid models", () => {
    const html = renderToStaticMarkup(<FreePlan />);
    expect(html).toContain("Tagflow AI"); expect(html).toContain("35%"); expect(html).toContain('href="/pricing"');
    expect(html).not.toContain("Start with unlimited included AI");
    const facts = FAQ.map(item => item.a).join("\n");
    expect(facts).toContain("pay as you go");
    expect(facts).toContain("provider's price plus 35%");
    for (const gone of ["Builder $9/month", "Pro $29/month", "Max $59/month", "credit pack"]) expect(facts).not.toContain(gone);
    expect(facts).not.toContain("no paid tier");
  });
});

describe("included model rates", () => {
  it("reads rates and dates from the live config, skipping wallet models", async () => {
    const { offeredModels } = await import("../src/lib/pricingOffer");
    expect(offeredModels([
      { name: "Queen", inputCreditsPer1k: 0.1, outputCreditsPer1k: 0.61, cacheCreditsPer1k: 0.05, releaseDate: "2026-11-01" },
      { name: "Paid", billing: "wallet", inputPrice: 1, outputPrice: 2 },
      { name: "Sponsored", inputCreditsPer1k: 0, outputCreditsPer1k: 0 },
    ])).toEqual([{ name: "Queen", input: 0.1, cached: 0.05, output: 0.61, releaseDate: "2026-11-01" }]);
    expect(offeredModels(undefined)).toBeUndefined();
  });
});
