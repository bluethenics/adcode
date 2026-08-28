/** Pure provider/model routing for one Team role. */

export interface RoutingCandidate {
  readonly providerId: string;
  readonly modelId: string;
  readonly connected: boolean;
  readonly local: boolean;
  readonly toolCall: boolean;
  readonly reasoning: boolean;
  readonly inputCostMicrosPerMillion: number | null;
  readonly outputCostMicrosPerMillion: number | null;
}

export type RoutingMode = "automatic" | "manual" | "hybrid";

export interface ManualRoute {
  readonly providerId: string;
  readonly modelId: string;
}

export interface RoutingPolicy {
  readonly mode: RoutingMode;
  readonly allowedProviders: readonly string[];
  readonly forbiddenProviders: readonly string[];
  readonly preferredModels: readonly string[];
  readonly localOnly: boolean;
  readonly preferLocal: boolean;
  readonly maxBlendedCostMicrosPerMillion: number | null;
  readonly manual: ManualRoute | null;
}

export interface RoutingRequirements {
  readonly toolCall: boolean;
  readonly reasoning: boolean;
}

export type RoutingDecision =
  | {
      readonly ok: true;
      readonly candidate: RoutingCandidate;
      readonly reason: string;
      readonly priceKnown: boolean;
      readonly blendedCostMicrosPerMillion: number | null;
    }
  | { readonly ok: false; readonly reason: string };

function validId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 160 && !value.includes("\u0000");
}

function priceKnown(candidate: RoutingCandidate): boolean {
  return (
    candidate.inputCostMicrosPerMillion !== null &&
    candidate.outputCostMicrosPerMillion !== null &&
    Number.isSafeInteger(candidate.inputCostMicrosPerMillion) &&
    candidate.inputCostMicrosPerMillion >= 0 &&
    Number.isSafeInteger(candidate.outputCostMicrosPerMillion) &&
    candidate.outputCostMicrosPerMillion >= 0
  );
}

function blendedCost(candidate: RoutingCandidate): number | null {
  if (!priceKnown(candidate)) return null;
  return Math.round(
    candidate.inputCostMicrosPerMillion! * 0.75 +
      candidate.outputCostMicrosPerMillion! * 0.25,
  );
}

function allowedByPolicy(
  candidate: RoutingCandidate,
  policy: RoutingPolicy,
  requirements: RoutingRequirements,
): boolean {
  if (!candidate.connected || !validId(candidate.providerId) || !validId(candidate.modelId)) return false;
  if (requirements.toolCall && !candidate.toolCall) return false;
  if (requirements.reasoning && !candidate.reasoning) return false;
  if (policy.localOnly && !candidate.local) return false;
  if (policy.allowedProviders.length > 0 && !policy.allowedProviders.includes(candidate.providerId)) return false;
  if (policy.forbiddenProviders.includes(candidate.providerId)) return false;
  const cost = blendedCost(candidate);
  if (
    policy.maxBlendedCostMicrosPerMillion !== null &&
    (cost === null || cost > policy.maxBlendedCostMicrosPerMillion)
  ) {
    return false;
  }
  return true;
}

function preferredIndex(policy: RoutingPolicy, candidate: RoutingCandidate): number {
  const exact = policy.preferredModels.indexOf(`${candidate.providerId}/${candidate.modelId}`);
  if (exact >= 0) return exact;
  const model = policy.preferredModels.indexOf(candidate.modelId);
  return model >= 0 ? model : Number.MAX_SAFE_INTEGER;
}

export function routeModel(
  candidates: readonly RoutingCandidate[],
  policy: RoutingPolicy,
  requirements: RoutingRequirements,
): RoutingDecision {
  if (!["automatic", "manual", "hybrid"].includes(policy.mode)) {
    throw new Error("Invalid routing mode");
  }
  if (
    policy.maxBlendedCostMicrosPerMillion !== null &&
    (!Number.isSafeInteger(policy.maxBlendedCostMicrosPerMillion) ||
      policy.maxBlendedCostMicrosPerMillion < 0)
  ) {
    throw new Error("Invalid routing price ceiling");
  }

  const suitable = candidates.filter((candidate) => allowedByPolicy(candidate, policy, requirements));
  if (policy.mode === "manual") {
    const manual = policy.manual;
    const chosen =
      manual === null
        ? undefined
        : suitable.find(
            (candidate) =>
              candidate.providerId === manual.providerId && candidate.modelId === manual.modelId,
          );
    if (chosen === undefined) {
      return { ok: false, reason: "The manually selected model is unavailable or unsuitable for this role." };
    }
    return {
      ok: true,
      candidate: chosen,
      reason: "Used the valid manual model selection.",
      priceKnown: priceKnown(chosen),
      blendedCostMicrosPerMillion: blendedCost(chosen),
    };
  }

  if (suitable.length === 0) {
    return { ok: false, reason: "No connected model satisfies this role and routing policy." };
  }
  const comparable = suitable.every(priceKnown);
  const ordered = [...suitable].sort((first, second) => {
    if (comparable) {
      const costDifference = blendedCost(first)! - blendedCost(second)!;
      if (costDifference !== 0) return costDifference;
    }
    if (policy.preferLocal && first.local !== second.local) return first.local ? -1 : 1;
    const preference = preferredIndex(policy, first) - preferredIndex(policy, second);
    if (preference !== 0) return preference;
    return `${first.providerId}/${first.modelId}`.localeCompare(`${second.providerId}/${second.modelId}`);
  });
  const chosen = ordered[0]!;
  return {
    ok: true,
    candidate: chosen,
    reason: comparable
      ? "Selected the least expensive suitable connected model from comparable catalogue prices."
      : "Selected by deterministic capability and user preference because at least one price is unknown.",
    priceKnown: comparable,
    blendedCostMicrosPerMillion: comparable ? blendedCost(chosen) : null,
  };
}
