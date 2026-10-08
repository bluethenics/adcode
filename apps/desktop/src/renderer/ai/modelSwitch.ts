/**
 * The model chip's quick switch: what to offer, in what order.
 *
 * Changing model meant opening Connect a model - every provider, full screen - for what
 * Claude, Codex and Cursor do from a small menu next to the send button. This menu offers
 * what can answer right now: providers with a key saved (or Ollama while it runs), each with
 * the model in use, its recommended model, and the ones used recently. Everything else stays
 * one click away, under "More models".
 *
 * Pure: no DOM, so the rules are tested as they are written.
 */
import type { AiProviderInfo, AiStatus } from "../../shared/api.ts";

export interface ModelChoice {
  readonly provider: string;
  readonly providerName: string;
  readonly model: string;
  readonly modelName: string;
  readonly current: boolean;
  readonly recommended: boolean;
  readonly free: boolean;
}

/** Shown at most, so the menu stays a menu. */
const MAX_CHOICES = 12;
const PER_PROVIDER = 3;
const RECENT_KEPT = 6;

/** A provider that would answer a message sent now. */
function canAnswer(provider: AiProviderInfo): boolean {
  if (provider.transport === "unsupported") return false;
  if (provider.local !== undefined) return provider.local.running && provider.models.length > 0;
  return provider.needsKey ? provider.hasKey : true;
}

/** "Ollama (on this computer)" reads as "Ollama" on a chip. */
export function shortProviderName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "").trim() || name;
}

export function modelChoices(status: AiStatus, recent: readonly string[]): ModelChoice[] {
  const providers = status.providers
    .filter(canAnswer)
    .sort((a, b) => Number(b.id === status.activeProvider) - Number(a.id === status.activeProvider));
  const choices: ModelChoice[] = [];

  for (const provider of providers) {
    const ids: string[] = [];
    if (provider.id === status.activeProvider && status.activeModel.length > 0) ids.push(status.activeModel);
    const recommended = provider.models.find((model) => model.recommended === true)?.id ?? provider.models[0]?.id;
    if (recommended !== undefined) ids.push(recommended);
    for (const entry of recent) {
      const [recentProvider, recentModel] = entry.split("\u0000");
      if (recentProvider === provider.id && recentModel !== undefined) ids.push(recentModel);
    }

    for (const id of [...new Set(ids)].slice(0, PER_PROVIDER)) {
      const model = provider.models.find((one) => one.id === id);
      choices.push({
        provider: provider.id,
        providerName: shortProviderName(provider.displayName),
        model: id,
        modelName: model?.name ?? id,
        current: provider.id === status.activeProvider && id === status.activeModel,
        recommended: model?.recommended === true,
        free: model?.free === true,
      });
    }
  }

  return choices.slice(0, MAX_CHOICES);
}

/** The recently used list with this model first, as stored: "provider\0model", newest first. */
export function rememberModel(recent: readonly string[], provider: string, model: string): string[] {
  const entry = `${provider}\u0000${model}`;
  return [entry, ...recent.filter((one) => one !== entry)].slice(0, RECENT_KEPT);
}

/** The provider and model a turn ran on. */
export interface ModelInUse {
  readonly provider: string;
  readonly model: string;
}

/**
 * Whether the model has changed since a turn failed on `failedOn`, to one that can answer.
 * Choosing the same model again, or a provider still waiting for its key, is not a switch yet.
 */
export function switchedFrom(failedOn: ModelInUse, status: AiStatus): boolean {
  return status.ready && (status.activeProvider !== failedOn.provider || status.activeModel !== failedOn.model);
}

/** What the chip says: the model's own name, then a short provider name. */
export function chipLabel(status: AiStatus): string {
  const provider = status.providers.find((one) => one.id === status.activeProvider);
  const model = provider?.models.find((one) => one.id === status.activeModel);
  return `${model?.name ?? status.activeModel} · ${shortProviderName(provider?.displayName ?? status.activeProvider)}`;
}
