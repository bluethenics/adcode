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
  it("renders without sign-in or a successful API call, and sells three plans and any amount of credits", async () => {
    vi.mocked(readApi).mockRejectedValue(new Error("offline"));
    const html = renderToStaticMarkup(await PricingPage());
    expect(metadata.alternates?.canonical).toBe(url("/pricing"));
    for (const amount of ["$10", "$20", "$50", "$100", "$19", "$39", "$149", "$5 to $1,000"]) expect(html).toContain(amount);
    expect(html).not.toContain("35%");
    expect(html).toContain("The live price list could not be loaded");
    expect(PLANS_ON_SALE.map((plan) => plan.name)).toEqual(["Builder", "Pro", "Max"]);
    // Pro is the recommendation, each plan costs so much a day, and checkout opens from each card.
    expect(html).toContain("Recommended");
    for (const perDay of ["$0.63 a day", "$1.30 a day", "$4.97 a day"]) expect(html).toContain(perDay);
    for (const plan of ["monthly", "pro", "max"]) expect(html).toContain(`/ai-tokens?plan=${plan}&amp;go=1#plans`);
    expect(html).toContain("/ai-tokens?amount=25&amp;go=1#wallet");
    expect(html).toContain("Cancel any time");
    // Yearly is offered only once its Dodo products exist.
    expect(html).not.toContain("2 months free");
    expect(html).not.toContain("Plans ended on 6 November 2026");
    expect(html).not.toContain("Sign in to see");
  });

  it("sells honestly: no countdown, invented proof or hidden price", () => {
    const html = renderToStaticMarkup(<PricingContent offer={{ ...STANDARD_PRICING, available: true }} />).toLowerCase();
    for (const word of ["hurry", "only a few", "spots left", "countdown", "users love", "trusted by", "most popular", "markup", "margin"]) expect(html, word).not.toContain(word);
  });

  it("shows yearly billing only when it can be bought, with the amount charged today", () => {
    const html = renderToStaticMarkup(<PricingContent offer={{ ...STANDARD_PRICING, available: true, yearly: true }} />);
    expect(html).toContain("2 months free");
    expect(html).toContain("Monthly or yearly, until you cancel");
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

  it("shows a running price offer: a banner, offer prices, and each regular price struck through", async () => {
    const endsAt = Date.parse("2099-11-27T13:00:00Z");
    vi.mocked(readApi).mockResolvedValue(Response.json({
      paid: { enabled: true, providers: ["custom-heabsy"], freeWeeklyTokens: 1_540_000, accounting: "cost-v1", packs: [{ id: "starter", priceCents: 300, tokens: 16_500_000 }] },
      offer: { name: "Launch offer", percent: 15, endsAt },
      // The service already lists offer prices: $1.35 regular, $1.1475 with 15% off.
      models: [{ id: "paid", name: "Paid · Paid credits", billing: "wallet", paid: true, providerName: "Heabsy", inputPrice: 1.1475, outputPrice: 5.7375, cacheInputPrice: 0.11475 }],
    }));
    const offer = await pricingOffer();
    expect(offer.offer).toEqual({ name: "Launch offer", percent: 15, endsAt });
    const html = renderToStaticMarkup(<PricingContent offer={offer} />);
    expect(html).toContain("Launch offer");
    expect(html).toContain("15% off every paid model");
    expect(html).toContain("Until 27 November");
    expect(html).toContain("$1.1475");
    expect(html).toMatch(/<s class="model-price-regular">.*?\$1\.35<\/s>/);
    expect(html).toMatch(/<s class="model-price-regular">.*?\$6\.75<\/s>/);
    // The offer is shown, never where the discount comes from.
    for (const word of ["markup", "margin", "35%"]) expect(html.toLowerCase()).not.toContain(word);
  });

  it("ignores an offer that has ended or is malformed, and shows regular prices only", async () => {
    for (const bad of [{ name: "Old", percent: 15, endsAt: Date.now() - 1000 }, { name: "", percent: 15, endsAt: Date.parse("2099-01-01") }, { name: "X", percent: 150, endsAt: Date.parse("2099-01-01") }]) {
      vi.mocked(readApi).mockResolvedValue(Response.json({
        paid: { enabled: true, providers: ["custom-heabsy"], freeWeeklyTokens: 1_540_000, accounting: "cost-v1", packs: [{ id: "starter", priceCents: 300, tokens: 16_500_000 }] },
        offer: bad,
        models: [{ id: "paid", name: "Paid", billing: "wallet", paid: true, providerName: "Heabsy", inputPrice: 1.35, outputPrice: 6.75 }],
      }));
      const offer = await pricingOffer();
      expect(offer.offer).toBeNull();
      const html = renderToStaticMarkup(<PricingContent offer={offer} />);
      expect(html).not.toContain("model-price-regular");
      expect(html).not.toContain("pricing-offer");
    }
  });

  it("explains a paused sale", () => {
    const html = renderToStaticMarkup(<PricingContent offer={{ ...STANDARD_PRICING, available: false }} />);
    expect(html).toContain("Purchases are temporarily paused");
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
    expect(checkoutIntent("?plan=pro&go=1")).toEqual({ plan: "pro", pack: null, billing: "month", amount: null });
    expect(checkoutIntent("?plan=max&billing=year&go=1")).toEqual({ plan: "max", pack: null, billing: "year", amount: null });
    expect(checkoutIntent("?pack=starter&go=1")).toEqual({ plan: null, pack: "starter", billing: "month", amount: null });
    expect(checkoutIntent("?amount=37&go=1")).toEqual({ plan: null, pack: null, billing: "month", amount: 37 });
    for (const bad of ["?amount=4&go=1", "?amount=1001&go=1", "?amount=12.5&go=1", "?amount=abc&go=1"]) expect(checkoutIntent(bad), bad).toBeNull();
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
    expect(html).toContain("Tagflow AI"); expect(html).not.toContain("35%"); expect(html).toContain('href="/pricing"');
    expect(html).not.toContain("Start with unlimited included AI");
    const facts = FAQ.map(item => item.a).join("\n");
    expect(facts).toContain("pay as you go");
    expect(facts).toContain("at the price listed for it"); expect(facts).not.toContain("35%");
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
