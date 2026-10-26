import type { PlanCheckout, PromoView, TagflowConfigRecord, TagflowReservation, TagflowStore, TagflowUsage, TagflowUserPolicy, TokenLedgerEntry, TokenOrder, TokenSalesDay } from "./tagflowTypes.ts";
import { INVITE_REWARD_TOKENS, PLAN_CHECKOUT_GUARD_MS, PLANS, planById, subscriptionBlocksCheckout, type PlanId } from "./aiPlans.ts";

/** Uses of one Pro subscriber's invite code. */
const INVITE_MAX_USES = 2;
import { chargeTokens, holdTokens, type FreeWindow, type PaidHold, type TokenBalance } from "./paidTokens.ts";
import { UNLIMITED_DAILY_REQUESTS, UNLIMITED_REQUESTS_PER_MINUTE } from "./tagflowConfig.ts";
import type { ModelFeedbackRecord, ModelRequestRecord } from "./tagflowReportTypes.ts";
import { summarizeModelReports } from "./tagflowReports.ts";
import type { ModelAudienceProfile } from "./modelAudience.ts";
import { admitCredits, settleWindow, type CreditWindows } from "./credits.ts";

export function createTagflowMemoryStore(): TagflowStore & { resetTagflow(): void } {
  let config: TagflowConfigRecord | null = null;
  const policies = new Map<string, TagflowUserPolicy>();
  const days = new Map<string, TagflowUsage>();
  const reservations = new Map<string, TagflowReservation & { sessionStartedAt: number | null; weekStartedAt: number | null }>();
  const windows = new Map<string, CreditWindows>();
  const minutes = new Map<string, number>();
  const modelRequests = new Map<string, ModelRequestRecord>();
  const modelFeedback = new Map<string, ModelFeedbackRecord>();
  let collectionStartedAt: number | null = null;
  const profiles = new Map<string,ModelAudienceProfile>();
  const verificationSends = new Map<string, number>();
  // Paid tokens: the free week per account, purchased balances, each reservation's hold.
  const freeWeeks = new Map<string, FreeWindow>();
  const balances = new Map<string, TokenBalance>();
  const holds = new Map<string, PaidHold>();
  const orders = new Map<string, TokenOrder>();
  const planCheckouts = new Map<string, PlanCheckout>();
  const ledger: TokenLedgerEntry[] = [];
  const seenWebhooks = new Set<string>();
  // AI plans: Dodo subscriptions by id, gifts and boosts (uid or '*'), promo codes, Pro invites.
  const subscriptions = new Map<string, { uid: string; plan: PlanId; customerId: string | null; status: string; endsAt: number; periodEnd: number; eventAt: number; eventType: string }>();
  const gifts: { uid: string; plan: PlanId; startsAt: number; endsAt: number; source: "admin" | "promo"; ref: string }[] = [];
  const boosts: { uid: string; weeklyTokens: number; startsAt: number; endsAt: number }[] = [];
  const promos = new Map<string, PromoView>();
  const redemptions = new Set<string>();
  const invites = new Map<string, { inviter: string; uses: number }>();
  const inviteOf = new Map<string, string>();
  const invitees = new Map<string, { inviter: string; rewarded: boolean }>();
  const grant = (uid: string, tokens: number, adminUid: string, note: string, now: number): void => {
    const balance = balances.get(uid) ?? { purchased: 0, reserved: 0 };
    balances.set(uid, { ...balance, purchased: balance.purchased + tokens });
    ledger.unshift({ id: `l${ledger.length + 1}`, uid, delta: tokens, kind: "grant", ref: adminUid, note, createdAt: now });
  };
  const balanceOf = (uid: string): TokenBalance => balances.get(uid) ?? { purchased: 0, reserved: 0 };
  const addLedger = (entry: Omit<TokenLedgerEntry, "id">): void => { ledger.unshift({ id: `l${ledger.length + 1}`, ...entry }); };
  const key = (uid: string, day: string): string => `${uid}\u0000${day}`;
  return {
    resetTagflow() { config = null; policies.clear(); days.clear(); reservations.clear(); windows.clear(); minutes.clear(); modelRequests.clear(); modelFeedback.clear(); profiles.clear(); verificationSends.clear(); collectionStartedAt = null;
      freeWeeks.clear(); balances.clear(); holds.clear(); orders.clear(); planCheckouts.clear(); ledger.length = 0; seenWebhooks.clear();
      subscriptions.clear(); gifts.length = 0; boosts.length = 0; promos.clear(); redemptions.clear(); invites.clear(); inviteOf.clear(); invitees.clear(); },
    async getModelAudienceProfile(uid) { return structuredClone(profiles.get(uid) ?? null); },
    async putModelAudienceProfile(profile) { profiles.set(profile.uid,structuredClone(profile)); },
    async deleteModelAudienceProfile(uid) { profiles.delete(uid); },
    async putModelRequest(record) { modelRequests.set(record.id,structuredClone(record)); collectionStartedAt ??= record.startedAt; },
    async getModelRequest(id) { return structuredClone(modelRequests.get(id) ?? null); },
    async putModelFeedback(record) {
      const previous = modelFeedback.get(record.requestId);
      modelFeedback.set(record.requestId,structuredClone({ ...record, createdAt: previous?.createdAt ?? record.createdAt }));
    },
    async getModelFeedback(requestId,uid) { const row = modelFeedback.get(requestId); return structuredClone(row?.uid === uid ? row : null); },
    async deleteModelFeedback(requestId,uid) { if (modelFeedback.get(requestId)?.uid === uid) modelFeedback.delete(requestId); },
    async readModelReports(range) { return summarizeModelReports([...modelRequests.values()],[...modelFeedback.values()],range,collectionStartedAt,profiles); },
    async getTagflowConfig() { return structuredClone(config); },
    async putTagflowConfig(value) { config = structuredClone(value); },
    async getTagflowPolicy(uid) { return structuredClone(policies.get(uid) ?? null); },
    async putTagflowPolicy(uid, policy) { policies.set(uid, structuredClone(policy)); },
    async getTagflowUsage(uid, day) { return structuredClone(days.get(key(uid, day)) ?? null); },
    async getCreditWindows(uid) { return structuredClone(windows.get(uid) ?? { session: null, week: null }); },
    async listTagflowUsage(day) { return [...days.values()].filter((row) => row.day === day).sort((a, b) => b.costMicros - a.costMicros || a.uid.localeCompare(b.uid)).slice(0, 200).map((row) => structuredClone(row)); },
    async reserveTagflow(request) {
      // No await between checking and writing: this is one atomic operation in memory.
      if (reservations.has(request.id)) throw new Error("Duplicate reservation");
      const row = days.get(key(request.uid, request.day)) ?? { uid: request.uid, day: request.day, requests: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, estimatedRequests: 0, reservedTokens: 0, reservedCostMicros: 0 };
      const minuteKey = key(request.uid, String(request.minute));
      if (!request.unlimited && ((request.limits.dailyRequests !== UNLIMITED_DAILY_REQUESTS && row.requests + 1 > request.limits.dailyRequests) || row.inputTokens + row.outputTokens + row.reservedTokens + request.tokens > request.limits.dailyTokens || row.costMicros + row.reservedCostMicros + request.costMicros > request.limits.dailyCostMicros)) return "daily-limit";
      const admitted = request.credits === undefined ? null : admitCredits(windows.get(request.uid) ?? { session: null, week: null }, request.credits, request.unlimited);
      if (admitted !== null && !admitted.ok) return admitted.limit;
      const paid = request.paid === undefined ? null : holdTokens(freeWeeks.get(request.uid) ?? null, balanceOf(request.uid), request.paid.freeWeeklyTokens, request.tokens, request.paid.now);
      if (paid !== null && !paid.ok) return "paid-limit";
      if (!request.unlimited && request.limits.requestsPerMinute !== UNLIMITED_REQUESTS_PER_MINUTE && (minutes.get(minuteKey) ?? 0) >= request.limits.requestsPerMinute) return "rate-limit";
      if (admitted !== null) windows.set(request.uid, admitted.windows);
      if (paid !== null && paid.ok) { freeWeeks.set(request.uid, paid.window); balances.set(request.uid, paid.balance); holds.set(request.id, paid.hold); }
      days.set(key(request.uid, request.day), { ...row, requests: row.requests + 1, reservedTokens: row.reservedTokens + request.tokens, reservedCostMicros: row.reservedCostMicros + request.costMicros });
      minutes.set(minuteKey, (minutes.get(minuteKey) ?? 0) + 1);
      reservations.set(request.id, { ...request, sessionStartedAt: admitted?.ok ? admitted.windows.session.startedAt : null, weekStartedAt: admitted?.ok ? admitted.windows.week.startedAt : null });
      return "ok";
    },
    async settleTagflow(id, usage) {
      const reservation = reservations.get(id);
      if (reservation === undefined) return;
      const row = days.get(key(reservation.uid, reservation.day))!;
      days.set(key(reservation.uid, reservation.day), { ...row,
        requests: row.requests - Number(usage.failed),
        inputTokens: row.inputTokens + usage.inputTokens, outputTokens: row.outputTokens + usage.outputTokens,
        costMicros: row.costMicros + usage.costMicros, estimatedRequests: row.estimatedRequests + Number(usage.estimated && !usage.failed),
        reservedTokens: row.reservedTokens - reservation.tokens, reservedCostMicros: row.reservedCostMicros - reservation.costMicros,
      });
      const held = reservation.credits?.millicredits ?? 0;
      const used = usage.failed ? 0 : usage.millicredits ?? 0;
      const current = windows.get(reservation.uid);
      if (current !== undefined) windows.set(reservation.uid, {
        session: settleWindow(current.session, reservation.sessionStartedAt, held, used),
        week: settleWindow(current.week, reservation.weekStartedAt, held, used),
      });
      const hold = holds.get(id);
      if (hold !== undefined) {
        const done = chargeTokens(freeWeeks.get(reservation.uid) ?? null, balanceOf(reservation.uid), hold, usage.failed ? 0 : usage.tokenCharge ?? usage.inputTokens + usage.outputTokens);
        if (done.window !== null) freeWeeks.set(reservation.uid, done.window);
        balances.set(reservation.uid, done.balance);
        if (done.paidCharged > 0) addLedger({ uid: reservation.uid, delta: -done.paidCharged, kind: "usage", ref: id, note: "", createdAt: Date.now() });
        holds.delete(id);
      }
      reservations.delete(id);
    },
    async getPaidTokens(uid) { return structuredClone({ free: freeWeeks.get(uid) ?? null, balance: balanceOf(uid) }); },
    async createTokenOrder(value) {
      if (orders.has(value.orderId)) throw new Error("Duplicate order");
      orders.set(value.orderId, structuredClone(value));
    },
    async applyTokenEvent(event) {
      const target = event.type === "purchase"
        ? (event.orderId === null ? undefined : orders.get(event.orderId))
        : [...orders.values()].find((one) => one.providerPaymentId === event.paymentId);
      if (target === undefined) return "not-ai-tokens";
      // A payment that does not match its order is held for review, never credited blindly.
      if (event.type === "purchase" && (event.amountMicros !== BigInt(target.priceCents) * 10_000n ||
          (event.sessionId !== null && target.checkoutSession !== null && event.sessionId !== target.checkoutSession))) return "review";
      if (seenWebhooks.has(event.webhookId)) return "duplicate";
      seenWebhooks.add(event.webhookId);
      const balance = balanceOf(target.uid);
      if (event.type === "dispute-release") {
        if (target.status !== "disputed") return "duplicate";
        const taken = -(ledger.find((row) => row.uid === target.uid && row.kind === "refund" && row.ref.startsWith(`${target.orderId}:`))?.delta ?? 0);
        orders.set(target.orderId, { ...target, status: "paid" });
        if (taken > 0) {
          balances.set(target.uid, { ...balance, purchased: balance.purchased + taken });
          addLedger({ uid: target.uid, delta: taken, kind: "purchase", ref: `${target.orderId}:${event.webhookId}`, note: "", createdAt: event.now });
        }
        return "credited";
      }
      if (target.status !== (event.type === "purchase" ? "pending" : "paid")) return "duplicate";
      if (event.type === "purchase") {
        orders.set(target.orderId, { ...target, status: "paid", providerPaymentId: event.paymentId, paidAt: event.now, checkoutSession: event.sessionId ?? target.checkoutSession });
        balances.set(target.uid, { ...balance, purchased: balance.purchased + target.tokens });
        addLedger({ uid: target.uid, delta: target.tokens, kind: "purchase", ref: target.orderId, note: "", createdAt: event.now });
        return "credited";
      }
      // Only what is left of the order comes back; tokens already used stay used.
      // A refund or a chargeback.
      const back = Math.min(target.tokens, Math.max(0, balance.purchased));
      orders.set(target.orderId, { ...target, status: event.type === "refund" ? "refunded" : "disputed" });
      balances.set(target.uid, { ...balance, purchased: balance.purchased - back });
      if (back > 0) addLedger({ uid: target.uid, delta: -back, kind: "refund", ref: event.type === "refund" ? target.orderId : `${target.orderId}:${event.webhookId}`, note: "", createdAt: event.now });
      return "refunded";
    },
    async grantTokens(uid, tokens, adminUid, note, now) {
      if (!Number.isSafeInteger(tokens) || tokens === 0) throw new Error("Invalid grant");
      const balance = balanceOf(uid);
      balances.set(uid, { ...balance, purchased: balance.purchased + tokens });
      addLedger({ uid, delta: tokens, kind: "grant", ref: adminUid, note, createdAt: now });
    },
    async listTokenActivity(uid) {
      return structuredClone({
        orders: [...orders.values()].filter((one) => one.uid === uid).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100),
        ledger: ledger.filter((row) => row.uid === uid).slice(0, 100),
      });
    },
    async tokenSales(sinceMs) {
      const days = new Map<string, TokenSalesDay>();
      const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
      const row = (day: string): TokenSalesDay => days.get(day) ?? { day, orders: 0, revenueCents: 0, tokensSold: 0, tokensUsed: 0 };
      for (const one of orders.values()) {
        if ((one.status !== "paid" && one.status !== "refunded") || one.paidAt === null || one.paidAt < sinceMs) continue;
        const r = row(dayOf(one.paidAt));
        days.set(r.day, { ...r, orders: r.orders + 1, revenueCents: r.revenueCents + one.priceCents, tokensSold: r.tokensSold + one.tokens });
      }
      for (const entry of ledger) {
        if (entry.kind !== "usage" || entry.createdAt < sinceMs) continue;
        const r = row(dayOf(entry.createdAt));
        days.set(r.day, { ...r, tokensUsed: r.tokensUsed - entry.delta });
      }
      return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
    },
    async claimVerificationSend(uid, now, gapMs) {
      const last = verificationSends.get(uid);
      if (last !== undefined && last > now - gapMs) return false;
      verificationSends.set(uid, now); return true;
    },
    async getAiPlanState(uid, now) {
      const live = [
        ...[...subscriptions.values()].filter((one) => one.uid === uid && one.endsAt > now).map((one) => ({ id: one.plan, endsAt: one.endsAt, source: "subscription" as const })),
        ...gifts.filter((one) => (one.uid === uid || one.uid === "*") && one.startsAt <= now && one.endsAt > now).map((one) => ({ id: one.plan, endsAt: one.endsAt, source: "gift" as const })),
      ].sort((a, b) => planRank(b.id) - planRank(a.id) || b.endsAt - a.endsAt);
      const boostTokens = Math.max(0, ...boosts.filter((one) => (one.uid === uid || one.uid === "*") && one.startsAt <= now && one.endsAt > now).map((one) => one.weeklyTokens));
      const transitions = [
        ...[...subscriptions.values()].filter((one) => one.uid === uid && one.endsAt > now).map((one) => one.endsAt),
        ...[...gifts, ...boosts].filter((one) => one.uid === uid || one.uid === "*").flatMap((one) => [one.startsAt, one.endsAt]).filter((at) => at > now),
      ];
      return { plan: live[0] ?? null, boostTokens, validUntil: transitions.length === 0 ? null : Math.min(...transitions) };
    },
    async applySubscriptionEvent(event) {
      if (seenWebhooks.has(event.webhookId)) return "duplicate";
      seenWebhooks.add(event.webhookId);
      if (event.uid === null || event.plan === null) return "review";
      const previous = subscriptions.get(event.subscriptionId);
      if (previous !== undefined && (previous.uid !== event.uid || previous.customerId !== null && event.customerId !== null && previous.customerId !== event.customerId)) return "review";
      const ended = ["on_hold", "failed", "expired"].includes(event.type);
      if (!ended && (!Number.isSafeInteger(event.periodEnd) || event.periodEnd <= 0)) return "review";
      const eventAt = event.occurredAt ?? event.now;
      const granting = ["active", "renewed", "plan_changed"].includes(event.type);
      if (previous !== undefined && (eventAt < previous.eventAt || event.periodEnd > 0 && event.periodEnd < previous.periodEnd ||
          granting && ["cancelled", "on_hold", "failed", "expired"].includes(previous.eventType) && event.periodEnd <= previous.periodEnd && (event.occurredAt === undefined || eventAt <= previous.eventAt))) return "applied";
      const endsAt = ended ? event.now : event.periodEnd;
      subscriptions.set(event.subscriptionId, { uid: event.uid, plan: event.plan, customerId: event.customerId ?? previous?.customerId ?? null, status: event.status, endsAt, periodEnd: event.periodEnd || previous?.periodEnd || 0, eventAt, eventType: event.type });
      const invitee = invitees.get(event.uid);
      const inviterActive = invitee !== undefined && [...subscriptions.values()].some((one) => one.uid === invitee.inviter && one.plan === "pro" && one.endsAt > event.now);
      if (event.type === "active" && endsAt > event.now && invitee !== undefined && !invitee.rewarded && inviterActive) {
        invitee.rewarded = true;
        for (const uid of [event.uid, invitee.inviter].sort()) grant(uid, INVITE_REWARD_TOKENS, `invite:${event.uid}`, "Pro invite reward", event.now);
      }
      return "applied";
    },
    async getSubscription(uid) {
      const mine = [...subscriptions.values()].filter((one) => one.uid === uid).sort((a, b) => b.endsAt - a.endsAt)[0];
      return mine === undefined ? null : { customerId: mine.customerId, plan: mine.plan, status: mine.status, periodEnd: mine.endsAt };
    },
    async claimPlanCheckout(uid, plan, billingCountry, orderId, now) {
      if ([...subscriptions.values()].some(one => one.uid === uid && subscriptionBlocksCheckout(one.status, one.endsAt, now))) return { status: "subscribed" };
      const previous = planCheckouts.get(uid);
      if (previous !== undefined && previous.expiresAt > now) return { status: "existing", checkout: structuredClone(previous) };
      const checkout: PlanCheckout = { uid, orderId, plan, billingCountry, createdAt: now, expiresAt: now + PLAN_CHECKOUT_GUARD_MS, checkoutSession: null, checkoutUrl: null };
      planCheckouts.set(uid, checkout);
      return { status: "claimed", checkout: structuredClone(checkout) };
    },
    async completePlanCheckout(uid, orderId, sessionId, checkoutUrl, now) {
      const checkout = planCheckouts.get(uid);
      if (checkout === undefined || checkout.orderId !== orderId || checkout.expiresAt <= now) return "missing";
      if ([...subscriptions.values()].some(one => one.uid === uid && subscriptionBlocksCheckout(one.status, one.endsAt, now))) return "subscribed";
      planCheckouts.set(uid, { ...checkout, checkoutSession: sessionId, checkoutUrl, expiresAt: Math.max(checkout.expiresAt, now + PLAN_CHECKOUT_GUARD_MS) });
      return "saved";
    },
    async giftPlan(uid, plan, days, adminUid, note, now) { gifts.push({ uid, plan, startsAt: now, endsAt: now + days * 86_400_000, source: "admin", ref: `${adminUid}:${note}` }); },
    async boostAllowance(uid, weeklyTokens, endsAt, adminUid, note, now) { void adminUid; void note; boosts.push({ uid, weeklyTokens, startsAt: now, endsAt }); },
    async resetAiWeek(uid) {
      const week = freeWeeks.get(uid);
      if (week === undefined) return "none";
      if (week.reservedTokens > 0) return "busy";
      freeWeeks.delete(uid); return "reset";
    },
    async listPaidWeekUids(after, limit) { return [...freeWeeks.keys()].filter((uid) => uid > after).sort().slice(0, limit); },
    async createPromo(promo, adminUid, now) {
      void adminUid; void now;
      if (promos.has(promo.code)) return false;
      promos.set(promo.code, { ...structuredClone(promo), redemptions: 0 }); return true;
    },
    async listPromos() { return [...promos.values()].map((one) => structuredClone(one)); },
    async redeemPromo(code, uid, now) {
      const promo = promos.get(code);
      if (promo === undefined) return "unknown";
      if (promo.expiresAt <= now) return "expired";
      if (redemptions.has(`${code}\u0000${uid}`)) return "already";
      if (promo.redemptions >= promo.maxRedemptions) return "used-up";
      redemptions.add(`${code}\u0000${uid}`); promo.redemptions += 1;
      if (promo.kind === "tokens") { grant(uid, promo.tokens ?? 0, `promo:${code}`, `Promo code ${code}`, now); return "tokens"; }
      gifts.push({ uid, plan: promo.plan!, startsAt: now, endsAt: now + (promo.days ?? 0) * 86_400_000, source: "promo", ref: code });
      return "plan";
    },
    async getInvite(uid, now) {
      const pro = [...subscriptions.values()].some((one) => one.uid === uid && one.plan === "pro" && one.endsAt > now);
      if (!pro) return null;
      let code = inviteOf.get(uid);
      if (code === undefined) { code = `INV${(inviteOf.size + 1).toString(36).toUpperCase().padStart(8, "0")}`; inviteOf.set(uid, code); invites.set(code, { inviter: uid, uses: 0 }); }
      const invite = invites.get(code)!;
      return { code, uses: invite.uses, maxUses: INVITE_MAX_USES };
    },
    async redeemInvite(code, uid, now) {
      const invite = invites.get(code);
      if (invite === undefined) return "unknown";
      if (invite.inviter === uid) return "own-code";
      if (![...subscriptions.values()].some((one) => one.uid === invite.inviter && one.plan === "pro" && one.endsAt > now)) return "unknown";
      if (invitees.has(uid)) return "already";
      if ([...subscriptions.values()].some((one) => one.uid === uid)) return "has-plan";
      if (invite.uses >= INVITE_MAX_USES) return "used-up";
      invite.uses += 1; invitees.set(uid, { inviter: invite.inviter, rewarded: false });
      return "joined";
    },
    async subscriptionSummary(now) {
      const totals = new Map<PlanId, number>();
      for (const one of subscriptions.values()) if (one.endsAt > now) totals.set(one.plan, (totals.get(one.plan) ?? 0) + 1);
      return PLANS.filter((plan) => totals.has(plan.id)).map((plan) => ({ plan: plan.id, active: totals.get(plan.id)!, mrrCents: monthlyCents(plan.id) * totals.get(plan.id)! }));
    },
  };
}

const planRank = (id: PlanId): number => id === "pro" ? 3 : id === "monthly" ? 2 : 1;
/** A weekly plan's monthly revenue: 52 weeks a year over 12 months. */
const monthlyCents = (id: PlanId): number => { const plan = planById(id)!; return plan.interval === "week" ? Math.round((plan.priceCents * 52) / 12) : plan.priceCents; };
