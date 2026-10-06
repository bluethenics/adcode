/**
 * The model list, curated from the admin panel.
 *
 * Asked for: "if new models come up I want to update them from the admin panel". The desktop
 * app's catalogue comes from models.dev, which can lag a launch by days and lists everything a
 * provider sells. This one small document says what models.dev cannot: which model each
 * provider starts on, which to feature, which to hide (because they fail for real users), a
 * line about a model, and models to add before models.dev lists them.
 *
 * The app reads it on launch (GET /v1/models/overrides) and applies it to its own list, so a
 * change in the panel reaches every editor without a release. Saving is admin-only, audited,
 * and refuses a malformed document outright: this reaches everybody. The desktop parses it
 * again on its side (`packages/ai/src/catalogueOverrides.ts`), forgivingly - a bad document
 * there means no overrides, never a broken list.
 */
import type { AuditRecord } from "./store.ts";

export interface AddedModel {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  maxOutput?: number;
  reasoning?: boolean;
  effortLevels?: string[];
  /** USD per million tokens. */
  inputPrice?: number;
  outputPrice?: number;
  releaseDate?: string;
}

export interface ModelCatalog {
  /** provider id -> the model it starts on. */
  recommended: Record<string, string>;
  /** "provider:model" keys. */
  hidden: string[];
  featured: string[];
  /** "provider:model" -> one line shown with the model. */
  notes: Record<string, string>;
  added: AddedModel[];
}

export interface ModelCatalogRecord {
  overrides: ModelCatalog;
  updatedAt: number;
  updatedBy: string;
}

export const EMPTY_MODEL_CATALOG: ModelCatalog = { recommended: {}, hidden: [], featured: [], notes: {}, added: [] };

const MAX_KEYS = 2000;
const MAX_ADDED = 200;
const MAX_NOTE = 140;
const KNOWN_FIELDS = new Set(["recommended", "hidden", "featured", "notes", "added"]);
const ADDED_FIELDS = new Set(["provider", "id", "name", "contextWindow", "maxOutput", "reasoning", "effortLevels", "inputPrice", "outputPrice", "releaseDate"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\s\0]/.test(value);

/** "provider:model" - provider ids never contain a colon; model ids often do. */
const isKey = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 260) return false;
  const colon = value.indexOf(":");
  return colon > 0 && colon < value.length - 1 && isId(value.slice(0, colon)) && isId(value.slice(colon + 1));
};

const positiveInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000;

const price = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10_000;

function parseAdded(raw: unknown): AddedModel | null {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !ADDED_FIELDS.has(key))) return null;
  const { provider, id, name, contextWindow, maxOutput, reasoning, effortLevels, inputPrice, outputPrice, releaseDate } = raw;
  if (!isId(provider) || !isId(id) || typeof name !== "string" || name.trim().length === 0 || name.length > 120) return null;
  if (contextWindow !== undefined && !positiveInt(contextWindow)) return null;
  if (maxOutput !== undefined && !positiveInt(maxOutput)) return null;
  if (reasoning !== undefined && typeof reasoning !== "boolean") return null;
  if (effortLevels !== undefined && !(Array.isArray(effortLevels) && effortLevels.length <= 8 && effortLevels.every((one) => typeof one === "string" && /^[a-z]{1,12}$/.test(one)))) return null;
  if (inputPrice !== undefined && !price(inputPrice)) return null;
  if (outputPrice !== undefined && !price(outputPrice)) return null;
  if (releaseDate !== undefined && !(typeof releaseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate))) return null;
  return {
    provider,
    id,
    name: name.trim(),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxOutput === undefined ? {} : { maxOutput }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(effortLevels === undefined ? {} : { effortLevels: effortLevels as string[] }),
    ...(inputPrice === undefined ? {} : { inputPrice }),
    ...(outputPrice === undefined ? {} : { outputPrice }),
    ...(releaseDate === undefined ? {} : { releaseDate }),
  };
}

/** The document, or null when any part of it is not what it should be. */
export function parseModelCatalog(raw: unknown): ModelCatalog | null {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !KNOWN_FIELDS.has(key))) return null;

  const recommended: Record<string, string> = {};
  if (raw["recommended"] !== undefined) {
    if (!isRecord(raw["recommended"]) || Object.keys(raw["recommended"]).length > 100) return null;
    for (const [provider, model] of Object.entries(raw["recommended"])) {
      if (!isId(provider) || !isId(model)) return null;
      recommended[provider] = model;
    }
  }

  const keys = (value: unknown): string[] | null => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_KEYS || !value.every(isKey)) return null;
    return [...new Set(value as string[])];
  };
  const hidden = keys(raw["hidden"]);
  const featured = keys(raw["featured"]);
  if (hidden === null || featured === null) return null;

  const notes: Record<string, string> = {};
  if (raw["notes"] !== undefined) {
    if (!isRecord(raw["notes"]) || Object.keys(raw["notes"]).length > MAX_KEYS) return null;
    for (const [key, note] of Object.entries(raw["notes"])) {
      if (!isKey(key) || typeof note !== "string" || note.length > MAX_NOTE) return null;
      if (note.trim().length > 0) notes[key] = note.trim();
    }
  }

  const added: AddedModel[] = [];
  if (raw["added"] !== undefined) {
    if (!Array.isArray(raw["added"]) || raw["added"].length > MAX_ADDED) return null;
    for (const entry of raw["added"]) {
      const parsed = parseAdded(entry);
      if (parsed === null) return null;
      added.push(parsed);
    }
  }

  return { recommended, hidden, featured, notes, added };
}

export interface ModelCatalogStore {
  getModelCatalog(): Promise<ModelCatalogRecord | null>;
  putModelCatalog(record: ModelCatalogRecord): Promise<void>;
  writeAudit(record: AuditRecord): Promise<void>;
}

/** What the public read and the admin panel both start from. */
export async function readModelCatalog(store: ModelCatalogStore): Promise<ModelCatalogRecord> {
  return (await store.getModelCatalog()) ?? { overrides: EMPTY_MODEL_CATALOG, updatedAt: 0, updatedBy: "" };
}

export async function saveModelCatalog(
  deps: { store: ModelCatalogStore; clock: { now(): number } },
  adminUid: string,
  overrides: ModelCatalog,
): Promise<ModelCatalogRecord> {
  const at = deps.clock.now();
  const record: ModelCatalogRecord = { overrides, updatedAt: at, updatedBy: adminUid };
  await deps.store.putModelCatalog(record);
  await deps.store.writeAudit({ adminUid, action: "save-model-catalog", subjectUid: "*", at });
  return record;
}
