/**
 * Settings schema, defaults, and migration.
 *
 * Brief §4: "every item has an `adcode.*` boolean or enum setting so the user can switch
 * it off." This file is the single place that promise is written down, and §3 makes the
 * settings screen "where the 'turn anything off' promise is actually kept."
 *
 * Plain TypeScript: no Electron, no DOM, no I/O. Persistence belongs to the main process;
 * this package only says what a setting is, what it defaults to, and whether some
 * arbitrary JSON off the disk is a valid value for it.
 *
 * `available: false` marks a setting whose feature is not built yet. Showing the toggle
 * keeps the screen honest about the full §4 roster; disabling it keeps the screen honest
 * about what actually works today. Silently listing a switch that does nothing would be
 * worse than either.
 */

export const SETTINGS_VERSION = 1;

export type SettingGroupId =
  | "editing"
  | "formatting"
  | "git"
  | "navigation"
  | "language"
  | "session"
  | "ai"
  | "appearance"
  | "ads";

export interface SettingGroup {
  readonly id: SettingGroupId;
  readonly title: string;
  readonly caption: string;
}

/**
 * §3 says "the six feature groups in §4", but §4 lists seven (Editing, Formatting, Git,
 * Navigation, Language, Session, AI) - AI is cross-referenced to §5, which is probably
 * why it was not counted. All seven appear here, plus Appearance for §3's density
 * setting and Ads for §1's local kill switch and §8.1's frequency presets.
 */
export const GROUPS: readonly SettingGroup[] = [
  { id: "ads", title: "Ads & Earnings", caption: "Sponsored messages appear on your terms. Turning them off is a real option." },
  { id: "appearance", title: "Appearance", caption: "iOS spacing is generous; a 13-inch laptop is not. Density is yours to choose." },
  { id: "editing", title: "Editing", caption: "The editing surface itself." },
  { id: "formatting", title: "Formatting", caption: "Formatting and diagnostics." },
  { id: "git", title: "Git", caption: "Source control, built in." },
  { id: "navigation", title: "Navigation", caption: "Finding your way around a codebase." },
  { id: "language", title: "Language", caption: "Language servers, debugging, and highlighting." },
  { id: "session", title: "Session", caption: "What survives a restart." },
  { id: "ai", title: "AI", caption: "One memory, shared by every AI you work with." },
];

interface BaseSetting {
  readonly id: string;
  readonly group: SettingGroupId;
  readonly label: string;
  readonly description: string;
  /** False when the feature is not built yet; the row renders disabled. */
  readonly available: boolean;
}

export interface BooleanSetting extends BaseSetting {
  readonly kind: "boolean";
  readonly default: boolean;
}

export interface EnumOption {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
}

export interface EnumSetting extends BaseSetting {
  readonly kind: "enum";
  readonly default: string;
  readonly options: readonly EnumOption[];
}

export type Setting = BooleanSetting | EnumSetting;
export type SettingValue = boolean | string;
export type SettingId = string;
export type SettingsValues = Record<SettingId, SettingValue>;

const bool = (
  id: string,
  group: SettingGroupId,
  label: string,
  description: string,
  defaultValue: boolean,
  available = false,
): BooleanSetting => ({ id, group, label, description, kind: "boolean", default: defaultValue, available });

export const SETTINGS_SCHEMA: readonly Setting[] = [
  /* ── Ads (§1, §8.1) ─────────────────────────────────────────────────── */
  bool(
    "adcode.ads.enabled",
    "ads",
    "Sponsored messages",
    "A local kill switch. Turning this off stops everything on this machine, whatever the server says.",
    true,
    true,
  ),
  {
    id: "adcode.ads.frequency",
    group: "ads",
    kind: "enum",
    label: "Frequency",
    description:
      "Caps are enforced on this machine. The server may only ever tighten them, never loosen them.",
    default: "standard",
    available: true,
    options: [
      { value: "off", label: "Off", detail: "Never" },
      { value: "light", label: "Light", detail: "60 min · 4/day" },
      { value: "standard", label: "Standard", detail: "30 min · 8/day" },
      { value: "max", label: "Max", detail: "15 min · 20/day" },
    ],
  },

  /* ── Appearance (§3) ────────────────────────────────────────────────── */
  {
    id: "adcode.appearance.density",
    group: "appearance",
    kind: "enum",
    label: "Density",
    description: "Row height and spacing throughout the workbench.",
    default: "comfortable",
    available: true,
    options: [
      { value: "comfortable", label: "Comfortable" },
      { value: "compact", label: "Compact" },
    ],
  },
  {
    id: "adcode.appearance.theme",
    group: "appearance",
    kind: "enum",
    label: "Appearance",
    description: "Follows the system by default, including the accent colour.",
    default: "system",
    available: true,
    options: [
      { value: "system", label: "System" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
  },

  /* ── Editing (§4) ───────────────────────────────────────────────────── */
  bool("adcode.editing.bracketPairColorization", "editing", "Bracket pair colorization", "Colour matching brackets by depth.", true, true),
  bool("adcode.editing.inlineErrorLens", "editing", "Inline error and warning lens", "Show diagnostics at the end of the line they belong to.", true),
  bool("adcode.editing.inlineGitBlame", "editing", "Inline git blame", "Show the last author and commit beside the cursor's line.", false),
  bool("adcode.editing.stickyScroll", "editing", "Sticky scroll", "Pin enclosing scopes to the top of the editor while scrolling.", true, true),
  bool("adcode.editing.indentGuides", "editing", "Indent guides", "Vertical rules showing indentation depth.", true, true),
  bool("adcode.editing.todoHighlighting", "editing", "TODO and FIXME highlighting", "Highlight TODO, FIXME, and HACK comments.", true),
  bool("adcode.editing.autoRenamePairedTag", "editing", "Auto-rename paired tag", "Renaming an opening tag renames its closing tag.", true),
  bool("adcode.editing.pathAutocomplete", "editing", "Path autocomplete", "Complete file paths inside strings and imports.", true),
  bool("adcode.editing.trailingWhitespace", "editing", "Render trailing whitespace", "Make trailing spaces visible.", false, true),
  bool("adcode.editing.minimap", "editing", "Minimap", "The scaled overview down the right-hand edge.", true, true),
  bool("adcode.editing.codeFolding", "editing", "Code folding", "Collapse and expand regions.", true, true),
  bool("adcode.editing.multiCursor", "editing", "Multi-cursor and column select", "Multiple cursors and rectangular selection.", true, true),

  /* ── Formatting (§4) ────────────────────────────────────────────────── */
  bool("adcode.formatting.formatter", "formatting", "Built-in formatter", "Formatting with no extension to install.", true),
  bool("adcode.formatting.formatOnSave", "formatting", "Format on save", "Run the formatter every time a file is saved.", true),
  bool("adcode.formatting.lintDiagnostics", "formatting", "Lint diagnostics", "Surface diagnostics reported by the language server.", true),
  bool("adcode.formatting.organizeImportsOnSave", "formatting", "Organize imports on save", "Sort and prune imports when saving.", false),

  /* ── Git (§4) ───────────────────────────────────────────────────────── */
  bool("adcode.git.gutterDiff", "git", "Gutter diff decorations", "Mark added, changed, and deleted lines in the gutter.", true),
  bool("adcode.git.blame", "git", "Blame", "Attribute each line to its last commit.", false),
  bool("adcode.git.stageCommitUi", "git", "Stage, unstage, and commit", "Source-control UI for staging and committing.", true),
  bool("adcode.git.branchSwitcher", "git", "Branch switcher", "Switch and create branches from the status bar.", true),
  bool("adcode.git.mergeConflict", "git", "Merge conflict resolution", "Inline resolution for conflicted files.", true),
  bool("adcode.git.fileTimeline", "git", "File timeline", "The commit history of the open file.", true),

  /* ── Navigation (§4) ────────────────────────────────────────────────── */
  bool("adcode.navigation.fuzzyFileOpen", "navigation", "Fuzzy file open", "Open any file by typing part of its name.", true),
  bool("adcode.navigation.symbolSearch", "navigation", "Symbol search", "Jump to a symbol across the workspace.", true),
  bool("adcode.navigation.globalSearch", "navigation", "Global search and replace", "Regex search and replace across the workspace.", true),
  bool("adcode.navigation.goToDefinition", "navigation", "Go to definition and references", "Definition, references, and implementations.", true),
  bool("adcode.navigation.breadcrumbs", "navigation", "Breadcrumbs", "The path and symbol trail above the editor.", true),
  bool("adcode.navigation.outline", "navigation", "Outline", "The symbol tree for the open file.", true),

  /* ── Language (§4) ──────────────────────────────────────────────────── */
  bool("adcode.language.lspClient", "language", "Language server client", "Completion, diagnostics, and navigation from bundled servers.", true),
  bool("adcode.language.dapClient", "language", "Debug adapter client", "Breakpoints, stepping, and variable inspection.", true),
  bool("adcode.language.treeSitterHighlighting", "language", "Tree-sitter highlighting", "Syntax highlighting driven by a real parse tree.", true),

  /* ── Session (§4) ───────────────────────────────────────────────────── */
  bool("adcode.session.workspaceRestore", "session", "Restore workspace", "Reopen the last folder and editors on launch.", true),
  bool("adcode.session.autoSave", "session", "Auto-save after delay", "Save automatically once typing pauses.", true),
  bool("adcode.session.localFileHistory", "session", "Local file history", "Keep local versions of edited files.", true),
  bool("adcode.session.crashRecovery", "session", "Crash recovery", "Recover unsaved buffers after an unexpected exit.", true),

  /* ── AI (§5) ────────────────────────────────────────────────────────── */
  bool("adcode.ai.chatWidget", "ai", "Chat widget", "The floating chat card, summoned by keyboard shortcut.", true),
  bool("adcode.ai.inlineCompletion", "ai", "Inline completion", "Ghost text suggestions, accepted with Tab.", true),
  bool("adcode.ai.terminalAgentDetection", "ai", "Terminal agent detection", "Recognise CLI agents running in the built-in terminal.", true),
  bool("adcode.ai.memoryCapture", "ai", "Memory capture", "Record decisions and conventions to the shared project memory.", true),
  bool("adcode.ai.mcpServer", "ai", "MCP server", "Let external agents read and write the same memory.", true),
];

const BY_ID = new Map<SettingId, Setting>(SETTINGS_SCHEMA.map((s) => [s.id, s]));

/** Keys that must never become own properties of a settings object. */
const POLLUTING = new Set(["__proto__", "constructor", "prototype"]);

export function getSetting(id: SettingId): Setting | undefined {
  return BY_ID.get(id);
}

export function defaultSettings(): SettingsValues {
  const values: SettingsValues = Object.create(null) as SettingsValues;
  for (const setting of SETTINGS_SCHEMA) values[setting.id] = setting.default;
  return { ...values };
}

function isValidFor(setting: Setting, value: unknown): value is SettingValue {
  if (setting.kind === "boolean") return typeof value === "boolean";
  return typeof value === "string" && setting.options.some((option) => option.value === value);
}

/**
 * Coerce arbitrary JSON off the disk into a valid settings object.
 *
 * Unknown keys are dropped rather than preserved: a settings file is user-editable, and
 * carrying unrecognised keys forward would let a typo survive upgrades forever, looking
 * like a setting that simply does not work.
 */
export function validateSettings(raw: unknown): SettingsValues {
  const result = defaultSettings();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return result;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (POLLUTING.has(key)) continue;

    const setting = BY_ID.get(key);
    if (setting === undefined) continue;
    if (!isValidFor(setting, value)) continue;

    result[key] = value;
  }

  return result;
}

export interface StoredSettings {
  readonly version: number | undefined;
  readonly values: Record<string, unknown>;
}

export interface MigratedSettings {
  readonly version: number;
  readonly values: SettingsValues;
}

/**
 * Bring stored settings up to the current schema version.
 *
 * Data from a *future* version is discarded rather than interpreted. Running two builds
 * against one settings file is normal - two machines, or a downgrade - and guessing at a
 * shape this build has never seen would silently corrupt the user's choices. Losing the
 * customisation is recoverable; writing nonsense back over it is not.
 */
export function migrate(stored: StoredSettings): MigratedSettings {
  if (typeof stored.version === "number" && stored.version > SETTINGS_VERSION) {
    return { version: SETTINGS_VERSION, values: defaultSettings() };
  }

  return { version: SETTINGS_VERSION, values: validateSettings(stored.values) };
}

export function settingsForGroup(group: SettingGroupId): readonly Setting[] {
  return SETTINGS_SCHEMA.filter((setting) => setting.group === group);
}

/** §3: the settings screen has a search field at the top. */
export function searchSettings(query: string): readonly Setting[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return SETTINGS_SCHEMA;

  return SETTINGS_SCHEMA.filter((setting) => {
    const haystack = `${setting.id} ${setting.label} ${setting.description}`.toLowerCase();
    return haystack.includes(needle);
  });
}
