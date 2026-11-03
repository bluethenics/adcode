import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUNDLED_CATALOGUE,
  baseUrlFor,
  parseCatalogue,
  recommendedModel,
  transportFor,
  usableCatalogue,
  type CatalogueModel,
  type CatalogueProvider,
} from "../../../../packages/ai/src/index.ts";
import type { ModelChoiceConfig } from "../config.ts";
import type { DesktopConnection, DesktopSnapshot } from "../desktop.ts";
import { environmentKey, envNamesFor } from "../keychain.ts";
import { cliPaths, ensureDir } from "../util/paths.ts";
import { fetchJson } from "../platform/http.ts";
import { apiOrigin } from "../account.ts";

/**
 * The models a terminal session can actually reach.
 *
 * The bundled catalogue answers instantly and offline; models.dev replaces it when the
 * network allows. Included AI and Ollama are layered on top because they are not entries
 * in models.dev - one is the account the person already signed in with, the other is a
 * process on this machine.
 */

export interface TagflowModelView {
  readonly id: string;
  readonly name: string;
  readonly providerName: string;
  readonly contextWindow: number;
  readonly maxOutput: number;
  readonly creditRate: number;
  readonly paid: boolean;
}

export interface TagflowConfigView {
  readonly available: boolean;
  readonly defaultModel: string;
  readonly models: readonly TagflowModelView[];
  readonly requiresVerifiedAccount: boolean;
  readonly credits: unknown;
  readonly fetchedAt: number;
}

export interface OllamaView {
  readonly running: boolean;
  readonly models: readonly string[];
  readonly detail: string;
}

export interface CliModel {
  readonly providerId: string;
  readonly providerName: string;
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly maxOutput: number;
  readonly reasoning: boolean;
  readonly effortLevels: readonly string[];
  readonly included: boolean;
  readonly costNote: string;
  readonly note: string | null;
}

export interface CliProvider {
  readonly id: string;
  readonly name: string;
  readonly models: readonly CliModel[];
  readonly ready: boolean;
  readonly keySource: "environment" | "desktop-keychain" | "included" | "local" | "missing" | "unavailable";
  readonly env: readonly string[];
  readonly doc: string | null;
  readonly included: boolean;
  readonly custom: boolean;
  readonly note: string | null;
  readonly baseUrl: string | null;
}

export type CatalogueSource = "bundled" | "live" | "cached";

export interface CatalogueSnapshot {
  readonly providers: readonly CliProvider[];
  readonly source: CatalogueSource;
  readonly refreshedAt: number | null;
  readonly tagflow: TagflowConfigView | null;
  readonly ollama: OllamaView;
  readonly liveError: string | null;
}

export interface ModelSelection {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly modelName: string;
  readonly ready: boolean;
  readonly reason: string | null;
  readonly choice: ModelChoiceConfig;
  readonly included: boolean;
}

const CACHE_FILE = "models-dev.json";
const TAGFLOW_CACHE_FILE = "tagflow.json";
const DEFAULT_CONTEXT = 131_072;
const DEFAULT_MAX_OUTPUT = 8_192;

function cacheDir(): string {
  return ensureDir(cliPaths.cache());
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  try {
    writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
  } catch {
    // A cache that cannot be written is still a working catalogue.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

export async function refreshLiveCatalogue(timeoutMs = 15_000): Promise<{ providers: readonly CatalogueProvider[]; error: string | null }> {
  try {
    const response = await fetchJson("https://models.dev/api.json", { timeoutMs });
    if (response.status < 200 || response.status >= 300) return { providers: [], error: `models.dev answered HTTP ${response.status}` };
    const live = usableCatalogue(parseCatalogue(response.body));
    if (live.length === 0) return { providers: [], error: "models.dev returned no usable models" };
    writeJson(join(cacheDir(), CACHE_FILE), { fetchedAt: Date.now(), raw: response.body });
    return { providers: live, error: null };
  } catch (error) {
    return { providers: [], error: error instanceof Error ? error.message : "models.dev was unreachable" };
  }
}

interface CachedCatalogue {
  readonly fetchedAt: number;
  readonly providers: readonly CatalogueProvider[];
}

function cachedCatalogue(): CachedCatalogue | null {
  const raw = readJson(join(cacheDir(), CACHE_FILE));
  if (!isRecord(raw) || typeof raw["fetchedAt"] !== "number" || !isRecord(raw["raw"])) return null;
  const providers = usableCatalogue(parseCatalogue(raw["raw"]));
  if (providers.length === 0) return null;
  return { fetchedAt: raw["fetchedAt"], providers };
}

export async function loadBaseCatalogue(options: { refresh?: boolean; timeoutMs?: number } = {}): Promise<{
  readonly providers: readonly CatalogueProvider[];
  readonly source: CatalogueSource;
  readonly refreshedAt: number | null;
  readonly error: string | null;
}> {
  if (options.refresh === true) {
    const live = await refreshLiveCatalogue(options.timeoutMs ?? 15_000);
    if (live.providers.length > 0) return { providers: live.providers, source: "live", refreshedAt: Date.now(), error: null };
    const cached = cachedCatalogue();
    if (cached !== null) return { providers: cached.providers, source: "cached", refreshedAt: cached.fetchedAt, error: live.error };
    return { providers: usableCatalogue(BUNDLED_CATALOGUE), source: "bundled", refreshedAt: null, error: live.error };
  }
  const cached = cachedCatalogue();
  if (cached !== null) return { providers: cached.providers, source: "cached", refreshedAt: cached.fetchedAt, error: null };
  return { providers: usableCatalogue(BUNDLED_CATALOGUE), source: "bundled", refreshedAt: null, error: null };
}

export async function fetchTagflowConfig(token: string | null, options: { timeoutMs?: number } = {}): Promise<TagflowConfigView | null> {
  const headers: Record<string, string> = {};
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  try {
    const response = await fetchJson(`${apiOrigin()}/v1/ai/tagflow/config`, {
      headers,
      timeoutMs: options.timeoutMs ?? 8_000,
    });
    if (response.status < 200 || response.status >= 300 || !isRecord(response.body)) return null;
    const body = response.body;
    const rawModels = Array.isArray(body["models"]) ? body["models"] : [];
    const models: TagflowModelView[] = [];
    for (const item of rawModels) {
      if (typeof item === "string") {
        models.push({
          id: item,
          name: item,
          providerName: "Included AI",
          contextWindow: DEFAULT_CONTEXT,
          maxOutput: 4_096,
          creditRate: 1,
          paid: false,
        });
        continue;
      }
      if (!isRecord(item) || typeof item["id"] !== "string") continue;
      models.push({
        id: item["id"],
        name: typeof item["name"] === "string" ? item["name"] : item["id"],
        providerName: typeof item["providerName"] === "string" ? item["providerName"] : "Included AI",
        contextWindow: num(item["contextWindow"], DEFAULT_CONTEXT),
        maxOutput: num(item["maxOutput"], 4_096),
        creditRate: typeof item["creditRate"] === "number" ? item["creditRate"] : 1,
        paid: item["paid"] === true,
      });
    }
    return {
      available: body["available"] === true,
      defaultModel: typeof body["defaultModel"] === "string" ? body["defaultModel"] : models[0]?.id ?? "",
      models,
      requiresVerifiedAccount: body["requiresVerifiedAccount"] !== false,
      credits: body["credits"] ?? null,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export function cachedTagflowConfig(): TagflowConfigView | null {
  const raw = readJson(join(cacheDir(), TAGFLOW_CACHE_FILE));
  if (!isRecord(raw)) return null;
  return fetchTagflowShape(raw);
}

function fetchTagflowShape(raw: Record<string, unknown>): TagflowConfigView | null {
  if (typeof raw["fetchedAt"] !== "number" || !Array.isArray(raw["models"])) return null;
  const models: TagflowModelView[] = [];
  for (const item of raw["models"]) {
    if (!isRecord(item) || typeof item["id"] !== "string") continue;
    models.push({
      id: item["id"],
      name: typeof item["name"] === "string" ? item["name"] : item["id"],
      providerName: typeof item["providerName"] === "string" ? item["providerName"] : "Included AI",
      contextWindow: num(item["contextWindow"], DEFAULT_CONTEXT),
      maxOutput: num(item["maxOutput"], 4_096),
      creditRate: typeof item["creditRate"] === "number" ? item["creditRate"] : 1,
      paid: item["paid"] === true,
    });
  }
  return {
    available: raw["available"] === true,
    defaultModel: typeof raw["defaultModel"] === "string" ? raw["defaultModel"] : "",
    models,
    requiresVerifiedAccount: raw["requiresVerifiedAccount"] !== false,
    credits: raw["credits"] ?? null,
    fetchedAt: raw["fetchedAt"],
  };
}

export function cacheTagflowConfig(config: TagflowConfigView | null): void {
  if (config === null) return;
  writeJson(join(cacheDir(), TAGFLOW_CACHE_FILE), config);
}

export async function probeOllama(timeoutMs = 1_200): Promise<OllamaView> {
  try {
    const response = await fetchJson("http://127.0.0.1:11434/api/tags", { timeoutMs });
    if (response.status !== 200 || !isRecord(response.body)) {
      return { running: false, models: [], detail: "not running" };
    }
    const raw = Array.isArray(response.body["models"]) ? response.body["models"] : [];
    const models = raw
      .map((item) => (isRecord(item) && typeof item["name"] === "string" ? item["name"] : null))
      .filter((name): name is string => name !== null)
      .sort((a, b) => a.localeCompare(b));
    return models.length > 0
      ? { running: true, models, detail: `${models.length} ${models.length === 1 ? "model" : "models"} ready` }
      : { running: true, models: [], detail: "running, no models installed" };
  } catch {
    return { running: false, models: [], detail: "not running" };
  }
}

function catalogueModelToCli(provider: CatalogueProvider, model: CatalogueModel): CliModel {
  const input = model.inputCostMicrosPerMillion ?? 0;
  const output = model.outputCostMicrosPerMillion ?? 0;
  const costNote = input === 0 && output === 0
    ? "No published price"
    : `$${(input / 1_000_000).toFixed(2)} / $${(output / 1_000_000).toFixed(2)} per M`;
  return {
    providerId: provider.id,
    providerName: provider.name,
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow ?? DEFAULT_CONTEXT,
    maxOutput: model.maxOutput ?? DEFAULT_MAX_OUTPUT,
    reasoning: model.reasoning,
    effortLevels: model.effortLevels ?? [],
    included: false,
    costNote,
    note: model.note ?? (model.status === "alpha" || model.status === "beta" ? model.status : null),
  };
}

function keyState(snapshot: DesktopSnapshot, provider: CatalogueProvider): { ready: boolean; source: CliProvider["keySource"] } {
  if (environmentKey(provider.id, provider.env) !== null) return { ready: true, source: "environment" };
  if (snapshot.keyIds.includes(provider.id)) return { ready: true, source: "desktop-keychain" };
  return { ready: false, source: "missing" };
}

function connectionProvider(connection: DesktopConnection, snapshot: DesktopSnapshot): CliProvider {
  const ready = environmentKey(connection.id) !== null || snapshot.keyIds.includes(connection.id);
  return {
    id: connection.id,
    name: connection.name,
    models: connection.model.length === 0 ? [] : [{
      providerId: connection.id,
      providerName: connection.name,
      id: connection.model,
      name: connection.model,
      contextWindow: DEFAULT_CONTEXT,
      maxOutput: DEFAULT_MAX_OUTPUT,
      reasoning: false,
      effortLevels: [],
      included: false,
      costNote: "Your connection",
      note: "Desktop connection",
    }],
    ready,
    keySource: ready ? (environmentKey(connection.id) !== null ? "environment" : "desktop-keychain") : "missing",
    env: [envNamesFor(connection.id)[0] ?? "ADCODE_CONNECTION_API_KEY"],
    doc: null,
    included: false,
    custom: true,
    note: connection.baseUrl,
    baseUrl: connection.baseUrl,
  };
}

export interface LoadCatalogueOptions {
  readonly snapshot: DesktopSnapshot;
  readonly tagflowToken?: string | null;
  readonly tagflow?: TagflowConfigView | null;
  readonly ollama?: OllamaView | null;
  readonly refresh?: boolean;
  readonly probeLocal?: boolean;
}

export async function loadCatalogue(options: LoadCatalogueOptions): Promise<CatalogueSnapshot> {
  const base = await loadBaseCatalogue({ refresh: options.refresh === true });
  const tagflow = options.tagflow !== undefined
    ? options.tagflow
    : cachedTagflowConfig() ?? (await fetchTagflowConfig(options.tagflowToken ?? null));
  if (tagflow !== null) cacheTagflowConfig(tagflow);
  const ollama = options.ollama ?? (options.probeLocal === false ? { running: false, models: [], detail: "not probed" } : await probeOllama());

  const providers: CliProvider[] = [];

  if (tagflow !== null) {
    const models = tagflow.models.map((model): CliModel => ({
      providerId: "tagflow",
      providerName: "Included AI",
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxOutput: model.maxOutput,
      reasoning: false,
      effortLevels: [],
      included: true,
      costNote: model.creditRate === 0 ? "Free, no credits" : `${model.creditRate} credit${model.creditRate === 1 ? "" : "s"} per 1k`,
      note: `Included AI · ${model.providerName}${model.paid ? " · paid after free week" : ""}`,
    }));
    providers.push({
      id: "tagflow",
      name: "Included AI",
      models,
      ready: tagflow.available && models.length > 0,
      keySource: tagflow.available && models.length > 0 ? "included" : "unavailable",
      env: [],
      doc: "https://adcode.bluethenics.com/docs/ai-tagflow",
      included: true,
      custom: false,
      note: tagflow.available
        ? `${models.length} ${models.length === 1 ? "model" : "models"} · one account, no API key`
        : "Included AI is unavailable right now",
      baseUrl: `${apiOrigin()}/v1/ai/tagflow`,
    });
  } else {
    providers.push({
      id: "tagflow",
      name: "Included AI",
      models: [],
      ready: false,
      keySource: "unavailable",
      env: [],
      doc: "https://adcode.bluethenics.com/docs/ai-tagflow",
      included: true,
      custom: false,
      note: "Sign in with the desktop app, or check your connection",
      baseUrl: `${apiOrigin()}/v1/ai/tagflow`,
    });
  }

  if (ollama.running && ollama.models.length > 0) {
    const models = ollama.models.map((name): CliModel => ({
      providerId: "ollama",
      providerName: "Ollama",
      id: name,
      name,
      contextWindow: DEFAULT_CONTEXT,
      maxOutput: DEFAULT_MAX_OUTPUT,
      reasoning: false,
      effortLevels: [],
      included: false,
      costNote: "Runs on this computer",
      note: "Local",
    }));
    providers.push({
      id: "ollama",
      name: "Ollama",
      models,
      ready: true,
      keySource: "local",
      env: [],
      doc: "https://ollama.com",
      included: false,
      custom: false,
      note: ollama.detail,
      baseUrl: "http://127.0.0.1:11434/v1",
    });
  }

  for (const provider of base.providers) {
    if (provider.id === "tagflow" || provider.id === "ollama") continue;
    const state = keyState(options.snapshot, provider);
    providers.push({
      id: provider.id,
      name: provider.name,
      models: provider.models.map((model) => catalogueModelToCli(provider, model)),
      ready: state.ready,
      keySource: state.source,
      env: provider.env,
      doc: provider.doc,
      included: false,
      custom: false,
      note: state.ready ? null : `Set ${provider.env[0] ?? `${provider.id.toUpperCase()}_API_KEY`}`,
      baseUrl: baseUrlFor(provider.id),
    });
  }

  for (const connection of options.snapshot.connections) {
    providers.push(connectionProvider(connection, options.snapshot));
  }

  const order = (provider: CliProvider): number => (provider.included ? 0 : provider.id === "ollama" ? 1 : provider.custom ? 2 : 3);
  providers.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));

  return {
    providers,
    source: base.source,
    refreshedAt: base.refreshedAt,
    tagflow,
    ollama,
    liveError: base.error,
  };
}

export function flattenModels(catalogue: CatalogueSnapshot, options: { readyOnly?: boolean } = {}): CliModel[] {
  const models: CliModel[] = [];
  for (const provider of catalogue.providers) {
    if (options.readyOnly === true && !provider.ready) continue;
    models.push(...provider.models);
  }
  return models;
}

export function findModel(catalogue: CatalogueSnapshot, providerId: string, modelId: string): CliModel | null {
  const provider = catalogue.providers.find((one) => one.id === providerId);
  return provider?.models.find((model) => model.id === modelId) ?? null;
}

/**
 * What this terminal should use, in order: the CLI's own pick, the desktop's pick, the
 * included model's default, then the first ready model. A stored choice that no longer
 * exists is repaired rather than treated as an error.
 */
export function resolveSelection(
  catalogue: CatalogueSnapshot,
  configured: ModelChoiceConfig | null,
  desktop: DesktopSnapshot,
): ModelSelection {
  const requested = configured ?? {
    provider: desktop.settings.provider,
    model: desktop.settings.model,
  };

  const tryProvider = (providerId: string, modelId: string): ModelSelection | null => {
    const provider = catalogue.providers.find((one) => one.id === providerId);
    if (provider === undefined || provider.models.length === 0) return null;
    const model = provider.models.find((one) => one.id === modelId)
      ?? provider.models.find((one) => one.id === catalogue.tagflow?.defaultModel)
      ?? provider.models[0];
    if (model === undefined) return null;
    return {
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.id,
      modelName: model.name,
      ready: provider.ready,
      reason: provider.ready ? null : provider.note,
      choice: { provider: provider.id, model: model.id },
      included: model.included,
    };
  };

  const exact = tryProvider(requested.provider, requested.model);
  if (exact !== null && exact.ready) return exact;

  const tagflowProvider = catalogue.providers.find((one) => one.id === "tagflow" && one.ready);
  if (tagflowProvider !== undefined) {
    const selection = tryProvider("tagflow", catalogue.tagflow?.defaultModel ?? "");
    if (selection !== null) return selection;
  }

  const firstReady = catalogue.providers.find((provider) => provider.ready && provider.models.length > 0);
  if (firstReady !== undefined) {
    const selection = tryProvider(firstReady.id, firstReady.models[0]?.id ?? "");
    if (selection !== null) return selection;
  }

  // A chosen provider that needs setup is still reported as the selection when nothing
  // else can answer, so the screens can explain exactly what is missing.
  if (exact !== null) return exact;

  return {
    providerId: requested.provider,
    providerName: requested.provider,
    modelId: requested.model,
    modelName: requested.model || "No model selected",
    ready: false,
    reason: "No reachable model. Set a provider key or sign in to Included AI.",
    choice: requested,
    included: false,
  };
}

export function recommendedFor(catalogue: CatalogueSnapshot, providerId: string): string | null {
  const provider = catalogue.providers.find((one) => one.id === providerId);
  if (provider === undefined) return null;
  if (provider.id === "tagflow") return catalogue.tagflow?.defaultModel ?? provider.models[0]?.id ?? null;
  return recommendedModel(catalogue.providers.map((one): CatalogueProvider => ({
    id: one.id,
    name: one.name,
    env: one.env,
    doc: one.doc,
    models: one.models.map((model): CatalogueModel => ({
      id: model.id,
      name: model.name,
      toolCall: true,
      reasoning: model.reasoning,
      contextWindow: model.contextWindow,
      maxOutput: model.maxOutput,
      effortLevels: model.effortLevels,
    })),
  })), providerId);
}

export function providerTransport(providerId: string): ReturnType<typeof transportFor> {
  return transportFor(providerId);
}

export function providerBaseUrl(providerId: string): string | null {
  return baseUrlFor(providerId);
}

export function hasCachedLiveCatalogue(): boolean {
  return existsSync(join(cacheDir(), CACHE_FILE));
}
