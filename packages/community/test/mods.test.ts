import { describe, expect, it } from "vitest";
import { describeInstalledMods, describeMod, modIdFor, modToolDefinition, readMod, MOD_TOOL_NAME } from "../src/mods.ts";

const manifest = {
  format: 1, id: "warm-paper", name: "Warm paper", version: "1.0.0", description: "A warm paper look for long reading sessions.",
  icon: "📜", category: "themes", tags: ["theme"], readme: "Ask the chat to turn it off.",
  contributes: {
    theme: { name: "Warm paper", tokens: { "--bg-app": "#f6efe2", "--text-primary": "#3b2a1a", "--accent": "#c4623a" } },
    slashCommands: [{ id: "standup", hint: "Summarise yesterday", kind: "prompt", prompt: "Summarise what changed in git since yesterday as a standup update.", overrides: false }],
  },
};

describe("mods", () => {
  it("reads the assistant's manifest into a checked mod in the mod namespace", () => {
    const draft = readMod(manifest);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.manifest.id).toBe("mod-warm-paper");
    expect(describeMod(draft.manifest)).toEqual(['Colours: the "Warm paper" theme (3 colours)', "Chat command /standup - Summarise yesterday"]);
    expect(readMod(JSON.stringify(manifest)).ok).toBe(true);
  });

  it("refuses what the plugin format refuses, with the reasons", () => {
    const draft = readMod({ ...manifest, contributes: { settings: { "adcode.ai.provider": "evil" } } });
    expect(draft.ok).toBe(false);
    expect(!draft.ok && draft.problems.length).toBeGreaterThan(0);
    expect(readMod("not json").ok).toBe(false);
    expect(readMod([1]).ok).toBe(false);
  });

  it("keeps every id inside the mod namespace", () => {
    expect(modIdFor("mod-clock")).toBe("mod-clock");
    expect(modIdFor("Status Clock!")).toBe("mod-status-clock");
    expect(modIdFor(undefined)).toBe("mod-custom");
    expect(modIdFor("")).toBe("mod-mine");
  });

  it("offers a tool whose first sentence fits the load_tools catalogue", () => {
    const tool = modToolDefinition(["review"]);
    expect(tool.name).toBe(MOD_TOOL_NAME);
    expect(tool.description.split("\n")[0]!.length).toBeLessThan(220);
    expect(tool.description).toContain("review");
  });

  it("lists only mods, with what each changes", () => {
    const read = readMod(manifest);
    if (!read.ok) throw new Error("bad");
    const other = { ...read.manifest, id: "word-count" };
    const text = describeInstalledMods([{ manifest: read.manifest, enabled: true }, { manifest: other, enabled: true }]);
    expect(text).toContain("mod-warm-paper v1.0.0 (on)");
    expect(text).not.toContain("word-count");
    expect(describeInstalledMods([])).toBe("No mods yet.");
  });
});
