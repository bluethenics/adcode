import { describe, expect, it } from "vitest";
import {
  blankManifest, checkPluginManifest, compareVersions, describeContributions, draftFromFeature, draftFromPlugin,
  nextVersion, parsePluginManifest, pluginIdFrom, pluginMaySet, PluginManifestError, skillMarkdown,
} from "@adcode/community";

const valid = (patch: Record<string, unknown> = {}, contributes: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...blankManifest("Explain like I'm five"),
  ...patch,
  contributes: { ...(blankManifest()["contributes"] as Record<string, unknown>), ...contributes },
});

describe("plugin manifests", () => {
  it("accepts the blank manifest the Studio starts from", () => {
    const manifest = parsePluginManifest(valid());
    expect(manifest.id).toBe("explain-like-im-five");
    expect(manifest.contributes.actions).toHaveLength(1);
    expect(describeContributions(manifest.contributes)).toBe("1 AI action");
  });

  it("reads JSON text and reports every problem at once", () => {
    const result = checkPluginManifest(JSON.stringify({ id: "X", name: "", version: "1", category: "nope" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.length).toBeGreaterThanOrEqual(4);
      expect(result.problems.join(" ")).toMatch(/id must be/);
      expect(result.problems.join(" ")).toMatch(/version/);
    }
    expect(() => parsePluginManifest("{not json")).toThrow(PluginManifestError);
  });

  it("refuses a plugin that contributes nothing", () => {
    const result = checkPluginManifest(valid({}, { actions: [] }));
    expect(result.ok).toBe(false);
  });

  it("requires overrides: true to replace a built-in slash command, and nothing to override otherwise", () => {
    const review = { id: "review", hint: "Strict review", prompt: "Review these changes like a staff engineer would.", kind: "diff" };
    expect(checkPluginManifest(valid({}, { slashCommands: [review] }), ["review"]).ok).toBe(false);
    const ok = parsePluginManifest(valid({}, { slashCommands: [{ ...review, overrides: true }] }), ["review"]);
    expect(ok.contributes.slashCommands[0]).toMatchObject({ id: "review", kind: "diff", overrides: true });
    expect(checkPluginManifest(valid({}, { slashCommands: [{ ...review, id: "shout", overrides: true }] }), ["review"]).ok).toBe(false);
  });

  it("keeps macros to ADCode's own commands", () => {
    expect(parsePluginManifest(valid({}, { macros: [{ id: "ship", title: "Save and test", commands: ["file.saveAll", "run.test"] }] })).contributes.macros[0]!.commands).toEqual(["file.saveAll", "run.test"]);
    expect(checkPluginManifest(valid({}, { macros: [{ id: "loop", title: "Loop", commands: ["plugin.macro.x.loop"] }] })).ok).toBe(false);
    expect(checkPluginManifest(valid({}, { macros: [{ id: "bad", title: "Shell", commands: ["rm -rf /"] }] })).ok).toBe(false);
  });

  it("only lets themes set known tokens to hex colours", () => {
    const theme = parsePluginManifest(valid({}, { theme: { name: "Dusk", tokens: { "--accent": "#FF8800" } } })).contributes.theme;
    expect(theme).toEqual({ name: "Dusk", tokens: { "--accent": "#ff8800" } });
    expect(checkPluginManifest(valid({}, { theme: { name: "Bad", tokens: { "--accent": "red; background:url(x)" } } })).ok).toBe(false);
    expect(checkPluginManifest(valid({}, { theme: { name: "Bad", tokens: { "--anything": "#fff" } } })).ok).toBe(false);
  });

  it("allows harmless setting presets and refuses the ones that must stay with the person", () => {
    expect(pluginMaySet("adcode.editing.minimap")).toBe(true);
    expect(pluginMaySet("adcode.ai.provider")).toBe(false);
    expect(pluginMaySet("adcode.ads.enabled")).toBe(false);
    expect(pluginMaySet("adcode.language.customServers")).toBe(false);
    expect(pluginMaySet("adcode.ai.askBeforeConnectorTools")).toBe(false);
    expect(parsePluginManifest(valid({}, { settings: { "adcode.editing.minimap": false } })).contributes.settings).toEqual({ "adcode.editing.minimap": false });
    const refused = checkPluginManifest(valid({}, { settings: { "adcode.ads.enabled": false } }));
    expect(refused.ok).toBe(false);
    expect(checkPluginManifest(valid({}, { settings: { "adcode.editing.minimap": "yes" } })).ok).toBe(false);
  });

  it("validates skills and writes them as SKILL.md with quoted frontmatter", () => {
    const manifest = parsePluginManifest(valid({}, { skills: [{ name: "api-review", description: "Review REST APIs: naming, errors, pagination.", body: "When reviewing an API, check the following carefully." }] }));
    const markdown = skillMarkdown(manifest.contributes.skills[0]!, manifest.name);
    expect(markdown).toMatch(/^---\nname: api-review\ndescription: "Review REST APIs: naming, errors, pagination."\n---/);
    expect(checkPluginManifest(valid({}, { skills: [{ name: "Bad Name", description: "x", body: "y" }] })).ok).toBe(false);
  });

  it("rejects duplicate names within one kind", () => {
    const action = { id: "same", title: "Same thing", prompt: "Do the same thing twice please." };
    expect(checkPluginManifest(valid({}, { actions: [action, action] })).ok).toBe(false);
  });

  it("orders versions and suggests the next one", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(nextVersion("1.2.3")).toBe("1.2.4");
  });

  it("makes ids from names", () => {
    expect(pluginIdFrom("Café Tools!")).toBe("cafe-tools");
    expect(pluginIdFrom("A")).toBe("a-plugin");
  });

  it("drafts a remix of a built-in feature that validates once published", () => {
    const draft = draftFromFeature({
      id: "adcode.editing.minimap",
      title: "Minimap",
      plain: "A tiny picture of the whole file.",
      commands: [{ command: "view.toggleSidebar", label: "Toggle" }, { command: "community.studio", label: "Nope" }],
      settings: { "adcode.editing.minimap": true, "adcode.ai.provider": "openai" },
      slash: [{ id: "review", hint: "Review", prompt: "Review the attached uncommitted changes for bugs.", kind: "diff" }],
    });
    const manifest = parsePluginManifest(draft, ["review"]);
    expect(manifest.remixOf).toBe("feature:adcode.editing.minimap");
    expect(manifest.contributes.settings).toEqual({ "adcode.editing.minimap": true });
    expect(manifest.contributes.macros[0]!.commands).toEqual(["view.toggleSidebar"]);
    expect(manifest.contributes.slashCommands[0]!.overrides).toBe(true);
  });

  it("drafts a remix of another plugin under a new id, crediting the original", () => {
    const original = parsePluginManifest(valid());
    const remix = parsePluginManifest(draftFromPlugin(original, "My explainer"));
    expect(remix.id).toBe("my-explainer");
    expect(remix.version).toBe("1.0.0");
    expect(remix.remixOf).toBe("plugin:explain-like-im-five");
  });
});
