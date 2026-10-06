import { describe, expect, it } from "vitest";
import {
  BUNDLED_CATALOGUE,
  DEFAULT_CONTEXT_WINDOW,
  SNAPSHOT_TAKEN_ON,
  contextWindowOf,
  baseUrlFor,
  isUsableModel,
  mergeCatalogue,
  parseCatalogue,
  providerIn,
  recommendedModel,
  searchCatalogue,
  traitsOf,
  transportFor,
  usableCatalogue,
  type CatalogueProvider,
} from "@adcode/ai";

const provider = (id: string, models: string[]): CatalogueProvider => ({
  id,
  name: id,
  env: [],
  doc: null,
  models: models.map((model) => ({
    id: model,
    name: model,
    toolCall: true,
    reasoning: false,
    inputCostMicrosPerMillion: null,
    outputCostMicrosPerMillion: null,
    cacheReadCostMicrosPerMillion: null,
    cacheWriteCostMicrosPerMillion: null,
  })),
});

describe("the bundled snapshot", () => {
  /*
   * The whole reason it exists: a first launch with no network must show a populated
   * connection screen, not an empty one that looks broken.
   */
  it("ships enough to connect with no network", () => {
    expect(BUNDLED_CATALOGUE.length).toBeGreaterThan(5);
    expect(BUNDLED_CATALOGUE.every((one) => one.models.length > 0)).toBe(true);
  });

  it("includes the providers people reach for first", () => {
    const ids = BUNDLED_CATALOGUE.map((one) => one.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(ids).toContain("google");
  });

  it("says when it was taken", () => {
    expect(SNAPSHOT_TAKEN_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("parseCatalogue", () => {
  const upstream = {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      doc: "https://example.com",
      models: {
        "claude-x": {
          id: "claude-x",
          name: "Claude X",
          tool_call: true,
          reasoning: true,
          cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
        },
      },
    },
  };

  it("reads a provider and its models", () => {
    const [one] = parseCatalogue(upstream);
    expect(one?.name).toBe("Anthropic");
    expect(one?.models[0]).toEqual({
      id: "claude-x",
      name: "Claude X",
      toolCall: true,
      reasoning: true,
      inputCostMicrosPerMillion: 5_000_000,
      outputCostMicrosPerMillion: 25_000_000,
      cacheReadCostMicrosPerMillion: 500_000,
      cacheWriteCostMicrosPerMillion: 6_250_000,
      contextWindow: null,
    });
  });

  it("labels absent or hostile prices unknown instead of inventing a zero", () => {
    const [one] = parseCatalogue({
      p: {
        models: {
          absent: { id: "absent" },
          hostile: { id: "hostile", cost: { input: -2, output: "free" } },
        },
      },
    });

    expect(one?.models.map((model) => [model.id, model.inputCostMicrosPerMillion])).toEqual([
      ["absent", null],
      ["hostile", null],
    ]);
  });

  it("drops a provider with no models", () => {
    // A row that can only disappoint.
    expect(parseCatalogue({ empty: { id: "empty", models: {} } })).toEqual([]);
  });

  /*
   * This is arbitrary JSON from the network reaching a list the user picks from. The shape
   * upstream publishes is not a promise anybody made us.
   */
  it("survives nonsense", () => {
    expect(parseCatalogue(null)).toEqual([]);
    expect(parseCatalogue("no")).toEqual([]);
    expect(parseCatalogue({ a: 7, b: null, c: { models: "no" } })).toEqual([]);
  });

  it("falls back to the key when a provider has no id", () => {
    const [one] = parseCatalogue({ myprovider: { models: { m: { id: "m" } } } });
    expect(one?.id).toBe("myprovider");
  });

  it("keeps only string env names", () => {
    const [one] = parseCatalogue({ p: { env: ["A", 3, null], models: { m: { id: "m" } } } });
    expect(one?.env).toEqual(["A"]);
  });
});

describe("mergeCatalogue", () => {
  it("keeps the snapshot when nothing came back", () => {
    const bundled = [provider("a", ["one"])];
    expect(mergeCatalogue(bundled, [])).toEqual(bundled);
  });

  /*
   * A live answer replaces a provider wholesale. Merging field by field would keep a model
   * upstream has removed forever.
   */
  it("replaces a provider rather than merging into it", () => {
    const merged = mergeCatalogue([provider("a", ["old"])], [provider("a", ["new"])]);
    expect(merged[0]?.models.map((model) => model.id)).toEqual(["new"]);
  });

  it("keeps providers the live answer did not mention", () => {
    const merged = mergeCatalogue([provider("a", ["x"]), provider("b", ["y"])], [provider("a", ["z"])]);
    expect(merged.map((one) => one.id)).toEqual(["a", "b"]);
  });
});

describe("searchCatalogue", () => {
  const catalogue = [provider("anthropic", ["claude-opus"]), provider("groq", ["llama-fast"])];

  it("returns everything for an empty query", () => {
    expect(searchCatalogue(catalogue, "  ")).toHaveLength(2);
  });

  it("matches a provider by name", () => {
    // "anthropic" is a reasonable thing to type when looking for Claude.
    expect(searchCatalogue(catalogue, "anthro").map((one) => one.id)).toEqual(["anthropic"]);
  });

  it("matches a model and narrows the provider to it", () => {
    const found = searchCatalogue(catalogue, "llama");
    expect(found).toHaveLength(1);
    expect(found[0]?.models.map((model) => model.id)).toEqual(["llama-fast"]);
  });

  it("finds nothing for a word nobody used", () => {
    expect(searchCatalogue(catalogue, "zzz")).toEqual([]);
  });
});

describe("transport", () => {
  it("knows which providers have a first-class client", () => {
    expect(transportFor("anthropic")).toBe("native");
    expect(transportFor("google")).toBe("native");
  });

  it("reaches the rest through the OpenAI wire format", () => {
    expect(transportFor("groq")).toBe("openai-compatible");
    expect(baseUrlFor("groq")).toContain("groq.com");
  });

  /*
   * Not a claim that the provider does not exist - only that this editor has not checked
   * an address for it. The custom endpoint covers those.
   */
  it("says unsupported for one it has no address for", () => {
    expect(transportFor("some-new-provider")).toBe("unsupported");
    expect(baseUrlFor("some-new-provider")).toBeNull();
  });

  it("points the local option at Ollama", () => {
    expect(baseUrlFor("ollama")).toContain("11434");
  });
});

describe("context size", () => {
  const raw = (limit: unknown) => ({
    anthropic: { id: "anthropic", name: "Anthropic", env: [], models: { big: { id: "big", name: "Big", tool_call: true, limit } } },
  });

  it("reads the context size models.dev publishes", () => {
    expect(parseCatalogue(raw({ context: 200000, output: 64000 }))[0]?.models[0]?.contextWindow).toBe(200000);
  });

  it("calls an absent or nonsense context size unknown", () => {
    for (const limit of [undefined, {}, { context: -1 }, { context: "x" }, { context: 1e15 }, { context: 1.5 }]) {
      expect(parseCatalogue(raw(limit))[0]?.models[0]?.contextWindow).toBeNull();
    }
  });

  it("finds a model's context size and says null for one it does not know", () => {
    const catalogue = parseCatalogue(raw({ context: 1000000 }));
    expect(contextWindowOf(catalogue, "anthropic", "big")).toBe(1000000);
    expect(contextWindowOf(catalogue, "anthropic", "small")).toBeNull();
    expect(contextWindowOf(catalogue, "nobody", "big")).toBeNull();
  });

  it("assumes 128k for models nobody published a size for", () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(128_000);
  });
});

/*
 * The list a person picks from, and only that.
 *
 * Reported: "for a lot of models I am getting errors". The list held whatever models.dev
 * published first for each provider - embeddings, Whisper, speech, image and video
 * generators, models retired upstream, OpenAI's Responses-only Pro and Codex models - and
 * providers ADCode has no address for. Every one of those failed the moment it was chosen.
 */
describe("the models a person can use", () => {
  const model = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    tool_call: true,
    modalities: { input: ["text"], output: ["text"] },
    ...extra,
  });
  const raw = {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: {
        a: model("gpt-6.1-sol", { release_date: "2026-09-29", limit: { context: 1050000, output: 128000 }, reasoning: true, reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }] }),
        b: model("gpt-4.1", { release_date: "2025-04-14" }),
        c: model("text-embedding-3-small", { tool_call: false }),
        d: model("gpt-image-2", { modalities: { input: ["text"], output: ["image"] } }),
        e: model("gpt-realtime-2.1", { modalities: { input: ["text", "audio"], output: ["text", "audio"] } }),
        f: model("gpt-5.4-pro", { family: "gpt-pro" }),
        g: model("gpt-5.3-codex", { family: "gpt-codex" }),
        h: model("gpt-3.5-turbo", { status: "deprecated" }),
        i: model("whisper-large-v3"),
      },
    },
    azure: { id: "azure", name: "Azure", models: { a: model("gpt-6.1-sol") } },
    "amazon-bedrock": { id: "amazon-bedrock", name: "Amazon Bedrock", models: { a: model("anthropic.claude-opus-5-5") } },
  };

  it("keeps chat models that call tools, through an API ADCode speaks", () => {
    const usable = usableCatalogue(parseCatalogue(raw));
    expect(usable.map((one) => one.id)).toEqual(["openai"]);
    expect(usable[0]?.models.map((one) => one.id)).toEqual(["gpt-6.1-sol", "gpt-4.1"]);
  });

  it("reads what the request needs: release date, output limit and effort levels", () => {
    const sol = usableCatalogue(parseCatalogue(raw))[0]?.models[0];
    expect(sol?.releaseDate).toBe("2026-09-29");
    expect(sol?.maxOutput).toBe(128000);
    expect(sol?.effortLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(traitsOf(usableCatalogue(parseCatalogue(raw)), "openai", "gpt-6.1-sol")).toEqual({
      reasoning: true,
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      maxOutput: 128000,
    });
    expect(traitsOf(usableCatalogue(parseCatalogue(raw)), "openai", "nope")).toBeUndefined();
  });

  it("keeps Pro models where the provider translates them, as OpenRouter does", () => {
    const usable = usableCatalogue(parseCatalogue({
      openrouter: { id: "openrouter", name: "OpenRouter", models: { a: model("openai/gpt-6.1-sol-pro", { family: "gpt-pro" }) } },
    }));
    expect(usable[0]?.models.map((one) => one.id)).toEqual(["openai/gpt-6.1-sol-pro"]);
  });

  it("starts each provider on a model it recommends, or its newest that can use tools", () => {
    const catalogue = usableCatalogue(parseCatalogue({
      google: { id: "google", name: "Google", models: { a: model("gemini-3.8-flash", { release_date: "2026-09-02" }), b: model("gemini-flash-latest", { release_date: "2026-08-13" }) } },
      xai: { id: "xai", name: "xAI", models: { a: model("grok-9", { release_date: "2027-01-01" }), b: model("grok-8", { release_date: "2026-12-01" }) } },
    }));
    expect(recommendedModel(catalogue, "google")).toBe("gemini-flash-latest");
    expect(recommendedModel(catalogue, "xai")).toBe("grok-9");
    expect(recommendedModel(catalogue, "nobody")).toBeNull();
  });

  it("ships a snapshot of usable models only", () => {
    const ids = BUNDLED_CATALOGUE.map((one) => one.id);
    expect(ids).not.toContain("azure");
    expect(ids).not.toContain("amazon-bedrock");
    expect(ids).not.toContain("github-copilot");
    for (const provider of BUNDLED_CATALOGUE) {
      for (const one of provider.models) expect(isUsableModel(provider.id, one), `${provider.id}/${one.id}`).toBe(true);
    }
  });
});
