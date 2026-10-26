import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";
import { DEFAULT_PAID_CONFIG } from "../src/paidTokens.ts";
import { handleFundingWebhook } from "../src/funding.ts";
import { sign } from "../src/billing.ts";
import type { TokenVerifier } from "../src/auth.ts";
import type { CheckoutRequest, PaymentProvider } from "../src/payments.ts";

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "admin") return { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } };
    if (token === "user" || token === "friend") return { uid: token, claims: { email: `${token}@adcode.test`, email_verified: true } };
    if (token === "unverified") return { uid: "nov", claims: { email: "nov@adcode.test", email_verified: false } };
    return null;
  },
};
const active = (uid: string, plan: "weekly" | "monthly" | "pro", webhookId = `w-${uid}`) => ({ webhookId, type: "active" as const, subscriptionId: `sub-${uid}`, uid, plan, customerId: `cus-${uid}`, status: "active", periodEnd: NOW + 30 * DAY, cancelAtPeriodEnd: false, now: NOW });

describe("AI plan routes", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let checkouts: CheckoutRequest[];
  let portals: string[];
  let handle: ReturnType<typeof createFetchHandler>;
  const payments = (): PaymentProvider => ({
    async createCheckout(request) { checkouts.push(request); return { sessionId: "cs_p", checkoutUrl: "https://checkout.test/cs_p" }; },
    async customerPortal(customerId) { portals.push(customerId); return `https://portal.test/${customerId}`; },
  });
  const call = (path: string, token?: string, data?: unknown) => handle(new Request(`https://adcode.test/v1${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }));
  const selling = (enabled: boolean) => store.putTagflowConfig({ config: { ...DEFAULT_TAGFLOW_CONFIG, paid: { ...DEFAULT_PAID_CONFIG, enabled } }, updatedAt: 0, updatedBy: "setup" });

  beforeEach(async () => {
    store = createMemoryStore(); checkouts = []; portals = [];
    await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
    await selling(true);
    handle = createFetchHandler({ store, verifier, clock: { now: () => NOW }, payments: payments(), siteOrigin: "https://adcode.test", tagflow: { apiKey: "k" } });
  });

  it("opens a Dodo checkout for a plan on its own product, carrying who is subscribing", async () => {
    const response = await call("/ai/plans/checkout", "user", { plan: "pro", billingCountry: "DE" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ checkoutUrl: "https://checkout.test/cs_p" });
    expect(checkouts[0]).toMatchObject({ product: "plan-pro", amountMicros: 19_000_000n, billingCountry: "DE", metadata: { uid: "user", plan: "pro" } });
    expect(checkouts[0]!.orderId.startsWith("aip_")).toBe(true);
  });

  it("refuses an unknown plan, an unverified account, selling off, and a missing product", async () => {
    expect((await call("/ai/plans/checkout", "user", { plan: "gold", billingCountry: "DE" })).status).toBe(400);
    expect((await call("/ai/plans/checkout", "unverified", { plan: "pro", billingCountry: "DE" })).status).toBe(403);
    await selling(false);
    expect((await call("/ai/plans/checkout", "user", { plan: "pro", billingCountry: "DE" })).status).toBe(409);
    await selling(true);
    handle = createFetchHandler({ store, verifier, clock: { now: () => NOW }, payments: { canCreateCheckout: () => false, async createCheckout() { return null; } }, siteOrigin: "https://adcode.test", tagflow: { apiKey: "k" } });
    expect((await call("/ai/plans/checkout", "user", { plan: "pro", billingCountry: "DE" })).status).toBe(503);
  });

  it("prevents duplicate subscriptions and resumes one durable checkout across workers", async () => {
    await store.applySubscriptionEvent(active("user", "monthly"));
    expect((await call("/ai/plans/checkout", "user", { plan: "pro", billingCountry: "DE" })).status).toBe(409);
    const first = await (await call("/ai/plans/checkout", "friend", { plan: "weekly", billingCountry: "US" })).json();
    // A second handler has no isolate-local state, but sees the same account's database claim.
    handle = createFetchHandler({ store, verifier, clock: { now: () => NOW }, payments: payments(), siteOrigin: "https://adcode.test", tagflow: { apiKey: "k" } });
    for (let i = 0; i < 5; i++) expect(await (await call("/ai/plans/checkout", "friend", { plan: "weekly", billingCountry: "US" })).json()).toEqual(first);
    const other = await call("/ai/plans/checkout", "friend", { plan: "pro", billingCountry: "US" });
    expect(other.status).toBe(409); expect(await other.json()).toMatchObject({ error: { code: "checkout-exists" } });
    expect(checkouts).toHaveLength(1);
  });

  it("allows only one concurrent provider call and keeps an uncertain failure guarded", async () => {
    let resolve: (value: null) => void = () => undefined;
    const provider = vi.fn<PaymentProvider["createCheckout"]>(() => new Promise(done => { resolve = done; }));
    handle = createFetchHandler({ store, verifier, clock: { now: () => NOW }, payments: { createCheckout: provider }, siteOrigin: "https://adcode.test", tagflow: { apiKey: "k" } });
    const first = call("/ai/plans/checkout", "friend", { plan: "weekly", billingCountry: "US" });
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    const concurrent = await call("/ai/plans/checkout", "friend", { plan: "monthly", billingCountry: "US" });
    expect(concurrent.status).toBe(409);
    resolve(null); expect((await first).status).toBe(502);
    expect((await call("/ai/plans/checkout", "friend", { plan: "weekly", billingCountry: "US" })).status).toBe(409);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("does not return a payable checkout after its subscription activates during creation", async () => {
    handle = createFetchHandler({ store, verifier, clock: { now: () => NOW }, payments: { async createCheckout() {
      await store.applySubscriptionEvent(active("user", "monthly"));
      return { sessionId: "cs_p", checkoutUrl: "https://checkout.test/cs_p" };
    } }, siteOrigin: "https://adcode.test", tagflow: { apiKey: "k" } });
    const response = await call("/ai/plans/checkout", "user", { plan: "monthly", billingCountry: "US" });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "already-subscribed" });
  });

  it("opens the Dodo portal for a subscriber only", async () => {
    expect((await call("/ai/plans/portal", "user", {})).status).toBe(404);
    await store.applySubscriptionEvent(active("user", "monthly"));
    const response = await call("/ai/plans/portal", "user", {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ link: "https://portal.test/cus-user" });
  });

  it.each(["active", "pending", "on_hold", "paused", "past_due"])("sends a recoverable %s subscription to the portal even without current access", async status => {
    await store.applySubscriptionEvent({ ...active("user", "monthly"), type: "on_hold", status });
    expect((await store.getAiPlanState("user", NOW)).plan).toBeNull();
    expect((await call("/ai/plans/checkout", "user", { plan: "pro", billingCountry: "US" })).status).toBe(409);
    expect(checkouts).toHaveLength(0);
    expect((await call("/ai/plans/portal", "user", {})).status).toBe(200);
  });

  it("redeems promo codes with a clear answer for each outcome", async () => {
    await store.createPromo({ code: "LAUNCH", kind: "tokens", tokens: 5_000_000, maxRedemptions: 1, expiresAt: NOW + DAY }, "admin-1", NOW);
    const redeem = async (token: string, code: string) => { const r = await call("/ai/promo/redeem", token, { code }); return [r.status, ((await r.json()) as { result?: string; error?: string }).result ?? (await Promise.resolve(undefined))] as const; };
    expect(await redeem("user", "LAUNCH")).toEqual([200, "tokens"]);
    expect((await call("/ai/promo/redeem", "user", { code: "LAUNCH" })).status).toBe(409);
    expect((await call("/ai/promo/redeem", "friend", { code: "LAUNCH" })).status).toBe(410);
    expect((await call("/ai/promo/redeem", "friend", { code: "NOPE" })).status).toBe(404);
    expect((await call("/ai/promo/redeem", "unverified", { code: "LAUNCH" })).status).toBe(403);
  });

  it("shows a Pro subscriber their invite code and lets a friend join", async () => {
    expect((await call("/ai/invites", "user")).status).toBe(404);
    await store.applySubscriptionEvent(active("user", "pro"));
    const invite = await (await call("/ai/invites", "user")).json() as { code: string; uses: number; maxUses: number };
    expect(invite).toMatchObject({ uses: 0, maxUses: 2 });
    const joined = await call("/ai/invites/redeem", "friend", { code: invite.code });
    expect(joined.status).toBe(200);
    expect(await joined.json()).toEqual({ result: "joined" });
  });

  it("lets only an administrator reset, boost, gift, make promos and read subscribers", async () => {
    for (const [path, body] of [["/admin/ai-plans/reset", { uid: "user" }], ["/admin/ai-plans/boost", { uid: "*", weeklyTokens: 30_000_000, endsAt: NOW + DAY, note: "launch" }],
      ["/admin/ai-plans/gift", { uid: "user", plan: "pro", days: 7, note: "thanks" }], ["/admin/ai-plans/promo", { code: "WEEK7", kind: "plan", plan: "weekly", days: 7, maxRedemptions: 10, expiresAt: NOW + DAY }]] as const) {
      expect((await call(path, "user", body)).status).toBe(403);
      expect((await call(path, "admin", body)).status).toBe(200);
    }
    expect((await store.getAiPlanState("user", NOW + 1)).plan).toMatchObject({ id: "pro", source: "gift" });
    expect((await store.getAiPlanState("someone", NOW + 1)).boostTokens).toBe(30_000_000);
    expect((await call("/admin/ai-plans/promo", "admin", { code: "bad code" })).status).toBe(400);
    const promos = await (await call("/admin/ai-plans/promo", "admin")).json() as { promos: { code: string }[] };
    expect(promos.promos.map((p) => p.code)).toContain("WEEK7");
    await store.applySubscriptionEvent(active("subscriber", "monthly"));
    expect(await (await call("/admin/ai-plans/subscriptions", "admin")).json()).toEqual({ plans: [{ plan: "monthly", active: 1, mrrCents: 900 }] });
  });

  it("audits admin reads and rejects invalid grants before changing anything", async () => {
    const audit = vi.spyOn(store, "writeAudit");
    for (const body of [{ uid: "user", weeklyTokens: -1, endsAt: NOW + DAY, note: "x" }, { uid: "user", weeklyTokens: 100, endsAt: NOW, note: "x" }]) {
      expect((await call("/admin/ai-plans/boost", "admin", body)).status).toBe(400);
    }
    expect((await call("/admin/ai-plans/gift", "admin", { uid: "user", plan: "pro", days: 1.5, note: "x" })).status).toBe(400);
    expect((await call("/admin/ai-plans/promo", "admin", { code: "OLD", kind: "tokens", tokens: 1, maxRedemptions: 1, expiresAt: NOW })).status).toBe(400);
    expect(audit).not.toHaveBeenCalled();
    await call("/admin/ai-plans/promo", "admin");
    await call("/admin/ai-plans/subscriptions", "admin");
    expect(audit.mock.calls.map(([entry]) => entry.action)).toEqual(["read-ai-promos", "read-ai-subscriptions"]);
  });

  it("bounds each everyone reset request to one page and preserves held weeks", async () => {
    for (let i = 0; i < 502; i++) {
      const uid = `member-${String(i).padStart(4, "0")}`;
      await store.reserveTagflow({ unlimited: true, id: `r-${uid}`, uid, day: "2026-10-24", minute: 1, tokens: 1, costMicros: 0, limits: DEFAULT_TAGFLOW_CONFIG.limits, paid: { freeWeeklyTokens: 10, now: NOW } });
      if (i !== 1) await store.settleTagflow(`r-${uid}`, { inputTokens: 1, outputTokens: 0, costMicros: 0, estimated: false, failed: false });
    }
    const pages = vi.spyOn(store, "listPaidWeekUids");
    const response = await call("/admin/ai-plans/reset", "admin", { uid: "*" });
    expect(await response.json()).toEqual({ reset: 499, busy: 1, none: 0, failed: [], nextCursor: "member-0499" });
    expect(pages.mock.calls).toEqual([["", 500]]);
    const next = await call("/admin/ai-plans/reset", "admin", { uid: "*", after: "member-0499" });
    expect(await next.json()).toEqual({ reset: 2, busy: 0, none: 0, failed: [], nextCursor: null });
    expect(await store.listPaidWeekUids("", 10)).toEqual(["member-0001"]);
    expect((await call("/admin/ai-plans/reset", "admin", { uid: "member-0001" })).status).toBe(409);
  });

  it("reports partial reset failures and retries only the failed accounts", async () => {
    for (const uid of ["a", "b", "c"]) await store.reserveTagflow({ unlimited: true, id: `r-${uid}`, uid, day: "2026-10-24", minute: 1, tokens: 1, costMicros: 0, limits: DEFAULT_TAGFLOW_CONFIG.limits, paid: { freeWeeklyTokens: 10, now: NOW } }).then(() => store.settleTagflow(`r-${uid}`, { inputTokens: 1, outputTokens: 0, costMicros: 0, estimated: false, failed: false }));
    const original = store.resetAiWeek.bind(store);
    const resets = vi.spyOn(store, "resetAiWeek").mockImplementation(async uid => { if (uid === "b") throw new Error("temporary"); return original(uid); });
    const first = await call("/admin/ai-plans/reset", "admin", { uid: "*" });
    expect(await first.json()).toEqual({ reset: 2, busy: 0, none: 0, failed: ["b"], nextCursor: null });
    resets.mockImplementation(original); resets.mockClear();
    const retry = await call("/admin/ai-plans/reset", "admin", { uid: "*", retryUids: ["b", "b"] });
    expect(await retry.json()).toEqual({ reset: 1, busy: 0, none: 0, failed: [], nextCursor: null });
    expect(resets.mock.calls).toEqual([["b"]]);
    for (const body of [{ uid: "*", after: "*" }, { uid: "*", retryUids: ["*"] }, { uid: "*", retryUids: Array(501).fill("a") }]) expect((await call("/admin/ai-plans/reset", "admin", body)).status).toBe(400);
  });

  it("resets everyone's week in pages", async () => {
    for (const uid of ["a", "b", "c"]) await store.reserveTagflow({ unlimited: true, id: `r-${uid}`, uid, day: "2026-10-24", minute: 1, tokens: 1, costMicros: 0, limits: DEFAULT_TAGFLOW_CONFIG.limits, paid: { freeWeeklyTokens: 10, now: NOW } }).then(() => store.settleTagflow(`r-${uid}`, { inputTokens: 1, outputTokens: 0, costMicros: 0, estimated: false, failed: false }));
    const response = await call("/admin/ai-plans/reset", "admin", { uid: "*" });
    expect(await response.json()).toMatchObject({ reset: 3 });
    expect(await store.listPaidWeekUids("", 10)).toEqual([]);
  });
});

describe("Dodo subscription webhooks", () => {
  const SECRET = "whsec_dGVzdC1zZWNyZXQtdmFsdWUtZm9yLXNpZ25pbmc=";
  const NOW_S = String(Math.floor(NOW / 1000));
  const signed = (raw: string, id: string) => ({ id, timestamp: NOW_S, signature: `v1,${sign(SECRET, id, NOW_S, raw)}` });
  const event = (type: string, over: Record<string, unknown> = {}) => JSON.stringify({ type, data: { payload_type: "Subscription", subscription_id: "sub_1", product_id: "pdt_pro", customer: { customer_id: "cus_1" }, status: "active",
    next_billing_date: "2025-11-08T00:00:00Z", cancel_at_next_billing_date: false, metadata: { uid: "user", plan: "pro" }, ...over } });
  let store: ReturnType<typeof createMemoryStore>;
  const deps = () => ({ store, clock: { now: () => NOW }, webhookSecret: SECRET, subscriptionProducts: { pro: "pdt_pro", weekly: "pdt_weekly", monthly: "pdt_monthly" } });
  beforeEach(async () => { store = createMemoryStore(); await store.putUser({ uid: "user", status: "active", createdAt: NOW }); });

  it("applies a subscription once, renewals included, and leaves advertiser credit alone", async () => {
    const advertiser = vi.spyOn(store, "applyCreditEvent");
    const raw = event("subscription.active");
    expect(await handleFundingWebhook(deps(), signed(raw, "evt_1"), raw)).toMatchObject({ ok: true });
    expect((await store.getAiPlanState("user", NOW + 1)).plan).toMatchObject({ id: "pro", source: "subscription" });
    expect(await handleFundingWebhook(deps(), signed(raw, "evt_1"), raw)).toMatchObject({ ok: true, reason: "duplicate" });
    const renewed = event("subscription.renewed", { next_billing_date: "2025-12-08T00:00:00Z" });
    await handleFundingWebhook(deps(), signed(renewed, "evt_2"), renewed);
    expect((await store.getAiPlanState("user", NOW + 1)).plan?.endsAt).toBe(Date.parse("2025-12-08T00:00:00Z"));
    expect(advertiser).not.toHaveBeenCalled();
  });

  it("sends a subscription without a uid to review instead of guessing", async () => {
    const raw = event("subscription.active", { metadata: {} });
    expect(await handleFundingWebhook(deps(), signed(raw, "evt_3"), raw)).toMatchObject({ ok: true, reason: "ignored" });
    expect((await store.getAiPlanState("user", NOW + 1)).plan).toBeNull();
  });

  it("records unknown accounts and unconfigured products for review, and trusts product pricing over metadata", async () => {
    const apply = vi.spyOn(store, "applySubscriptionEvent");
    for (const [name, fields] of [
      ["unknown-user", { metadata: { uid: "ghost", plan: "pro" } }],
      ["unknown-product", { product_id: "pdt_other" }],
      ["mismatch", { product_id: "pdt_weekly" }],
    ] as const) {
      const raw = event("subscription.active", fields);
      await handleFundingWebhook(deps(), signed(raw, name), raw);
    }
    expect(apply.mock.calls[0]![0].uid).toBeNull();
    expect(apply.mock.calls[1]![0].plan).toBeNull();
    expect(apply.mock.calls[2]![0].plan).toBe("weekly");
    expect((await store.getAiPlanState("user", NOW)).plan?.id).toBe("weekly");
    expect((await store.getAiPlanState("ghost", NOW)).plan).toBeNull();
  });

  it("does not grant access without a valid billing period or a valid signature", async () => {
    const raw = event("subscription.active", { next_billing_date: "broken-date" });
    await handleFundingWebhook(deps(), signed(raw, "invalid-period"), raw);
    expect((await store.getAiPlanState("user", NOW + 1)).plan).toBeNull();
    expect(await handleFundingWebhook(deps(), { ...signed(raw, "bad-signature"), signature: "v1,bad" }, raw)).toMatchObject({ ok: false, status: 400 });
  });

  it("still sends advertiser payments to their own credit path", async () => {
    const advertiser = vi.spyOn(store, "applyCreditEvent");
    const raw = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_ad", checkout_session_id: "chk_ad", total_amount: 100, currency: "USD", metadata: { orderId: "ord_advertiser" } } });
    await handleFundingWebhook(deps(), signed(raw, "advertiser-payment"), raw);
    expect(advertiser).toHaveBeenCalledWith(expect.objectContaining({ type: "purchase", orderId: "ord_advertiser", amountMicros: 1_000_000n }));
  });

  it("ignores subscription events it does not act on", async () => {
    const raw = event("subscription.updated");
    expect(await handleFundingWebhook(deps(), signed(raw, "evt_4"), raw)).toMatchObject({ ok: true, reason: "ignored" });
  });
});
