import { describe, expect, it } from "vitest";
import {
  ADDON_CSP, STARTER_PLUGINS, addonDataFor, fillOptions, optionDisplay, optionValues, addonDocument, addonUrl, artifactFolderAllowed, blankManifest, checkPluginManifest,
  clampAddonSize, describeContributions, gitignoreMatcher, notAProjectReason, parseAddonUrl, parsePluginManifest, readAddonRequest,
  type PluginAddon,
} from "@adcode/community";

const BUILT_IN = ["review", "commit", "explain", "new", "model"];

const addon = (patch: Partial<PluginAddon> = {}): PluginAddon => ({ id: "meter", title: "Meter", slot: "chat", html: "<b>hi</b>", data: ["usage"], commands: ["ai.showUsage"], prompt: false, ...patch });

describe("add-ons in a manifest", () => {
  const withAddon = (patch: Record<string, unknown>) => ({ ...blankManifest("Addon test"), contributes: { addons: [{ id: "panel", title: "A panel", slot: "sidebar", html: "<p>Hello</p>", data: ["git"], commands: ["workspace.changes"], prompt: true, ...patch }] } });

  it("accepts a sidebar add-on and describes it", () => {
    const manifest = parsePluginManifest(withAddon({}));
    expect(manifest.contributes.addons[0]).toMatchObject({ slot: "sidebar", data: ["git"], commands: ["workspace.changes"], prompt: true });
    expect(describeContributions(manifest.contributes)).toBe("1 add-on");
  });

  it("refuses unknown slots, data, and commands it may not run", () => {
    expect(checkPluginManifest(withAddon({ slot: "titlebar" })).ok).toBe(false);
    expect(checkPluginManifest(withAddon({ data: ["files"] })).ok).toBe(false);
    expect(checkPluginManifest(withAddon({ commands: ["community.studio"] })).ok).toBe(false);
    expect(checkPluginManifest(withAddon({ html: "" })).ok).toBe(false);
    expect(checkPluginManifest(withAddon({ html: "x".repeat(70_000) })).ok).toBe(false);
  });
});

describe("the add-on bridge", () => {
  it("passes only what the manifest allows", () => {
    expect(readAddonRequest(addon(), { adcode: 1, type: "run", command: "ai.showUsage" })).toEqual({ type: "run", command: "ai.showUsage" });
    expect(readAddonRequest(addon(), { adcode: 1, type: "run", command: "file.saveAll" })).toBeNull();
    expect(readAddonRequest(addon(), { adcode: 1, type: "prompt", text: "hi" })).toBeNull();
    expect(readAddonRequest(addon({ prompt: true }), { adcode: 1, type: "prompt", text: "hi" })).toEqual({ type: "prompt", text: "hi" });
    expect(readAddonRequest(addon(), { type: "run", command: "ai.showUsage" })).toBeNull();
    expect(readAddonRequest(addon(), { adcode: 1, type: "store", value: { a: "x".repeat(5000) } })).toBeNull();
    expect(readAddonRequest(addon(), { adcode: 1, type: "store", value: { rounds: 2 } })).toEqual({ type: "store", value: { rounds: 2 } });
  });

  it("clamps sizes to the slot", () => {
    expect(clampAddonSize("chat", 900, 900)).toEqual({ height: 180, width: null });
    expect(clampAddonSize("statusbar", 80, 999)).toEqual({ height: 22, width: 260 });
    expect(readAddonRequest(addon({ slot: "sidebar" }), { adcode: 1, type: "resize", height: 10 })).toEqual({ type: "resize", height: 24, width: null });
  });

  it("hands an add-on only the data it declared", () => {
    expect(addonDataFor(addon({ data: ["git"] }), { git: { isRepo: true, branch: "main", changed: 1, ahead: 0, behind: 0 }, earnings: { balance: "$1" } })).toEqual({ git: { isRepo: true, branch: "main", changed: 1, ahead: 0, behind: 0 } });
  });

  it("seals the document: no network, no frames, no forms", () => {
    expect(ADDON_CSP).toContain("default-src 'none'");
    expect(ADDON_CSP).toContain("connect-src 'none'");
    expect(ADDON_CSP).not.toMatch(/https?:/);
    expect(addonDocument(addon())).toContain("window.adcode = Object.freeze");
  });

  it("round-trips add-on URLs and refuses others", () => {
    expect(parseAddonUrl(addonUrl("usage-meter", "meter", "1.0.0"))).toEqual({ pluginId: "usage-meter", addonId: "meter" });
    expect(parseAddonUrl("adcode-addon://addon/../x")).toBeNull();
    expect(parseAddonUrl("https://evil.example/usage-meter/meter")).toBeNull();
  });
});

describe("plugins made by ADCode", () => {
  it("ships eight, every one valid, with unique ids", () => {
    expect(STARTER_PLUGINS).toHaveLength(8);
    const manifests = STARTER_PLUGINS.map((starter) => parsePluginManifest(starter, BUILT_IN));
    expect(new Set(manifests.map((manifest) => manifest.id)).size).toBe(8);
    expect(manifests.filter((manifest) => manifest.contributes.addons.length > 0).map((manifest) => manifest.contributes.addons[0]!.slot).sort())
      .toEqual(["chat", "chat", "sidebar", "statusbar", "statusbar", "statusbar"]);
  });
});

describe("sharing a folder that is not a project", () => {
  it("refuses a drive, the home folder and personal folders", () => {
    expect(notAProjectReason("C:\\", "C:\\Users\\Ana", [])).toMatch(/whole drive/);
    expect(notAProjectReason("C:\\Users\\Ana", "C:\\Users\\Ana", [])).toMatch(/home folder/);
    expect(notAProjectReason("C:\\Users", "C:\\Users\\Ana", [])).toMatch(/home folder/);
    expect(notAProjectReason("D:\\Stuff", "C:\\Users\\Ana", ["Desktop", "Documents", "Downloads", "notes.txt"])).toMatch(/personal folder/);
    expect(notAProjectReason("C:\\Users\\Ana\\code\\game", "C:\\Users\\Ana", ["src", "package.json"])).toBeNull();
  });

  it("skips hidden folders except the ones projects keep", () => {
    expect(artifactFolderAllowed(".local")).toBe(false);
    expect(artifactFolderAllowed(".ssh")).toBe(false);
    expect(artifactFolderAllowed(".github")).toBe(true);
    expect(artifactFolderAllowed("src")).toBe(true);
  });

  it("follows .gitignore", () => {
    const ignored = gitignoreMatcher("# deps\nnode_modules/\n*.log\n/secret.txt\nbuild/\n!build/keep.txt\ndocs/**/*.tmp\n");
    expect(ignored("app.log", false)).toBe(true);
    expect(ignored("logs/app.log", false)).toBe(true);
    expect(ignored("secret.txt", false)).toBe(true);
    expect(ignored("src/secret.txt", false)).toBe(false);
    expect(ignored("build", true)).toBe(true);
    expect(ignored("build/keep.txt", false)).toBe(false);
    expect(ignored("docs/a/b/c.tmp", false)).toBe(true);
    expect(ignored("src/app.ts", false)).toBe(false);
  });
});

describe("plugin options", () => {
  const manifest = () => parsePluginManifest({
    ...blankManifest("Options test"),
    options: [
      { id: "minutes", label: "Minutes", type: "number", default: 25, min: 5, max: 90, step: 5 },
      { id: "loud", label: "Loud", type: "toggle", default: false },
      { id: "focus", label: "Focus", type: "choice", default: "all", choices: [{ value: "all", label: "Everything" }, { value: "sec", label: "Security" }] },
    ],
  });

  it("validates option definitions", () => {
    expect(manifest().options.map((option) => option.type)).toEqual(["number", "toggle", "choice"]);
    expect(checkPluginManifest({ ...blankManifest(), options: [{ id: "x", label: "X", type: "number", default: 500, min: 0, max: 10 }] }).ok).toBe(false);
    expect(checkPluginManifest({ ...blankManifest(), options: [{ id: "x", label: "X", type: "choice", default: "z", choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }] }).ok).toBe(false);
    expect(checkPluginManifest({ ...blankManifest(), options: [{ id: "x", label: "X", type: "slider", default: 1 }] }).ok).toBe(false);
  });

  it("keeps chosen values that are still valid and falls back to defaults", () => {
    const { options } = manifest();
    expect(optionValues(options, { minutes: 200, loud: "yes", focus: "sec", gone: 1 })).toEqual({ minutes: 90, loud: false, focus: "sec" });
    expect(optionValues(options, null)).toEqual({ minutes: 25, loud: false, focus: "all" });
  });

  it("fills prompts, choices by their label", () => {
    const { options } = manifest();
    expect(fillOptions("Review for {{focus}} in {{ minutes }} min, {{unknown}}", optionDisplay(options, { minutes: 30, loud: true, focus: "sec" }))).toBe("Review for security in 30 min, {{unknown}}");
  });
});
