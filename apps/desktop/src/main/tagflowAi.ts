import { join } from "node:path";
import { app } from "electron";
import { createOpenAiCompatibleProvider, recoverIncludedLimits, type CatalogueProvider, type Provider } from "@adcode/ai";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, createBackendTokens } from "./backend.ts";
import type { TagflowAllowanceView, TagflowFeedbackInput, TagflowFeedbackResult } from "../shared/tagflow.ts";
import { AUDIENCE_ROLES, AUDIENCE_EXPERIENCE, DECLARED_USES, includedAiPersona, includedTokenError, type TagflowAudienceInput, type TagflowAudienceResult } from "../shared/tagflow.ts";
import { reportedPlatform } from "../shared/reportedPlatform.ts";

let offered: CatalogueProvider | null = null;
let defaultModel = "";
let refreshedAt = 0;
let refreshing: Promise<void> | null = null;
export const tagflowCatalogue = (): CatalogueProvider | null => offered;
export const tagflowDefaultModel = (): string => defaultModel;

/** The server publishes offered models, never the upstream URL or provider credential. */
export function refreshTagflowModels(force = false): Promise<void> {
  if (refreshing !== null) return refreshing;
  if (!force && Date.now() - refreshedAt < 300_000) return Promise.resolve();
  refreshedAt = Date.now();
  refreshing = (async () => {
    try {
      const response = await fetch(`${apiBaseUrl()}/ai/tagflow/config`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return;
      const raw: unknown = await response.json();
      if (typeof raw !== "object" || raw === null) return;
      const config = raw as { available?: unknown; defaultModel?: unknown; models?: unknown; paid?: { enabled?: unknown; freeWeeklyTokens?: unknown } };
      const freeWeekly = config.paid?.enabled === true && typeof config.paid.freeWeeklyTokens === "number" ? config.paid.freeWeeklyTokens : null;
      if (config.available !== true) { offered = null; defaultModel = ""; return; }
      if (typeof config.defaultModel !== "string" || !Array.isArray(config.models)) return;
      const models: CatalogueProvider["models"][number][] = [];
      for (const rawModel of config.models.slice(0, 50)) {
        if (typeof rawModel !== "object" || rawModel === null) continue;
        const model = rawModel as Record<string, unknown>;
        if (typeof model["id"] !== "string" || typeof model["name"] !== "string" || typeof model["contextWindow"] !== "number" || typeof model["maxOutput"] !== "number" ||
          !Number.isSafeInteger(model["contextWindow"]) || model["contextWindow"] < 1 || !Number.isSafeInteger(model["maxOutput"]) || model["maxOutput"] < 1) continue;
        const source = typeof model["providerName"] === "string" ? ` from ${model["providerName"]}` : "";
        // Older relays send no rate: every model then costs the standard credit.
        const rate = typeof model["creditRate"] === "number" && Number.isFinite(model["creditRate"]) && model["creditRate"] >= 0 ? model["creditRate"] : 1;
        // A paid provider's model (relays from 2026-10-21) says what it costs once the free week is spent.
        const cost = model["paid"] === true && freeWeekly !== null ? `${Math.round(freeWeekly / 1_000_000)}M free tokens a week, then purchased tokens`
          : rate === 0 ? "free, no credits used" : rate === 1 ? "uses your free AI credits" : `uses ${rate < 1 ? "fewer" : "more"} credits (${rate}× the standard rate)`;
        models.push({ id: model["id"], name: model["name"], toolCall: true, reasoning: false, contextWindow: model["contextWindow"], maxOutput: model["maxOutput"], inputs: ["text"], outputs: ["text"], inputCostMicrosPerMillion: 0, outputCostMicrosPerMillion: 0, note: `Included${source} · ${cost}` });
      }
      if (!models.some((model) => model.id === config.defaultModel)) return;
      offered = { id: "tagflow", name: "Included AI", env: [], doc: "https://adcode.bluethenics.com/docs/ai-tagflow", models };
      defaultModel = config.defaultModel;
    } catch { /* Offline: the server still checks availability on every request. */ }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function token(): Promise<string> {
  const provider = createBackendTokens({ http: new FetchHttpTransport([]), clock: new SystemClock(), store: new DiskFileStore(join(app.getPath("userData"), "ads")) });
  const result = await provider.getToken();
  if (!result.ok) throw includedTokenError(result.error.detail);
  return result.value;
}

/** Refresh the Firebase credential on each provider request, including long agent runs. */
export async function buildTagflowProvider(source = "unknown", onRequest?: (requestId: string) => void, roleId?: string): Promise<Provider | null> {
  await refreshTagflowModels();
  if (offered === null) return null;
  let account: string | undefined;
  const provider = createOpenAiCompatibleProvider({ id: "tagflow", displayName: offered.name, baseUrl: `${apiBaseUrl()}/ai/tagflow`, apiKey: "", models: offered.models.map((model) => model.id),
    traits: (id) => { const model = offered?.models.find((one) => one.id === id); return model === undefined ? undefined : { reasoning: false, effortLevels: [], contextWindow: model.contextWindow ?? null, maxOutput: model.maxOutput ?? null }; },
    fetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      init?.signal?.throwIfAborted();
      const credential = await token();
      // Refreshing a token is expected; changing the signed-in account ends this task.
      let identity = credential;
      try {
        const claims = JSON.parse(Buffer.from(credential.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: unknown };
        if (typeof claims.sub === "string") identity = claims.sub;
      } catch { /* Local development can use a stable opaque token. */ }
      if (account !== undefined && account !== identity) throw new Error("The signed-in account changed. Start this task again with the current account.");
      account = identity;
      headers.set("authorization", `Bearer ${credential}`);
      headers.set("x-adcode-ai-source",source);
      headers.set("x-adcode-ai-persona",includedAiPersona(source,roleId));
      headers.set("x-adcode-platform",reportedPlatform(process.env,process.platform));
      const response = await fetch(input, { ...init, headers });
      const requestId = response.headers.get("x-adcode-request-id");
      if (requestId !== null && /^[0-9a-f-]{36}$/i.test(requestId)) onRequest?.(requestId);
      return response;
    },
  });
  // A completion, edit preview or connection test must not remain pending overnight.
  return source === "chat" || source === "agent" ? recoverIncludedLimits(provider) : provider;
}

/** Optional survey; the server binds it to the signed-in account. No conversation is attached. */
export async function tagflowAudience(raw?: unknown): Promise<TagflowAudienceResult> {
  if (raw !== undefined) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok:false,message:"Choose a valid profile." };
    const input = raw as TagflowAudienceInput;
    if (Object.keys(raw).some(key => !["role","experience","primaryUse","consent"].includes(key)) || typeof input.consent !== "boolean" || !AUDIENCE_ROLES.includes(input.role) || !AUDIENCE_EXPERIENCE.includes(input.experience) || !DECLARED_USES.includes(input.primaryUse)) return { ok:false,message:"Choose a supported role, experience and purpose." };
  }
  try {
    const response = await fetch(`${apiBaseUrl()}/ai/tagflow/audience`,{ method:raw === undefined ? "GET" : "POST",headers:{ authorization:`Bearer ${await token()}`,"content-type":"application/json" },...(raw === undefined ? {} : { body:JSON.stringify(raw) }),signal:AbortSignal.timeout(10_000) });
    const result = await response.json() as { profile?: TagflowAudienceInput | null; error?: { message?: string } };
    if (!response.ok) return { ok:false,message:result.error?.message ?? "Your profile could not be saved." };
    return { ok:true,profile:raw === undefined ? result.profile ?? null : (raw as TagflowAudienceInput).consent ? raw as TagflowAudienceInput : null };
  } catch { return { ok:false,message:"Your profile could not be read or saved. Check your connection and try again." }; }
}

/** Submit only deliberately entered feedback, tied to a server-owned request. */
export async function submitTagflowFeedback(raw: unknown): Promise<TagflowFeedbackResult> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, message: "Choose a response to rate." };
  const input = raw as TagflowFeedbackInput;
  if (Object.keys(raw).some(key => !["requestId","rating","category","comment","shareWithProvider"].includes(key)) || typeof input.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId) || ![null,"helpful","not-helpful"].includes(input.rating) || !["quality","instructions","tools","speed","reliability","other"].includes(input.category) || typeof input.comment !== "string" || input.comment.length > 2000 || typeof input.shareWithProvider !== "boolean") return { ok: false, message: "Choose a rating and category. Comments can be up to 2,000 characters." };
  try {
    const response = await fetch(`${apiBaseUrl()}/ai/tagflow/feedback`, { method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(10_000) });
    if (response.ok) return { ok: true };
    const result = await response.json() as { error?: { message?: string } };
    return { ok: false, message: result.error?.message ?? "Feedback could not be saved. Try again." };
  } catch { return { ok: false, message: "Feedback could not be saved. Check your connection and try again." }; }
}

export async function readTagflowAllowance(): Promise<TagflowAllowanceView | null> {
  try {
    const response = await fetch(`${apiBaseUrl()}/ai/tagflow/usage`, { headers: { authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    return await response.json() as TagflowAllowanceView;
  } catch { return null; }
}
