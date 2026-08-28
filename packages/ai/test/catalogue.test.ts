import { describe, expect, it } from "vitest";
import {
  BUNDLED_CATALOGUE,
  SNAPSHOT_TAKEN_ON,
  baseUrlFor,
  mergeCatalogue,
  parseCatalogue,
  providerIn,
  searchCatalogue,
  transportFor,
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
