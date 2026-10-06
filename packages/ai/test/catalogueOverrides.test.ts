import { describe, expect, it } from "vitest";
import {
  EMPTY_OVERRIDES,
  applyOverrides,
  parseOverrides,
  preferencesWith,
} from "../src/catalogueOverrides.ts";
import { RECOMMENDED_MODELS, recommendedModel } from "../src/catalogue.ts";
import type { CatalogueProvider } from "../src/catalogueTypes.ts";

/**
 * The admin panel's word on the model list.
 *
 * Asked for: "if new models come up I want to update them from the admin panel". The
 * catalogue comes from models.dev, which lags a launch by days and lists everything a
 * provider sells; the panel says which model each provider starts on, which to feature,
 * which to hide because they fail, and adds a model models.dev does not list yet - and the
 * app applies it on launch, without a release.
 */
const catalogue: CatalogueProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    env: [],
    doc: null,
    models: [
      { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", toolCall: true, reasoning: true },
      { id: "gpt-5.6", name: "GPT-5.6", toolCall: true, reasoning: true },
      { id: "gpt-4.1", name: "GPT-4.1", toolCall: true, reasoning: false },
    ],
  },
];

describe("parseOverrides", () => {
  it("reads every part it knows", () => {
    const parsed = parseOverrides({
      recommended: { openai: "gpt-5.6" },
      hidden: ["openai:gpt-4.1"],
      featured: ["openai:gpt-5.6"],
      notes: { "openai:gpt-5.6": "Best for big builds" },
      added: [{ provider: "openai", id: "gpt-7", name: "GPT-7", contextWindow: 2_000_000, reasoning: true, effortLevels: ["low", "high"] }],
    });
    expect(parsed.recommended).toEqual({ openai: "gpt-5.6" });
    expect(parsed.hidden).toEqual(["openai:gpt-4.1"]);
    expect(parsed.featured).toEqual(["openai:gpt-5.6"]);
    expect(parsed.notes).toEqual({ "openai:gpt-5.6": "Best for big builds" });
    expect(parsed.added[0]).toMatchObject({ provider: "openai", id: "gpt-7", name: "GPT-7", contextWindow: 2_000_000 });
  });

  it("turns anything else into no overrides at all, never an exception", () => {
    for (const raw of [null, "x", 7, [], { recommended: "openai" }, { hidden: [3, null] }]) {
      const parsed = parseOverrides(raw);
      expect(parsed.hidden).toEqual([]);
      expect(parsed.recommended).toEqual({});
    }
  });

  it("drops entries that are not what they claim to be", () => {
    const parsed = parseOverrides({
      hidden: ["openai:gpt-4.1", "no-colon", 5],
      notes: { "openai:gpt-5.6": "x".repeat(500) },
      added: [{ provider: "openai", id: "", name: "Empty id" }, { provider: "openai", id: "ok", name: "OK", contextWindow: -5 }],
    });
    expect(parsed.hidden).toEqual(["openai:gpt-4.1"]);
    expect(parsed.notes["openai:gpt-5.6"]?.length).toBeLessThanOrEqual(140);
    expect(parsed.added.map((one) => one.id)).toEqual(["ok"]);
    expect(parsed.added[0]?.contextWindow).toBeUndefined();
  });
});

describe("applyOverrides", () => {
  it("hides the models the panel hid", () => {
    const applied = applyOverrides(catalogue, { ...EMPTY_OVERRIDES, hidden: ["openai:gpt-4.1"] });
    expect(applied[0]?.models.map((one) => one.id)).toEqual(["gpt-6.1-sol", "gpt-5.6"]);
  });

  it("adds a model models.dev does not list yet, first, as new", () => {
    const applied = applyOverrides(catalogue, {
      ...EMPTY_OVERRIDES,
      added: [{ provider: "openai", id: "gpt-7", name: "GPT-7", reasoning: true, effortLevels: ["low", "high"], maxOutput: 64000 }],
    });
    const added = applied[0]?.models[0];
    expect(added).toMatchObject({ id: "gpt-7", name: "GPT-7", toolCall: true, reasoning: true, effortLevels: ["low", "high"], maxOutput: 64000 });
  });

  it("does not add a model twice when models.dev catches up", () => {
    const applied = applyOverrides(catalogue, {
      ...EMPTY_OVERRIDES,
      added: [{ provider: "openai", id: "gpt-5.6", name: "Duplicate" }],
    });
    expect(applied[0]?.models.filter((one) => one.id === "gpt-5.6")).toHaveLength(1);
    expect(applied[0]?.models.find((one) => one.id === "gpt-5.6")?.name).toBe("GPT-5.6");
  });

  it("marks featured models, moves them up, and carries notes", () => {
    const applied = applyOverrides(catalogue, {
      ...EMPTY_OVERRIDES,
      featured: ["openai:gpt-4.1"],
      notes: { "openai:gpt-4.1": "Cheap and quick" },
    });
    expect(applied[0]?.models[0]).toMatchObject({ id: "gpt-4.1", featured: true, note: "Cheap and quick" });
  });

  it("leaves the catalogue as it was with no overrides", () => {
    expect(applyOverrides(catalogue, EMPTY_OVERRIDES)).toEqual(catalogue);
  });
});

describe("preferencesWith", () => {
  it("puts the panel's recommended model ahead of the built-in list", () => {
    const preferences = preferencesWith({ ...EMPTY_OVERRIDES, recommended: { openai: "gpt-4.1" } });
    expect(preferences["openai"]?.[0]).toBe("gpt-4.1");
    expect(recommendedModel(catalogue, "openai", preferences)).toBe("gpt-4.1");
    // Untouched providers keep the built-in order.
    expect(preferences["google"]).toEqual(RECOMMENDED_MODELS["google"]);
  });
});
