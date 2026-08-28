import { describe, expect, it } from "vitest";
import { routeModel, type RoutingCandidate, type RoutingPolicy } from "../src/routing.ts";

const candidate = (
  providerId: string,
  modelId: string,
  options: Partial<RoutingCandidate> = {},
): RoutingCandidate => ({
  providerId,
  modelId,
  connected: true,
  local: providerId === "ollama",
  toolCall: true,
  reasoning: false,
  inputCostMicrosPerMillion: 1_000_000,
  outputCostMicrosPerMillion: 3_000_000,
  ...options,
});

const automatic = (overrides: Partial<RoutingPolicy> = {}): RoutingPolicy => ({
  mode: "automatic",
  allowedProviders: [],
  forbiddenProviders: [],
  preferredModels: [],
  localOnly: false,
  preferLocal: false,
  maxBlendedCostMicrosPerMillion: null,
  manual: null,
  ...overrides,
});

describe("Team model routing", () => {
  it("chooses the least expensive suitable connected model when prices are comparable", () => {
    const routed = routeModel(
      [
        candidate("openai", "large", {
          inputCostMicrosPerMillion: 5_000_000,
          outputCostMicrosPerMillion: 20_000_000,
        }),
        candidate("groq", "small", {
          inputCostMicrosPerMillion: 500_000,
          outputCostMicrosPerMillion: 800_000,
        }),
        candidate("offline", "cheap", { connected: false }),
      ],
      automatic(),
      { toolCall: true, reasoning: false },
    );

    expect(routed.ok && routed.candidate.modelId).toBe("small");
    expect(routed.ok && routed.priceKnown).toBe(true);
    expect(routed.ok && routed.reason).toMatch(/least expensive/i);
  });

  it("uses deterministic preferences and labels price unknown when candidates are not comparable", () => {
    const routed = routeModel(
      [
        candidate("zeta", "z-model", {
          inputCostMicrosPerMillion: null,
          outputCostMicrosPerMillion: null,
        }),
        candidate("alpha", "a-model"),
      ],
      automatic({ preferredModels: ["z-model"] }),
      { toolCall: true, reasoning: false },
    );

    expect(routed.ok && routed.candidate.modelId).toBe("z-model");
    expect(routed.ok && routed.priceKnown).toBe(false);
    expect(routed.ok && routed.reason).toMatch(/price.*unknown/i);
  });

  it("honours an exact valid manual route", () => {
    const routed = routeModel(
      [candidate("openai", "a"), candidate("anthropic", "b", { reasoning: true })],
      automatic({ mode: "manual", manual: { providerId: "anthropic", modelId: "b" } }),
      { toolCall: true, reasoning: true },
    );

    expect(routed.ok && [routed.candidate.providerId, routed.candidate.modelId]).toEqual([
      "anthropic",
      "b",
    ]);
    expect(routed.ok && routed.reason).toMatch(/manual/i);
  });

  it("never escapes hybrid provider, privacy, capability, or price constraints", () => {
    const routed = routeModel(
      [
        candidate("openai", "cheap"),
        candidate("ollama", "local-chat", { toolCall: false }),
        candidate("ollama", "local-agent", {
          inputCostMicrosPerMillion: 0,
          outputCostMicrosPerMillion: 0,
        }),
      ],
      automatic({
        mode: "hybrid",
        allowedProviders: ["ollama"],
        forbiddenProviders: ["openai"],
        localOnly: true,
        maxBlendedCostMicrosPerMillion: 100_000,
      }),
      { toolCall: true, reasoning: false },
    );

    expect(routed.ok && routed.candidate.modelId).toBe("local-agent");
  });

  it("returns a scoped refusal when no connected model satisfies the role", () => {
    const routed = routeModel(
      [candidate("ollama", "chat", { toolCall: false, reasoning: false })],
      automatic(),
      { toolCall: true, reasoning: true },
    );

    expect(routed).toEqual({ ok: false, reason: "No connected model satisfies this role and routing policy." });
  });
});
