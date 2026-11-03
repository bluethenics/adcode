import { describe, expect, it } from "vitest";
import {
  findModel,
  flattenModels,
  recommendedFor,
  resolveSelection,
  type CatalogueSnapshot,
} from "../src/ai/catalogue.ts";
import { fakeDesktop, fakeModel, fakeProvider } from "./helpers.ts";

function snapshot(overrides: Partial<CatalogueSnapshot> = {}): CatalogueSnapshot {
  const included = fakeProvider("tagflow", [
    fakeModel("tagflow", "test-default", { name: "Test Default", included: true }),
    fakeModel("tagflow", "test-fast", { name: "Test Fast", included: true }),
  ], {
    name: "Included AI",
    included: true,
    keySource: "included",
    env: [],
  });
  const openrouter = fakeProvider("openrouter", [fakeModel("openrouter", "or-model", { name: "OR Model" })]);
  return {
    providers: [included, openrouter],
    source: "bundled",
    refreshedAt: null,
    tagflow: {
      available: true,
      defaultModel: "test-default",
      models: [],
      requiresVerifiedAccount: false,
      credits: null,
      fetchedAt: 1,
    },
    ollama: { running: false, models: [], detail: "not probed" },
    liveError: null,
    ...overrides,
  };
}

describe("resolveSelection - the model that answers", () => {
  it("uses a ready saved CLI choice before the desktop's choice", () => {
    const selection = resolveSelection(
      snapshot(),
      { provider: "openrouter", model: "or-model" },
      fakeDesktop({ settings: { ...fakeDesktop().settings, provider: "tagflow", model: "test-default" } }),
    );
    expect(selection.providerId).toBe("openrouter");
    expect(selection.modelId).toBe("or-model");
    expect(selection.ready).toBe(true);
  });

  it("follows the desktop when the CLI has not saved a choice", () => {
    const selection = resolveSelection(
      snapshot(),
      null,
      fakeDesktop({ settings: { ...fakeDesktop().settings, provider: "openrouter", model: "or-model" } }),
    );
    expect(selection.providerId).toBe("openrouter");
    expect(selection.modelId).toBe("or-model");
  });

  it("falls back to Included AI's default when the saved provider disappeared", () => {
    const selection = resolveSelection(
      snapshot(),
      { provider: "missing-provider", model: "gone" },
      fakeDesktop(),
    );
    expect(selection.providerId).toBe("tagflow");
    expect(selection.modelId).toBe("test-default");
    expect(selection.included).toBe(true);
  });

  it("falls back to a ready provider rather than keeping an unready choice", () => {
    const catalogue = snapshot({
      providers: [
        fakeProvider("chosen", [fakeModel("chosen", "chosen-model")], {
          ready: false,
          keySource: "missing",
          note: "Set CHOSEN_API_KEY",
        }),
        fakeProvider("fallback", [fakeModel("fallback", "fallback-model")], { ready: true }),
      ],
      tagflow: null,
    });
    const selection = resolveSelection(
      catalogue,
      { provider: "chosen", model: "chosen-model" },
      fakeDesktop({ settings: { ...fakeDesktop().settings, provider: "chosen", model: "chosen-model" } }),
    );
    expect(selection.providerId).toBe("fallback");
    expect(selection.modelId).toBe("fallback-model");
    expect(selection.ready).toBe(true);
  });

  it("reports the chosen provider's setup note when nothing can answer", () => {
    const catalogue = snapshot({
      providers: [
        fakeProvider("openrouter", [fakeModel("openrouter", "or-model")], {
          ready: false,
          keySource: "missing",
          note: "Set OPENROUTER_API_KEY",
        }),
      ],
      tagflow: null,
    });
    const selection = resolveSelection(
      catalogue,
      { provider: "openrouter", model: "or-model" },
      fakeDesktop(),
    );
    expect(selection.providerId).toBe("openrouter");
    expect(selection.ready).toBe(false);
    expect(selection.reason).toBe("Set OPENROUTER_API_KEY");
  });

  it("does not silently select a provider with no models", () => {
    const catalogue = snapshot({
      providers: [fakeProvider("empty", [], { ready: true })],
      tagflow: null,
    });
    const selection = resolveSelection(catalogue, null, fakeDesktop());
    expect(selection.ready).toBe(false);
    expect(selection.reason).toContain("No reachable model");
  });
});

describe("catalogue queries", () => {
  it("flattens only ready providers when asked", () => {
    const catalogue = snapshot({
      providers: [
        fakeProvider("ready", [fakeModel("ready", "a")]),
        fakeProvider("unready", [fakeModel("unready", "b")], { ready: false }),
      ],
    });
    expect(flattenModels(catalogue).map((model) => model.id)).toEqual(["a", "b"]);
    expect(flattenModels(catalogue, { readyOnly: true }).map((model) => model.id)).toEqual(["a"]);
  });

  it("finds a model by provider and id, and returns null for a stranger", () => {
    const catalogue = snapshot();
    expect(findModel(catalogue, "tagflow", "test-fast")?.name).toBe("Test Fast");
    expect(findModel(catalogue, "tagflow", "nope")).toBeNull();
    expect(findModel(catalogue, "nope", "test-fast")).toBeNull();
  });

  it("recommends Included AI's declared default", () => {
    expect(recommendedFor(snapshot(), "tagflow")).toBe("test-default");
    expect(recommendedFor(snapshot(), "missing")).toBeNull();
  });
});
