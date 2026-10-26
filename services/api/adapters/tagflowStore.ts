import type { TagflowStore, TagflowUsage, TokenLedgerEntry, TokenOrder } from "../src/tagflowTypes.ts";
import type { PlanId } from "../src/aiPlans.ts";
import type { CreditWindow } from "../src/credits.ts";
import { createModelReportStore } from "./modelReportStore.ts";

type SupabaseClient = import("@supabase/supabase-js").SupabaseClient;
type UsageRow = { uid: string; day: string; requests: number | string; input_tokens: number | string; output_tokens: number | string; cost_micros: number | string; estimated_requests: number | string; reserved_tokens: number | string; reserved_cost_micros: number | string };
const usageFrom = (row: UsageRow): TagflowUsage => ({ uid: row.uid, day: row.day, requests: Number(row.requests), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), costMicros: Number(row.cost_micros), estimatedRequests: Number(row.estimated_requests), reservedTokens: Number(row.reserved_tokens), reservedCostMicros: Number(row.reserved_cost_micros) });
type WindowRow = { kind: string; started_at: number | string; ends_at: number | string; used_millicredits: number | string; reserved_millicredits: number | string };
const windowFrom = (row: WindowRow | undefined): CreditWindow | null => row === undefined ? null : { startedAt: Number(row.started_at), endsAt: Number(row.ends_at), usedMillicredits: Number(row.used_millicredits), reservedMillicredits: Number(row.reserved_millicredits) };
const RESERVE_RESULTS = ["ok", "daily-limit", "rate-limit", "session-limit", "weekly-limit", "paid-limit"] as const;
const TOKEN_EVENT_RESULTS = ["credited", "refunded", "duplicate", "review", "not-ai-tokens"] as const;
type OrderRow = { order_id: string; uid: string; pack_id: string; price_cents: number | string; tokens: number | string; status: TokenOrder["status"]; checkout_session: string | null; provider_payment_id: string | null; created_at: number | string; paid_at: number | string | null };
const orderFrom = (row: OrderRow): TokenOrder => ({ orderId: row.order_id, uid: row.uid, packId: row.pack_id, priceCents: Number(row.price_cents), tokens: Number(row.tokens), status: row.status, checkoutSession: row.checkout_session, providerPaymentId: row.provider_payment_id, createdAt: Number(row.created_at), paidAt: row.paid_at === null ? null : Number(row.paid_at) });
type LedgerRow = { id: string; uid: string; delta: number | string; kind: TokenLedgerEntry["kind"]; ref: string; note: string; created_at: number | string };
const check = (error: { message: string } | null): void => { if (error !== null) throw new Error(`Tagflow storage: ${error.message}`); };

/** Same lazy, server-only service_role client as the other persistence ports. */
export function createTagflowStore(lazy: () => Promise<SupabaseClient>): TagflowStore {
  return {
    ...createModelReportStore(lazy),
    async getTagflowConfig() {
      const { data, error } = await (await lazy()).from("tagflow_config").select("config, updated_at, updated_by").eq("id", 1).maybeSingle();
      check(error);
      return data === null ? null : { config: data.config, updatedAt: Number(data.updated_at), updatedBy: data.updated_by };
    },
    async putTagflowConfig(record) {
      const { error } = await (await lazy()).from("tagflow_config").upsert({ id: 1, config: record.config, updated_at: record.updatedAt, updated_by: record.updatedBy });
      check(error);
    },
    async getTagflowPolicy(uid) {
      const { data, error } = await (await lazy()).from("tagflow_user_policies").select("policy").eq("uid", uid).maybeSingle();
      check(error); return data?.policy ?? null;
    },
    async putTagflowPolicy(uid, policy) {
      const { error } = await (await lazy()).from("tagflow_user_policies").upsert({ uid, policy }); check(error);
    },
    async getTagflowUsage(uid, day) {
      const { data, error } = await (await lazy()).from("tagflow_usage").select("*").eq("uid", uid).eq("day", day).maybeSingle();
      check(error); return data === null ? null : usageFrom(data as UsageRow);
    },
    async listTagflowUsage(day) {
      const { data, error } = await (await lazy()).from("tagflow_usage").select("*").eq("day", day).order("cost_micros", { ascending: false }).order("uid").limit(200);
      check(error); return (data as UsageRow[]).map(usageFrom);
    },
    async getCreditWindows(uid) {
      const { data, error } = await (await lazy()).from("ai_credit_windows").select("kind, started_at, ends_at, used_millicredits, reserved_millicredits").eq("uid", uid);
      check(error);
      const rows = (data ?? []) as WindowRow[];
      return { session: windowFrom(rows.find((row) => row.kind === "session")), week: windowFrom(rows.find((row) => row.kind === "week")) };
    },
    // Credits and the day's counts are checked and held in one database transaction.
    async reserveTagflow(request) {
      const credits = request.credits;
      // A paid-model request holds its tokens in the same transaction as everything else.
      const paid = request.paid === undefined ? {} : { p_paid: true, p_free_weekly: request.paid.freeWeeklyTokens };
      const { data, error } = await (await lazy()).rpc(request.paid !== undefined ? "reserve_ai_with_tokens" : request.unlimited ? "reserve_unlimited_ai" : "reserve_included_ai", { ...paid, p_id: request.id, p_uid: request.uid, p_day: request.day, p_minute: request.minute, p_tokens: request.tokens, p_cost: request.costMicros, p_requests_limit: request.limits.dailyRequests, p_tokens_limit: request.limits.dailyTokens, p_cost_limit: request.limits.dailyCostMicros, p_rpm: request.limits.requestsPerMinute,
        p_now: credits?.now ?? 0, p_credits: credits?.millicredits ?? 0, p_session_limit: credits?.sessionLimit ?? 0, p_weekly_limit: credits?.weeklyLimit ?? 0, p_session_ms: credits?.sessionMs ?? 0, p_metered: credits !== undefined });
      check(error);
      if (!RESERVE_RESULTS.includes(data)) throw new Error("Invalid Tagflow reservation result");
      return data as typeof RESERVE_RESULTS[number];
    },
    async settleTagflow(id, usage) {
      // Only a paid-model request names a token charge; every other one settles exactly as before.
      const base = { p_id: id, p_input: usage.inputTokens, p_output: usage.outputTokens, p_cost: usage.costMicros, p_credits: usage.failed ? 0 : usage.millicredits ?? 0, p_estimated: usage.estimated, p_failed: usage.failed };
      const { error } = await (await lazy()).rpc(usage.tokenCharge === undefined ? "settle_included_ai" : "settle_ai_with_tokens",
        usage.tokenCharge === undefined ? base : { ...base, p_token_charge: usage.failed ? 0 : usage.tokenCharge });
      check(error);
    },
    async claimVerificationSend(uid, now, gapMs) {
      const { data, error } = await (await lazy()).rpc("claim_verification_send", { p_uid: uid, p_now: now, p_gap_ms: gapMs });
      check(error); return data === true;
    },
    async getPaidTokens(uid) {
      const db = await lazy();
      const [week, balance] = await Promise.all([
        db.from("ai_credit_windows").select("started_at, ends_at, used_millicredits, reserved_millicredits").eq("uid", uid).eq("kind", "paid_week").maybeSingle(),
        db.from("ai_token_balances").select("purchased, reserved").eq("uid", uid).maybeSingle(),
      ]);
      check(week.error); check(balance.error);
      // In a paid_week row the millicredit columns hold tokens.
      const free = week.data === null ? null : { startedAt: Number(week.data.started_at), endsAt: Number(week.data.ends_at), usedTokens: Number(week.data.used_millicredits), reservedTokens: Number(week.data.reserved_millicredits) };
      return { free, balance: { purchased: Number(balance.data?.purchased ?? 0), reserved: Number(balance.data?.reserved ?? 0) } };
    },
    async createTokenOrder(order) {
      const { error } = await (await lazy()).from("ai_token_orders").insert({ order_id: order.orderId, uid: order.uid, pack_id: order.packId, price_cents: order.priceCents, tokens: order.tokens, status: order.status,
        checkout_session: order.checkoutSession, provider_payment_id: order.providerPaymentId, created_at: order.createdAt, paid_at: order.paidAt });
      check(error);
    },
    async applyTokenEvent(event) {
      const { data, error } = await (await lazy()).rpc("apply_ai_token_event", { p_type: event.type, p_webhook: event.webhookId, p_order: event.orderId ?? "", p_payment: event.paymentId, p_session: event.sessionId, p_amount_micros: event.amountMicros.toString(), p_now: event.now });
      check(error);
      if (!TOKEN_EVENT_RESULTS.includes(data)) throw new Error("Invalid AI token event result");
      return data as typeof TOKEN_EVENT_RESULTS[number];
    },
    async grantTokens(uid, tokens, adminUid, note, now) {
      const { error } = await (await lazy()).rpc("grant_ai_tokens", { p_uid: uid, p_tokens: tokens, p_admin: adminUid, p_note: note, p_now: now });
      check(error);
    },
    async listTokenActivity(uid) {
      const db = await lazy();
      const [orders, ledger] = await Promise.all([
        db.from("ai_token_orders").select("*").eq("uid", uid).order("created_at", { ascending: false }).limit(100),
        db.from("ai_token_ledger").select("*").eq("uid", uid).order("created_at", { ascending: false }).limit(100),
      ]);
      check(orders.error); check(ledger.error);
      return {
        orders: ((orders.data ?? []) as OrderRow[]).map(orderFrom),
        ledger: ((ledger.data ?? []) as LedgerRow[]).map((row) => ({ id: row.id, uid: row.uid, delta: Number(row.delta), kind: row.kind, ref: row.ref, note: row.note, createdAt: Number(row.created_at) })),
      };
    },
    async getAiPlanState(uid, now) {
      const { data, error } = await (await lazy()).rpc("ai_plan_state_v2", { p_uid: uid, p_now: now });
      check(error);
      const row = ((data ?? []) as { plan: PlanId | null; ends_at: number | string | null; source: "subscription" | "gift" | null; boost_tokens: number | string; valid_until: number | string | null }[])[0];
      return { plan: row?.plan == null ? null : { id: row.plan, endsAt: Number(row.ends_at), source: row.source ?? "gift" }, boostTokens: Number(row?.boost_tokens ?? 0), validUntil: row?.valid_until == null ? null : Number(row.valid_until) };
    },
    async applySubscriptionEvent(event) {
      const { data, error } = await (await lazy()).rpc("apply_ai_subscription_event_v2", { p_webhook: event.webhookId, p_type: event.type, p_subscription: event.subscriptionId, p_uid: event.uid, p_plan: event.plan,
        p_customer: event.customerId, p_status: event.status, p_period_end: event.periodEnd, p_cancel: event.cancelAtPeriodEnd, p_now: event.now, p_occurred_at: event.occurredAt ?? null });
      check(error);
      if (data !== "applied" && data !== "duplicate" && data !== "review") throw new Error("Invalid subscription event result");
      return data;
    },
    async getSubscription(uid) {
      const { data, error } = await (await lazy()).from("ai_subscriptions").select("customer_id, plan, status, ends_at").eq("uid", uid).order("ends_at", { ascending: false }).limit(1).maybeSingle();
      check(error);
      return data === null ? null : { customerId: data.customer_id, plan: data.plan as PlanId, status: data.status, periodEnd: Number(data.ends_at) };
    },
    async claimPlanCheckout(uid, plan, billingCountry, orderId, now) {
      const { data, error } = await (await lazy()).rpc("claim_ai_plan_checkout", { p_uid: uid, p_plan: plan, p_country: billingCountry, p_order: orderId, p_now: now });
      check(error);
      const result = data as import("../src/tagflowTypes.ts").PlanCheckoutClaim;
      if (result?.status !== "claimed" && result?.status !== "existing" && result?.status !== "subscribed") throw new Error("Invalid plan checkout claim");
      return result;
    },
    async completePlanCheckout(uid, orderId, sessionId, checkoutUrl, now) {
      const { data, error } = await (await lazy()).rpc("complete_ai_plan_checkout", { p_uid: uid, p_order: orderId, p_session: sessionId, p_url: checkoutUrl, p_now: now });
      check(error);
      if (data !== "saved" && data !== "subscribed" && data !== "missing") throw new Error("Invalid plan checkout completion");
      return data;
    },
    async giftPlan(uid, plan, days, adminUid, note, now) {
      const { error } = await (await lazy()).from("ai_plan_gifts").insert({ uid, plan, starts_at: now, ends_at: now + days * 86_400_000, source: "admin", ref: `${adminUid}:${note}`.slice(0, 500), created_at: now });
      check(error);
    },
    async boostAllowance(uid, weeklyTokens, endsAt, adminUid, note, now) {
      const { error } = await (await lazy()).from("ai_boosts").insert({ uid, weekly_tokens: weeklyTokens, starts_at: now, ends_at: endsAt, created_by: adminUid, note });
      check(error);
    },
    async resetAiWeek(uid) {
      const { data, error } = await (await lazy()).rpc("reset_ai_week", { p_uid: uid });
      check(error);
      if (data !== "reset" && data !== "busy" && data !== "none") throw new Error("Invalid reset result");
      return data;
    },
    async listPaidWeekUids(after, limit) {
      const { data, error } = await (await lazy()).from("ai_credit_windows").select("uid").eq("kind", "paid_week").gt("uid", after).order("uid").limit(limit);
      check(error);
      return ((data ?? []) as { uid: string }[]).map((row) => row.uid);
    },
    async createPromo(promo, adminUid, now) {
      const { error } = await (await lazy()).from("ai_promo_codes").insert({ code: promo.code, kind: promo.kind, tokens: promo.tokens ?? null, plan: promo.plan ?? null, days: promo.days ?? null,
        max_redemptions: promo.maxRedemptions, expires_at: promo.expiresAt, created_by: adminUid, created_at: now });
      if (error !== null && /duplicate key|23505/.test(`${error.message} ${(error as { code?: string }).code ?? ""}`)) return false;
      check(error); return true;
    },
    async listPromos() {
      const { data, error } = await (await lazy()).from("ai_promo_codes").select("code, kind, tokens, plan, days, max_redemptions, redemptions, expires_at").order("created_at", { ascending: false }).limit(200);
      check(error);
      return ((data ?? []) as { code: string; kind: "tokens" | "plan"; tokens: number | string | null; plan: PlanId | null; days: number | null; max_redemptions: number; redemptions: number; expires_at: number | string }[])
        .map((row) => ({ code: row.code, kind: row.kind, ...(row.tokens === null ? {} : { tokens: Number(row.tokens) }), ...(row.plan === null ? {} : { plan: row.plan }), ...(row.days === null ? {} : { days: row.days }),
          maxRedemptions: row.max_redemptions, redemptions: row.redemptions, expiresAt: Number(row.expires_at) }));
    },
    async redeemPromo(code, uid, now) {
      const { data, error } = await (await lazy()).rpc("redeem_ai_promo", { p_code: code, p_uid: uid, p_now: now });
      check(error);
      if (!["tokens", "plan", "unknown", "expired", "used-up", "already"].includes(data)) throw new Error("Invalid promo result");
      return data;
    },
    async getInvite(uid, now) {
      const { data, error } = await (await lazy()).rpc("ai_invite_for", { p_uid: uid, p_now: now });
      check(error);
      const row = ((data ?? []) as { code: string; uses: number; max_uses: number }[])[0];
      return row === undefined ? null : { code: row.code, uses: row.uses, maxUses: row.max_uses };
    },
    async redeemInvite(code, uid, now) {
      const { data, error } = await (await lazy()).rpc("redeem_ai_invite", { p_code: code, p_uid: uid, p_now: now });
      check(error);
      if (!["joined", "unknown", "used-up", "own-code", "already", "has-plan"].includes(data)) throw new Error("Invalid invite result");
      return data;
    },
    async subscriptionSummary(now) {
      const { data, error } = await (await lazy()).rpc("ai_subscription_summary", { p_now: now });
      check(error);
      return ((data ?? []) as { plan: PlanId; active: number | string; mrr_cents: number | string }[]).map((row) => ({ plan: row.plan, active: Number(row.active), mrrCents: Number(row.mrr_cents) }));
    },
    async tokenSales(sinceMs) {
      const { data, error } = await (await lazy()).rpc("ai_token_sales", { p_since: sinceMs });
      check(error);
      return ((data ?? []) as { day: string; orders: number | string; revenue_cents: number | string; tokens_sold: number | string; tokens_used: number | string }[])
        .map((row) => ({ day: row.day, orders: Number(row.orders), revenueCents: Number(row.revenue_cents), tokensSold: Number(row.tokens_sold), tokensUsed: Number(row.tokens_used) }));
    },
  };
}
