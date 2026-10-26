/** Streaming relay to approved providers, with atomic account allowances. */
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { authenticate, bearerFrom, type TokenVerifier } from "./auth.ts";
import type { AccountIdentity } from "./accountIdentity.ts";
import { corsHeaders } from "./cors.ts";
import { DEFAULT_TAGFLOW_CONFIG, isTagflowUrl, parseTagflowConfig, parseTagflowLimits, tagflowCost } from "./tagflowConfig.ts";
import type { Clock, Store, UserRecord } from "./store.ts";
import type { TagflowConfig, TagflowModel, TagflowSettlement } from "./tagflowTypes.ts";
import { createWorkerSecrets, type WorkerSecrets } from "./workerSecrets.ts";
import { includedProvider, isCustomProviderUrl, modelProvider, providerConnections, type IncludedProviderId } from "./includedProviders.ts";
import { DEFAULT_CREDIT_PLAN, creditCharge, creditsView, millicreditsFor, modelCreditRate, parseCreditPlan, untilText, type CreditPlan } from "./credits.ts";
import { BUY_TOKENS_URL, DEFAULT_PAID_CONFIG, TOKEN_ORDER_PREFIX, isPaidModel, tokensView } from "./paidTokens.ts";
import type { PaymentProvider } from "./payments.ts";
import { PLANS, effectiveWeeklyAllowance, parsePromo, planById } from "./aiPlans.ts";
import { MODEL_FEEDBACK_CATEGORIES, type ModelRequestOutcome, type ModelRequestRecord, type ModelRequestSource } from "./tagflowReportTypes.ts";
import { completeModelReport, parseReportRange } from "./tagflowReports.ts";
import { AUDIENCE_ROLES, AUDIENCE_EXPERIENCE, DECLARED_USES, AI_PERSONAS, audienceChoice, audienceCountry, observedUse, type ModelAudienceProfile } from "./modelAudience.ts";

export interface TagflowOptions {
  store: Store;
  verifier: TokenVerifier;
  clock: Clock;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  country?: (request: Request) => string | undefined;
  /** Dodo checkout for AI tokens; missing answers "not configured". */
  payments?: PaymentProvider;
  /** Where Dodo returns the browser after paying for tokens. */
  siteOrigin?: string;
  /** Saves provider keys as this Worker's Cloudflare secrets from the admin panel. */
  workerSecrets?: WorkerSecrets;
  /** The waits before retrying a provider's 429; tests pass zeros. */
  rateLimitWaitsMs?: readonly number[];
  /** Overrides for the relay's clocks; tests use short ones. */
  timeouts?: Partial<{ firstMs: number; idleMs: number; maxMs: number }>;
  /** Answer from another included model when the chosen one is overloaded. On unless false. */
  fallback?: boolean;
  /** Reads an account's live verification state and sends Firebase's verification email. */
  identity?: AccountIdentity;
}

/** Two retries of a provider's rate limit when no other included model can answer, then the person hears about it. */
export const UPSTREAM_RATE_LIMIT_WAITS_MS: readonly number[] = [700, 1600];

/**
 * Which models are overloaded right now, as this isolate has seen it.
 *
 * On 2026-10-20 one included model's provider refused 84-90% of requests with 429 for four
 * hours while the other three models answered normally. Retrying the refused model does not
 * help when the provider is saturated - it only makes every person wait two more seconds to be
 * refused - so three refusals in a row (each already retried) put a model on a one-minute
 * cooldown. While it cools, its requests go straight to a healthy included model; one answer
 * clears the strikes. Per isolate is enough: each isolate learns within three requests, and a
 * model that recovers is tried again within a minute everywhere.
 */
/** Waiting for a provider to start answering; then silence allowed mid-stream; then the longest any answer may run. */
export const RELAY_TIMEOUTS = { firstMs: 180_000, idleMs: 120_000, maxMs: 1_200_000 } as const;

/** Unpaid token checkouts one account may open in `CHECKOUT_WINDOW_MS`. */
export const CHECKOUTS_PER_WINDOW = 5;
export const CHECKOUT_WINDOW_MS = 600_000;

/** How soon the gate may send the same account another verification link. */
export const VERIFICATION_RESEND_MS = 3_600_000;

export const MODEL_COOLDOWN_STRIKES = 3;
export const MODEL_COOLDOWN_MS = 60_000;
export function createModelHealth(): { strike(id: string, now: number): void; answered(id: string): void; cooling(id: string, now: number): boolean } {
  const health = new Map<string, { strikes: number; until: number }>();
  return {
    strike(id, now) {
      const entry = health.get(id) ?? { strikes: 0, until: 0 };
      entry.strikes += 1;
      if (entry.strikes >= MODEL_COOLDOWN_STRIKES) { entry.until = now + MODEL_COOLDOWN_MS; entry.strikes = 0; }
      health.set(id, entry);
    },
    answered(id) { health.delete(id); },
    cooling(id, now) { return (health.get(id)?.until ?? 0) > now; },
  };
}

export function isTagflowPath(path: string): boolean {
  return path === "/v1/ai/tagflow/config" || path === "/v1/ai/tagflow/usage" || path === "/v1/ai/tagflow/chat/completions" ||
    path === "/v1/ai/tagflow/feedback" || path === "/v1/ai/tagflow/audience" || path === "/v1/admin/tagflow/reports" ||
    path === "/v1/admin/tagflow" || path === "/v1/admin/tagflow/usage" || path === "/v1/admin/tagflow/keys" || /^\/v1\/admin\/tagflow\/users\/[^/]+$/.test(path) ||
    path === "/v1/ai/plans/checkout" || path === "/v1/ai/plans/portal" || path === "/v1/ai/promo/redeem" || path === "/v1/ai/invites" || path === "/v1/ai/invites/redeem" ||
    ["reset", "boost", "gift", "promo", "subscriptions"].some((route) => path === `/v1/admin/ai-plans/${route}`) ||
    path === "/v1/ai/tokens/checkout" || path === "/v1/ai/tokens/orders" || path === "/v1/admin/ai-tokens/grant" || path === "/v1/admin/ai-tokens/sales";
}

/** Tokens are no longer a limit; credits are. Passed where the stores still compare a day's tokens. */
const NO_TOKEN_LIMIT = 9_000_000_000_000_000;
const isRecord = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);
const count = (raw: unknown): raw is number => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw <= 100_000_000;
const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > 1_000_000) throw new Error("body-too-large");
  const reader = request.body?.getReader();
  if (reader === undefined) throw new SyntaxError("missing-body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000) { await reader.cancel(); throw new Error("body-too-large"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** Unknown options cannot bypass pricing with n, images or token-limit aliases. */
type ChatBody = { body: Record<string, unknown>; model: TagflowModel; input: number; output: number; contextInput: number }
  | { error: { status: number; code: string; message: string } };

function chatBody(raw: unknown, config: TagflowConfig): ChatBody {
  const invalid = (code: string, message: string, status = 400): ChatBody => ({ error: { status, code, message } });
  if (!isRecord(raw) || Object.keys(raw).some((key) => !["model", "messages", "tools", "tool_choice", "stream", "stream_options", "max_tokens", "max_completion_tokens", "reasoning_effort"].includes(key))) return invalid("bad-request", "Send a supported chat request.");
  const model = config.models.find((one) => one.id === raw["model"] && one.enabled !== false);
  if (model === undefined) return invalid("model-unavailable", "This model is not available in included AI. Choose another offered model.");
  if (Array.isArray(raw["messages"]) && raw["messages"].some((message) => isRecord(message) && Array.isArray(message["content"]) && message["content"].some((part) => isRecord(part) && (part["type"] === "image_url" || part["type"] === "image")))) {
    return invalid("images-not-supported", "Included AI cannot read image attachments. Choose a model that supports images, or start a text-only conversation.");
  }
  if (!Array.isArray(raw["messages"]) || raw["messages"].length === 0 || raw["messages"].length > 1000 ||
      !raw["messages"].every((message) => isRecord(message) && ["system", "user", "assistant", "tool"].includes(String(message["role"])) &&
        (typeof message["content"] === "string" || message["role"] === "assistant" && message["content"] === null))) return invalid("invalid-messages", "Included AI could not read this conversation's message format. Start a fresh conversation, or switch model.");
  if (raw["tools"] !== undefined && (!Array.isArray(raw["tools"]) || raw["tools"].length > 100)) return invalid("bad-request", "Send a supported tool list.");
  if (raw["stream"] !== undefined && typeof raw["stream"] !== "boolean") return invalid("bad-request", "Send a valid stream option.");
  if (raw["max_tokens"] !== undefined && raw["max_completion_tokens"] !== undefined) return invalid("bad-request", "Send one output token limit.");
  const requested = raw["max_tokens"] ?? raw["max_completion_tokens"] ?? config.maxOutputTokens;
  if (!count(requested) || requested === 0) return invalid("bad-request", "Choose a positive output token limit.");
  const output = Math.min(requested, config.maxOutputTokens, model.maxOutput);
  const inputBytes = bytes(JSON.stringify({ messages: raw["messages"], tools: raw["tools"] ?? [] }));
  const framing = raw["messages"].length * 16 + 256;
  // Use the same token estimate for context checks and allowance reservations.
  // UTF-8 bytes account for non-ASCII text; bytes themselves are not tokens.
  // Provider-reported counts replace this estimate when the request finishes.
  const contextInput = Math.ceil(inputBytes / 3) + framing;
  const inputLimit = Math.max(0, Math.min(config.maxInputTokens, model.contextWindow - output));
  if (contextInput > inputLimit) return invalid("context-length", `This request is too large for included AI. Estimated input tokens: Limit ${inputLimit}, Requested ${contextInput}. Compact the conversation, start fresh, or choose a model with more room.`, 413);
  const input = contextInput;
  const body: Record<string, unknown> = { ...raw, max_tokens: output, stream: raw["stream"] !== false };
  delete body["max_completion_tokens"];
  if (body["stream"]) body["stream_options"] = { include_usage: true };
  else delete body["stream_options"];
  return { body, model, input, output, contextInput };
}

/** Observe counts in bounded memory; never persist prompt or response text. */
class UsageObserver {
  private readonly onOutput: () => void;
  constructor(onOutput: () => void = () => undefined) { this.onOutput = onOutput; }
  private pending = "";
  private readonly decoder = new TextDecoder();
  reported: { input: number; output: number } | null = null;
  outputBytes = 0;
  completed = false;
  finishReason: string | null = null;
  readonly toolCalls = new Set<string>();
  push(chunk: Uint8Array): Uint8Array | null {
    this.pending += this.decoder.decode(chunk, { stream: true });
    let output = "";
    let boundary: RegExpMatchArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(this.pending)) !== null) {
      const frame = this.pending.slice(0, boundary.index);
      this.pending = this.pending.slice(boundary.index! + boundary[0].length);
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data === "[DONE]") this.completed = true;
      else if (data !== "") {
        if (bytes(data) > 1_000_000) throw new Error("upstream-event-too-large");
        // Wait for a complete event before forwarding; an upstream error must never leak
        // credentials even if its JSON arrives in several network chunks.
        let raw: unknown;
        try { raw = JSON.parse(data); } catch { throw new Error("Invalid Tagflow event"); }
        if (!isRecord(raw) || raw["error"] !== undefined) throw new Error("Tagflow stream error");
        this.observe(raw);
      }
      output += `${frame}\n\n`;
    }
    if (this.pending.length > 1_000_000) throw new Error("upstream-event-too-large");
    return output === "" ? null : new TextEncoder().encode(output);
  }
  /** Some compatible providers close after their last data line without an empty line. */
  finish(): Uint8Array | null {
    this.pending += this.decoder.decode();
    if (this.pending.trim() === "") return null;
    // Reuse exactly the same JSON/error/size checks as an ordinary complete frame.
    // The caller still requires [DONE] or finish_reason; EOF alone is never success.
    return this.push(new Uint8Array([10, 10]));
  }
  observe(raw: unknown): void {
    if (!isRecord(raw)) return;
    const groq = raw["x_groq"];
    const usage = raw["usage"] ?? (isRecord(groq) ? groq["usage"] : undefined);
    if (isRecord(usage) && count(usage["prompt_tokens"]) && count(usage["completion_tokens"])) this.reported = { input: usage["prompt_tokens"], output: usage["completion_tokens"] };
    if (Array.isArray(raw["choices"])) for (const choice of raw["choices"]) {
      if (!isRecord(choice)) continue;
      if (choice["finish_reason"] !== undefined && choice["finish_reason"] !== null) {
        const reason = choice["finish_reason"];
        if (typeof reason !== "string" || !["stop", "length", "tool_calls", "function_call", "content_filter", "refusal"].includes(reason)) throw new Error("Invalid Tagflow completion reason");
        this.completed = true;
        this.finishReason = reason === "content_filter" ? "refusal" : reason;
      }
      const delta = choice["delta"] ?? choice["message"];
      if (isRecord(delta)) {
        // Count generated text, not SSE/JSON envelopes repeated on every chunk.
        for (const field of ["content", "reasoning_content", "reasoning"]) {
          if (typeof delta[field] === "string") this.outputBytes += bytes(delta[field]);
        }
        const calls = delta["tool_calls"];
        if (typeof delta["content"] === "string" && delta["content"].length > 0 || Array.isArray(calls) && calls.length > 0 || isRecord(delta["function_call"])) this.onOutput();
        if (Array.isArray(calls)) for (const call of calls) if (isRecord(call)) {
          this.toolCalls.add(`${String(choice["index"] ?? 0)}:${String(call["index"] ?? call["id"] ?? 0)}`);
          this.observeFunction(call["function"]);
        }
        if (isRecord(delta["function_call"])) { this.toolCalls.add("legacy-function"); this.observeFunction(delta["function_call"]); }
      }
    }
  }
  private observeFunction(raw: unknown): void {
    if (!isRecord(raw)) return;
    for (const field of ["name", "arguments"]) if (typeof raw[field] === "string") this.outputBytes += bytes(raw[field]);
  }
}

export function createTagflowHandler(deps: TagflowOptions): (request: Request) => Promise<Response | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const secrets = deps.workerSecrets ?? createWorkerSecrets();
  // A custom provider's secret name is derived from its ID inside its own namespace, so a
  // saved configuration can never name another server secret.
  const providerKey = (config: TagflowConfig, id: IncludedProviderId): string => {
    if (id === "tagflow") return (deps.apiKey ?? process.env["TAGFLOW_API_KEY"] ?? process.env["tagflow-api"] ?? "").trim();
    const connection = includedProvider(id, config.providers);
    return connection === undefined ? "" : (process.env[connection.secretName] ?? "").trim();
  };
  const connections = (config: TagflowConfig) => providerConnections(config.providers).map((provider) => ({ ...provider, configured: providerKey(config, provider.id).length > 0 }));
  const defaultKeyConfigured = (config: TagflowConfig): boolean => {
    const model = config.models.find((one) => one.id === config.defaultModel);
    return model !== undefined && providerKey(config, modelProvider(model)).length > 0;
  };
  const health = createModelHealth();
  /**
   * Where a parsed request goes: its model's provider, address and key, or null when the model
   * cannot be served (no key, or an address that is not allowed). Shared by the chosen model and
   * any fallback, so a fallback passes exactly the checks the chosen model did.
   */
  const target = (config: TagflowConfig, parsed: Extract<ChatBody, { model: TagflowModel }>, signal: AbortSignal): { providerId: IncludedProviderId; send: () => Promise<Response> } | null => {
    const providerId = modelProvider(parsed.model);
    const connection = includedProvider(providerId, config.providers);
    const apiKey = providerKey(config, providerId);
    const baseUrl = providerId === "tagflow" ? config.baseUrl : connection?.baseUrl ?? "";
    if (connection === undefined || apiKey.length === 0 || (providerId === "tagflow" ? !isTagflowUrl(baseUrl) : connection.custom && !isCustomProviderUrl(baseUrl))) return null;
    parsed.body["model"] = parsed.model.upstreamModel ?? parsed.model.id;
    if (connection.outputTokenField === "max_completion_tokens") {
      parsed.body["max_completion_tokens"] = parsed.output;
      delete parsed.body["max_tokens"];
    }
    // Built-in providers have fixed hosts, Tagflow stays on its domain, and custom hosts are
    // public HTTPS addresses only an administrator can register. Redirects are refused, so a
    // credential cannot travel to another host.
    const keyHeader: Record<string, string> = connection.authentication === "bearer" ? { authorization: `Bearer ${apiKey}` } : { [connection.authentication]: apiKey };
    const fetchImpl = deps.fetchImpl ?? fetch;
    return { providerId, send: () => fetchImpl(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", ...keyHeader }, body: JSON.stringify(parsed.body), redirect: "manual", signal }) };
  };
  /**
   * A healthy included model to answer instead, in the administrator's own model order: offered,
   * not cooling, never at a higher credit rate than the person chose (they are never charged more
   * than they agreed to), and able to take this exact request - the same validation, context
   * check and output cap the chosen model passed.
   */
  const fallbackFor = (config: TagflowConfig, raw: Record<string, unknown>, chosen: Extract<ChatBody, { model: TagflowModel }>, maxRate: number, signal: AbortSignal, now: number) => {
    if (deps.fallback === false) return null;
    // The same request with the same output ceiling, so the answer fits the reservation made for it.
    const { max_completion_tokens: _unused, ...rest } = raw;
    for (const model of config.models) {
      // Never onto a paid model: the reservation was made for the chosen one, and no one is charged for a model they did not pick.
      if (model.id === chosen.model.id || model.enabled === false || health.cooling(model.id, now) || modelCreditRate(model, config) > maxRate || isPaidModel(model, config.paid)) continue;
      const parsed = chatBody({ ...rest, model: model.id, max_tokens: chosen.output }, config);
      if ("error" in parsed) continue;
      const route = target(config, parsed, signal);
      if (route !== null) return { parsed, route };
    }
    return null;
  };
  return async (request) => {
    const url = new URL(request.url);
    if (!isTagflowPath(url.pathname)) return null;
    const headers: Record<string,string> = { ...corsHeaders(request.headers.get("origin") ?? undefined), "cache-control": "no-store" };
    const json = (status: number, value: unknown, extra: Record<string, string> = {}): Response => new Response(JSON.stringify(value), { status, headers: { ...headers, "content-type": "application/json", ...extra } });
    const fail = (status: number, code: string, message: string, extra: Record<string, string> = {}, recovery: { retryable: boolean; resetsAt?: number } | null = null): Response => json(status, { error: { code, message, ...recovery } }, extra);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    let metric: ModelRequestRecord | null = null;
    let metricFinished = false;
    // Telemetry never holds up an answer: the "pending" row goes out alongside the provider
    // call, not before it. Writes are chained, so a slow early write can never land after -
    // and overwrite - the finished record of the same request.
    let metricWrites: Promise<void> = Promise.resolve();
    const writeMetric = (): Promise<void> => {
      if (metric === null) return metricWrites;
      const snapshot = { ...metric };
      metricWrites = metricWrites.then(() => deps.store.putModelRequest(snapshot)).catch(() => { console.warn("Included AI telemetry write failed"); });
      return metricWrites;
    };
    const finishMetric = async (outcome: ModelRequestOutcome, code: string | null = null): Promise<void> => {
      if (metric === null || metricFinished) return;
      metricFinished = true;
      metric.finishedAt ??= deps.clock.now();
      metric.outcome = outcome; metric.errorCode = code;
      metric.durationMs = metric.providerStartedAt === null ? null : Math.max(0,metric.finishedAt-metric.providerStartedAt);
      await writeMetric();
    };
    /**
     * Free AI needs a verified email - and the refusal used to be a dead end. GitHub and
     * email/password sign-ins arrive unverified, and nothing in the desktop or on the website sent
     * a verification link: on 2026-10-20, 11 of 15 people who reported "Sign in to use free AI"
     * were signed in and stuck. Now the gate (1) reads the account's live state, so someone who has
     * just opened the link is let straight in, and (2) otherwise has Firebase email them a link, at
     * most once an hour, and says where it went. Null means the person may continue.
     */
    const verificationRefusal = async (user: UserRecord | null, uid: string, idToken: string | null): Promise<Response | null> => {
      const live = idToken !== null && deps.identity !== undefined ? await deps.identity.lookup(idToken) : null;
      if (user !== null && live?.emailVerified === true && live.email !== null) {
        await deps.store.putUser({ ...user, email: live.email, emailVerified: true });
        return null;
      }
      const email = live?.email ?? user?.email ?? null;
      if (email === null) return fail(403, "verify-account", "Sign in to use included AI - it takes a few seconds and no API key is needed.");
      const identity = deps.identity;
      const claimed = idToken !== null && identity !== undefined && await deps.store.claimVerificationSend(uid, deps.clock.now(), VERIFICATION_RESEND_MS);
      const sent = claimed && idToken !== null && identity !== undefined ? await identity.sendVerification(idToken) : false;
      return fail(403, "verify-account", sent
        ? `Free AI needs a verified email. We sent a verification link to ${email} - open it, then send your message again. No API key is needed.`
        : claimed
          ? `Free AI needs a verified email, and the verification email to ${email} could not be sent just now. Try again in an hour, or sign in with Google, which verifies the address for you.`
          : `Free AI needs a verified email. Open the verification link we emailed to ${email}, then send your message again. Not there? Check spam - a new link can be sent an hour after the last one.`);
    };
    try {
      const saved = await deps.store.getTagflowConfig();
      const config = parseTagflowConfig(saved?.config ?? DEFAULT_TAGFLOW_CONFIG);
      if (config === null) return fail(503, "unavailable", "Included AI is unavailable. Try another connected model.");
      const offeredModels = config.models.filter((model) => model.enabled !== false && providerKey(config, modelProvider(model)).length > 0);
      const available = config.enabled && offeredModels.length > 0;
      const day = new Date(deps.clock.now()).toISOString().slice(0, 10);
      const resetsAt = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
      const remainingDay = { "retry-after": String(Math.max(1, Math.ceil((resetsAt - deps.clock.now()) / 1000))) };
      if (url.pathname === "/v1/ai/tagflow/config" && request.method === "GET") {
        return json(200, { available, defaultModel: offeredModels.some((model) => model.id === config.defaultModel) ? config.defaultModel : offeredModels[0]?.id ?? config.defaultModel, models: available ? offeredModels.map((model) => ({ id: model.id, name: model.name, providerName: includedProvider(modelProvider(model), config.providers)?.name ?? "Included AI", contextWindow: Math.min(model.contextWindow, config.maxInputTokens), maxOutput: Math.min(model.maxOutput, config.maxOutputTokens), creditRate: modelCreditRate(model, config), paid: isPaidModel(model, config.paid) })) : [], requiresVerifiedAccount: true, unlimited: true, credits: config.credits ?? DEFAULT_CREDIT_PLAN, paid: { ...(config.paid ?? DEFAULT_PAID_CONFIG), plans: PLANS } });
      }
      const auth = await authenticate(deps, request.headers.get("authorization") ?? undefined);
      if (!auth.ok) return fail(auth.failure === "banned" ? 403 : 401, auth.failure, "Sign in to use included AI. Banned accounts cannot use it.");
      if (url.pathname.startsWith("/v1/admin/") && !auth.isAdmin) return fail(403, "not-admin", "Administrator access is required.");
      const audit = async (action: string, subjectUid = "*"): Promise<void> => deps.store.writeAudit({ adminUid: auth.uid, action, subjectUid, at: deps.clock.now() });
      if (url.pathname === "/v1/ai/tagflow/audience") {
        if (request.method === "GET") {
          const profile = await deps.store.getModelAudienceProfile(auth.uid);
          return json(200,{ profile: profile === null ? null : { role: profile.role, experience: profile.experience, primaryUse: profile.primaryUse, consent: true } });
        }
        if (request.method === "POST") {
          const raw = await readJson(request);
          if (!isRecord(raw) || Object.keys(raw).some(key => !["role","experience","primaryUse","consent"].includes(key)) || typeof raw["consent"] !== "boolean") return fail(400,"bad-profile","Choose the optional profile fields and sharing preference.");
          if (!raw["consent"]) { await deps.store.deleteModelAudienceProfile(auth.uid); return json(200,{ ok:true, profile:null }); }
          if (!AUDIENCE_ROLES.includes(raw["role"] as never) || !AUDIENCE_EXPERIENCE.includes(raw["experience"] as never) || !DECLARED_USES.includes(raw["primaryUse"] as never)) return fail(400,"bad-profile","Choose a supported role, experience and purpose.");
          await deps.store.putModelAudienceProfile({ uid:auth.uid, role:raw["role"] as ModelAudienceProfile["role"], experience:raw["experience"] as ModelAudienceProfile["experience"], primaryUse:raw["primaryUse"] as ModelAudienceProfile["primaryUse"], updatedAt:deps.clock.now() });
          return json(200,{ ok:true });
        }
      }
      if (url.pathname === "/v1/ai/tokens/orders" && request.method === "GET") {
        const [activity, state, subscription] = await Promise.all([deps.store.listTokenActivity(auth.uid), deps.store.getPaidTokens(auth.uid), deps.store.getSubscription(auth.uid)]);
        return json(200, { tokens: tokensView(config.paid, state.free, state.balance, deps.clock.now()), ...activity,
          subscription: subscription === null ? null : { plan: subscription.plan, status: subscription.status, periodEnd: subscription.periodEnd, active: subscription.periodEnd > deps.clock.now() } });
      }
      if (url.pathname === "/v1/ai/plans/checkout" && request.method === "POST") {
        const raw = await readJson(request);
        if (config.paid?.enabled !== true) return json(409, { error: "paid-off" });
        const selected = isRecord(raw) && typeof raw["plan"] === "string" ? planById(raw["plan"]) : null;
        if (selected === null) return json(400, { error: "bad-plan" });
        const country = isRecord(raw) ? raw["billingCountry"] : undefined;
        if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) return json(400, { error: "bad-country" });
        const buyer = await deps.store.getUser(auth.uid);
        if (!buyer?.email || buyer.emailVerified !== true) return json(403, { error: "verify-account" });
        if (deps.payments === undefined) return json(503, { error: "not-configured" });
        const now = deps.clock.now();
        const orderId = `aip_${randomUUID().replaceAll("-", "")}`;
        const product = `plan-${selected.id}` as const;
        if (deps.payments.canCreateCheckout?.(product) === false) return json(503, { error: "not-configured" });
        // A database claim, not an isolate-local count: two workers cannot issue two payable subscriptions.
        const claim = await deps.store.claimPlanCheckout(auth.uid, selected.id, country, orderId, now);
        if (claim.status === "subscribed") return json(409, { error: "already-subscribed" });
        if (claim.status === "existing") {
          if (claim.checkout.plan !== selected.id) return json(409, { error: { code: "checkout-exists", message: `You already opened a ${planById(claim.checkout.plan)?.name ?? "plan"} checkout. Choose that plan again to resume it. Wait until the existing checkout expires before choosing a different plan.` }, expiresAt: claim.checkout.expiresAt });
          if (claim.checkout.checkoutUrl !== null) return json(200, { orderId: claim.checkout.orderId, checkoutUrl: claim.checkout.checkoutUrl });
          return json(409, { error: { code: "checkout-pending", message: "Your checkout is being prepared or its status is still being confirmed. Try again shortly. If it stays unavailable, contact support before starting another subscription." } }, { "retry-after": "30" });
        }
        const origin = deps.siteOrigin ?? "https://adcode.bluethenics.com";
        const session = await deps.payments.createCheckout({ orderId, product, advertiserId: auth.uid,
          advertiserName: buyer.displayName ?? buyer.email, advertiserEmail: buyer.email, billingCountry: country,
          amountMicros: BigInt(selected.priceCents) * 10_000n, metadata: { uid: auth.uid, plan: selected.id },
          returnUrl: `${origin}/ai-tokens?plan=${selected.id}&order=${orderId}`, cancelUrl: `${origin}/ai-tokens` });
        // A timeout can happen after Dodo creates a session. Retain the claim until that session expires.
        if (session === null) return json(502, { error: { code: "checkout-pending", message: "We couldn't confirm your checkout. Try again shortly. If it stays unavailable, contact support so we can check it before opening another subscription." } });
        const completed = await deps.store.completePlanCheckout(auth.uid, orderId, session.sessionId, session.checkoutUrl, deps.clock.now());
        if (completed === "subscribed") return json(409, { error: "already-subscribed" });
        if (completed !== "saved") return json(409, { error: { code: "checkout-pending", message: "Your checkout status changed. Refresh your account before trying again." } });
        return json(200, { orderId, checkoutUrl: session.checkoutUrl });
      }
      if (url.pathname === "/v1/ai/plans/portal" && request.method === "POST") {
        const buyer = await deps.store.getUser(auth.uid);
        if (!buyer?.email || buyer.emailVerified !== true) return json(403, { error: "verify-account" });
        const subscription = await deps.store.getSubscription(auth.uid);
        if (!subscription?.customerId) return json(404, { error: "no-subscription" });
        if (deps.payments?.customerPortal === undefined) return json(503, { error: "not-configured" });
        const link = await deps.payments.customerPortal(subscription.customerId, `${deps.siteOrigin ?? "https://adcode.bluethenics.com"}/ai-tokens`);
        return link === null ? json(502, { error: "portal-unavailable" }) : json(200, { link });
      }
      if ((url.pathname === "/v1/ai/promo/redeem" || url.pathname === "/v1/ai/invites/redeem") && request.method === "POST") {
        const buyer = await deps.store.getUser(auth.uid);
        if (!buyer?.email || buyer.emailVerified !== true) return json(403, { error: "verify-account" });
        const raw = await readJson(request);
        const code = isRecord(raw) && typeof raw["code"] === "string" ? raw["code"].trim().toUpperCase() : "";
        if (!/^[A-Z0-9]{3,24}$/.test(code)) return json(400, { error: "bad-code" });
        const result = url.pathname === "/v1/ai/promo/redeem" ? await deps.store.redeemPromo(code, auth.uid, deps.clock.now()) : await deps.store.redeemInvite(code, auth.uid, deps.clock.now());
        const status = result === "unknown" ? 404 : result === "expired" || result === "used-up" ? 410 : ["already", "own-code", "has-plan"].includes(result) ? 409 : 200;
        return json(status, { result });
      }
      if (url.pathname === "/v1/ai/invites" && request.method === "GET") {
        const invite = await deps.store.getInvite(auth.uid, deps.clock.now());
        return invite === null ? json(404, { error: "no-invite" }) : json(200, invite);
      }
      if (url.pathname.startsWith("/v1/admin/ai-plans/")) {
        const route = url.pathname.slice("/v1/admin/ai-plans/".length);
        if (request.method === "GET" && route === "promo") { await audit("read-ai-promos"); return json(200, { promos: await deps.store.listPromos() }); }
        if (request.method === "GET" && route === "subscriptions") { await audit("read-ai-subscriptions"); return json(200, { plans: await deps.store.subscriptionSummary(deps.clock.now()) }); }
        if (request.method !== "POST" || !["reset", "boost", "gift", "promo"].includes(route)) return json(405, { error: "method" });
        const raw = await readJson(request);
        if (route === "promo") {
          const promo = parsePromo(raw);
          if (promo === null || promo.expiresAt <= deps.clock.now()) return json(400, { error: "bad-promo" });
          await audit("create-ai-promo", promo.code);
          return await deps.store.createPromo(promo, auth.uid, deps.clock.now()) ? json(200, { ok: true }) : json(409, { error: "code-exists" });
        }
        const uid = isRecord(raw) ? raw["uid"] : undefined;
        if (!isRecord(raw) || typeof uid !== "string" || uid.length === 0 || uid.length > 128 || uid !== uid.trim()) return json(400, { error: "bad-user" });
        if (route === "reset") {
          if (uid !== "*") {
            await audit("reset-ai-week", uid);
            const result = await deps.store.resetAiWeek(uid);
            return json(result === "busy" ? 409 : 200, { result, reset: result === "reset" ? 1 : 0, busy: result === "busy" ? 1 : 0, none: result === "none" ? 1 : 0 });
          }
          const after = raw["after"] ?? "";
          const retryUids = raw["retryUids"];
          if (typeof after !== "string" || after.length > 128 || after !== after.trim() || after === "*" ||
              retryUids !== undefined && (!Array.isArray(retryUids) || retryUids.length < 1 || retryUids.length > 500 || retryUids.some(one => typeof one !== "string" || one.length === 0 || one.length > 128 || one !== one.trim() || one === "*"))) return json(400, { error: "bad-cursor" });
          await audit("reset-ai-week", uid);
          // One bounded page per HTTP request. The admin client advances the cursor only
          // after a confirmed response, and retries failed accounts without resetting a
          // successfully processed page again.
          const uids = retryUids === undefined ? await deps.store.listPaidWeekUids(after, 500) : [...new Set(retryUids as string[])];
          const totals = { reset: 0, busy: 0, none: 0 };
          const failed: string[] = [];
          for (let offset = 0; offset < uids.length; offset += 20) {
            const chunk = uids.slice(offset, offset + 20);
            const results = await Promise.allSettled(chunk.map(one => deps.store.resetAiWeek(one)));
            results.forEach((result, index) => {
              if (result.status === "fulfilled") totals[result.value] += 1;
              else failed.push(chunk[index]!);
            });
          }
          return json(200, { ...totals, failed, nextCursor: retryUids === undefined && uids.length === 500 ? uids[uids.length - 1] : null });
        }
        const note = raw["note"];
        if (typeof note !== "string" || note.length > 500) return json(400, { error: "bad-note" });
        if (route === "boost") {
          const weeklyTokens = raw["weeklyTokens"], endsAt = raw["endsAt"];
          if (typeof weeklyTokens !== "number" || !Number.isSafeInteger(weeklyTokens) || weeklyTokens < 1 || weeklyTokens > 10_000_000_000 ||
              typeof endsAt !== "number" || !Number.isSafeInteger(endsAt) || endsAt <= deps.clock.now() || endsAt > 9_000_000_000_000) return json(400, { error: "bad-boost" });
          await audit("boost-ai-allowance", uid);
          await deps.store.boostAllowance(uid, weeklyTokens, endsAt, auth.uid, note.trim(), deps.clock.now());
        } else {
          const selected = typeof raw["plan"] === "string" ? planById(raw["plan"]) : null, days = raw["days"];
          if (selected === null || typeof days !== "number" || !Number.isSafeInteger(days) || days < 1 || days > 366) return json(400, { error: "bad-gift" });
          await audit("gift-ai-plan", uid);
          await deps.store.giftPlan(uid, selected.id, days, auth.uid, note.trim(), deps.clock.now());
        }
        return json(200, { ok: true });
      }
      if (url.pathname === "/v1/ai/tokens/checkout" && request.method === "POST") {
        const raw = await readJson(request);
        const paid = config.paid;
        if (paid?.enabled !== true) return json(409, { error: "paid-off" });
        const pack = isRecord(raw) ? paid.packs.find((one) => one.id === raw["pack"]) : undefined;
        if (pack === undefined) return json(400, { error: "bad-pack" });
        const country = isRecord(raw) ? raw["billingCountry"] : undefined;
        if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) return json(400, { error: "bad-country" });
        const buyer = await deps.store.getUser(auth.uid);
        if (buyer?.email === undefined || buyer.emailVerified !== true) return json(403, { error: "verify-account" });
        if (deps.payments === undefined) return json(503, { error: "not-configured" });
        // Every checkout opens a Dodo session on the merchant account advertisers pay through too.
        const recent = (await deps.store.listTokenActivity(auth.uid)).orders.filter((one) => one.status === "pending" && one.createdAt > deps.clock.now() - CHECKOUT_WINDOW_MS);
        if (recent.length >= CHECKOUTS_PER_WINDOW) return json(429, { error: "too-many-checkouts" }, { "retry-after": "600" });
        const orderId = `${TOKEN_ORDER_PREFIX}${randomUUID().replaceAll("-", "")}`;
        const origin = deps.siteOrigin ?? "https://adcode.bluethenics.com";
        const session = await deps.payments.createCheckout({ orderId, product: "ai-tokens", advertiserId: auth.uid, advertiserName: buyer.displayName ?? buyer.email, advertiserEmail: buyer.email,
          billingCountry: country, amountMicros: BigInt(pack.priceCents) * 10_000n, returnUrl: `${origin}/ai-tokens?order=${orderId}`, cancelUrl: `${origin}/ai-tokens` });
        if (session === null) return json(503, { error: "not-configured" });
        await deps.store.createTokenOrder({ orderId, uid: auth.uid, packId: pack.id, priceCents: pack.priceCents, tokens: pack.tokens, status: "pending", checkoutSession: session.sessionId, providerPaymentId: null, createdAt: deps.clock.now(), paidAt: null });
        return json(200, { orderId, checkoutUrl: session.checkoutUrl });
      }
      if (url.pathname === "/v1/admin/ai-tokens/grant" && request.method === "POST") {
        const raw = await readJson(request);
        if (!isRecord(raw) || typeof raw["uid"] !== "string" || raw["uid"].length === 0 || raw["uid"].length > 128 || typeof raw["tokens"] !== "number" || !Number.isSafeInteger(raw["tokens"]) ||
          raw["tokens"] === 0 || Math.abs(raw["tokens"]) > 10_000_000_000 || typeof raw["note"] !== "string" || raw["note"].length > 500) return json(400, { error: "bad-grant" });
        await audit("grant-ai-tokens", raw["uid"]);
        await deps.store.grantTokens(raw["uid"], raw["tokens"], auth.uid, raw["note"].trim(), deps.clock.now());
        return json(200, { ok: true });
      }
      if (url.pathname === "/v1/admin/ai-tokens/sales" && request.method === "GET") {
        const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30) || 30));
        return json(200, { days: await deps.store.tokenSales(deps.clock.now() - days * 86_400_000) });
      }
      if (url.pathname === "/v1/admin/tagflow") {
        if (request.method === "GET") return json(200, { config, updatedAt: saved?.updatedAt ?? 0, updatedBy: saved?.updatedBy ?? "", keyConfigured: defaultKeyConfigured(config), connections: connections(config), keysManageable: secrets.configured() });
        if (request.method === "POST") {
          const next = parseTagflowConfig(await readJson(request));
          if (next === null) return fail(400, "bad-config", "Check the providers (custom ones need a public HTTPS API address), the Tagflow HTTPS base URL, unique model IDs, prices, and non-negative limits.");
          if (next.enabled && !defaultKeyConfigured(next)) {
            const provider = includedProvider(modelProvider(next.models.find((model) => model.id === next.defaultModel)!), next.providers);
            return fail(409, "missing-secret", `Set the ${provider?.secretName ?? "provider"} server secret before choosing this default model.`);
          }
          await audit("save-tagflow-config");
          const result = { config: next, updatedAt: deps.clock.now(), updatedBy: auth.uid };
          await deps.store.putTagflowConfig(result);
          return json(200, { ...result, keyConfigured: defaultKeyConfigured(next), connections: connections(next), keysManageable: secrets.configured() });
        }
      }
      // Only a saved provider's own key name can be written, so this can never replace another secret.
      if (url.pathname === "/v1/admin/tagflow/keys" && request.method === "POST") {
        const raw = await readJson(request);
        if (!isRecord(raw) || Object.keys(raw).some((key) => !["provider", "key"].includes(key)) || typeof raw["provider"] !== "string") return fail(400, "bad-key", "Choose a provider.");
        const connection = providerConnections(config.providers).find((provider) => provider.id === raw["provider"]);
        if (connection === undefined) return fail(404, "not-found", "Save this provider before adding its key.");
        const value = raw["key"] === null ? null : typeof raw["key"] === "string" ? raw["key"].trim() : undefined;
        if (value === undefined || value !== null && !/^[\x21-\x7e]{8,4096}$/.test(value)) return fail(400, "bad-key", "Paste the whole key: 8 to 4,096 visible characters, with no spaces.");
        await audit(value === null ? "remove-provider-key" : "save-provider-key", connection.id);
        const result = value === null ? await secrets.remove(connection.secretName) : await secrets.put(connection.secretName, value);
        if (!result.ok) return fail(result.reason === "not-configured" ? 409 : 502, result.reason, result.message);
        return json(200, { ok: true, provider: connection.id, secretName: connection.secretName, saved: value !== null });
      }
      if (url.pathname === "/v1/admin/tagflow/usage" && request.method === "GET") {
        const requestedDay = url.searchParams.get("day") ?? day;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDay) || !Number.isFinite(Date.parse(requestedDay)) || new Date(requestedDay).toISOString().slice(0, 10) !== requestedDay) return fail(400, "bad-day", "Choose a valid date.");
        await audit("read-tagflow-usage");
        return json(200, { day: requestedDay, rows: await deps.store.listTagflowUsage(requestedDay) });
      }
      if (url.pathname === "/v1/admin/tagflow/reports" && request.method === "GET") {
        const range = parseReportRange(url.searchParams.get("from"),url.searchParams.get("to"),deps.clock.now());
        if (range === null) return fail(400,"bad-range","Choose valid dates, up to 93 days, ending no later than today (UTC).");
        await audit("read-free-model-provider-reports");
        return json(200,completeModelReport(await deps.store.readModelReports(range),config,range,deps.clock.now()));
      }
      if (url.pathname === "/v1/ai/tagflow/feedback" && request.method === "POST") {
        const raw = await readJson(request);
        if (!isRecord(raw) || Object.keys(raw).some(key => !["requestId","rating","category","comment","shareWithProvider"].includes(key)) || typeof raw["requestId"] !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw["requestId"])) return fail(400,"bad-feedback","Choose a response to rate.");
        const original = await deps.store.getModelRequest(raw["requestId"]);
        if (original === null || original.uid !== auth.uid) return fail(404,"not-found","That response was not found for this account.");
        if (original.outcome === "pending") return fail(409,"not-ready","Wait for this response to finish before rating it.");
        if (raw["rating"] === null) { await deps.store.deleteModelFeedback(original.id,auth.uid); return json(200,{ ok: true }); }
        if (!["helpful","not-helpful"].includes(String(raw["rating"])) || !MODEL_FEEDBACK_CATEGORIES.includes(raw["category"] as never) || typeof raw["comment"] !== "string" || raw["comment"].length > 2000 || typeof raw["shareWithProvider"] !== "boolean") return fail(400,"bad-feedback","Choose a rating and category. Comments can be up to 2,000 characters.");
        const previous = await deps.store.getModelFeedback(original.id,auth.uid);
        await deps.store.putModelFeedback({ requestId: original.id, uid: auth.uid, rating: raw["rating"] as "helpful" | "not-helpful", category: raw["category"] as typeof MODEL_FEEDBACK_CATEGORIES[number], comment: raw["comment"].trim(), shareWithProvider: raw["shareWithProvider"], createdAt: previous?.createdAt ?? deps.clock.now(), updatedAt: deps.clock.now() });
        return json(200,{ ok: true });
      }
      const userMatch = /^\/v1\/admin\/tagflow\/users\/([^/]+)$/.exec(url.pathname);
      const subject = userMatch === null ? auth.uid : decodeURIComponent(userMatch[1]!);
      if (subject.length > 128 || subject.length === 0) return fail(400, "bad-user", "Choose a valid user.");
      if (userMatch !== null) {
        if (await deps.store.getUser(subject) === null) return fail(404, "not-found", "That account was not found.");
        if (request.method === "POST") {
          const raw = await readJson(request);
          if (!isRecord(raw) || Object.keys(raw).some((key) => !["blocked", "limits", "credits"].includes(key)) || typeof raw["blocked"] !== "boolean") return fail(400, "bad-policy", "Check the user allowance.");
          const limits = raw["limits"] === null ? null : parseTagflowLimits(raw["limits"]);
          if (raw["limits"] !== null && limits === null) return fail(400, "bad-policy", "Check the user allowance.");
          const personal = raw["credits"] === undefined || raw["credits"] === null ? null : parseCreditPlan(raw["credits"]);
          if (raw["credits"] !== undefined && raw["credits"] !== null && personal === null) return fail(400, "bad-policy", "Check the user's credits.");
          await audit("save-tagflow-policy", subject);
          await deps.store.putTagflowPolicy(subject, { blocked: raw["blocked"], limits, credits: personal, updatedAt: deps.clock.now(), updatedBy: auth.uid });
        } else if (request.method !== "GET") return fail(405, "method", "Use GET or POST.");
        await audit("read-tagflow-user", subject);
      }
      const policy = await deps.store.getTagflowPolicy(subject);
      const limits = policy?.limits ?? config.limits;
      const plan: CreditPlan = policy?.credits ?? config.credits ?? DEFAULT_CREDIT_PLAN;
      if (userMatch !== null || url.pathname === "/v1/ai/tagflow/usage" && request.method === "GET") {
        // The day's usage row and the credit windows are what this view shows; a chat request
        // needs neither - its reservation checks both inside one database transaction.
        // Paid-token rows are read only while selling is on: no extra reads per poll otherwise, and a
        // Worker deployed before its migration still answers this view for everyone.
        const selling = config.paid?.enabled === true;
        const [stored, windows, paidState, planState] = await Promise.all([deps.store.getTagflowUsage(subject, day), deps.store.getCreditWindows(subject),
          selling ? deps.store.getPaidTokens(subject) : Promise.resolve({ free: null, balance: { purchased: 0, reserved: 0 } }),
          selling ? deps.store.getAiPlanState(subject, deps.clock.now()) : Promise.resolve({ plan: null, boostTokens: 0 })]);
        // The view's limit is the account's own allowance: its plan or boost when better than everyone's.
        const view = tokensView(config.paid === undefined ? undefined : { ...config.paid, freeWeeklyTokens: effectiveWeeklyAllowance(planState, config.paid.freeWeeklyTokens, deps.clock.now()) },
          paidState.free, paidState.balance, deps.clock.now());
        // Which offered models draw on it, so the editor's meter shows tokens only for those.
        const tokens = { ...view, plan: planState.plan !== null && planState.plan.endsAt > deps.clock.now() ? planState.plan : null, paidModels: offeredModels.filter((model) => isPaidModel(model, config.paid)).map((model) => model.id) };
        const usage = stored ?? { uid: subject, day, requests: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, estimatedRequests: 0, reservedTokens: 0, reservedCostMicros: 0 };
        const credits = creditsView(plan, windows, Object.fromEntries(offeredModels.map((model) => [model.id, modelCreditRate(model, config)])), deps.clock.now());
        if (userMatch !== null) return json(200, { available, policy, limits, usage, resetsAt, blocked: policy?.blocked === true, unlimited: true, credits, tokens });
        // Desktops from before credits read only the token fields. They get the session window in
        // tokens (a credit is 1,000 tokens at the standard rate), so their meter, its reset time
        // and their automatic resume all follow the window that is really enforced.
        const sessionReset = credits.session.resetsAt ?? deps.clock.now() + plan.sessionHours * 3_600_000;
        const legacy = { ...usage, inputTokens: Math.round(credits.session.used * 1000), outputTokens: 0, reservedTokens: Math.round(credits.session.held * 1000) };
        return json(200, { available, policy, limits: { ...limits, dailyTokens: plan.sessionCredits * 1000 }, usage: legacy, today: usage, resetsAt: sessionReset, blocked: policy?.blocked === true, unlimited: true, credits, tokens });
      }
      if (url.pathname !== "/v1/ai/tagflow/chat/completions" || request.method !== "POST") return fail(405, "method", "Unsupported method.");
      const user = await deps.store.getUser(auth.uid);
      if (!user?.email || user.emailVerified !== true) {
        const refusal = await verificationRefusal(user, auth.uid, bearerFrom(request.headers.get("authorization") ?? undefined));
        if (refusal !== null) return refusal;
      }
      const raw = await readJson(request);
      const selected = isRecord(raw) ? config.models.find(model => model.id === raw["model"]) : undefined;
      if (selected !== undefined) {
        const source = request.headers.get("x-adcode-ai-source");
        const sourceValue: ModelRequestSource = ["chat","agent","completion","edit"].includes(source ?? "") ? source as ModelRequestSource : source === "admin-test" && auth.isAdmin ? "admin-test" : "unknown";
        const aiPersona = audienceChoice(request.headers.get("x-adcode-ai-persona"),AI_PERSONAS);
        let country = "unknown"; try { country = audienceCountry(deps.country?.(request)); } catch { /* Geography must never fail an AI request. */ }
        metric = { id: randomUUID(), uid: auth.uid, modelId: selected.id, modelName: selected.name, provider: modelProvider(selected), upstreamModel: selected.upstreamModel ?? selected.id,
          country, aiPersona, useCase: observedUse(sourceValue,aiPersona), platform: audienceChoice(request.headers.get("x-adcode-platform"),["win32","darwin","linux","web"]),
          startedAt: deps.clock.now(), finishedAt: null, providerStartedAt: null, outcome: "pending", errorCode: null, upstreamStatus: null, source: sourceValue,
          streamed: isRecord(raw) && raw["stream"] !== false, toolsOffered: isRecord(raw) && Array.isArray(raw["tools"]) && raw["tools"].length > 0,
          toolCalls: 0, finishReason: null, contextWindow: selected.contextWindow, requestedOutput: 0, estimatedInput: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, estimated: false, durationMs: null, firstTokenMs: null };
        headers["x-adcode-request-id"] = metric.id;
        void writeMetric();
      }
      if (!available) { await finishMetric("rejected","unavailable"); return fail(503, "unavailable", "Included AI is unavailable. Try another connected model."); }
      if (policy?.blocked) { await finishMetric("rejected","blocked"); return fail(403, "blocked", "Included AI is disabled for this account."); }
      const parsed = chatBody(raw, config);
      if ("error" in parsed) { await finishMetric("rejected",parsed.error.code); return fail(parsed.error.status, parsed.error.code, parsed.error.message); }
      if (metric !== null) { metric.requestedOutput = parsed.output; metric.estimatedInput = parsed.contextInput; }
      const abort = new AbortController();
      const chosenRoute = target(config, parsed, abort.signal);
      if (chosenRoute === null) { await finishMetric("rejected","unavailable"); return fail(503, "unavailable", "This included model is unavailable. Choose another model."); }
      let route = chosenRoute;
      // Every included model draws from the account's one credit balance, at its own rate.
      // Tokens are no longer a limit; the day keeps its spending and request ceilings.
      const rate = modelCreditRate(parsed.model, config);
      const tokens = parsed.input + parsed.output;
      const paidModel = isPaidModel(parsed.model, config.paid);
      // The week's free allowance: the account's plan or boost when better than everyone's. Cached per isolate.
      const freeWeeklyTokens = paidModel ? effectiveWeeklyAllowance(await deps.store.getAiPlanState(auth.uid, deps.clock.now()), config.paid!.freeWeeklyTokens, deps.clock.now()) : 0;
      const reservation = { unlimited: true, id: randomUUID(), uid: auth.uid, day, minute: Math.floor(deps.clock.now() / 60_000), tokens, costMicros: tagflowCost(parsed.model, parsed.input, parsed.output),
        limits: { ...limits, dailyTokens: NO_TOKEN_LIMIT }, credits: creditCharge(plan, millicreditsFor(tokens, rate), deps.clock.now()),
        // A paid provider's model holds its tokens from the free week, then purchased ones.
        ...(paidModel ? { paid: { freeWeeklyTokens, now: deps.clock.now() } } : {}) };
      const reserved = await deps.store.reserveTagflow(reservation);
      if (reserved !== "ok") {
        await finishMetric("rejected",reserved);
        if (reserved === "paid-limit") {
          // "daily-limit" with a reset time: every released desktop already pauses on it and resumes by itself.
          const state = await deps.store.getPaidTokens(auth.uid);
          const refill = state.free?.endsAt ?? deps.clock.now() + 7 * 86_400_000;
          const provider = includedProvider(modelProvider(parsed.model), config.providers)?.name ?? "this provider's";
          const message = `You've used this week's ${freeWeeklyTokens.toLocaleString("en-US")} free tokens on ${provider} models. Buy tokens or a plan at ${BUY_TOKENS_URL}, or switch to Tagflow AI, which stays free. Your free tokens refill in ${untilText(refill, deps.clock.now())}.`;
          return json(429, { error: { code: "daily-limit", limit: "paid", message, retryable: true, resetsAt: refill, buyUrl: BUY_TOKENS_URL } }, { "retry-after": String(Math.max(1, Math.ceil((refill - deps.clock.now()) / 1000))) });
        }
        if (reserved === "session-limit" || reserved === "weekly-limit") {
          const view = creditsView(plan, await deps.store.getCreditWindows(auth.uid), {}, deps.clock.now());
          const weekly = reserved === "weekly-limit";
          const refill = (weekly ? view.weekly : view.session).resetsAt ?? deps.clock.now() + (weekly ? 7 * 86_400_000 : plan.sessionHours * 3_600_000);
          const retryable = (weekly ? plan.weeklyCredits : plan.sessionCredits) > 0;
          const until = untilText(refill, deps.clock.now());
          const message = !retryable
            ? "Free AI credits are set to zero for this account, so waiting will not help. Ask an administrator to change your credits, or use your own connected model."
            : weekly
              ? `You've used this week's free AI credits (${plan.weeklyCredits.toLocaleString("en-US")}). They refill in ${until}, and this task resumes by itself then. All free models share one credit balance.`
              : `You've used this ${plan.sessionHours}-hour window's free AI credits (${plan.sessionCredits.toLocaleString("en-US")}). They refill in ${until}, and this task resumes by itself then. All free models share one credit balance.`;
          // "daily-limit" is the code every released desktop already waits on; `limit` says which window.
          return json(429, { error: { code: "daily-limit", limit: weekly ? "weekly" : "session", message, retryable, resetsAt: refill } }, { "retry-after": String(Math.max(1, Math.ceil((refill - deps.clock.now()) / 1000))) });
        }
        const daily = reserved === "daily-limit";
        const retryable = daily ? limits.dailyRequests > 0 && reservation.costMicros <= limits.dailyCostMicros : limits.requestsPerMinute > 0;
        const message = !retryable ? daily
          ? "This request cannot fit within your account's daily spending or request ceiling, even after a reset. Start a smaller conversation, choose another model, or ask an administrator to change the ceiling."
          : "This account's per-minute AI request allowance is zero. Waiting will not enable requests. Ask an administrator to change the allowance."
          : daily ? "Your account reached today's free AI spending or request ceiling. This task can resume after the daily reset. Your credits are unaffected."
          : "Your account reached its per-minute AI request limit. This task can resume in about a minute. Your credits may still have room.";
        return fail(429,reserved,message,daily ? remainingDay : { "retry-after":"60" },{ retryable,...(daily ? { resetsAt } : {}) });
      }
      const observer = new UsageObserver(() => { if (metric !== null && metric.streamed && metric.firstTokenMs === null && metric.providerStartedAt !== null) metric.firstTokenMs = Math.max(0,deps.clock.now()-metric.providerStartedAt); });
      // The model that actually answers: the chosen one, or a fallback when it is overloaded.
      // Settlement charges what was served, never more than the reservation held for the choice.
      let served = parsed;
      let servedRate = rate;
      let settled = false;
      let settlementFailed = false;
      let settling: Promise<void> | null = null;
      const settle = (failed = false, complete = false): Promise<void> => {
        if (settled) return Promise.resolve();
        // cancel() and an aborted pending pull can arrive together. Both await the
        // same request-local write instead of sending two settlement requests.
        if (settling !== null) return settling;
        settling = (async () => {
        const reported = observer.completed ? observer.reported : null;
        // An incomplete stream may have consumed its full allocation upstream.
        const inputTokens = failed ? 0 : reported?.input ?? served.input;
        const outputTokens = failed ? 0 : reported?.output ?? (complete && observer.completed ? Math.min(served.output, Math.ceil(observer.outputBytes / 3) + (observer.toolCalls.size > 0 ? 16 * observer.toolCalls.size : 0)) : served.output);
        const result: TagflowSettlement = { inputTokens, outputTokens, costMicros: failed ? 0 : tagflowCost(served.model, inputTokens, outputTokens), estimated: reported === null, failed, millicredits: failed ? 0 : millicreditsFor(inputTokens + outputTokens, servedRate),
          // A paid hold is charged only when a paid model answered: a fallback to a free model costs no tokens.
          ...(reservation.paid === undefined ? {} : { tokenCharge: failed || !isPaidModel(served.model, config.paid) ? 0 : inputTokens + outputTokens }) };
        if (metric !== null) {
          metric.finishedAt ??= deps.clock.now();
          metric.inputTokens = inputTokens; metric.outputTokens = outputTokens; metric.costMicros = result.costMicros; metric.estimated = !failed && result.estimated;
          metric.toolCalls = observer.toolCalls.size; metric.finishReason = observer.finishReason;
        }
        try { await deps.store.settleTagflow(reservation.id, result); }
        catch (error) { settlementFailed = true; throw error; }
        settled = true;
        })();
        void settling.then(() => { settling = null; }, () => { settling = null; });
        return settling;
      };
      const onAbort = (): void => abort.abort();
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) abort.abort();
      /*
       * Three clocks, not one. A single 180-second limit from the start of the request cut 420
       * answers in three days (2026-10-18 to -21) mid-stream, at exactly 180.0 s, while tokens were
       * still arriving - long max-effort answers, every one charged in full and reported as
       * "terminated". Now a provider has `firstMs` to start answering; once it is answering, the
       * stream lives as long as it keeps sending, cut only after `idleMs` of silence, and never
       * beyond `maxMs`.
       */
      const clocks = { ...RELAY_TIMEOUTS, ...deps.timeouts };
      let timeout = setTimeout(() => abort.abort(), clocks.firstMs);
      const hardStop = setTimeout(() => abort.abort(), clocks.maxMs);
      const stillSending = (): void => { clearTimeout(timeout); timeout = setTimeout(() => abort.abort(), clocks.idleMs); };
      const cleanup = (): void => { clearTimeout(timeout); clearTimeout(hardStop); request.signal.removeEventListener("abort", onAbort); };
      /**
       * Hand the request to a fallback model. The chosen model's attempt is finished as what it
       * was - refused, or skipped while cooling - so its own figures stay honest, and the answer is
       * recorded as a new request against the model that gave it. The header lets the desktop say so.
       */
      const switchTo = async (fallback: NonNullable<ReturnType<typeof fallbackFor>>, outcome: ModelRequestOutcome, code: string): Promise<void> => {
        if (metric !== null) {
          void finishMetric(outcome, code);
          const model = fallback.parsed.model;
          metric = { ...metric, id: randomUUID(), modelId: model.id, modelName: model.name, provider: modelProvider(model), upstreamModel: model.upstreamModel ?? model.id, contextWindow: model.contextWindow,
            requestedOutput: fallback.parsed.output, estimatedInput: fallback.parsed.contextInput, providerStartedAt: deps.clock.now(), finishedAt: null, outcome: "pending", errorCode: null, upstreamStatus: null, durationMs: null, firstTokenMs: null };
          metricFinished = false;
          headers["x-adcode-request-id"] = metric.id;
          void writeMetric();
        }
        headers["x-adcode-fallback-model"] = fallback.parsed.model.id;
        route = fallback.route; served = fallback.parsed; servedRate = modelCreditRate(fallback.parsed.model, config);
      };
      const retryRateLimit = async (response: Response): Promise<Response> => {
        let current = response;
        // A provider's 429 is usually a burst limit, not a quota: on 2026-10-20 one included model
        // refused 21% of requests with 429 while answering thousands beside them. Two short waits
        // (the provider's Retry-After when it asks for under 4 s) turn most into an answer.
        for (const wait of deps.rateLimitWaitsMs ?? UPSTREAM_RATE_LIMIT_WAITS_MS) {
          if (current.status !== 429 || abort.signal.aborted) break;
          const asked = Number(current.headers.get("retry-after"));
          await current.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, Number.isFinite(asked) && asked > 0 && asked <= 4 && wait > 0 ? asked * 1000 : wait));
          if (abort.signal.aborted) break;
          current = await route.send();
        }
        return current;
      };
      let upstream: Response;
      try {
        // Recorded with the finished request; a write of its own would sit in front of the provider.
        if (metric !== null) metric.providerStartedAt = deps.clock.now();
        const body = raw as Record<string, unknown>;
        // A model that keeps refusing is cooling: skip it rather than make this person wait to be refused.
        if (health.cooling(parsed.model.id, deps.clock.now())) {
          const fallback = fallbackFor(config, body, parsed, rate, abort.signal, deps.clock.now());
          if (fallback !== null) await switchTo(fallback, "rejected", "model-busy");
        }
        upstream = await route.send();
        // A saturated provider is slow to refuse - each 429 from GLM took ~16 s on 2026-10-21, so
        // two retries held people ~48 s before a backup that answers in ~3 s. With a backup to
        // hand, the first refusal moves on; the retries are for when nothing else can answer.
        const fallback = upstream.status === 429 && !abort.signal.aborted && served === parsed ? fallbackFor(config, body, parsed, rate, abort.signal, deps.clock.now()) : null;
        if (fallback === null) upstream = await retryRateLimit(upstream);
        if (upstream.status === 429 && !abort.signal.aborted) {
          health.strike(served.model.id, deps.clock.now());
          if (fallback !== null) {
            if (metric !== null) metric.upstreamStatus = 429;
            await upstream.body?.cancel();
            await switchTo(fallback, "provider_error", "upstream-rate-limit");
            upstream = await retryRateLimit(await route.send());
            if (upstream.status === 429) health.strike(served.model.id, deps.clock.now());
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const reason = abort.signal.aborted ? request.signal.aborted ? "request-ended" : "timeout"
          : /redirect/i.test(message) ? "redirect"
          : /header|ByteString/i.test(message) ? "key-format"
          : /certificate|TLS|SSL/i.test(message) ? "tls"
          : /cache mode/i.test(message) ? "cache-mode"
          : /different request|global scope|I\/O/i.test(message) ? "request-context"
          : /Illegal invocation|receiver/i.test(message) ? "fetch-binding"
          : /resolve|DNS/i.test(message) ? "dns" : "network";
        // Never log the upstream error message: malformed-header errors can contain a key.
        console.warn("Included AI connection failed", { provider: route.providerId, reason });
        cleanup(); await settle(); await finishMetric(reason === "request-ended" ? "cancelled" : ["key-format","cache-mode","request-context","fetch-binding"].includes(reason) ? "relay_error" : "provider_error",reason);
        const explanation = reason === "request-ended" ? "The request ended before the provider answered. Try again."
          : reason === "timeout" ? "The included AI provider took too long to answer. Try later."
          : reason === "key-format" ? "The server provider key has invalid formatting. Ask an administrator to update it."
          : reason === "redirect" ? "The provider redirected its API address. An administrator needs to update the saved endpoint."
          : reason === "cache-mode" || reason === "request-context" || reason === "fetch-binding" ? "The AI relay encountered a server configuration error. Ask an administrator to check the connection."
          : "The included AI provider could not be reached. Try another model or try later.";
        return fail(502, "upstream", explanation);
      }
      if (metric !== null) metric.upstreamStatus = upstream.status;
      if (!upstream.ok || upstream.body === null) {
        await upstream.body?.cancel(); cleanup(); await settle(!upstream.ok); await finishMetric("provider_error",upstream.status === 429 ? "upstream-rate-limit" : !upstream.ok ? "upstream-http" : "empty-response");
        if (upstream.status === 429) return fail(429, "upstream-rate-limit", "This free model's provider reached a temporary rate limit. Your credits may still have room. Try again shortly, or choose a different model.", { "retry-after": "60" }, { retryable:true });
        return fail(502, "upstream", "The included AI provider refused the request. Try another model or try later.");
      }
      health.answered(served.model.id);
      stillSending();
      if (parsed.body["stream"] === false) {
        try {
          const raw = await readJson(new Request("https://relay.invalid", { method: "POST", body: upstream.body, duplex: "half" } as RequestInit));
          observer.observe(raw);
          if (!isRecord(raw) || !Array.isArray(raw["choices"]) || raw["error"] !== undefined) { await settle(); await finishMetric("provider_error","invalid-response"); return fail(502, "upstream", "The included AI provider returned an invalid response."); }
          observer.completed = true;
          await settle(false, true); await finishMetric("success"); return json(200, raw);
        } catch {
          if (settlementFailed) { await finishMetric("relay_error","storage-settlement"); return fail(503,"unavailable","Included AI accounting is temporarily unavailable. Try again later."); }
          await settle(); await finishMetric("provider_error","invalid-response"); return fail(502, "upstream", "The included AI provider returned an invalid response.");
        }
        finally { cleanup(); }
      }
      if (!upstream.headers.get("content-type")?.includes("text/event-stream")) {
        await upstream.body.cancel(); cleanup(); await settle(); await finishMetric("provider_error","invalid-stream");
        return fail(502, "upstream", "The included AI provider did not return a chat stream.");
      }
      const reader = upstream.body.getReader();
      // Once headers have been sent, an AI failure belongs in the SSE protocol. Erroring
      // the response body rejects Next's pipeToNodeResponse and destroys its response;
      // the Workers bridge can then be left waiting for a response that never finishes.
      // The desktop already throws on data.error (including released 2.4.0 clients).
      const interrupted = new TextEncoder().encode(`data: ${JSON.stringify({ error: { code: "stream-interrupted", message: "Included AI stream interrupted. Try again or choose another model." } })}\n\n`);
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            for (;;) {
              const chunk = await reader.read();
              if (!chunk.done) stillSending();
              if (chunk.done) {
                const trailing = observer.finish();
                if (trailing !== null && !cancelled) controller.enqueue(trailing);
                await settle(false, true);
                await finishMetric(observer.completed ? "success" : "provider_error",observer.completed ? null : "incomplete-stream");
                cleanup(); reader.releaseLock();
                if (!cancelled) {
                  if (!observer.completed) controller.enqueue(interrupted);
                  controller.close();
                }
                break;
              }
              const safe = observer.push(chunk.value);
              if (safe !== null) { controller.enqueue(safe); break; }
            }
          } catch {
            abort.abort(); cleanup(); await reader.cancel().catch(() => undefined);
            await settle().catch(() => undefined);
            await finishMetric(settlementFailed ? "relay_error" : request.signal.aborted ? "cancelled" : "provider_error",settlementFailed ? "storage-settlement" : request.signal.aborted ? "request-ended" : "stream-interrupted");
            reader.releaseLock();
            if (!cancelled) { controller.enqueue(interrupted); controller.close(); }
          }
        },
        async cancel() { cancelled = true; abort.abort(); cleanup(); await reader.cancel().catch(() => undefined); await settle().catch(() => undefined); await finishMetric(settlementFailed ? "relay_error" : "cancelled",settlementFailed ? "storage-settlement" : "request-ended"); },
      });
      return new Response(stream, { headers: { ...headers, "content-type": "text/event-stream", "x-accel-buffering": "no" } });
    } catch (error) {
      await finishMetric("relay_error","storage-or-relay");
      if (error instanceof SyntaxError || error instanceof URIError) return fail(400, "bad-request", "Send a valid request.");
      // Over 1 MB is past every included model's context window, so waiting or retrying cannot help.
      if (error instanceof Error && error.message === "body-too-large") return fail(413, "body-too-large", "This conversation is larger than any included model can read. Compact it (type /compact) or start a new conversation.");
      return fail(503, "unavailable", "Included AI is temporarily unavailable. Try another connected model.");
    }
  };
}
