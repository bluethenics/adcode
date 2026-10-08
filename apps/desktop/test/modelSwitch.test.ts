import { describe, expect, it } from "vitest";
import { modelChoices, chipLabel, rememberModel, switchedFrom } from "../src/renderer/ai/modelSwitch.ts";
import type { AiProviderInfo, AiStatus } from "../src/shared/api.ts";

/**
 * The model chip's quick switch.
 *
 * Changing model meant opening Connect a model - a full-screen list of every provider - for
 * what Claude, Codex and Cursor do from a small menu next to the send button. The menu
 * offers what can answer right now: providers with a key saved (or Ollama, running), each
 * with the model in use, its recommended one, and the ones used recently.
 */
const provider = (id: string, extra: Partial<AiProviderInfo> = {}): AiProviderInfo => ({
  id,
  displayName: id[0]!.toUpperCase() + id.slice(1),
  models: [
    { id: `${id}-new`, name: `${id} New`, toolCall: true, reasoning: true, recommended: true },
    { id: `${id}-old`, name: `${id} Old`, toolCall: true, reasoning: false },
    { id: `${id}-older`, name: `${id} Older`, toolCall: true, reasoning: false },
  ],
  hasKey: true,
  needsKey: true,
  transport: "openai-compatible",
  doc: null,
  ...extra,
});

const status = (providers: AiProviderInfo[], active = "openai", model = "openai-old"): AiStatus => ({
  providers,
  activeProvider: active,
  activeModel: model,
  ready: true,
  customBaseUrl: "",
  catalogueTakenOn: "2026-10-06",
  catalogueIsLive: false,
});

describe("modelChoices", () => {
  it("offers only providers that can answer now, the active one first", () => {
    const choices = modelChoices(status([
      provider("anthropic"),
      provider("groq", { hasKey: false }),
      provider("openai"),
      provider("azure", { transport: "unsupported" }),
    ]), []);
    expect([...new Set(choices.map((one) => one.provider))]).toEqual(["openai", "anthropic"]);
  });

  it("lists the model in use, then the recommended one, then recent ones", () => {
    const choices = modelChoices(status([provider("openai")]), ["openai\u0000openai-older"]);
    expect(choices.map((one) => one.model)).toEqual(["openai-old", "openai-new", "openai-older"]);
    expect(choices[0]?.current).toBe(true);
    expect(choices[1]?.recommended).toBe(true);
  });

  it("offers Ollama only while it runs with models", () => {
    const ollama = (running: boolean): AiProviderInfo => provider("ollama", {
      needsKey: false,
      hasKey: running,
      local: { installed: true, running, models: running ? ["qwen"] : [] },
      models: running ? [{ id: "qwen", name: "qwen", toolCall: true, reasoning: false, recommended: true }] : [],
    });
    expect(modelChoices(status([provider("openai"), ollama(true)]), []).some((one) => one.provider === "ollama")).toBe(true);
    expect(modelChoices(status([provider("openai"), ollama(false)]), []).some((one) => one.provider === "ollama")).toBe(false);
  });

  it("keeps the menu short", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((id) => provider(id));
    expect(modelChoices(status(many, "a", "a-old"), []).length).toBeLessThanOrEqual(12);
  });
});

describe("rememberModel", () => {
  it("puts the newest first and keeps six", () => {
    let recent: string[] = [];
    for (const id of ["1", "2", "3", "4", "5", "6", "7", "2"]) recent = rememberModel(recent, "p", id);
    expect(recent).toEqual(["p\u00002", "p\u00007", "p\u00006", "p\u00005", "p\u00004", "p\u00003"]);
  });
});

describe("chipLabel", () => {
  it("names the model by its display name, with a short provider name", () => {
    const providers = [provider("ollama", { displayName: "Ollama (on this computer)" })];
    expect(chipLabel(status(providers, "ollama", "ollama-new"))).toBe("ollama New · Ollama");
  });

  it("falls back to the id for a model the list does not know", () => {
    expect(chipLabel(status([provider("openai")], "openai", "gpt-x"))).toBe("gpt-x · Openai");
  });
});

describe("switchedFrom", () => {
  const failedOn = { provider: "openrouter", model: "openrouter-new" };
  const providers = [provider("openrouter"), provider("groq")];

  it("is a switch once another model, or the same model elsewhere, can answer", () => {
    expect(switchedFrom(failedOn, status(providers, "groq", "groq-new"))).toBe(true);
    expect(switchedFrom(failedOn, status(providers, "openrouter", "openrouter-old"))).toBe(true);
  });

  it("is not a switch to choose the same model again, or one that cannot answer yet", () => {
    expect(switchedFrom(failedOn, status(providers, "openrouter", "openrouter-new"))).toBe(false);
    expect(switchedFrom(failedOn, { ...status(providers, "groq", "groq-new"), ready: false })).toBe(false);
  });
});
