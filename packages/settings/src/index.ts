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
  | "structure"
  | "language"
  | "session"
  | "ai"
  | "appearance"
  | "updates"
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
  { id: "structure", title: "Structure", caption: "Reading the shape of a project, and what connects to what." },
  { id: "language", title: "Language", caption: "Language servers, debugging, and highlighting." },
  { id: "session", title: "Session", caption: "What survives a restart." },
  { id: "updates", title: "Updates", caption: "New versions install quietly and apply when you next restart." },
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

/**
 * A free-text setting.
 *
 * Exists for one row: the language-server escape hatch §4 describes as "the escape hatch
 * that replaces an extension system for languages you did not bundle". There is no way to
 * express "run this command for this language" as a checkbox or a dropdown, and inventing
 * a whole editor for it would be a worse answer than a text box people can paste into.
 *
 * `maxLength` is not decoration. This value is read off disk, and every character of it
 * eventually reaches a command line.
 */
export interface TextSetting extends BaseSetting {
  readonly kind: "text";
  readonly default: string;
  readonly placeholder: string;
  readonly multiline: boolean;
  readonly maxLength: number;
}

export type Setting = BooleanSetting | EnumSetting | TextSetting;
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
  /* ── Updates ────────────────────────────────────────────────────────── */
  bool(
    "adcode.updates.auto",
    "updates",
    "Install updates automatically",
    "Downloads new versions in the background and applies them the next time you restart. ADCode never restarts itself or interrupts you to ask.",
    true,
    true,
  ),

  bool(
    "adcode.updates.announce",
    "updates",
    "Tell me what changed",
    "After an update installs, show a short note about what is new. Once per version, never while you are typing or running something, and only for releases worth mentioning. What's New under Help has every note whether this is on or off.",
    true,
    true,
  ),

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
  bool("adcode.editing.inlineErrorLens", "editing", "Inline error and warning lens", "Show diagnostics at the end of the line they belong to. One per line, and never on the line you are typing on.", true, true),
  bool("adcode.editing.inlineGitBlame", "editing", "Inline git blame", "Show the last author and commit beside the cursor's line.", false, true),
  bool("adcode.editing.stickyScroll", "editing", "Sticky scroll", "Pin enclosing scopes to the top of the editor while scrolling.", true, true),
  bool("adcode.editing.indentGuides", "editing", "Indent guides", "Vertical rules showing indentation depth.", true, true),
  bool("adcode.editing.todoHighlighting", "editing", "TODO and FIXME highlighting", "Highlight TODO, FIXME, HACK, XXX and NOTE - inside comments only, never the word appearing in code.", true, true),
  bool("adcode.editing.autoCloseTags", "editing", "Close tags automatically", "Typing the end of an opening tag writes its closing tag, and typing </ completes the tag that is still open.", true, true),
  bool("adcode.editing.fileTemplates", "editing", "Start new files from a template", "A new file opens with the boilerplate its language always begins with - a doctype for HTML, a main function for C. Ctrl+Z undoes it.", true, true),
  bool("adcode.editing.autoRenamePairedTag", "editing", "Auto-rename paired tag", "Renaming an opening tag renames its closing tag, in the same undo step.", true, true),
  bool("adcode.editing.pathAutocomplete", "editing", "Path autocomplete", "Complete file paths inside strings and imports, from the files that are really there.", true, true),
  bool("adcode.editing.trailingWhitespace", "editing", "Render trailing whitespace", "Make trailing spaces visible.", false, true),
  bool("adcode.editing.minimap", "editing", "Minimap", "The scaled overview down the right-hand edge.", true, true),
  bool("adcode.editing.codeFolding", "editing", "Code folding", "Collapse and expand regions.", true, true),
  bool("adcode.editing.multiCursor", "editing", "Multi-cursor", "Place more than one cursor with Ctrl+click, Ctrl+D, and Ctrl+Alt+Up/Down.", true, true),
  // Its own row rather than a rider on multi-cursor, and off by default, because column
  // select is a *mode*: while it is on, every mouse drag selects a rectangular block
  // instead of the text it crosses. Shipping it on turned dragging across a line into a
  // box selection for everyone, which is not a preference anybody chose.
  bool("adcode.editing.columnSelection", "editing", "Column selection mode", "Dragging with the mouse selects a rectangular block instead of flowing text.", false, true),

  /*
   * Suggestions and plain-English errors.
   *
   * `acceptOnEnter` is its own row rather than folded into `suggestions` because it is the
   * one with a real cost: with the widget open, Enter takes the suggestion instead of
   * starting a new line. That is what makes it fast, and it is also the thing a user who
   * dislikes it needs to be able to switch off without losing suggestions entirely.
   */
  bool("adcode.editing.suggestions", "editing", "Suggestions as you type", "Offer completions while typing. Press Tab or Enter to take one.", true, true),
  bool("adcode.editing.acceptOnEnter", "editing", "Accept suggestion with Enter", "Enter takes the highlighted suggestion. Turn off to make Enter always start a new line.", true, true),
  bool("adcode.editing.wordSuggestions", "editing", "Suggest words already in the file", "The fallback for languages with no built-in intelligence.", true, true),
  bool("adcode.editing.plainEnglishErrors", "editing", "Explain errors in plain English", "Rewrite compiler messages in the Problems panel and on hover. The original wording is always kept underneath.", true, true),

  /* ── Formatting (§4) ────────────────────────────────────────────────── */
  bool("adcode.formatting.formatter", "formatting", "Built-in formatter", "Formatting with no extension to install. A language server is asked first where one is running; otherwise ADCode re-prints JSON and CSS, and fixes indentation and whitespace everywhere else.", true, true),
  bool("adcode.formatting.formatOnSave", "formatting", "Format on save", "Run the formatter every time a file is saved. A language ADCode cannot format is saved exactly as you wrote it.", true, true),
  bool("adcode.formatting.lintDiagnostics", "formatting", "Lint diagnostics", "Report problems in the Problems panel, the badge, and beside the line. Off silences all three without stopping the compiler.", true, true),
  bool("adcode.formatting.organizeImportsOnSave", "formatting", "Organize imports on save", "Sort the import block when saving, and drop an import nothing in the file uses. Off by default, because deleting a line you did not ask to delete deserves to be a choice.", false, true),

  /* ── Git (§4) ───────────────────────────────────────────────────────── */
  bool("adcode.git.gutterDiff", "git", "Gutter diff decorations", "Mark added, changed, and deleted lines in the gutter.", true, true),
  bool("adcode.git.blame", "git", "Blame", "Attribute each line to its last commit.", false, true),
  bool("adcode.git.stageCommitUi", "git", "Stage, unstage, and commit", "Source-control UI for staging and committing.", true, true),
  bool("adcode.git.branchSwitcher", "git", "Branch switcher", "Switch and create branches from the status bar.", true, true),
  bool("adcode.git.mergeConflict", "git", "Merge conflict resolution", "Inline resolution for conflicted files.", true, true),
  bool("adcode.git.fileTimeline", "git", "File timeline", "The commit history of the open file.", true, true),

  /* ── Navigation (§4) ────────────────────────────────────────────────── */
  bool("adcode.navigation.fuzzyFileOpen", "navigation", "Fuzzy file open", "Open any file by typing part of its name.", true, true),
  bool("adcode.navigation.symbolSearch", "navigation", "Symbol search", "Jump to any function, class, or variable across the workspace with Ctrl+T. Nothing is indexed; the project is searched when you ask.", true, true),
  bool("adcode.navigation.globalSearch", "navigation", "Global search and replace", "Regex search and replace across the workspace.", true, true),
  bool("adcode.navigation.goToDefinition", "navigation", "Go to definition and references", "F12 or Alt+click previews a definition inline; Ctrl+click goes there. ADCode says whether a language server resolved it or it matched by name.", true, true),
  bool("adcode.navigation.breadcrumbs", "navigation", "Breadcrumbs", "The path and symbol trail above the editor. Every part of it is a button.", true, true),
  bool("adcode.navigation.outline", "navigation", "Outline", "The symbol tree for the open file, drawn with connecting lines in the Structure popup.", true, true),

  /* ── Structure ──────────────────────────────────────────────────────── */
  bool("adcode.structure.projectTreeLines", "structure", "Draw trees with connecting lines", "Show the lines that join a row to the folder it is inside. Off leaves plain indentation.", true, true),
  bool("adcode.structure.elementToRules", "structure", "Show the rules that style an element", "Click an element in markup to see every CSS rule that applies to it.", true, true),
  bool("adcode.structure.selectorToElements", "structure", "Show the elements a rule styles", "Click a rule in a stylesheet to see the elements it actually affects.", true, true),
  /*
   * Off by default, and the description says why rather than hiding it. On a project using
   * CSS modules or utility classes this list is long and wrong, because matching by name
   * cannot see a name that is generated.
   */
  bool("adcode.structure.unusedSelectors", "structure", "Point out rules that style nothing", "Report a CSS rule that matches no element in the project. Off by default: it cannot see class names built at runtime, so on some projects it is wrong more often than right.", false, true),
  bool("adcode.structure.missingClasses", "structure", "Point out classes nothing defines", "Report a class used in markup that no stylesheet defines - usually a typo, which nothing else in a project ever catches.", true, true),

  /* ── Language (§4) ──────────────────────────────────────────────────── */
  /*
   * `available: true` now, with an honest description.
   *
   * The client is built and works against a server that is on PATH. What is *not* built is
   * bundling the servers into the installer, so the description says "installed" rather
   * than "bundled" - the roster's job is to describe what the toggle actually does, and
   * claiming bundled servers would be the exact failure `available: false` exists to avoid.
   */
  bool("adcode.language.lspClient", "language", "Language server intelligence", "Completion, diagnostics, and hover from language servers installed on this machine.", true, true),
  {
    id: "adcode.language.customServers",
    group: "language",
    kind: "text",
    label: "Additional language servers",
    description:
      "One per line, as `language: command args`. This is what replaces an extension system for languages ADCode does not know about.",
    default: "",
    available: true,
    placeholder: "zig: zls\nelm: elm-language-server --stdio",
    multiline: true,
    maxLength: 4000,
  },
  bool("adcode.language.dapClient", "language", "Debugger", "Breakpoints, stepping, the call stack, and variables - for JavaScript and TypeScript with nothing to install. Python needs debugpy, and ADCode says so rather than failing.", true, true),
  bool("adcode.language.treeSitterHighlighting", "language", "Tree-sitter highlighting", "Syntax highlighting driven by a real parse tree, for 11 languages. A language without one keeps the built-in colouring.", true, true),

  /* ── Session (§4) ───────────────────────────────────────────────────── */
  bool("adcode.session.workspaceRestore", "session", "Restore workspace", "Reopen the last folder and editors on launch.", true, true),
  bool("adcode.session.autoSave", "session", "Auto-save after delay", "Save automatically once typing pauses.", true, true),
  bool("adcode.session.localFileHistory", "session", "Local file history", "Keep local versions of edited files.", true, true),
  bool("adcode.session.crashRecovery", "session", "Crash recovery", "Recover unsaved buffers after an unexpected exit.", true, true),

  /* ── AI (§5) ────────────────────────────────────────────────────────── */
  {
    id: "adcode.ai.provider",
    group: "ai",
    kind: "enum",
    label: "Provider",
    description:
      "Bring your own key. Keys are stored in the OS keychain, never in this settings file. The local option needs no key.",
    default: "anthropic",
    available: true,
    options: [
      { value: "anthropic", label: "Anthropic" },
      { value: "openai", label: "OpenAI" },
      { value: "google", label: "Google" },
      { value: "ollama", label: "Local" },
      { value: "custom", label: "Custom" },
    ],
  },
  /*
   * Free text rather than a fixed list.
   *
   * It used to be an enum of six, which meant the dropdown offered models a key could not
   * reach and hid ones it could - and a new model could not be used until the app shipped
   * again. The Connect screen picks from the real catalogue and writes the id here, so the
   * set of valid values is "whatever your provider actually offers".
   */
  {
    id: "adcode.ai.model",
    group: "ai",
    kind: "text",
    label: "Model",
    description:
      "Which model the built-in chat uses. Pick one in Connect a model rather than typing it here. Switching takes effect on your next message.",
    default: "claude-opus-5",
    available: true,
    placeholder: "claude-opus-5",
    multiline: false,
    maxLength: 120,
  },
  {
    id: "adcode.ai.customBaseUrl",
    group: "ai",
    kind: "text",
    label: "Custom endpoint",
    description:
      "Any address that speaks the OpenAI format - a gateway, a hosted provider, or a model running on this machine. Used when Provider is set to Custom.",
    default: "",
    available: true,
    placeholder: "https://openrouter.ai/api/v1",
    multiline: false,
    maxLength: 400,
  },
  bool("adcode.ai.chatWidget", "ai", "Chat widget", "The floating chat card, summoned by keyboard shortcut.", true, true),
  bool("adcode.ai.inlineCompletion", "ai", "Inline completion", "Ghost text suggestions, accepted with Tab.", true, true),
  bool("adcode.ai.terminalAgentDetection", "ai", "Terminal agent detection", "Recognise an AI agent started in the built-in terminal and offer to share this project's memory with it. Recognised from the command you typed - nothing else is inspected.", true, true),
  bool("adcode.ai.memoryCapture", "ai", "Memory capture", "Record decisions and conventions to the shared project memory.", true, true),
  bool("adcode.ai.mcpServer", "ai", "MCP server", "Let external agents read and write the same memory.", true, true),
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

/**
 * Is this a value that setting may hold?
 *
 * Exported because the main process asks the same question before persisting a write, and
 * it used to answer it with its own copy of this logic - which then did not learn about the
 * `text` kind and rejected every write to it. One implementation, one place to update.
 */
export function isValidSettingValue(setting: Setting, value: unknown): value is SettingValue {
  if (setting.kind === "boolean") return typeof value === "boolean";

  if (setting.kind === "text") {
    // Length is checked here rather than at the point of use, because "at the point of
    // use" is a command line and by then it is too late to be picky about it.
    return typeof value === "string" && value.length <= setting.maxLength;
  }

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
    if (!isValidSettingValue(setting, value)) continue;

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
