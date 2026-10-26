/** Server-owned included AI configuration and accounting; never contains an API key. */
import type { CustomProvider, IncludedProviderId, TagflowLimits } from "./includedProviders.ts";
import type { ModelFeedbackRecord, ModelReportData, ModelReportRange, ModelRequestRecord } from "./tagflowReportTypes.ts";
import type { ModelAudienceProfile } from "./modelAudience.ts";
import type { CreditCharge, CreditPlan, CreditWindows } from "./credits.ts";
import type { FreeWindow, PaidConfig, TokenBalance } from "./paidTokens.ts";
import type { AiPlanState, PlanId, PromoInput } from "./aiPlans.ts";
// Defined beside the providers, which can carry their own allowance, so neither file imports the other.
export type { TagflowLimits } from "./includedProviders.ts";

export interface TagflowModel {
  id: string;
  name: string;
  /** Older records without a provider use Tagflow. */
  provider?: IncludedProviderId;
  /** Optional upstream ID when the public ID is an alias. */
  upstreamModel?: string;
  /** Missing preserves older enabled models. */
  enabled?: boolean;
  contextWindow: number;
  maxOutput: number;
  /** USD per million tokens, as quoted by your deployment. */
  inputPrice: number;
  outputPrice: number;
  /** Credits per 1,000 tokens; missing derives one (see credits.ts). Zero is free of credits. */
  creditRate?: number;
}

export interface TagflowConfig {
  enabled: boolean;
  baseUrl: string;
  defaultModel: string;
  models: TagflowModel[];
  limits: TagflowLimits;
  maxInputTokens: number;
  maxOutputTokens: number;
  /** Administrator-registered OpenAI-compatible providers; missing means none. */
  providers?: CustomProvider[];
  /** Credits per rolling window; missing uses DEFAULT_CREDIT_PLAN. */
  credits?: CreditPlan;
  /** Paid tokens on some providers' models; missing means none are paid. See paidTokens.ts. */
  paid?: PaidConfig;
}

export interface TagflowConfigRecord {
  config: TagflowConfig;
  updatedAt: number;
  updatedBy: string;
}

export interface TagflowUserPolicy {
  blocked: boolean;
  /** Null inherits the current defaults. */
  limits: TagflowLimits | null;
  /** A personal credit plan; null or missing inherits the default. */
  credits?: CreditPlan | null;
  updatedAt: number;
  updatedBy: string;
}

export interface TagflowUsage {
  uid: string;
  day: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  estimatedRequests: number;
  reservedTokens: number;
  reservedCostMicros: number;
}

export interface TagflowReservation {
  /** Bypass per-user quotas while preserving atomic usage accounting. */
  unlimited?: boolean;
  id: string;
  uid: string;
  day: string;
  minute: number;
  tokens: number;
  costMicros: number;
  limits: TagflowLimits;
  /** The account's credit windows to check and hold; missing charges no credits. */
  credits?: CreditCharge;
  /** Paid-model reservation: hold `tokens` from the free week, then purchased tokens. */
  paid?: { freeWeeklyTokens: number; now: number };
}

export interface TagflowSettlement {
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  estimated: boolean;
  /** Only a definite upstream refusal releases the request itself. */
  failed: boolean;
  /** Credits actually used, in millicredits. */
  millicredits?: number;
  /** Tokens charged to a paid-model hold: 0 when a free model answered instead. Missing charges input + output. */
  tokenCharge?: number;
}

export type TagflowReserveResult = "ok" | "daily-limit" | "rate-limit" | "session-limit" | "weekly-limit" | "paid-limit";

export type TokenOrderStatus = "pending" | "paid" | "refunded" | "disputed" | "abandoned";
export interface TokenOrder { orderId: string; uid: string; packId: string; priceCents: number; tokens: number; status: TokenOrderStatus; checkoutSession: string | null; providerPaymentId: string | null; createdAt: number; paidAt: number | null }
export interface TokenLedgerEntry { id: string; uid: string; delta: number; kind: "purchase" | "usage" | "refund" | "grant"; ref: string; note: string; createdAt: number }
export interface PaidTokenState { free: FreeWindow | null; balance: TokenBalance }
export interface TokenEvent { type: "purchase" | "refund" | "dispute-opened" | "dispute-release"; webhookId: string; orderId: string | null; paymentId: string; sessionId: string | null; amountMicros: bigint; now: number }
/** "review": a payment that does not match its order, recorded for an administrator and not credited. */
export type TokenEventResult = "credited" | "refunded" | "duplicate" | "review" | "not-ai-tokens";
export interface TokenSalesDay { day: string; orders: number; revenueCents: number; tokensSold: number; tokensUsed: number }

/** A Dodo subscription event, normalized. `periodEnd` is the paid period's end (ms); 0 when unknown. */
export interface SubscriptionEvent { webhookId: string; type: "active" | "renewed" | "plan_changed" | "on_hold" | "cancelled" | "failed" | "expired"; subscriptionId: string; uid: string | null; plan: PlanId | null; customerId: string | null; status: string; periodEnd: number; cancelAtPeriodEnd: boolean; now: number; occurredAt?: number }
export type SubscriptionEventResult = "applied" | "duplicate" | "review";
export type PromoRedeemResult = "tokens" | "plan" | "unknown" | "expired" | "used-up" | "already";
export type InviteRedeemResult = "joined" | "unknown" | "used-up" | "own-code" | "already" | "has-plan";
export interface PromoView extends PromoInput { redemptions: number }
/** One hosted subscription checkout per account; pending provider outcomes remain guarded. */
export interface PlanCheckout { uid: string; orderId: string; plan: PlanId; billingCountry: string; createdAt: number; expiresAt: number; checkoutSession: string | null; checkoutUrl: string | null }
export type PlanCheckoutClaim = { status: "subscribed" } | { status: "claimed" | "existing"; checkout: PlanCheckout };

export interface TagflowStore {
  getModelAudienceProfile(uid: string): Promise<ModelAudienceProfile | null>;
  putModelAudienceProfile(profile: ModelAudienceProfile): Promise<void>;
  deleteModelAudienceProfile(uid: string): Promise<void>;
  putModelRequest(record: ModelRequestRecord): Promise<void>;
  getModelRequest(id: string): Promise<ModelRequestRecord | null>;
  putModelFeedback(record: ModelFeedbackRecord): Promise<void>;
  getModelFeedback(requestId: string, uid: string): Promise<ModelFeedbackRecord | null>;
  deleteModelFeedback(requestId: string, uid: string): Promise<void>;
  readModelReports(range: ModelReportRange): Promise<ModelReportData>;
  getTagflowConfig(): Promise<TagflowConfigRecord | null>;
  putTagflowConfig(record: TagflowConfigRecord): Promise<void>;
  getTagflowPolicy(uid: string): Promise<TagflowUserPolicy | null>;
  putTagflowPolicy(uid: string, policy: TagflowUserPolicy): Promise<void>;
  getTagflowUsage(uid: string, day: string): Promise<TagflowUsage | null>;
  listTagflowUsage(day: string): Promise<TagflowUsage[]>;
  /** Atomic across all workers: reserves a request and its maximum token/cost budget. */
  reserveTagflow(request: TagflowReservation): Promise<TagflowReserveResult>;
  /** The account's credit windows as stored; an ended window is still returned. */
  getCreditWindows(uid: string): Promise<CreditWindows>;
  /** Atomic and idempotent. A failed settlement leaves its reservation charged. */
  settleTagflow(id: string, usage: TagflowSettlement): Promise<void>;
  /**
   * Claims the right to send this account one verification email: true when it has never had one
   * from the included-AI gate, or its last one is at least `gapMs` old. Atomic across workers.
   */
  claimVerificationSend(uid: string, now: number, gapMs: number): Promise<boolean>;
  /** The account's free paid-model week and purchased balance, as stored. */
  getPaidTokens(uid: string): Promise<PaidTokenState>;
  createTokenOrder(order: TokenOrder): Promise<void>;
  /** Exactly once per webhook and per order state; refunds find the order by its payment id. */
  applyTokenEvent(event: TokenEvent): Promise<TokenEventResult>;
  grantTokens(uid: string, tokens: number, adminUid: string, note: string, now: number): Promise<void>;
  /** The account's last 100 orders and ledger rows, newest first. */
  listTokenActivity(uid: string): Promise<{ orders: TokenOrder[]; ledger: TokenLedgerEntry[] }>;
  tokenSales(sinceMs: number): Promise<TokenSalesDay[]>;
  /** The account's best live plan and boost (its own rows and everyone's `'*'` rows). Keyed lookups only. */
  getAiPlanState(uid: string, now: number): Promise<AiPlanState>;
  /** Exactly once per webhook; a live subscription's access lasts until its period end. */
  applySubscriptionEvent(event: SubscriptionEvent): Promise<SubscriptionEventResult>;
  getSubscription(uid: string): Promise<{ customerId: string | null; plan: PlanId; status: string; periodEnd: number } | null>;
  /** Atomic account claim before any provider call. Existing sessions are reused, never recreated. */
  claimPlanCheckout(uid: string, plan: PlanId, billingCountry: string, orderId: string, now: number): Promise<PlanCheckoutClaim>;
  completePlanCheckout(uid: string, orderId: string, sessionId: string, checkoutUrl: string, now: number): Promise<"saved" | "subscribed" | "missing">;
  /** `uid` may be `'*'` for everyone. */
  giftPlan(uid: string, plan: PlanId, days: number, adminUid: string, note: string, now: number): Promise<void>;
  /** `uid` may be `'*'` for everyone. */
  boostAllowance(uid: string, weeklyTokens: number, endsAt: number, adminUid: string, note: string, now: number): Promise<void>;
  /** A fresh free week; refused while a request holds tokens in the current one. */
  resetAiWeek(uid: string): Promise<"reset" | "busy" | "none">;
  /** Accounts with a free paid-model week, in uid order after `after` (for resetting everyone in pages). */
  listPaidWeekUids(after: string, limit: number): Promise<string[]>;
  /** False when the code already exists. */
  createPromo(promo: PromoInput, adminUid: string, now: number): Promise<boolean>;
  listPromos(): Promise<PromoView[]>;
  redeemPromo(code: string, uid: string, now: number): Promise<PromoRedeemResult>;
  /** A Pro subscriber's invite code, made on first ask; null without a live Pro subscription. */
  getInvite(uid: string, now: number): Promise<{ code: string; uses: number; maxUses: number } | null>;
  redeemInvite(code: string, uid: string, now: number): Promise<InviteRedeemResult>;
  subscriptionSummary(now: number): Promise<{ plan: PlanId; active: number; mrrCents: number }[]>;
}
