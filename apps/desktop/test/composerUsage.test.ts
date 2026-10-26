import { describe, expect, it } from "vitest";
import { summarizeUsage } from "../src/shared/aiUsage.ts";
import { UNLIMITED_DAILY_REQUESTS, UNLIMITED_REQUESTS_PER_MINUTE, paidTokensSummary, type TagflowAllowanceView } from "../src/shared/tagflow.ts";
import { composerUsageModels } from "../src/renderer/ai/composerUsage.ts";

const allowance = (extra: Partial<TagflowAllowanceView> = {}): TagflowAllowanceView => ({
  available: true, blocked: false,
  limits: { dailyRequests: 50, dailyTokens: 1_000_000, dailyCostMicros: 1_000_000, requestsPerMinute: 10 },
  usage: { day: "2026-10-11", requests: 10, inputTokens: 12_000, outputTokens: 4_000, reservedTokens: 4_000, costMicros: 100_000, reservedCostMicros: 50_000, estimatedRequests: 0 },
  resetsAt: new Date("2026-10-12T00:00:00Z").getTime(),
  ...extra,
});

describe("composer usage meters", () => {
  it("shows the session and weekly credit windows when the relay meters credits", () => {
    const now = Date.now();
    const view = allowance({ credits: {
      plan: { sessionCredits: 2000, weeklyCredits: 20000, sessionHours: 5 },
      session: { limit: 2000, used: 1500.4, held: 120, remaining: 379.6, startedAt: now - 3_600_000, resetsAt: now + 4 * 3_600_000 },
      weekly: { limit: 20000, used: 0, held: 0, remaining: 20000, startedAt: null, resetsAt: null },
      rates: { "tagflow-code-27b": 1, "heabsy-qwen38": 0.2 },
    } });
    const [session, weekly] = composerUsageModels(null, view, true, "heabsy-qwen38");
    expect(session).toMatchObject({ label: "Session", percent: 81, value: "81%", detail: "379 left", tone: "warn" });
    expect(session.tooltip).toContain("379 of 2,000 left, 120 held by replies in progress");
    expect(session.tooltip).toContain("Refills in 4 hr");
    expect(session.tooltip).toContain("This model uses 0.2 credits per 1,000 tokens.");
    expect(weekly).toMatchObject({ label: "Weekly", percent: 0, detail: "20,000 left", tone: "ok" });
    expect(weekly.tooltip).toContain("A 7-day window starts with your next request.");
    const spent = composerUsageModels(null, allowance({ credits: { ...view.credits!, session: { ...view.credits!.session, used: 2000, held: 0, remaining: 0 } } }), true)[0];
    expect(spent).toMatchObject({ percent: 100, tone: "full", detail: "Back in 4 hr" });
  });
  it("shows a partner model's own allowance instead of the main one", () => {
    const base = allowance();
    const view = allowance({ pools: [{ provider: "custom-heabsy", name: "Heabsy", models: ["heabsy-qwen38"], limits: { ...base.limits, dailyTokens: 10_000_000 }, usage: { ...base.usage, inputTokens: 1_000_000, outputTokens: 0, reservedTokens: 0 } }] });
    const [partner] = composerUsageModels(null, view, true, "heabsy-qwen38");
    expect(partner).toMatchObject({ percent: 10, detail: "9M left" });
    expect(partner.tooltip).toContain("Heabsy models have their own daily allowance");
    expect(partner.tooltip).toContain("out of 10,000,000");
    const [main] = composerUsageModels(null, view, true, "tagflow-code-27b");
    expect(main).toMatchObject({ detail: "980k left" });
    expect(main.tooltip).not.toContain("Heabsy");
  });
  it("shows unlimited requests even when recorded counts exceed the wire encoding", () => {
    const base = allowance();
    const [tokens, requests] = composerUsageModels(null, allowance({ limits: { ...base.limits, dailyRequests: UNLIMITED_DAILY_REQUESTS, requestsPerMinute: UNLIMITED_REQUESTS_PER_MINUTE }, usage: { ...base.usage, requests: UNLIMITED_DAILY_REQUESTS + 1 } }), true);
    expect(requests).toMatchObject({ percent: null, value: "∞", detail: "Unlimited", tone: "ok" });
    expect(requests.tooltip).toContain("1,000,001 included AI requests used today");
    expect(requests.tooltip).toContain("daily token allowance");
    expect(tokens.detail).toBe("980k left");
  });
  it("includes active reservations in the shared allowance and shows requests separately", () => {
    const [usage, requests] = composerUsageModels(null, allowance(), true);
    expect(usage).toMatchObject({ percent: 2, value: "2%", detail: "980k left", tone: "ok" });
    expect(requests).toMatchObject({ percent: 20, detail: "40 left" });
    expect(usage.tooltip).toContain("Shared across devices");
    expect(usage.tooltip).toContain("active replies temporarily hold 4k tokens");
    expect(usage.tooltip).toContain("980,000 tokens left out of 1,000,000");
    expect(usage.tooltip).toContain("12,000 input (read), 4,000 output (written)");
    expect(usage.tooltip).toContain("history and tool results it reads again");
  });

  it("warns about the service budget without changing what the token ring measures", () => {
    const base = allowance();
    const [usage] = composerUsageModels(null, allowance({ usage: { ...base.usage, costMicros: 800_000, reservedCostMicros: 50_000 } }), true);
    expect(usage).toMatchObject({ percent: 2, detail: "980k left", tone: "warn" });
    expect(usage.tooltip).toContain("Service budget: $0.15 left of $1.00");
    const [exhausted] = composerUsageModels(null, allowance({ usage: { ...base.usage, costMicros: 1_000_000, reservedCostMicros: 0 } }), true);
    expect(exhausted).toMatchObject({ percent: 2, detail: "Budget reached", tone: "full" });
    const [nearly] = composerUsageModels(null, allowance({ usage: { ...base.usage, costMicros: 999_000, reservedCostMicros: 0 } }), true);
    expect(nearly).toMatchObject({ percent: 2, detail: "980k left", tone: "warn" });
  });

  it("clamps exhausted quotas without negative remaining amounts", () => {
    const base = allowance();
    const [usage, requests] = composerUsageModels(null, allowance({ usage: { ...base.usage, inputTokens: 1_300_000, requests: 80 } }), true);
    expect(usage).toMatchObject({ percent: 100, value: "100%", detail: "0 left", tone: "full" });
    expect(requests).toMatchObject({ percent: 100, detail: "0 left", tone: "full" });
  });

  it("does not claim that an unread or blocked allowance has room", () => {
    expect(composerUsageModels(null, null, true)[0]).toMatchObject({ percent: null, detail: "Unavailable" });
    expect(composerUsageModels(null, allowance({ available: false }), true)[0].percent).toBeNull();
    expect(composerUsageModels(null, allowance({ blocked: true }), true)[0]).toMatchObject({ percent: null, value: "!", tone: "full", detail: "Disabled" });
  });

  it("shows real local totals without inventing a provider quota", () => {
    const now = new Date(2026, 9, 11, 12).getTime();
    const view = summarizeUsage([{ day: "2026-10-11", provider: "custom", model: "my-model", source: "chat", requests: 3, inputTokens: 15_000, outputTokens: 5_000, costMicros: 0, estimatedRequests: 1, pricedRequests: 0 }], "today", now);
    const [usage, requests] = composerUsageModels(view, allowance(), false);
    expect(usage).toMatchObject({ percent: null, value: "—", detail: "≈ 20k today" });
    expect(requests).toMatchObject({ percent: null, value: "3", detail: "3 today" });
    expect(usage.tooltip).toContain("does not report an account limit");
  });

  it("distinguishes an empty history from a failed history read", () => {
    expect(composerUsageModels(summarizeUsage([], "today", Date.now()), null, false)[0].detail).toBe("0 today");
    expect(composerUsageModels(null, null, false)[0].detail).toBe("Unavailable");
  });
});

describe("free AI sign-in token failures", () => {
  it("turns a network drop while refreshing the token into the retryable fetch failure, not a sign-in request", async () => {
    const { includedTokenError } = await import("../src/shared/tagflow.ts");
    for (const detail of ["fetch failed", "refresh transport failure", "connect ECONNRESET 104.21.0.1:443"]) {
      const error = includedTokenError(detail);
      expect(error, detail).toBeInstanceOf(TypeError);
      expect(error.message, detail).toBe("fetch failed");
    }
    expect((includedTokenError("getaddrinfo ENOTFOUND securetoken.googleapis.com").cause as { code?: string }).code).toBe("ENOTFOUND");
    expect(includedTokenError("token refresh failed: TOKEN_EXPIRED").message).toBe("Sign in in Account to use included AI.");
  });
});

describe("the composer meter on a paid model", () => {
  const tokens = { enabled: true, free: { limit: 10_000_000, used: 4_000_000, held: 0, remaining: 6_000_000, resetsAt: Date.now() + 3 * 86_400_000 }, purchased: 48_000_000, paidModels: ["heabsy-glm53-flash-unc"] };

  it("shows the free week and purchased tokens on a paid model", () => {
    const [free, purchased] = composerUsageModels(null, allowance({ unlimited: true, tokens }), true, "heabsy-glm53-flash-unc");
    expect(free).toMatchObject({ label: "Free this week", value: "6M", detail: "6M of 10M free" });
    expect(free.tooltip).toContain("48M purchased");
    expect(purchased).toMatchObject({ label: "Purchased", value: "48M", detail: "48M purchased" });
  });

  it.each([["weekly", "Weekly", "subscription"], ["monthly", "Monthly", "gift"], ["pro", "Pro", "subscription"]] as const)("names the %s plan in the weekly meter and usage summary", (id, name, source) => {
    const now = Date.now();
    const planned = { ...tokens, plan: { id, source, endsAt: now + 86_400_000 }, free: { ...tokens.free, limit: id === "pro" ? 150_000_000 : 60_000_000 } };
    const [weekly] = composerUsageModels(null, allowance({ unlimited: true, tokens: planned }), true, "heabsy-glm53-flash-unc");
    expect(weekly.label).toBe(`${name} this week`);
    expect(weekly.tooltip).toContain(`${name} plan`);
    expect(weekly.detail).toContain("included");
    expect(paidTokensSummary(planned, now)).toContain(`${name} plan`);
  });

  it("keeps the free label for an expired or unrecognised plan", () => {
    for (const plan of [{ id: "pro", endsAt: Date.now() - 1, source: "subscription" }, { id: "future-plan", endsAt: Date.now() + 86_400_000, source: "gift" }]) {
      const [weekly] = composerUsageModels(null, allowance({ tokens: { ...tokens, plan } }), true, "heabsy-glm53-flash-unc");
      expect(weekly.label).toBe("Free this week");
    }
  });

  it("warns when the free week and purchased tokens are both gone", () => {
    const [free] = composerUsageModels(null, allowance({ unlimited: true, tokens: { ...tokens, free: { ...tokens.free, used: 10_000_000, remaining: 0 }, purchased: 0 } }), true, "heabsy-glm53-flash-unc");
    expect(free.tone).toBe("full");
    expect(free.tooltip).toContain("Buy tokens");
  });

  it("keeps the unlimited meter for a model that is not paid", () => {
    const [free] = composerUsageModels(null, allowance({ unlimited: true, tokens }), true, "tagflow-code-27b");
    expect(free).toMatchObject({ value: "∞", detail: "Unlimited" });
  });
});

describe("the usage dialog's paid-token line", () => {
  it("says what is left of the free week and what was bought", async () => {
    const { paidTokensSummary } = await import("../src/shared/tagflow.ts");
    const now = Date.parse("2026-10-21T00:00:00Z");
    expect(paidTokensSummary({ enabled: true, free: { limit: 10_000_000, used: 4_000_000, held: 0, remaining: 6_000_000, resetsAt: now + 3 * 86_400_000 }, purchased: 48_000_000 }, now))
      .toBe("Heabsy models: 6M of 10M free tokens left this week (refill in 3 days), then 48M purchased tokens. Tagflow AI stays unlimited.");
    expect(paidTokensSummary({ enabled: true, free: { limit: 10_000_000, used: 0, held: 0, remaining: 10_000_000, resetsAt: null }, purchased: 0 }, now))
      .toBe("Heabsy models: 10M free tokens a week, starting with your first request on them. Tagflow AI stays unlimited.");
  });
});
