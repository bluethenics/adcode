import { describe, it, expect } from "vitest";
import {
  SETTINGS_SCHEMA,
  SETTINGS_VERSION,
  GROUPS,
  defaultSettings,
  validateSettings,
  migrate,
  settingsForGroup,
  searchSettings,
  type SettingId,
} from "../src/index.ts";

const byId = new Map(SETTINGS_SCHEMA.map((s) => [s.id, s]));

describe("schema completeness", () => {
  // Brief §4: "every item has an `adcode.*` boolean or enum setting so the user can
  // switch it off." Defaults below are quoted from §4 directly.
  const REQUIRED: ReadonlyArray<[string, boolean]> = [
    ["adcode.editing.bracketPairColorization", true],
    ["adcode.editing.inlineErrorLens", true],
    ["adcode.editing.inlineGitBlame", false],
    ["adcode.editing.stickyScroll", true],
    ["adcode.editing.indentGuides", true],
    ["adcode.editing.todoHighlighting", true],
    ["adcode.editing.autoRenamePairedTag", true],
    ["adcode.editing.pathAutocomplete", true],
    ["adcode.editing.trailingWhitespace", false],
    ["adcode.editing.minimap", true],
    ["adcode.editing.codeFolding", true],
    ["adcode.editing.multiCursor", true],

    ["adcode.formatting.formatter", true],
    ["adcode.formatting.formatOnSave", true],
    ["adcode.formatting.lintDiagnostics", true],
    ["adcode.formatting.organizeImportsOnSave", false],

    ["adcode.git.gutterDiff", true],
    ["adcode.git.blame", false],
    ["adcode.git.stageCommitUi", true],
    ["adcode.git.branchSwitcher", true],
    ["adcode.git.mergeConflict", true],
    ["adcode.git.fileTimeline", true],

    ["adcode.navigation.fuzzyFileOpen", true],
    ["adcode.navigation.symbolSearch", true],
    ["adcode.navigation.globalSearch", true],
    ["adcode.navigation.goToDefinition", true],
    ["adcode.navigation.breadcrumbs", true],
    ["adcode.navigation.outline", true],

    ["adcode.language.lspClient", true],
    ["adcode.language.dapClient", true],
    ["adcode.language.treeSitterHighlighting", true],

    ["adcode.session.workspaceRestore", true],
    ["adcode.session.autoSave", true],
    ["adcode.session.localFileHistory", true],
    ["adcode.session.crashRecovery", true],

    ["adcode.ai.chatWidget", true],
    ["adcode.ai.inlineCompletion", true],
    ["adcode.ai.terminalAgentDetection", true],
    ["adcode.ai.memoryCapture", true],
    ["adcode.ai.mcpServer", true],
  ];

  for (const [id, expected] of REQUIRED) {
    it(`${id} exists and defaults to ${expected}`, () => {
      const setting = byId.get(id as SettingId);
      expect(setting, `${id} must exist`).toBeDefined();
      expect(setting?.kind).toBe("boolean");
      expect(setting?.default).toBe(expected);
    });
  }

  it("covers every §4 feature and nothing is orphaned from a group", () => {
    for (const setting of SETTINGS_SCHEMA) {
      expect(GROUPS.map((g) => g.id)).toContain(setting.group);
      expect(setting.id.startsWith("adcode.")).toBe(true);
      expect(setting.label.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    const ids = SETTINGS_SCHEMA.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ads settings", () => {
  it("exposes a local kill switch, per §1", () => {
    // "Remote kill switch plus a local `adcode.ads.enabled` setting. Either stops
    // everything."
    const setting = byId.get("adcode.ads.enabled" as SettingId);
    expect(setting?.kind).toBe("boolean");
    expect(setting?.default).toBe(true);
  });

  it("offers exactly the four frequency presets from §8.1, defaulting to standard", () => {
    const setting = byId.get("adcode.ads.frequency" as SettingId);
    expect(setting?.kind).toBe("enum");
    if (setting?.kind === "enum") {
      expect(setting.options.map((o) => o.value)).toEqual(["off", "light", "standard", "max"]);
    }
    expect(setting?.default).toBe("standard");
  });

  it("keeps off as a real option", () => {
    // §8.1: "`off` is a real option and disables earnings accordingly."
    const setting = byId.get("adcode.ads.frequency" as SettingId);
    if (setting?.kind === "enum") {
      expect(setting.options.some((o) => o.value === "off")).toBe(true);
    }
  });
});

describe("appearance", () => {
  it("makes density a setting rather than a decision, per §3", () => {
    const setting = byId.get("adcode.appearance.density" as SettingId);
    expect(setting?.kind).toBe("enum");
    if (setting?.kind === "enum") {
      expect(setting.options.map((o) => o.value)).toEqual(["comfortable", "compact"]);
    }
    expect(setting?.default).toBe("comfortable");
  });
});

describe("defaultSettings", () => {
  it("returns a value for every setting in the schema", () => {
    const defaults = defaultSettings();
    expect(Object.keys(defaults).length).toBe(SETTINGS_SCHEMA.length);

    for (const setting of SETTINGS_SCHEMA) {
      expect(defaults[setting.id]).toBe(setting.default);
    }
  });
});

describe("validateSettings", () => {
  it("fills missing keys from defaults", () => {
    const result = validateSettings({ "adcode.editing.minimap": false });
    expect(result["adcode.editing.minimap"]).toBe(false);
    expect(result["adcode.editing.stickyScroll"]).toBe(true);
  });

  it("drops unknown keys rather than storing them", () => {
    const result = validateSettings({ "adcode.not.a.real.setting": true });
    expect("adcode.not.a.real.setting" in result).toBe(false);
  });

  it("rejects a wrong type and falls back to the default", () => {
    const result = validateSettings({ "adcode.editing.minimap": "yes" });
    expect(result["adcode.editing.minimap"]).toBe(true);
  });

  it("rejects an out-of-range enum value", () => {
    const result = validateSettings({ "adcode.ads.frequency": "constant" });
    expect(result["adcode.ads.frequency"]).toBe("standard");
  });

  it("survives hostile input without throwing", () => {
    for (const hostile of [null, undefined, 42, "text", [], { __proto__: { polluted: true } }]) {
      expect(() => validateSettings(hostile)).not.toThrow();
    }
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("never returns a prototype-polluting key", () => {
    const result = validateSettings(JSON.parse('{"__proto__":{"polluted":true}}'));
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
  });
});

describe("migrate", () => {
  it("stamps the current version onto unversioned data", () => {
    const result = migrate({ version: undefined, values: { "adcode.editing.minimap": false } });
    expect(result.version).toBe(SETTINGS_VERSION);
    expect(result.values["adcode.editing.minimap"]).toBe(false);
  });

  it("returns defaults for data from a future version rather than guessing", () => {
    // Downgrading is real: a user on two machines with different builds. Guessing at a
    // schema this build has never seen would corrupt their settings silently.
    const result = migrate({ version: SETTINGS_VERSION + 99, values: { anything: true } });
    expect(result.version).toBe(SETTINGS_VERSION);
    expect(result.values).toEqual(defaultSettings());
  });

  it("is idempotent", () => {
    const once = migrate({ version: SETTINGS_VERSION, values: defaultSettings() });
    const twice = migrate(once);
    expect(twice).toEqual(once);
  });
});

describe("grouping and search", () => {
  it("returns settings for a group in schema order", () => {
    const editing = settingsForGroup("editing");
    expect(editing.length).toBe(19);
    expect(editing.every((s) => s.group === "editing")).toBe(true);
  });

  it("finds settings by label, not just by id", () => {
    const hits = searchSettings("minimap");
    expect(hits.some((s) => s.id === "adcode.editing.minimap")).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(searchSettings("  MINIMAP ").length).toBeGreaterThan(0);
  });

  it("returns everything for an empty query", () => {
    expect(searchSettings("").length).toBe(SETTINGS_SCHEMA.length);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchSettings("zzzznope")).toEqual([]);
  });
});
