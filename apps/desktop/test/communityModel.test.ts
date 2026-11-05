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
  return { manifest, enabled, source: "directory", installedAt, update: null, options: {}, pinned: false };
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

describe("plugin options in prompts", () => {
  it("fills {{option}} in actions and slash commands with the chosen values", () => {
    const base = blankManifest("Opt test");
    const manifest = parsePluginManifest({
      ...base,
      options: [{ id: "focus", label: "Focus", type: "choice", default: "all", choices: [{ value: "all", label: "Everything" }, { value: "sec", label: "Security" }] }],
      contributes: { actions: [{ id: "go", title: "Go now", uses: "nothing", prompt: "Look at {{focus}} first, please." }], slashCommands: [{ id: "deep", hint: "Deep look", prompt: "Concentrate on {{focus}}: ", overrides: false }] },
    }, BUILT_IN);
    const view: InstalledPluginView = { manifest, enabled: true, source: "starter", installedAt: 1, update: null, options: { focus: "sec" }, pinned: false };
    expect(pluginCommands([view])[0]!.action!.prompt).toBe("Look at security first, please.");
    expect(pluginSlashCommands([view])[0]!.prompt).toBe("Concentrate on security:");
  });
});

describe("Help improve ADCode names", () => {
  it("accepts exactly the names the service accepts", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const desktop = readFileSync(join(import.meta.dirname, "../src/main/appUsage.ts"), "utf8").match(/const NAME = (\/.+\/);/)?.[1];
    const service = readFileSync(join(import.meta.dirname, "../../../services/api/src/appUsage.ts"), "utf8").match(/export const APP_USAGE_NAME = (\/.+\/);/)?.[1];
    expect(desktop).toBeDefined();
    expect(desktop).toBe(service);
  });
});
