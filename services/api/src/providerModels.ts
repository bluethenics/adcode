/**
 * Models a provider submits on the website to go live in ADCode, once an administrator approves.
 *
 * The /providers application form (providerApplications.ts) starts a conversation. This is the
 * other half: a provider who already knows what they want offered fills in their endpoint, key
 * and each model's real limits and prices, and an administrator's single Approve puts them in the
 * model picker - no retyping into the catalogue editor, no key passed around by email.
 *
 * The key is encrypted the moment it arrives (adNetworkCrypto, bound to the submission's ID),
 * never shown back to anyone, written into the Worker's own secret store only on approval, and
 * erased from the database as soon as the submission is approved or declined.
 */
import type { TagflowConfig, TagflowModel } from "./tagflowTypes.ts";
import { MAX_CUSTOM_PROVIDERS, customProviderId, customProviderSecretName, isCustomProviderUrl, type CustomProvider, type CustomProviderId } from "./includedProviders.ts";
import { MAX_TAGFLOW_MODELS, parseTagflowConfig } from "./tagflowConfig.ts";
import type { EncryptedAdNetworkKey } from "./adNetworkConfig.ts";

export const SUBMISSION_BILLING = ["wallet", "included"] as const;
export type SubmissionBilling = (typeof SUBMISSION_BILLING)[number];
export const SUBMISSION_STATUSES = ["pending", "approved", "declined"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const MAX_SUBMITTED_MODELS = 20;

export interface SubmittedModel {
  /** The exact ID the provider's API expects. */
  readonly upstreamModel: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly maxOutput: number;
  /** USD per million tokens. */
  readonly inputPrice: number;
  readonly outputPrice: number;
  readonly cacheInputPrice?: number;
}

export interface ProviderModelInput {
  readonly company: string;
  readonly contactName: string;
  readonly email: string;
  readonly website: string;
  readonly apiBase: string;
  readonly authentication: "bearer" | "x-api-key";
  readonly billing: SubmissionBilling;
  readonly models: readonly SubmittedModel[];
  readonly message: string;
}

/** What an administrator sees: everything but the key, of which only the last four characters. */
export interface ProviderModelSubmission extends ProviderModelInput {
  readonly id: string;
  readonly status: SubmissionStatus;
  readonly receivedAt: number;
  readonly note: string;
  readonly keyHint: string;
  /** False once the key has been erased (after a decision). */
  readonly hasKey: boolean;
  readonly decidedAt: number | null;
  readonly decidedBy: string;
  /** The catalogue provider the approval created or reused. */
  readonly providerId: string;
}

export interface ProviderModelStore {
  add(submission: ProviderModelSubmission, key: EncryptedAdNetworkKey): Promise<void>;
  list(limit: number): Promise<ProviderModelSubmission[]>;
  get(id: string): Promise<{ submission: ProviderModelSubmission; key: EncryptedAdNetworkKey | null } | null>;
  /** Records the decision and erases the encrypted key. False when it was already decided. */
  decide(id: string, decision: { status: Exclude<SubmissionStatus, "pending">; note: string; decidedAt: number; decidedBy: string; providerId: string }): Promise<boolean>;
}

/** The ID a submission's key is encrypted under: it cannot be decrypted as any other record. */
export const submissionKeyId = (id: string): string => `provider-model:${id}`;

const KEYS = new Set(["company", "contactName", "email", "website", "apiBase", "apiKey", "authentication", "billing", "models", "message", "url2"]);
const MODEL_KEYS = new Set(["upstreamModel", "name", "contextWindow", "maxOutput", "inputPrice", "outputPrice", "cacheInputPrice"]);

const clean = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length <= max ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : null;
const whole = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const price = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10_000;
const httpsSite = (value: string): boolean => {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname.includes(".") && value.length <= 300; } catch { return false; }
};

export type ParsedSubmission =
  | { readonly ok: true; readonly value: ProviderModelInput; readonly apiKey: string }
  | { readonly ok: false; readonly error: string; readonly bot?: true };

/** A form submission, or the first thing wrong with it in words the form can show. */
export function parseProviderModels(raw: unknown): ParsedSubmission {
  const broken = { ok: false, error: "The form did not arrive. Try again." } as const;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return broken;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !KEYS.has(key))) return broken;
  if (typeof value["url2"] === "string" && value["url2"] !== "") return { ok: false, error: "spam", bot: true };
  const company = clean(value["company"], 120), contactName = clean(value["contactName"], 120), email = clean(value["email"], 254);
  const website = clean(value["website"], 300), message = clean(value["message"] ?? "", 2000);
  const apiBase = (clean(value["apiBase"], 300) ?? "").replace(/\/+$/, "");
  const apiKey = typeof value["apiKey"] === "string" ? value["apiKey"].trim() : "";
  if (!company) return { ok: false, error: "Add your company name." };
  if (!contactName) return { ok: false, error: "Add your name." };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "Add a work email we can reply to." };
  if (!website || !httpsSite(website)) return { ok: false, error: "Add your website, starting with https://." };
  if (!isCustomProviderUrl(apiBase)) return { ok: false, error: "Add your API base URL: a public https:// address, such as https://api.example.ai/v1." };
  if (!/^[\x21-\x7e]{8,4096}$/.test(apiKey)) return { ok: false, error: "Paste the whole API key ADCode should use: 8 to 4,096 visible characters, no spaces." };
  const authentication = value["authentication"] ?? "bearer";
  if (authentication !== "bearer" && authentication !== "x-api-key") return broken;
  const billing = value["billing"];
  if (!(SUBMISSION_BILLING as readonly unknown[]).includes(billing)) return { ok: false, error: "Choose how developers pay for your models." };
  const list = value["models"];
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: "Add at least one model." };
  if (list.length > MAX_SUBMITTED_MODELS) return { ok: false, error: `Submit up to ${MAX_SUBMITTED_MODELS} models at a time.` };
  const models: SubmittedModel[] = [];
  for (const [index, item] of list.entries()) {
    const at = `Model ${index + 1}`;
    if (typeof item !== "object" || item === null || Array.isArray(item) || Object.keys(item).some((key) => !MODEL_KEYS.has(key))) return broken;
    const row = item as Record<string, unknown>;
    const upstreamModel = clean(row["upstreamModel"], 200), name = clean(row["name"], 120);
    if (!upstreamModel || !/^[^\s]{1,200}$/.test(upstreamModel)) return { ok: false, error: `${at}: add the model ID exactly as your API names it, without spaces.` };
    if (models.some((one) => one.upstreamModel === upstreamModel)) return { ok: false, error: `${at}: ${upstreamModel} is listed twice.` };
    if (!name) return { ok: false, error: `${at}: add the name developers should see.` };
    if (!whole(row["contextWindow"], 1024, 10_000_000)) return { ok: false, error: `${at}: the context window must be a whole number of tokens, at least 1,024.` };
    if (!whole(row["maxOutput"], 256, 65_536) || row["maxOutput"] > row["contextWindow"]) return { ok: false, error: `${at}: the maximum output must be 256 to 65,536 tokens, and no more than the context window.` };
    if (!price(row["inputPrice"]) || !price(row["outputPrice"])) return { ok: false, error: `${at}: enter input and output prices in USD per million tokens.` };
    if (row["cacheInputPrice"] !== undefined && row["cacheInputPrice"] !== null && !price(row["cacheInputPrice"])) return { ok: false, error: `${at}: the cached input price must be a number of USD per million tokens, or empty.` };
    // A free model would be served as a missing price (paidTokens.ts): only Tagflow's are sponsored.
    if (row["inputPrice"] <= 0 || row["outputPrice"] <= 0) return { ok: false, error: `${at}: prices must be above zero. To sponsor free usage, apply on the main providers page instead.` };
    models.push({ upstreamModel, name, contextWindow: row["contextWindow"], maxOutput: row["maxOutput"], inputPrice: row["inputPrice"], outputPrice: row["outputPrice"],
      ...(typeof row["cacheInputPrice"] === "number" ? { cacheInputPrice: row["cacheInputPrice"] } : {}) });
  }
  return { ok: true, apiKey, value: { company, contactName, email: email.toLowerCase(), website, apiBase, authentication, billing: billing as SubmissionBilling, models, message: message ?? "" } };
}

export const keyHint = (key: string): string => key.length <= 8 ? "••••" : `••••${key.slice(-4)}`;

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "model";

export type ApprovalPlan =
  | { readonly ok: true; readonly config: TagflowConfig; readonly providerId: CustomProviderId; readonly secretName: string; readonly newProvider: boolean; readonly modelIds: readonly string[] }
  | { readonly ok: false; readonly error: string };

/**
 * The catalogue after approving a submission: its provider (reused when the same API address is
 * already registered) and its models, offered from today. Pure; the caller writes the key and saves.
 */
export function planApproval(config: TagflowConfig, submission: ProviderModelInput, today: string): ApprovalPlan {
  const providers = config.providers ?? [];
  const existing = providers.find((provider) => provider.baseUrl === submission.apiBase);
  if (existing === undefined && providers.length >= MAX_CUSTOM_PROVIDERS) return { ok: false, error: `The catalogue already has ${MAX_CUSTOM_PROVIDERS} custom providers. Remove one in Providers & keys first.` };
  if (config.models.length + submission.models.length > MAX_TAGFLOW_MODELS) return { ok: false, error: `This would take the catalogue past ${MAX_TAGFLOW_MODELS} models. Remove some in the Models view first.` };
  const providerId = existing?.id ?? customProviderId(submission.company, providers.map((provider) => provider.id));
  const provider: CustomProvider = existing ?? { id: providerId, name: submission.company, baseUrl: submission.apiBase, ...(submission.authentication === "bearer" ? {} : { authentication: submission.authentication }) };
  const taken = new Set(config.models.map((model) => model.id));
  const prefix = providerId.slice("custom-".length);
  const added: TagflowModel[] = submission.models.map((model) => {
    let id = `${prefix}-${slug(model.upstreamModel)}`.slice(0, 190);
    for (let n = 2; taken.has(id); n++) id = `${prefix}-${slug(model.upstreamModel)}-${n}`.slice(0, 190);
    taken.add(id);
    return {
      id, name: model.name, provider: providerId, upstreamModel: model.upstreamModel, enabled: true,
      contextWindow: model.contextWindow, maxOutput: model.maxOutput, inputPrice: model.inputPrice, outputPrice: model.outputPrice,
      ...(model.cacheInputPrice === undefined ? {} : { cacheInputPrice: model.cacheInputPrice }),
      ...(submission.billing === "wallet" ? { billing: "wallet" as const } : {}),
      releaseDate: today,
    };
  });
  const next = parseTagflowConfig({ ...config, providers: existing === undefined ? [...providers, provider] : providers, models: [...config.models, ...added] });
  if (next === null) return { ok: false, error: "These models do not fit the catalogue's rules. Open the submission's details and check each model's limits." };
  return { ok: true, config: next, providerId, secretName: customProviderSecretName(providerId), newProvider: existing === undefined, modelIds: added.map((model) => model.id) };
}

export function isSubmissionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
