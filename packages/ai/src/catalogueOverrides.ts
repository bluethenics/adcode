/**
 * The admin panel's word on the model list, applied on top of the catalogue.
 *
 * Asked for: "if new models come up I want to update them from the admin panel". The
 * catalogue comes from models.dev, which can lag a launch by days and lists everything a
 * provider sells. The panel decides four things the catalogue cannot: which model each
 * provider starts on, which models to feature, which to hide (because they fail for real
 * users), and models to add before models.dev lists them. The server keeps that as one small
 * document (GET /v1/models/overrides); the app reads it on launch and applies it here, so a
 * change in the panel reaches everybody without a release.
 *
 * Pure, and forgiving: this is JSON from the network, and a document that is not what it
 * claims to be means no overrides, never a broken model list.
 */
import { RECOMMENDED_MODELS } from "./catalogue.ts";
import type { CatalogueModel, CatalogueProvider } from "./catalogueTypes.ts";

export interface AddedModel {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly contextWindow?: number;
  readonly maxOutput?: number;
  readonly reasoning?: boolean;
  readonly effortLevels?: readonly string[];
  /** USD per million tokens. */
  readonly inputPrice?: number;
  readonly outputPrice?: number;
  readonly releaseDate?: string;
}

export interface CatalogueOverrides {
  /** provider id -> the model it starts on. */
  readonly recommended: Readonly<Record<string, string>>;
  /** "provider:model" keys. */
  readonly hidden: readonly string[];
  readonly featured: readonly string[];
  /** "provider:model" -> one line shown with the model. */
  readonly notes: Readonly<Record<string, string>>;
  readonly added: readonly AddedModel[];
  /** How Tag Flow AI is offered; the defaults when the panel never saved any. */
  readonly tagflow: TagflowClientSettings;
}

/**
 * The part of the panel's Tag Flow settings the app acts on. The limit and its window are
 * the relay's business: the app learns them from a 429 when they matter.
 */
export interface TagflowClientSettings {
  /** Off: the app stops offering Tag Flow, and a fresh install starts where it used to. */
  readonly enabled: boolean;
  /** At the limit, wait for the reset and continue the same turn. */
  readonly autoContinue: boolean;
  readonly privacyUrl: string;
  /** Null until Tag Flow publishes terms; the notice then links its site. */
  readonly termsUrl: string | null;
}

export const DEFAULT_TAGFLOW_CLIENT_SETTINGS: TagflowClientSettings = {
  enabled: true,
  autoContinue: true,
  privacyUrl: "https://tagflow-ai.com/legal/privacy",
  termsUrl: null,
};

export const EMPTY_OVERRIDES: CatalogueOverrides = { recommended: {}, hidden: [], featured: [], notes: {}, added: [], tagflow: DEFAULT_TAGFLOW_CLIENT_SETTINGS };

/** An https address, or null: these are links a person will click. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 400) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function parseTagflow(raw: unknown): TagflowClientSettings {
  if (!isRecord(raw)) return DEFAULT_TAGFLOW_CLIENT_SETTINGS;
  return {
    enabled: typeof raw["enabled"] === "boolean" ? raw["enabled"] : DEFAULT_TAGFLOW_CLIENT_SETTINGS.enabled,
    autoContinue: typeof raw["autoContinue"] === "boolean" ? raw["autoContinue"] : DEFAULT_TAGFLOW_CLIENT_SETTINGS.autoContinue,
    privacyUrl: httpsUrl(raw["privacyUrl"]) ?? DEFAULT_TAGFLOW_CLIENT_SETTINGS.privacyUrl,
    termsUrl: httpsUrl(raw["termsUrl"]),
  };
}

const MAX_KEYS = 2000;
const MAX_ADDED = 200;
const MAX_NOTE = 140;

/** "provider:model" - provider ids never contain a colon; model ids often do (`qwen2.5:7b`). */
export const modelKey = (provider: string, model: string): string => `${provider}:${model}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\s\0]/.test(value);

const isKey = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 260) return false;
  const colon = value.indexOf(":");
  return colon > 0 && colon < value.length - 1 && isId(value.slice(0, colon)) && isId(value.slice(colon + 1));
};

const positiveInt = (value: unknown, max: number): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max ? value : undefined;

const price = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : undefined;

function parseAdded(raw: unknown): AddedModel | null {
  if (!isRecord(raw) || !isId(raw["provider"]) || !isId(raw["id"])) return null;
  const name = typeof raw["name"] === "string" && raw["name"].trim().length > 0 ? raw["name"].trim().slice(0, 120) : raw["id"];
  const levels = Array.isArray(raw["effortLevels"])
    ? raw["effortLevels"].filter((one): one is string => typeof one === "string" && /^[a-z]{1,12}$/.test(one)).slice(0, 8)
    : [];
  const contextWindow = positiveInt(raw["contextWindow"], 1_000_000_000);
  const maxOutput = positiveInt(raw["maxOutput"], 1_000_000_000);
  const inputPrice = price(raw["inputPrice"]);
  const outputPrice = price(raw["outputPrice"]);
  const releaseDate = typeof raw["releaseDate"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw["releaseDate"]) ? raw["releaseDate"] : undefined;
  return {
    provider: raw["provider"],
    id: raw["id"],
    name,
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxOutput === undefined ? {} : { maxOutput }),
    ...(raw["reasoning"] === true ? { reasoning: true } : {}),
    ...(levels.length === 0 ? {} : { effortLevels: levels }),
    ...(inputPrice === undefined ? {} : { inputPrice }),
    ...(outputPrice === undefined ? {} : { outputPrice }),
    ...(releaseDate === undefined ? {} : { releaseDate }),
  };
}

export function parseOverrides(raw: unknown): CatalogueOverrides {
  if (!isRecord(raw)) return EMPTY_OVERRIDES;

  const recommended: Record<string, string> = {};
  if (isRecord(raw["recommended"])) {
    for (const [provider, model] of Object.entries(raw["recommended"]).slice(0, 100)) {
      if (isId(provider) && isId(model)) recommended[provider] = model;
    }
  }
  const keys = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isKey).slice(0, MAX_KEYS) : []);
  const notes: Record<string, string> = {};
  if (isRecord(raw["notes"])) {
    for (const [key, note] of Object.entries(raw["notes"]).slice(0, MAX_KEYS)) {
      if (isKey(key) && typeof note === "string" && note.trim().length > 0) notes[key] = note.trim().slice(0, MAX_NOTE);
    }
  }
  const added = Array.isArray(raw["added"])
    ? raw["added"].map(parseAdded).filter((one): one is AddedModel => one !== null).slice(0, MAX_ADDED)
    : [];

  return { recommended, hidden: keys(raw["hidden"]), featured: keys(raw["featured"]), notes, added, tagflow: parseTagflow(raw["tagflow"]) };
}

function fromAdded(added: AddedModel): CatalogueModel {
  const micros = (dollars: number | undefined): number | null => (dollars === undefined ? null : Math.round(dollars * 1_000_000));
  return {
    id: added.id,
    name: added.name,
    // An added model is one somebody chose to put in front of people as an assistant.
    toolCall: true,
    reasoning: added.reasoning === true,
    inputCostMicrosPerMillion: micros(added.inputPrice),
    outputCostMicrosPerMillion: micros(added.outputPrice),
    cacheReadCostMicrosPerMillion: null,
    cacheWriteCostMicrosPerMillion: null,
    contextWindow: added.contextWindow ?? null,
    ...(added.maxOutput === undefined ? {} : { maxOutput: added.maxOutput }),
    ...(added.effortLevels === undefined ? {} : { effortLevels: added.effortLevels }),
    ...(added.releaseDate === undefined ? {} : { releaseDate: added.releaseDate }),
  };
}

/** The catalogue as the admin panel says it should read. Unchanged with no overrides. */
export function applyOverrides(catalogue: readonly CatalogueProvider[], overrides: CatalogueOverrides): CatalogueProvider[] {
  const hidden = new Set(overrides.hidden);
  const featured = new Set(overrides.featured);
  const nothing = hidden.size === 0 && featured.size === 0 && Object.keys(overrides.notes).length === 0 && overrides.added.length === 0;
  if (nothing) return [...catalogue];

  return catalogue.map((provider) => {
    const known = new Set(provider.models.map((model) => model.id));
    // Added first, as the newest thing on the list; skipped once models.dev lists it too.
    const added = overrides.added
      .filter((one) => one.provider === provider.id && !known.has(one.id))
      .map(fromAdded);
    const models = [...added, ...provider.models]
      .filter((model) => !hidden.has(modelKey(provider.id, model.id)))
      .map((model) => {
        const key = modelKey(provider.id, model.id);
        const note = overrides.notes[key];
        return featured.has(key) || note !== undefined
          ? { ...model, ...(featured.has(key) ? { featured: true } : {}), ...(note === undefined ? {} : { note }) }
          : model;
      });
    // Featured ones move up, keeping their order otherwise.
    const ordered = [...models.filter((model) => model.featured === true), ...models.filter((model) => model.featured !== true)];
    return { ...provider, models: ordered };
  });
}

/** The recommended-model preferences with the panel's choice ahead of the built-in list. */
export function preferencesWith(overrides: CatalogueOverrides): Record<string, readonly string[]> {
  const preferences: Record<string, readonly string[]> = { ...RECOMMENDED_MODELS };
  for (const [provider, model] of Object.entries(overrides.recommended)) {
    preferences[provider] = [model, ...(RECOMMENDED_MODELS[provider] ?? []).filter((one) => one !== model)];
  }
  return preferences;
}
