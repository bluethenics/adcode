/**
 * The public included-AI directory, as the header reads it.
 *
 * `/v1/ai/tagflow/config` is the only public list of models an administrator has
 * actually enabled *and* connected a server key for. The status feed knows how those
 * models have behaved, but only models that have served traffic appear there, so the
 * directory is what makes the header's list complete. This parser is deliberately
 * forgiving: one malformed model must not hide the others.
 */

export interface IncludedAiModel {
  id: string;
  name: string;
  providerName: string;
  contextWindow: number;
  maxOutput: number;
  /** Relative credit cost: 1 is the standard rate. */
  creditRate: number;
  billing?: "wallet";
}

export interface IncludedAiView {
  available: boolean;
  defaultModel: string;
  models: IncludedAiModel[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

const positive = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

const nonNegative = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function parseModel(raw: unknown): IncludedAiModel | null {
  if (!record(raw)) return null;
  const id = text(raw["id"]);
  const name = text(raw["name"]);
  const contextWindow = positive(raw["contextWindow"]);
  if (id === null || id === "" || name === null || name === "" || contextWindow === null) return null;
  return {
    id,
    name,
    providerName: text(raw["providerName"]) ?? "Included AI",
    contextWindow,
    maxOutput: nonNegative(raw["maxOutput"]) ?? 0,
    creditRate: nonNegative(raw["creditRate"]) ?? 1,
    ...(raw["billing"] === "wallet" ? { billing: "wallet" as const } : {}),
  };
}

export function parseIncludedAiView(raw: unknown): IncludedAiView | null {
  if (!record(raw)) return null;
  const available = raw["available"];
  const defaultModel = text(raw["defaultModel"]);
  if (typeof available !== "boolean" || defaultModel === null) return null;
  if (raw["models"] !== undefined && !Array.isArray(raw["models"])) return null;

  const models: IncludedAiModel[] = [];
  for (const item of Array.isArray(raw["models"]) ? raw["models"] : []) {
    const model = parseModel(item);
    if (model === null || models.some((one) => one.id === model.id)) continue;
    models.push(model);
  }

  return { available, defaultModel, models };
}
