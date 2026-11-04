import { describe, expect, it } from "vitest";
import { blankManifest, checkPluginManifest, parsePluginManifest } from "@adcode/community";
import { featureRecords } from "@adcode/help";
import {
  actionPrompt, activeTheme, addContribution, aiBuildPrompt, installSummary, pluginCommands, pluginSlashCommands, remixableFeatures,
} from "../src/renderer/community/communityModel.ts";
import type { InstalledPluginView } from "../src/shared/community.ts";
import { SLASH_COMMANDS, allSlashCommands, expandSlashCommand, parseSlashCommand, setPluginSlashCommands } from "../src/shared/slashCommands.ts";

const BUILT_IN = SLASH_COMMANDS.map((command) => command.id);

function installed(patch: Record<string, unknown>, enabled = true, installedAt = 1): InstalledPluginView {
  const base = blankManifest("Strict tools");
  const manifest = parsePluginManifest({ ...base, ...patch, contributes: { ...(base["contributes"] as object), ...(patch["contributes"] as object | undefined) } }, BUILT_IN);
  return { manifest, enabled, source: "directory", installedAt, update: null };
}

describe("what installed plugins add", () => {
  const plugin = installed({ contributes: {
    macros: [{ id: "ship", title: "Save and review", commands: ["file.saveAll", "workspace.changes"] }],
    slashCommands: [{ id: "review", hint: "Very strict review", kind: "diff", prompt: "Review these changes as a strict staff engineer.", overrides: true }, { id: "eli5", hint: "Explain simply", prompt: "Explain this like I am five years old: ", overrides: false }],
    theme: { name: "Dusk", tokens: { "--accent": "#ff8800" } },
  } });

  it("registers palette commands for actions and macros of enabled plugins only", () => {
    expect(pluginCommands([plugin]).map((plan) => plan.id)).toEqual(["plugin.action.strict-tools.explain-simply", "plugin.macro.strict-tools.ship"]);
    expect(pluginCommands([{ ...plugin, enabled: false }])).toEqual([]);
  });

  it("asks the assistant with the selection or file named", () => {
    expect(actionPrompt({ id: "a", title: "A", prompt: "Do it.", uses: "selection" })).toMatch(/selected\.$/);
    expect(actionPrompt({ id: "a", title: "A", prompt: "Do it.", uses: "nothing" })).toBe("Do it.");
  });

  it("overrides a built-in chat command and adds new ones, and never shadows an action command", () => {
    setPluginSlashCommands([...pluginSlashCommands([plugin]), { id: "new", hint: "Hijack", kind: "prompt", prompt: "bad", overrides: true }]);
    try {
      expect(expandSlashCommand("/review")).toBe("Review these changes as a strict staff engineer.");
      expect(expandSlashCommand("/eli5 closures")).toBe("Explain this like I am five years old:\n\nclosures");
      expect(parseSlashCommand("/new")?.command.kind).toBe("action");
      expect(allSlashCommands().filter((command) => command.id === "review")).toHaveLength(1);
    } finally {
      setPluginSlashCommands([]);
    }
    expect(expandSlashCommand("/eli5 closures")).toBe("/eli5 closures");
  });

  it("applies the newest enabled theme", () => {
    const older = installed({ id: "older-theme", contributes: { theme: { name: "Old", tokens: { "--accent": "#000000" } } } }, true, 0);
    expect(activeTheme([older, plugin])).toMatchObject({ pluginId: "strict-tools", tokens: { "--accent": "#ff8800" } });
    expect(activeTheme([{ ...plugin, enabled: false }, older])?.pluginId).toBe("older-theme");
  });

  it("describes every change before install", () => {
    const lines = installSummary(plugin.manifest);
    expect(lines).toContain("Replaces the instruction behind /review");
    expect(lines.some((line) => line.startsWith("Macro \"Save and review\""))).toBe(true);
  });
});

describe("the Studio", () => {
  it("adds each kind of contribution and stays valid", () => {
    let text = JSON.stringify(blankManifest());
    for (const kind of ["action", "slash", "skill", "macro", "theme", "setting"] as const) {
      text = addContribution(text, kind)!;
      expect(checkPluginManifest(text, BUILT_IN)).toMatchObject({ ok: true });
    }
    expect(addContribution("{oops", "action")).toBeNull();
  });

  it("tells the assistant the format and where to write it", () => {
    const prompt = aiBuildPrompt("explain errors kindly", BUILT_IN);
    expect(prompt).toContain("adcode-plugin.json");
    expect(prompt).toContain("explain errors kindly");
  });

  it("offers built-in features to remix, including the chat commands", () => {
    const features = remixableFeatures(featureRecords(), { "adcode.editing.minimap": true }, SLASH_COMMANDS);
    expect(features.some((feature) => feature.id.startsWith("community."))).toBe(false);
    expect(features.find((feature) => feature.id === "adcode.editing.minimap")?.settings).toEqual({ "adcode.editing.minimap": true });
    expect(features.find((feature) => feature.id === "ai.composerCommands")?.slash?.map((one) => one.id)).toContain("review");
  });
});
