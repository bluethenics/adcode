import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PricingPage, { metadata } from "../src/app/pricing/page";
import { PricingContent } from "../src/app/pricing/PricingContent";
import { FreePlan } from "../src/components/FreePlan";
import { checkoutIntent, selectedPricingPlan } from "../src/app/ai-tokens/AiTokens";
import { PlanCards } from "../src/app/ai-tokens/Plans";
import { pricingOffer } from "../src/lib/pricingOffer";
import { FREE_WEEKLY_TOKENS, PLANS, PLANS_ON_SALE, STANDARD_PRICING } from "../src/lib/pricing";
import { readApi } from "../src/lib/apiRead";
import { FAQ } from "../src/lib/schema";
import { url } from "../src/lib/site";

vi.mock("../src/lib/apiRead", () => ({ readApi: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("public pricing and existing checkout", () => {
  it("shows the complete source catalogue without requiring sign-in or a successful API call", async () => {
    vi.mocked(readApi).mockRejectedValue(new Error("offline"));
    const html = renderToStaticMarkup(await PricingPage());
    expect(metadata.alternates?.canonical).toBe(url("/pricing"));
    for (const amount of ["$9", "$29", "$59", "$10", "$25", "$50", "140 free credits", "300", "975", "2,000", "5,000", "14,000", "30,000"]) expect(html).toContain(amount);
    expect(html).toContain("Practically unlimited.");
    expect(html).toContain("Up to <strong>$100</strong> of top-up credits a month");
    expect(html).not.toContain("$299");
    expect(html).not.toContain("ai-tokens?plan=weekly");
    expect(html).toContain("Purchased credits never expire");
    expect(html).toContain("The standard catalogue is shown");
    expect(html).not.toContain("Sign in to see");
    for (const plan of PLANS_ON_SALE) expect(html).toContain(`href="/ai-tokens?plan=${plan.id}&amp;go=1#plans"`);
    expect(html).toContain("first subscription becomes active while your Pro plan is active");
    expect(html).toContain("100 extra credits");
    expect(html).toContain("Each friend can earn the reward once");
  });

  it("uses the current bounded sale configuration and explains a sales pause", async () => {
    vi.mocked(readApi).mockResolvedValue(Response.json({ paid: { enabled: false, providers: ["custom-heabsy"], freeWeeklyTokens: 132_000, accounting: "cost-v1", packs: [{ id: "extra", priceCents: 1250, tokens: 55_000_000 }] } }));
    const offer = await pricingOffer();
    expect(readApi).toHaveBeenCalledWith("/v1/ai/tagflow/config", 60);
    const html = renderToStaticMarkup(<PricingContent offer={offer} />);
    expect(html).toContain("12 free credits each day");
    expect(html).toContain("5,000"); expect(html).toContain("$12.50 once");
    expect(html).not.toContain("30,000");
    expect(html).toContain("Plan and token sales are temporarily paused");
    expect(html).not.toContain("standard catalogue is shown");
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

  it("keeps homepage and search answers honest about free access and optional paid AI", () => {
    const html = renderToStaticMarkup(<FreePlan />);
    expect(FREE_WEEKLY_TOKENS).toBe(1_540_000);
    expect(html).toContain("140"); expect(html).toContain('href="/pricing"');
    expect(html).not.toContain("Start with unlimited included AI");
    const facts = FAQ.map(item => item.a).join("\n");
    expect(facts).toContain("Builder $9/month");
    expect(facts).toContain("Pro $29/month");
    expect(facts).toContain("Max $59/month");
    expect(facts).not.toContain("Weekly");
    expect(facts).not.toContain("no paid tier");
    expect(facts).not.toContain("no subscription, no trial");
  });
});

describe("included model rates", () => {
  it("lists only the models offered now and marks recent ones New", () => {
    const now = Date.parse("2026-11-03T00:00:00Z");
    const offer = { ...STANDARD_PRICING, models: [
      { name: "Qwen3.8 27B Queen", input: 0.1, cached: 0.05, output: 0.61, releaseDate: "2026-11-01" },
      { name: "GLM 5.3 Flash Uncensored", input: 0.2, cached: 0.0641, output: 0.8001 },
    ] };
    const html = renderToStaticMarkup(<PricingContent offer={offer} now={now} />);
    expect(html).toContain("Qwen3.8 27B Queen<span class=\"pricing-new\">New</span>");
    expect(html).not.toContain("GLM 5.3 Flash Uncensored<span class=\"pricing-new\">");
    expect(html).not.toContain("Claude Opus 5.5 (Heabsy partner)");
  });
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
