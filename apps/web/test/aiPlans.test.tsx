import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PLANS, subscriptionBlocksCheckout } from "../../../services/api/src/aiPlans.ts";
import { CodeRedeemer, PlanCards, PlanRequestError, codeMessage, planArrivalMessage, planRequest } from "../src/app/ai-tokens/Plans";
import { BalanceSummary, checkoutArrived } from "../src/app/ai-tokens/AiTokens";
import { PlansAdmin, PromoAdminTable, SubscriptionSummaryTable, newResetProgress, resetEveryoneInBatches, resetHasMore, resetResultMessage } from "../src/components/PlansAdmin";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("AI plans on the website", () => {
  it("keeps recoverable billing subscriptions in the portal while access is suspended", () => {
    for (const status of ["active", "pending", "on_hold", "paused", "past_due"]) expect(subscriptionBlocksCheckout(status, 500, 1_000)).toBe(true);
    expect(subscriptionBlocksCheckout("cancelled", 2_000, 1_000)).toBe(true);
    expect(subscriptionBlocksCheckout("cancelled", 500, 1_000)).toBe(false);
    expect(subscriptionBlocksCheckout("expired", 500, 1_000)).toBe(false);
  });
  it("shows the real prices, weekly allowances, Pro invites, and current plan", () => {
    const html = renderToStaticMarkup(<PlanCards plans={PLANS} current="monthly" busy={null} onChoose={() => undefined} />);
    expect(html).toContain("$3"); expect(html).toContain("/week");
    expect(html).toContain("$9"); expect(html).toContain("$19"); expect(html).toContain("/month");
    expect(html).toContain("150M tokens a week"); expect(html).toContain("60M tokens a week");
    expect(html).toContain("Invite 2 friends"); expect(html).toContain("Current plan");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Monthly: current plan"/);
  });

  it("prevents duplicate plan purchases while a subscription or checkout is active", () => {
    const subscribed = renderToStaticMarkup(<PlanCards plans={PLANS} current="monthly" busy={null} subscribed onChoose={() => undefined} />);
    expect(subscribed.match(/disabled=""/g)).toHaveLength(3);
    expect(subscribed).toContain("Manage in portal");
    const busy = renderToStaticMarkup(<PlanCards plans={PLANS} current={null} busy="pro" onChoose={() => undefined} />);
    expect(busy.match(/disabled=""/g)).toHaveLength(3);
    expect(busy).toContain("Opening checkout…");
  });

  it("names the plan in the account's weekly balance and identifies gifts", () => {
    const html = renderToStaticMarkup(<BalanceSummary tokens={{ enabled: true, free: { limit: 150_000_000, used: 1_000_000, held: 0, remaining: 149_000_000, resetsAt: null }, purchased: 4_000_000, plan: { id: "pro", source: "gift", endsAt: 2_000_000_000_000 } }} now={1_900_000_000_000} />);
    expect(html).toContain("Pro this week"); expect(html).toContain("149M of 150M free"); expect(html).toContain("Gifted plan");
  });

  it("offers both promotion and invite redemption with labelled fields", () => {
    const html = renderToStaticMarkup(<CodeRedeemer token={async () => "test"} onRedeem={() => undefined} />);
    expect(html).toContain("Code type"); expect(html).toContain("Promo code"); expect(html).toContain("Friend&#x27;s invite");
    expect(html).toContain("before subscribing"); expect(html).toContain("Redeem code");
  });

  it("explains each code outcome, including the delayed invite reward", () => {
    expect(codeMessage("tokens")).toContain("added to your balance");
    expect(codeMessage("plan")).toContain("plan is active");
    expect(codeMessage("joined", true)).toContain("Start any paid plan");
    expect(codeMessage("already")).toContain("already redeemed");
    expect(codeMessage("unknown")).toContain("wasn't found");
    expect(codeMessage("expired")).toContain("expired");
    expect(codeMessage("used-up")).toContain("redemption limit");
    expect(codeMessage("used-up", true)).toContain("no uses left");
    expect(codeMessage("own-code", true)).toContain("own invite");
    expect(codeMessage("has-plan", true)).toContain("haven't started");
  });
});

describe("webhook-confirmed subscription returns", () => {
  const free = { enabled: true, free: { limit: 10_000_000, used: 0, held: 0, remaining: 10_000_000, resetsAt: null }, purchased: 0 };
  it("does not announce activation just because checkout returned", () => {
    expect(checkoutArrived({ tokens: free, orders: [], subscription: null }, { plan: "pro", order: "aip_1" })).toBe(false);
    expect(planArrivalMessage("checking", "pro")).toContain("after payment is confirmed");
    expect(planArrivalMessage("checking", "pro")).not.toContain("plan is active");
    expect(planArrivalMessage("not-yet", "pro")).toContain("hasn't been confirmed");
  });
  it("confirms the subscription even when a higher gifted plan wins the allowance", () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const view = { tokens: { ...free, plan: { id: "pro" as const, source: "gift" as const, endsAt: 9_000 } }, orders: [], subscription: { plan: "monthly" as const, status: "active", periodEnd: 8_000, active: true } };
    expect(checkoutArrived(view, { plan: "monthly", order: "aip_1" })).toBe(true);
    expect(checkoutArrived(view, { plan: "pro", order: "aip_1" })).toBe(false);
    expect(checkoutArrived({ ...view, subscription: { ...view.subscription, active: false } }, { plan: "monthly", order: "aip_1" })).toBe(false);
    expect(checkoutArrived({ ...view, subscription: null }, { plan: "pro", order: "aip_1" })).toBe(false);
  });
});

describe("plan requests", () => {
  it("explains how to resume an existing checkout and preserves uncertain provider outcomes", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: "checkout-exists", message: "You already opened a Weekly checkout. Choose that plan again to resume it." } }, { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    await expect(planRequest("/ai/plans/checkout", "test", { plan: "pro" })).rejects.toMatchObject({ code: "checkout-exists", message: expect.stringContaining("Choose that plan again to resume") });
    fetch.mockResolvedValueOnce(Response.json({ error: { code: "checkout-pending", message: "We couldn't confirm your checkout. Contact support before opening another subscription." } }, { status: 502 }));
    await expect(planRequest("/ai/plans/checkout", "test", { plan: "weekly" })).rejects.toMatchObject({ code: "checkout-pending", message: expect.stringContaining("Contact support") });
  });
  it("retains a rejected redemption's result for a helpful message", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ result: "already" }, { status: 409 })); vi.stubGlobal("fetch", fetch);
    await expect(planRequest("/ai/promo/redeem", "test", { code: "LAUNCH" })).rejects.toMatchObject({ code: "already" });
    expect(fetch).toHaveBeenCalledWith("/v1/ai/promo/redeem", expect.objectContaining({ method: "POST", body: '{"code":"LAUNCH"}', headers: { authorization: "Bearer test", "content-type": "application/json" } }));
  });
  it("explains verification and missing product configuration errors", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "verify-account" }, { status: 403 })).mockResolvedValueOnce(Response.json({ error: "not-configured" }, { status: 503 })); vi.stubGlobal("fetch", fetch);
    await expect(planRequest("/ai/plans/checkout", "test", {})).rejects.toThrow("Verify your email");
    await expect(planRequest("/ai/plans/checkout", "test", {})).rejects.toThrow("aren't ready yet");
  });
  it("handles absent sessions, network failures and unreadable replies", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("disconnected")).mockResolvedValueOnce(new Response("Bad gateway", { status: 502 })); vi.stubGlobal("fetch", fetch);
    await expect(planRequest("/ai/plans/portal", null, {})).rejects.toBeInstanceOf(PlanRequestError);
    expect(fetch).not.toHaveBeenCalled();
    await expect(planRequest("/ai/plans/portal", "test", {})).rejects.toThrow("Check your connection");
    await expect(planRequest("/ai/plans/portal", "test", {})).rejects.toThrow("Couldn't read");
  });
});

describe("admin plans and promotions", () => {
  it("lists rewards, use counts, expiry and availability", () => {
    const html = renderToStaticMarkup(<PromoAdminTable now={1_000} promos={[{ code: "LAUNCH", kind: "tokens", tokens: 50_000_000, maxRedemptions: 100, redemptions: 3, expiresAt: Date.parse("2026-11-01T00:00:00Z") }, { code: "PRO7", kind: "plan", plan: "pro", days: 7, maxRedemptions: 1, redemptions: 1, expiresAt: 3_000 }]} />);
    expect(html).toContain("LAUNCH"); expect(html).toContain("3 / 100"); expect(html).toContain("50M tokens");
    expect(html).toContain("7 days of Pro"); expect(html).toContain("Fully redeemed"); expect(html).toContain("2026-11-01");
  });
  it("shows subscription totals and excludes empty revenue claims", () => {
    const html = renderToStaticMarkup(<SubscriptionSummaryTable plans={[{ plan: "weekly", active: 2, mrrCents: 2_600 }, { plan: "pro", active: 3, mrrCents: 5_700 }]} />);
    expect(html).toContain("$83"); expect(html).toContain("Total");
    expect(renderToStaticMarkup(<SubscriptionSummaryTable plans={[]} />)).toContain("No active paid subscriptions");
  });
  it("has independently submitted allowance and promo forms and visible loading states", () => {
    const html = renderToStaticMarkup(<PlansAdmin call={async <T,>() => ({} as T)} />);
    expect(html.match(/<form/g)).toHaveLength(2);
    expect(html).toContain("Reset weekly usage"); expect(html).toContain("Boost weekly allowance"); expect(html).toContain("Gift a plan");
    expect(html).toContain("Everyone"); expect(html).toContain("Loading subscriptions"); expect(html).toContain("Loading promo codes");
  });
  it("identifies held requests without treating skipped resets as success", () => {
    expect(resetResultMessage({ reset: 2, busy: 1, none: 3 })).toContain("2 weekly allowances reset");
    expect(resetResultMessage({ reset: 2, busy: 1, none: 3 })).toContain("1 account has a request in progress");
    expect(resetResultMessage({ reset: 0, busy: 0, none: 1 })).toContain("1 account has no weekly usage");
  });

  it("advances everyone resets only after confirmed pages and resumes after a disconnect", async () => {
    const call = vi.fn().mockResolvedValueOnce({ reset: 499, busy: 1, none: 0, failed: [], nextCursor: "member-0499" }).mockRejectedValueOnce(new Error("disconnected"));
    let confirmed = newResetProgress();
    await expect(resetEveryoneInBatches(call, confirmed, progress => { confirmed = progress; })).rejects.toThrow("disconnected");
    expect(confirmed).toMatchObject({ reset: 499, busy: 1, after: "member-0499" });
    call.mockResolvedValueOnce({ reset: 2, busy: 0, none: 0, failed: [], nextCursor: null });
    const finished = await resetEveryoneInBatches(call, confirmed, progress => { confirmed = progress; });
    expect(call.mock.calls.map(args => args[1])).toEqual([{ uid: "*", after: "" }, { uid: "*", after: "member-0499" }, { uid: "*", after: "member-0499" }]);
    expect(finished).toMatchObject({ reset: 501, busy: 1, after: null }); expect(resetHasMore(finished)).toBe(false);
  });

  it("pauses on partial failures, retries only those accounts, then continues the next page", async () => {
    const call = vi.fn().mockResolvedValueOnce({ reset: 498, busy: 1, none: 0, failed: ["retry-me"], nextCursor: "member-0499" });
    const paused = await resetEveryoneInBatches(call, newResetProgress(), () => undefined);
    expect(call).toHaveBeenCalledTimes(1); expect(resetHasMore(paused)).toBe(true);
    call.mockResolvedValueOnce({ reset: 1, busy: 0, none: 0, failed: [], nextCursor: null }).mockResolvedValueOnce({ reset: 2, busy: 0, none: 0, failed: [], nextCursor: null });
    const finished = await resetEveryoneInBatches(call, paused, () => undefined);
    expect(call.mock.calls[1]![1]).toEqual({ uid: "*", retryUids: ["retry-me"] });
    expect(call.mock.calls[2]![1]).toEqual({ uid: "*", after: "member-0499" });
    expect(finished.reset).toBe(501); expect(finished.busy).toBe(1);
  });

  it("honors an administrator's pause between batches", async () => {
    const call = vi.fn().mockResolvedValue({ reset: 500, busy: 0, none: 0, failed: [], nextCursor: "member-0499" });
    let pause = false;
    const progress = await resetEveryoneInBatches(call, newResetProgress(), () => { pause = true; }, () => pause);
    expect(call).toHaveBeenCalledTimes(1); expect(progress.after).toBe("member-0499");
  });
});
