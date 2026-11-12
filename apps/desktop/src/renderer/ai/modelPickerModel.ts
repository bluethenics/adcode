/**
 * The composer's model picker, as rules rather than DOM.
 *
 * The picker is three columns: a rail of connected providers (with Favourites on top), the
 * models to pick from, and how hard the highlighted model thinks. Everything it shows is
 * decided here, so what the window draws is what the tests asserted - which models are
 * offered, which carry a Ctrl+number shortcut, which thinking levels a model really takes.
 *
 * Pure: no DOM and no `window`.
 */
import type { AiModelInfo, AiProviderInfo, AiStatus } from "../../shared/api.ts";

/** The setting that keeps favourites: a JSON list of `{ provider, model }`. */
export const FAVORITES_SETTING = "adcode.ai.favoriteModels";
/** The thinking-effort setting Connect a model already writes. */
export const EFFORT_SETTING = "adcode.ai.effort";

/** Rows shown for one provider before "Show more". */
export const ROWS_PER_PROVIDER = 8;
/** Ctrl+1 to Ctrl+9: the first nine favourites. */
export const SHORTCUT_SLOTS = 9;
/** Kept at most, so a hand-edited setting cannot grow without end. */
const FAVORITES_KEPT = 50;

export type Effort = "auto" | "low" | "medium" | "high" | "max";
export const EFFORTS: readonly Effort[] = ["auto", "low", "medium", "high", "max"];

export interface FavoriteModel {
  readonly provider: string;
  readonly model: string;
}

/** Which list the middle column shows: favourites, or one provider's models. */
export type PickerFilter = "favorites" | { readonly provider: string };

export interface RailItem {
  /** "favorites", or a provider id. */
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
  /** The provider of the model in use. */
  readonly inUse: boolean;
}

export interface PickerRow {
  /** Unique within the picker: provider and model. */
  readonly key: string;
  readonly provider: string;
  readonly providerName: string;
  readonly model: string;
  readonly modelName: string;
  /** The small muted line under the name. */
  readonly note: string;
  readonly current: boolean;
  readonly favorite: boolean;
  /** 1-9 when this favourite has a Ctrl+number shortcut. */
  readonly shortcut: number | null;
  readonly info: AiModelInfo | undefined;
}

export interface PickerGroup {
  /** "favorites" or the provider id; what "Show more" expands. */
  readonly id: string;
  /** Shown above the rows when the list mixes providers; null for a single list. */
  readonly heading: string | null;
  readonly rows: readonly PickerRow[];
  /** Rows held back behind "Show more". */
  readonly hidden: number;
}

export interface PickerView {
  readonly rail: readonly RailItem[];
  readonly groups: readonly PickerGroup[];
  /** Every row on screen, in order: what the arrow keys walk. */
  readonly rows: readonly PickerRow[];
  /** A plain sentence when there is nothing to list, else null. */
  readonly empty: string | null;
}

export interface PickerState {
  readonly filter: PickerFilter;
  readonly query: string;
  /** Group ids whose "Show more" was pressed. */
  readonly expanded: ReadonlySet<string>;
}

/* ── Favourites ──────────────────────────────────────────────────────── */

const keyOf = (provider: string, model: string): string => `${provider}\u0000${model}`;

/** The stored setting, read defensively: anything that is not a list of pairs is no favourites. */
export function parseFavorites(raw: unknown): FavoriteModel[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: FavoriteModel[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { provider, model } = entry as { provider?: unknown; model?: unknown };
    if (typeof provider !== "string" || typeof model !== "string" || provider === "" || model === "") continue;
    const key = keyOf(provider, model);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider, model });
    if (out.length >= FAVORITES_KEPT) break;
  }
  return out;
}

export function serializeFavorites(list: readonly FavoriteModel[]): string {
  return JSON.stringify(list.slice(0, FAVORITES_KEPT).map(({ provider, model }) => ({ provider, model })));
}

/** Add at the end (so shortcuts already learned keep their numbers), or remove. */
export function toggleFavorite(list: readonly FavoriteModel[], provider: string, model: string): FavoriteModel[] {
  const key = keyOf(provider, model);
  return list.some((one) => keyOf(one.provider, one.model) === key)
    ? list.filter((one) => keyOf(one.provider, one.model) !== key)
    : [...list, { provider, model }].slice(0, FAVORITES_KEPT);
}

/* ── Providers and rows ──────────────────────────────────────────────── */

/** A provider that would answer a message sent now - the same test as the quick switch. */
export function canAnswer(provider: AiProviderInfo): boolean {
  if (provider.transport === "unsupported") return false;
  if (provider.local !== undefined) return provider.local.running && provider.models.length > 0;
  return provider.needsKey ? provider.hasKey : true;
}

/** "Ollama (on this computer)" reads as "Ollama". */
function shortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "").trim() || name;
}

/** A provider's name on the rail: short, without "(on this computer)" or a trailing "CLI". */
export function railLabel(name: string): string {
  const short = shortName(name);
  return short.replace(/\s+CLI$/i, "").trim() || short;
}

/** Connected providers, the one in use first, otherwise in catalogue order. */
export function connectedProviders(status: AiStatus): AiProviderInfo[] {
  return status.providers
    .filter(canAnswer)
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) => Number(b.provider.id === status.activeProvider) - Number(a.provider.id === status.activeProvider) || a.index - b.index)
    .map(({ provider }) => provider);
}

/** The models a provider offers, with the one in use added when the list does not carry it. */
function modelsOf(status: AiStatus, provider: AiProviderInfo): { id: string; info: AiModelInfo | undefined }[] {
  const listed = provider.models.map((info) => ({ id: info.id, info }));
  if (provider.id === status.activeProvider && status.activeModel !== "" && !provider.models.some((one) => one.id === status.activeModel)) {
    return [{ id: status.activeModel, info: undefined }, ...listed];
  }
  return listed;
}

/** The small line under a model's name: what is worth knowing at a glance. */
function noteFor(info: AiModelInfo | undefined, providerName: string | null): string {
  const parts: string[] = [];
  if (providerName !== null) parts.push(providerName);
  if (info?.note !== undefined && info.note.trim() !== "") parts.push(info.note.trim());
  else if (info?.free === true) parts.push("Free");
  else if (info?.recommended === true) parts.push("Recommended");
  if (info?.isNew === true && !parts.includes("New")) parts.push("New");
  return parts.join(" · ");
}

/**
 * Favourites that can be picked now, in the order they were starred. Their position here is
 * their shortcut: the first is Ctrl+1.
 */
export function availableFavorites(status: AiStatus, favorites: readonly FavoriteModel[]): FavoriteModel[] {
  const providers = new Map(connectedProviders(status).map((provider) => [provider.id, provider]));
  return favorites.filter((favorite) => {
    const provider = providers.get(favorite.provider);
    return provider !== undefined && modelsOf(status, provider).some((one) => one.id === favorite.model);
  });
}

/** The favourite Ctrl+`slot` picks (1-9), or null when that slot is empty. */
export function favoriteForShortcut(status: AiStatus, favorites: readonly FavoriteModel[], slot: number): FavoriteModel | null {
  if (!Number.isInteger(slot) || slot < 1 || slot > SHORTCUT_SLOTS) return null;
  return availableFavorites(status, favorites)[slot - 1] ?? null;
}

/** "Ctrl+1", or "⌘1" on a Mac. */
export function shortcutLabel(slot: number, isMac: boolean): string {
  return isMac ? `⌘${String(slot)}` : `Ctrl+${String(slot)}`;
}

/** Where the picker opens: on Favourites when there are any, else on the provider in use. */
export function defaultFilter(status: AiStatus, favorites: readonly FavoriteModel[]): PickerFilter {
  if (availableFavorites(status, favorites).length > 0) return "favorites";
  const providers = connectedProviders(status);
  const active = providers.find((provider) => provider.id === status.activeProvider) ?? providers[0];
  return active === undefined ? "favorites" : { provider: active.id };
}

function matches(row: PickerRow, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${row.modelName} ${row.model} ${row.providerName} ${row.note}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Everything the picker draws, for one state. */
export function pickerView(status: AiStatus, favorites: readonly FavoriteModel[], state: PickerState): PickerView {
  const providers = connectedProviders(status);
  const starred = availableFavorites(status, favorites);
  const shortcutOf = new Map(starred.slice(0, SHORTCUT_SLOTS).map((one, index) => [keyOf(one.provider, one.model), index + 1]));
  const favoriteKeys = new Set(favorites.map((one) => keyOf(one.provider, one.model)));
  const filter = state.filter;
  const selectedProvider = filter === "favorites" ? null : filter.provider;

  const rail: RailItem[] = [
    { id: "favorites", label: "Favourites", selected: filter === "favorites" && state.query.trim() === "", inUse: false },
    ...providers.map((provider) => ({
      id: provider.id,
      label: railLabel(provider.displayName),
      selected: selectedProvider === provider.id && state.query.trim() === "",
      inUse: provider.id === status.activeProvider,
    })),
  ];

  const rowFor = (provider: AiProviderInfo, id: string, info: AiModelInfo | undefined, showProvider: boolean): PickerRow => {
    const key = keyOf(provider.id, id);
    const providerName = shortName(provider.displayName);
    return {
      key,
      provider: provider.id,
      providerName,
      model: id,
      modelName: info?.name ?? id,
      note: noteFor(info, showProvider ? providerName : null),
      current: provider.id === status.activeProvider && id === status.activeModel,
      favorite: favoriteKeys.has(key),
      shortcut: shortcutOf.get(key) ?? null,
      info,
    };
  };

  const cap = (id: string, rows: PickerRow[]): { rows: PickerRow[]; hidden: number } =>
    state.expanded.has(id) || rows.length <= ROWS_PER_PROVIDER
      ? { rows, hidden: 0 }
      : { rows: rows.slice(0, ROWS_PER_PROVIDER), hidden: rows.length - ROWS_PER_PROVIDER };

  const groups: PickerGroup[] = [];
  const query = state.query.trim();

  if (providers.length === 0) {
    return { rail, groups, rows: [], empty: "No models are connected yet. Connect one and it shows up here." };
  }

  if (query !== "") {
    // Typing searches everything connected, grouped by provider, so a name is found wherever it lives.
    for (const provider of providers) {
      const rows = modelsOf(status, provider).map(({ id, info }) => rowFor(provider, id, info, false)).filter((row) => matches(row, query));
      if (rows.length === 0) continue;
      groups.push({ id: provider.id, heading: shortName(provider.displayName), ...cap(provider.id, rows) });
    }
  } else if (filter === "favorites") {
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    const rows = starred.map((favorite) => {
      const provider = byId.get(favorite.provider)!;
      return rowFor(provider, favorite.model, provider.models.find((one) => one.id === favorite.model), true);
    });
    if (rows.length > 0) groups.push({ id: "favorites", heading: null, rows, hidden: 0 });
  } else {
    const provider = providers.find((one) => one.id === filter.provider);
    if (provider !== undefined) {
      const rows = modelsOf(status, provider).map(({ id, info }) => rowFor(provider, id, info, false));
      if (rows.length > 0) groups.push({ id: provider.id, heading: null, ...cap(provider.id, rows) });
    }
  }

  const rows = groups.flatMap((group) => group.rows);
  let empty: string | null = null;
  if (rows.length === 0) {
    if (query !== "") empty = `No model matches "${query}".`;
    else if (filter === "favorites") empty = "No favourites yet. Press the star next to a model to keep it here.";
    else empty = "This provider has no models to pick right now.";
  }
  return { rail, groups, rows, empty };
}

/* ── Reasoning ───────────────────────────────────────────────────────── */

export interface ReasoningOption {
  readonly value: Effort;
  readonly label: string;
  /** A few plain words about what it means. */
  readonly detail: string;
  readonly checked: boolean;
}

export interface ReasoningView {
  /** False for a model that does not think before answering: the pane says so instead. */
  readonly supported: boolean;
  readonly options: readonly ReasoningOption[];
  /** A plain sentence under the list, or null. */
  readonly note: string | null;
}

const EFFORT_TEXT: Readonly<Record<Effort, { label: string; detail: string }>> = {
  auto: { label: "Auto (Default)", detail: "Let the model decide" },
  low: { label: "Low", detail: "Quick answers" },
  medium: { label: "Medium", detail: "A bit more care" },
  high: { label: "High", detail: "Thinks it through" },
  max: { label: "Max", detail: "Thinks hardest, costs most" },
};

/** "auto" for anything the setting would not accept. */
export function effortFrom(value: unknown): Effort {
  return value === "low" || value === "medium" || value === "high" || value === "max" ? value : "auto";
}

/** The short word the chip uses: Low, Medium, High, Max. */
export function effortWord(effort: Effort): string {
  return effort === "auto" ? "Auto" : EFFORT_TEXT[effort].label;
}

/**
 * ADCode's four levels a model really accepts, or null when it does not think at all.
 *
 * Models name their own levels (coding CLIs report them). Low also covers a model's
 * "minimal", and Max its "xhigh" - the same rounding the request side does, so a level is
 * offered only when picking it changes what is sent.
 */
export function offeredEfforts(info: AiModelInfo | undefined): readonly Effort[] | null {
  const all: Effort[] = ["low", "medium", "high", "max"];
  if (info === undefined) return all;
  if (info.efforts !== undefined) {
    const own = new Set(info.efforts.map((level) => level.toLowerCase()));
    const offered = all.filter((level) =>
      level === "low" ? own.has("low") || own.has("minimal")
      : level === "max" ? own.has("max") || own.has("xhigh")
      : own.has(level));
    return offered.length === 0 ? null : offered;
  }
  return info.reasoning ? all : null;
}

export function reasoningView(info: AiModelInfo | undefined, current: Effort): ReasoningView {
  const offered = offeredEfforts(info);
  if (offered === null) {
    return { supported: false, options: [], note: "This model answers straight away. It has no thinking levels to choose from." };
  }
  const values: Effort[] = ["auto", ...offered];
  const options = values.map((value) => ({ value, ...EFFORT_TEXT[value], checked: value === current }));
  const note = current !== "auto" && !values.includes(current)
    ? `${EFFORT_TEXT[current].label} is not offered here, so it uses the closest level.`
    : null;
  return { supported: true, options, note };
}

/* ── The chip ────────────────────────────────────────────────────────── */

/** The model in use, as listed by its provider, if it is listed. */
export function activeModelInfo(status: AiStatus): AiModelInfo | undefined {
  return status.providers.find((one) => one.id === status.activeProvider)?.models.find((one) => one.id === status.activeModel);
}

/**
 * What the composer chip says: "Fable 5.1 · High". The effort is left off when it is Auto,
 * and when the model in use does not take that level - the chip never claims a setting
 * that is not being sent.
 */
export function composerChipLabel(status: AiStatus): string {
  const info = activeModelInfo(status);
  const name = info?.name ?? status.activeModel;
  const effort = effortFrom(status.effort);
  if (effort === "auto") return name;
  const offered = offeredEfforts(info);
  return offered !== null && offered.includes(effort) ? `${name} · ${effortWord(effort)}` : name;
}
