import { describe, expect, it } from "vitest";
import { EMPTY_MODEL_OVERRIDES, modelKey, toggleKey, usableProviders } from "../src/lib/modelCatalog";

/**
 * The admin Models page's view of models.dev: the same cut the editor makes - providers it
 * can reach, models that write text and call tools, not retired, not Responses-only on
 * OpenAI - newest first, so what the panel curates is what people actually see.
 */
const raw = {
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      a: { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", tool_call: true, reasoning: true, release_date: "2026-09-29", limit: { context: 1050000, output: 128000 }, cost: { input: 2, output: 10 }, modalities: { output: ["text"] }, reasoning_options: [{ type: "effort", values: ["low", "high"] }] },
      b: { id: "gpt-4.1", name: "GPT-4.1", tool_call: true, release_date: "2025-04-14", modalities: { output: ["text"] } },
      c: { id: "text-embedding-3-small", name: "Embedding", tool_call: false },
      d: { id: "gpt-image-2", name: "Image", tool_call: true, modalities: { output: ["image"] } },
      e: { id: "gpt-5.4-pro", name: "Pro", tool_call: true, family: "gpt-pro" },
      f: { id: "gpt-3.5-turbo", name: "Old", tool_call: true, status: "deprecated" },
    },
  },
  azure: { id: "azure", name: "Azure", models: { a: { id: "x", name: "X", tool_call: true } } },
};

describe("usableProviders", () => {
  it("keeps what the editor can drive, newest first, with the facts the panel shows", () => {
    const providers = usableProviders(raw);
    expect(providers.map((one) => one.id)).toEqual(["openai"]);
    expect(providers[0]?.models.map((one) => one.id)).toEqual(["gpt-6.1-sol", "gpt-4.1"]);
    expect(providers[0]?.models[0]).toMatchObject({
      releaseDate: "2026-09-29",
      contextWindow: 1050000,
      maxOutput: 128000,
      inputPrice: 2,
      outputPrice: 10,
      reasoning: true,
      effortLevels: ["low", "high"],
    });
  });

  it("survives nonsense", () => {
    expect(usableProviders(null)).toEqual([]);
    expect(usableProviders({ openai: { models: "no" } })).toEqual([]);
  });
});

describe("keys", () => {
  it("writes provider and model the way the server reads them", () => {
    expect(modelKey("ollama", "qwen2.5-coder:7b")).toBe("ollama:qwen2.5-coder:7b");
  });

  it("adds a key once and takes it away again", () => {
    const once = toggleKey(EMPTY_MODEL_OVERRIDES.hidden, "openai:gpt-4.1");
    expect(once).toEqual(["openai:gpt-4.1"]);
    expect(toggleKey(once, "openai:gpt-4.1")).toEqual([]);
  });
});
