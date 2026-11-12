/**
 * The composer's model picker: what it lists, which favourites carry Ctrl+number, which
 * thinking levels a model really takes, and what the chip says. Plus the stylesheet rules
 * the rest of the workbench keeps: tokens only, motion behind both stillness switches,
 * hover only for a fine pointer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiModelInfo, AiProviderInfo, AiStatus } from "../src/shared/api.ts";
import {
  ROWS_PER_PROVIDER,
  availableFavorites,
  composerChipLabel,
  connectedProviders,
  defaultFilter,
  effortFrom,
  favoriteForShortcut,
  offeredEfforts,
  parseFavorites,
  pickerView,
  railLabel,
  reasoningView,
  serializeFavorites,
  shortcutLabel,
  toggleFavorite,
  type PickerState,
} from "../src/renderer/ai/modelPickerModel.ts";

const model = (id: string, extra: Partial<AiModelInfo> = {}): AiModelInfo => ({ id, name: id.toUpperCase(), toolCall: true, reasoning: false, ...extra });

const provider = (id: string, models: AiModelInfo[], extra: Partial<AiProviderInfo> = {}): AiProviderInfo => ({
  id, displayName: id[0]!.toUpperCase() + id.slice(1), models, hasKey: true, needsKey: true, transport: "native", doc: null, ...extra,
});

function status(extra: Partial<AiStatus> = {}): AiStatus {
  return {
    providers: [
      provider("openai", Array.from({ length: 11 }, (_, index) => model(`gpt-${String(index)}`, { reasoning: true }))),
      provider("anthropic", [model("fable", { name: "Fable 5.1", efforts: ["low", "medium", "high", "xhigh"] }), model("haiku", { name: "Haiku" })]),
      provider("nokey", [model("x")], { hasKey: false }),
      provider("ollama", [model("llama")], { needsKey: false, local: { installed: true, running: false, models: [] } as never }),
    ],
    activeProvider: "anthropic",
    activeModel: "fable",
    ready: true,
    customBaseUrl: "",
    catalogueTakenOn: "2026-11-01",
    catalogueIsLive: false,
    ...extra,
  };
}

const state = (extra: Partial<PickerState> = {}): PickerState => ({ filter: "favorites", query: "", expanded: new Set(), ...extra });

describe("favourites", () => {
  it("reads the setting defensively and keeps each pair once", () => {
    expect(parseFavorites("")).toEqual([]);
    expect(parseFavorites("not json")).toEqual([]);
    expect(parseFavorites('{"provider":"a"}')).toEqual([]);
    expect(parseFavorites(42)).toEqual([]);
    expect(parseFavorites('[{"provider":"a","model":"b"},{"provider":"a","model":"b"},{"provider":"","model":"c"},null,{"provider":"a","model":"c"}]'))
      .toEqual([{ provider: "a", model: "b" }, { provider: "a", model: "c" }]);
  });

  it("adds at the end, so shortcuts already learned keep their number, and removes", () => {
    const one = toggleFavorite([], "a", "1");
    const two = toggleFavorite(one, "b", "2");
    expect(two).toEqual([{ provider: "a", model: "1" }, { provider: "b", model: "2" }]);
    expect(toggleFavorite(two, "a", "1")).toEqual([{ provider: "b", model: "2" }]);
    expect(parseFavorites(serializeFavorites(two))).toEqual(two);
  });

  it("offers only favourites that can answer now, and numbers them from 1", () => {
    const favorites = [{ provider: "nokey", model: "x" }, { provider: "anthropic", model: "haiku" }, { provider: "anthropic", model: "gone" }, { provider: "openai", model: "gpt-2" }];
    expect(availableFavorites(status(), favorites)).toEqual([{ provider: "anthropic", model: "haiku" }, { provider: "openai", model: "gpt-2" }]);
    expect(favoriteForShortcut(status(), favorites, 1)).toEqual({ provider: "anthropic", model: "haiku" });
    expect(favoriteForShortcut(status(), favorites, 2)).toEqual({ provider: "openai", model: "gpt-2" });
    expect(favoriteForShortcut(status(), favorites, 3)).toBeNull();
    expect(favoriteForShortcut(status(), favorites, 0)).toBeNull();
    expect(favoriteForShortcut(status(), favorites, 10)).toBeNull();
  });

  it("gives the first nine favourites a shortcut and no more", () => {
    const favorites = Array.from({ length: 11 }, (_, index) => ({ provider: "openai", model: `gpt-${String(index)}` }));
    const rows = pickerView(status(), favorites, state()).rows;
    expect(rows).toHaveLength(11);
    expect(rows.map((row) => row.shortcut)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, null, null]);
    expect(rows.every((row) => row.favorite && row.note.startsWith("Openai"))).toBe(true);
  });

  it("names the shortcut the platform's way", () => {
    expect(shortcutLabel(3, false)).toBe("Ctrl+3");
    expect(shortcutLabel(3, true)).toBe("⌘3");
  });
});

describe("the rail and the list", () => {
  it("lists connected providers only, the one in use first", () => {
    expect(connectedProviders(status()).map((one) => one.id)).toEqual(["anthropic", "openai"]);
    const view = pickerView(status(), [], state({ filter: { provider: "anthropic" } }));
    expect(view.rail.map((item) => item.id)).toEqual(["favorites", "anthropic", "openai"]);
    expect(view.rail.find((item) => item.id === "anthropic")).toMatchObject({ selected: true, inUse: true, label: "Anthropic" });
  });

  it("names providers on the rail the short way", () => {
    expect(railLabel("Codex CLI")).toBe("Codex");
    expect(railLabel("Ollama (on this computer)")).toBe("Ollama");
    expect(railLabel("Claude Code")).toBe("Claude Code");
    expect(pickerView(status(), [], state()).rail[0]).toMatchObject({ id: "favorites", label: "Favourites" });
  });

  it("opens on Favourites when there are some, else on the provider in use", () => {
    expect(defaultFilter(status(), [])).toEqual({ provider: "anthropic" });
    expect(defaultFilter(status(), [{ provider: "openai", model: "gpt-1" }])).toBe("favorites");
    // A favourite that cannot answer does not count.
    expect(defaultFilter(status(), [{ provider: "nokey", model: "x" }])).toEqual({ provider: "anthropic" });
  });

  it("shows eight rows per provider, then Show more", () => {
    const view = pickerView(status(), [], state({ filter: { provider: "openai" } }));
    expect(view.groups[0]!.rows).toHaveLength(ROWS_PER_PROVIDER);
    expect(view.groups[0]!.hidden).toBe(11 - ROWS_PER_PROVIDER);
    const more = pickerView(status(), [], state({ filter: { provider: "openai" }, expanded: new Set(["openai"]) }));
    expect(more.groups[0]!.rows).toHaveLength(11);
    expect(more.groups[0]!.hidden).toBe(0);
  });

  it("marks the model in use", () => {
    const rows = pickerView(status(), [], state({ filter: { provider: "anthropic" } })).rows;
    expect(rows.map((row) => [row.modelName, row.current])).toEqual([["Fable 5.1", true], ["Haiku", false]]);
  });

  it("keeps a model in use that its provider no longer lists", () => {
    const rows = pickerView(status({ activeModel: "custom-1" }), [], state({ filter: { provider: "anthropic" } })).rows;
    expect(rows[0]).toMatchObject({ model: "custom-1", modelName: "custom-1", current: true });
  });

  it("searches every connected provider by name, id and provider", () => {
    const byName = pickerView(status(), [], state({ query: "fable" }));
    expect(byName.rows.map((row) => row.model)).toEqual(["fable"]);
    expect(byName.groups[0]!.heading).toBe("Anthropic");
    expect(byName.rail.every((item) => !item.selected)).toBe(true);
    expect(pickerView(status(), [], state({ query: "gpt-1" })).rows.map((row) => row.model)).toEqual(["gpt-1", "gpt-10"]);
    expect(pickerView(status(), [], state({ query: "anthropic hai" })).rows.map((row) => row.model)).toEqual(["haiku"]);
    expect(pickerView(status(), [], state({ query: "zzz" })).empty).toBe('No model matches "zzz".');
  });

  it("says plainly when there is nothing to list", () => {
    expect(pickerView(status(), [], state()).empty).toMatch(/No favourites yet/);
    const none = status({ providers: [provider("nokey", [model("x")], { hasKey: false })] });
    expect(pickerView(none, [], state()).empty).toMatch(/No models are connected yet/);
  });
});

describe("reasoning", () => {
  it("offers the levels a model reports, mapping minimal to Low and xhigh to Max", () => {
    expect(offeredEfforts(model("a", { efforts: ["low", "medium", "high", "xhigh"] }))).toEqual(["low", "medium", "high", "max"]);
    expect(offeredEfforts(model("a", { efforts: ["minimal", "high"] }))).toEqual(["low", "high"]);
    expect(offeredEfforts(model("a", { efforts: ["none"] }))).toBeNull();
    expect(offeredEfforts(model("a", { efforts: [] }))).toBeNull();
  });

  it("offers all four for a reasoning model whose levels are unknown, and none for a model that does not reason", () => {
    expect(offeredEfforts(model("a", { reasoning: true }))).toEqual(["low", "medium", "high", "max"]);
    expect(offeredEfforts(model("a"))).toBeNull();
    expect(offeredEfforts(undefined)).toEqual(["low", "medium", "high", "max"]);
  });

  it("always offers Auto first and checks the level in use", () => {
    const view = reasoningView(model("a", { efforts: ["low", "high"] }), "high");
    expect(view.supported).toBe(true);
    expect(view.options.map((option) => option.label)).toEqual(["Auto (Default)", "Low", "High"]);
    expect(view.options.filter((option) => option.checked).map((option) => option.value)).toEqual(["high"]);
    expect(view.note).toBeNull();
  });

  it("says when the level in use is not one this model has", () => {
    const view = reasoningView(model("a", { efforts: ["low", "high"] }), "max");
    expect(view.options.some((option) => option.checked)).toBe(false);
    expect(view.note).toMatch(/Max is not offered here/);
  });

  it("explains a model with no thinking levels in a plain sentence", () => {
    const view = reasoningView(model("a"), "auto");
    expect(view).toMatchObject({ supported: false, options: [] });
    expect(view.note).toMatch(/answers straight away/);
  });

  it("reads anything unknown as Auto", () => {
    expect(effortFrom("high")).toBe("high");
    expect(effortFrom("xhigh")).toBe("auto");
    expect(effortFrom(undefined)).toBe("auto");
  });
});

describe("the chip", () => {
  it("says the model and the effort, leaving Auto off", () => {
    expect(composerChipLabel(status())).toBe("Fable 5.1");
    expect(composerChipLabel(status({ effort: "auto" }))).toBe("Fable 5.1");
    expect(composerChipLabel(status({ effort: "high" }))).toBe("Fable 5.1 · High");
    expect(composerChipLabel(status({ effort: "max" }))).toBe("Fable 5.1 · Max");
  });

  it("never claims an effort the model in use does not take", () => {
    expect(composerChipLabel(status({ activeModel: "haiku", effort: "high" }))).toBe("Haiku");
  });
});

describe("modelPicker.css", () => {
  const css = readFileSync(join(import.meta.dirname, "../src/renderer/styles/modelPicker.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = readFileSync(join(import.meta.dirname, "../src/renderer/styles/tokens.css"), "utf8");
  const main = readFileSync(join(import.meta.dirname, "../src/renderer/main.ts"), "utf8");
  const picker = readFileSync(join(import.meta.dirname, "../src/renderer/ai/modelPicker.ts"), "utf8");

  /** The body of the first block that opens with `opener`, braces balanced. */
  function block(opener: string): string {
    const start = css.indexOf(opener);
    if (start < 0) return "";
    let depth = 0;
    for (let index = css.indexOf("{", start); index < css.length; index++) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      if (depth === 0) return css.slice(css.indexOf("{", start) + 1, index);
    }
    return "";
  }

  it("is loaded by the renderer", () => {
    expect(main).toContain('import "./styles/modelPicker.css";');
  });

  it("uses only tokens that tokens.css defines", () => {
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]!));
    expect([...used].filter((name) => !tokens.includes(`${name}:`))).toEqual([]);
  });

  it("animates only transform and opacity, behind both stillness switches", () => {
    for (const frames of css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})+\s*\}/g) ?? []) {
      const properties = [...frames.replace(/@keyframes[^{]+\{/, "").matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
      for (const property of properties) expect(["transform", "opacity"]).toContain(property);
    }
    const guard = block("@media (prefers-reduced-motion: no-preference)");
    expect(guard).toContain("animation");
    const outside = css.replace(guard, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})+\s*\}/g, "");
    expect(outside).not.toMatch(/\b(animation|transition)(-[a-z-]+)?\s*:/);
    for (const rule of guard.match(/[^{}]+\{[^{}]*\}/g) ?? []) {
      for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) {
        expect(selector.trim().startsWith(':root:not([data-reduced-motion="true"])')).toBe(true);
      }
    }
    expect(css).not.toMatch(/transition\s*:\s*all\b/);
    expect(css).not.toMatch(/ease-in\b(?!-out)/);
    expect(css).not.toMatch(/scale\(0\)/);
  });

  it("keeps hover for a fine pointer", () => {
    const fine = block("@media (hover: hover) and (pointer: fine)");
    expect(fine).toContain(":hover");
    expect(css.replace(fine, "")).not.toContain(":hover");
  });

  it("draws icons, not emoji or star characters", () => {
    expect(picker + css).not.toMatch(/[\u{1F300}-\u{1FAFF}✨★☆]/u);
  });
});
