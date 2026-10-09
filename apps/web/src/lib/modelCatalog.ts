/**
 * The admin Models page's view of the model list.
 *
 * Asked for: "if new models come up I want to update them from the admin panel". The panel
 * reads models.dev in the browser (it allows any origin), cuts it the way the editor does -
 * providers ADCode can reach, models that write text and call tools, not retired, not
 * Responses-only on OpenAI - and edits one small document of overrides that every editor reads
 * on launch (GET /v1/models/overrides).
 *
 * The cut is a copy of `usableCatalogue` in packages/ai: the site cannot import the editor's
 * packages. It decides only what the panel lists; the editor applies its own copy of the rules
 * to whatever it shows, so a drift here costs an admin a row, never a user a broken model.
 */

/** Providers the editor can address: a native client, or a known OpenAI-compatible address. */
export const REACHABLE_PROVIDERS = ["anthropic", "openai", "google", "openrouter", "groq", "mistral", "deepseek", "xai", "together", "fireworks-ai", "cerebras"];

export interface PanelModel {
  id: string;
  name: string;
  releaseDate: string | null;
  contextWindow: number | null;
  maxOutput: number | null;
  /** USD per million tokens. */
  inputPrice: number | null;
  outputPrice: number | null;
  reasoning: boolean;
  effortLevels: string[];
}

export interface PanelProvider {
  id: string;
  name: string;
  models: PanelModel[];
}

export interface AddedModel {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  maxOutput?: number;
  reasoning?: boolean;
  effortLevels?: string[];
  inputPrice?: number;
  outputPrice?: number;
  releaseDate?: string;
}

/** The document the server stores; see services/api/src/modelCatalog.ts. */
export interface ModelOverrides {
  recommended: Record<string, string>;
  hidden: string[];
  featured: string[];
  notes: Record<string, string>;
  added: AddedModel[];
  /** Tag Flow AI, the built-in model; absent until the panel first saves it. */
  tagflow?: TagflowSettings;
}

export const EMPTY_MODEL_OVERRIDES: ModelOverrides = { recommended: {}, hidden: [], featured: [], notes: {}, added: [] };

/** How Tag Flow AI is offered. The server checks the same rules (services/api/src/modelCatalog.ts). */
export interface TagflowSettings {
  enabled: boolean;
  /** Requests per user per window; 0 is unlimited. */
  requestLimit: number;
  windowHours: number;
  /** Requests per minute across everybody together; 0 is unlimited. Protects the shared key. */
  globalRequestsPerMinute: number;
  autoContinue: boolean;
  privacyUrl: string;
  termsUrl: string;
}

export const DEFAULT_TAGFLOW_SETTINGS: TagflowSettings = {
  enabled: true,
  requestLimit: 0,
  windowHours: 5,
  globalRequestsPerMinute: 0,
  autoContinue: true,
  privacyUrl: "https://tagflow-ai.com/legal/privacy",
  termsUrl: "",
};

export const tagflowOf = (overrides: ModelOverrides): TagflowSettings => overrides.tagflow ?? DEFAULT_TAGFLOW_SETTINGS;

export function withTagflow(overrides: ModelOverrides, patch: Partial<TagflowSettings>): ModelOverrides {
  return { ...overrides, tagflow: { ...tagflowOf(overrides), ...patch } };
}

const isHttps = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** What the server would refuse, in words, or null. Checked before Save so a refusal is never a surprise. */
export function tagflowProblem(settings: TagflowSettings): string | null {
  if (!Number.isSafeInteger(settings.requestLimit) || settings.requestLimit < 0 || settings.requestLimit > 1_000_000) {
    return "The request limit is a whole number from 0 (unlimited) to 1,000,000.";
  }
  if (!Number.isSafeInteger(settings.windowHours) || settings.windowHours < 1 || settings.windowHours > 168) {
    return "The window is a whole number of hours, 1 to 168.";
  }
  if (!Number.isSafeInteger(settings.globalRequestsPerMinute) || settings.globalRequestsPerMinute < 0 || settings.globalRequestsPerMinute > 1_000_000) {
    return "The limit across everybody is a whole number of requests per minute, from 0 (unlimited) to 1,000,000.";
  }
  if (!isHttps(settings.privacyUrl)) return "The privacy policy link must be an https:// address.";
  if (settings.termsUrl !== "" && !isHttps(settings.termsUrl)) return "The terms link must be an https:// address, or empty.";
  return null;
}

/** "provider:model" - provider ids never contain a colon; model ids often do. */
export const modelKey = (provider: string, model: string): string => `${provider}:${model}`;

/** The list with `key` added, or without it when it was there. */
export function toggleKey(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter((one) => one !== key) : [...list, key];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const NOT_A_CHAT_MODEL =
  /(?:^|[-/._])(?:embed|embedding|embeddings|whisper|tts|transcribe|transcription|realtime|moderation|guard|computer-use|lyria|veo|imagen|image|audio|speech)(?:$|[-/._:])/i;

function usable(provider: string, model: Record<string, unknown>): boolean {
  if (model["tool_call"] !== true || model["status"] === "deprecated") return false;
  const id = typeof model["id"] === "string" ? model["id"] : "";
  if (id.length === 0 || NOT_A_CHAT_MODEL.test(id)) return false;
  const modalities = isRecord(model["modalities"]) ? model["modalities"] : {};
  const outputs = Array.isArray(modalities["output"]) ? modalities["output"] : ["text"];
  if (!outputs.every((kind) => kind === "text")) return false;
  const family = typeof model["family"] === "string" ? model["family"] : "";
  if (provider === "openai" && (["gpt-pro", "o-pro", "gpt-codex", "codex"].includes(family) || /(?:-pro|codex)(?:$|-)/i.test(id))) return false;
  return true;
}

const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

export function usableProviders(raw: unknown): PanelProvider[] {
  if (!isRecord(raw)) return [];
  const providers: PanelProvider[] = [];
  for (const id of REACHABLE_PROVIDERS) {
    const entry = raw[id];
    if (!isRecord(entry) || !isRecord(entry["models"])) continue;
    const models: PanelModel[] = [];
    for (const model of Object.values(entry["models"])) {
      if (!isRecord(model) || !usable(id, model)) continue;
      const limit = isRecord(model["limit"]) ? model["limit"] : {};
      const cost = isRecord(model["cost"]) ? model["cost"] : {};
      const effort = Array.isArray(model["reasoning_options"])
        ? model["reasoning_options"].find((option) => isRecord(option) && option["type"] === "effort")
        : undefined;
      models.push({
        id: String(model["id"]),
        name: typeof model["name"] === "string" && model["name"].length > 0 ? model["name"] : String(model["id"]),
        releaseDate: typeof model["release_date"] === "string" ? model["release_date"] : null,
        contextWindow: number(limit["context"]),
        maxOutput: number(limit["output"]),
        inputPrice: number(cost["input"]),
        outputPrice: number(cost["output"]),
        reasoning: model["reasoning"] === true,
        effortLevels: isRecord(effort) && Array.isArray(effort["values"]) ? effort["values"].filter((one): one is string => typeof one === "string") : [],
      });
    }
    if (models.length === 0) continue;
    models.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.name.localeCompare(b.name));
    providers.push({ id, name: typeof entry["name"] === "string" ? entry["name"] : id, models });
  }
  return providers;
}
