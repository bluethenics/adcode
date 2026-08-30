/**
 * The feature access catalogue.
 *
 * Explanations remain in `entries/`; this file adds only navigation metadata. Keeping the
 * two concerns separate lets Settings keep owning setting labels while the feature library,
 * universal search, Guide, and docs all agree on the safe action that opens each feature.
 * Plain TypeScript only: no DOM, Electron, storage, or I/O.
 */
import { GROUPS, getSetting } from "@adcode/settings";
import { HELP_ENTRIES } from "./entries/index.ts";
import type {
  FeatureAction,
  FeatureCommandAction,
  FeatureRecord,
  HelpEntry,
} from "./types.ts";

interface FeatureMetadata {
  readonly actions?: readonly FeatureCommandAction[];
  readonly keywords?: readonly string[];
}

const command = (commandId: string, label: string): FeatureCommandAction => ({
  kind: "command",
  command: commandId,
  label,
});

/**
 * Every way into a feature that is not "open its Settings row".
 *
 * This used to hold eighteen entries while a second table, `FEATURE_COMMANDS.children`,
 * held sixty more that no surface read - so "Stage, unstage, and commit" advertised one
 * route into itself, the switch that turns it off. The two tables are now one: the routes
 * are declared here, with the words a button should say, and `FEATURE_COMMANDS` is derived
 * from them so the coverage tests keep their shape.
 *
 * The first command is the one a surface offers first, so it should be the thing a person
 * looking for the feature actually wants: Commit, not Fetch.
 */
const METADATA: Readonly<Record<string, FeatureMetadata>> = {
  "workbench.allFeatures": {
    actions: [
      command("features.open", "Open"),
      command("settings.open", "Preferences"),
      command("view.fullScreen", "Full screen"),
      command("view.toggleSidebar", "Toggle side bar"),
      command("view.togglePanel", "Toggle panel"),
      command("view.zoomIn", "Zoom in"),
      command("view.zoomOut", "Zoom out"),
      command("view.zoomReset", "Reset zoom"),
      command("view.problems", "Problems"),
      command("view.output", "Output"),
      command("view.ports", "Ports"),
      command("help.guide", "Feature guide"),
      command("help.devTools", "Developer tools"),
      command("help.about", "About ADCode"),
    ],
    keywords: ["everything adcode can do", "feature library", "feature guide", "discover"],
  },
  "workbench.universalSearch": {
    actions: [command("search.universal", "Search")],
    keywords: ["main search", "title bar", "find anything", "everywhere"],
  },
  "workbench.commandPalette": {
    actions: [command("palette.open", "Open")],
    keywords: ["run a command", "greater than", "actions"],
  },
  "workbench.keybindings": {
    actions: [command("help.shortcuts", "Open")],
    keywords: ["keys", "hotkeys", "accelerators"],
  },
  "structure.popup": {
    actions: [command("view.structure", "Open")],
    keywords: ["file outline", "project map", "calls"],
  },
  "structure.cssLinks": {
    actions: [command("view.projectMap", "Open project map")],
    keywords: ["html css", "class name", "selector links"],
  },
  "workbench.terminal": {
    actions: [
      command("terminal.toggle", "Open"),
      command("terminal.new", "New terminal"),
      command("terminal.newWithProfile", "New terminal with profile"),
      command("terminal.split", "Split"),
      command("terminal.next", "Next terminal"),
      command("terminal.previous", "Previous terminal"),
      command("terminal.copy", "Copy"),
      command("terminal.paste", "Paste"),
      command("terminal.clear", "Clear"),
      command("terminal.kill", "Kill"),
      command("terminal.killAll", "Kill all"),
      command("terminal.runActiveFile", "Run this file in the terminal"),
    ],
    keywords: ["shell", "command line", "console"],
  },
  "workbench.run": {
    actions: [command("run.file", "Run")],
    keywords: ["execute", "start program", "active file"],
  },
  "workbench.preview": {
    actions: [
      command("preview.toggle", "Open"),
      command("preview.reload", "Reload"),
      command("preview.undock", "Undock into a window"),
      command("preview.switchMode", "Switch project or files"),
      command("preview.device", "Another screen size"),
    ],
    keywords: ["browser", "website", "screen size", "responsive"],
  },
  "workbench.collab": {
    actions: [command("collab.panel", "Open"), command("collab.leave", "Leave session")],
    keywords: ["share", "join", "pair", "live session"],
  },
  "account.earnings": {
    actions: [command("view.earnings", "Open")],
    keywords: ["ads", "money", "balance", "ledger"],
  },
  "account.signIn": {
    actions: [command("account.open", "Open account")],
    keywords: ["login", "google", "github", "email"],
  },
  "gestures.multiSelect": {
    actions: [
      command("view.explorer", "Open Explorer"),
      command("file.new", "New file"),
      command("file.open", "Open file"),
      command("file.save", "Save"),
      command("file.saveAs", "Save as"),
      command("file.saveAll", "Save all"),
      command("file.revert", "Revert file"),
      command("editor.close", "Close editor"),
      command("editor.closeAll", "Close all editors"),
      command("editor.insertTemplate", "Insert file template"),
      command("workspace.open", "Open folder"),
      command("workspace.openRecent", "Open recent"),
      command("workspace.openRecentAt", "Open a recent folder"),
      command("workspace.clearRecents", "Clear recent folders"),
      command("workspace.close", "Close folder"),
    ],
    keywords: ["files", "rename", "move", "copy", "delete"],
  },
  "ai.connect": {
    actions: [command("ai.connect", "Connect")],
    keywords: ["api key", "provider", "model", "local ai"],
  },
  "ai.sessions": {
    actions: [command("ai.toggle", "Open Assistant")],
    keywords: ["chat history", "conversation", "memory"],
  },
  "ai.team": {
    actions: [command("ai.team", "Set up Team")],
    keywords: ["multiple ai", "parallel agents", "divide task", "roles"],
  },
  "adcode.ai.inlineCompletion": {
    actions: [command("ai.complete", "Suggest now")],
    keywords: ["autosuggest", "auto suggest", "ghost text", "tab completion"],
  },
  "adcode.ai.scheduledMessages": {
    actions: [command("ai.schedule", "Schedule")],
    keywords: ["send something to ai later", "delayed prompt", "reminder", "queue"],
  },

  /* ── Editing, formatting, and navigation ───────────────────────────────── */

  "adcode.editing.suggestions": {
    actions: [
      command("edit.undo", "Undo"),
      command("edit.redo", "Redo"),
      command("edit.find", "Find"),
      command("edit.replace", "Replace"),
      command("edit.toggleLineComment", "Toggle line comment"),
      command("edit.toggleBlockComment", "Toggle block comment"),
      command("edit.cut", "Cut"),
      command("edit.copy", "Copy"),
      command("edit.paste", "Paste"),
      command("view.toggleWordWrap", "Toggle word wrap"),
    ],
  },
  "adcode.editing.multiCursor": {
    actions: [
      command("selection.addNextOccurrence", "Add next occurrence"),
      command("selection.selectAllOccurrences", "Select all occurrences"),
      command("selection.all", "Select all"),
      command("selection.expand", "Expand selection"),
      command("selection.shrink", "Shrink selection"),
      command("selection.copyLineUp", "Copy line up"),
      command("selection.copyLineDown", "Copy line down"),
      command("selection.moveLineUp", "Move line up"),
      command("selection.moveLineDown", "Move line down"),
      command("selection.duplicate", "Duplicate selection"),
      command("selection.cursorAbove", "Add cursor above"),
      command("selection.cursorBelow", "Add cursor below"),
    ],
  },
  "adcode.editing.todoHighlighting": {
    actions: [command("edit.todos", "List them")],
    keywords: ["todo", "fixme", "hack", "xxx", "note", "left to do", "unfinished"],
  },
  "adcode.editing.spellCheck": {
    actions: [command("edit.spelling", "Check now")],
    keywords: ["spelling", "typo", "misspelled", "dictionary"],
  },
  "adcode.formatting.formatter": {
    actions: [command("edit.format", "Format this file")],
  },
  "adcode.formatting.organizeImportsOnSave": {
    actions: [command("edit.organizeImports", "Organize now")],
    keywords: ["sort imports", "unused import", "tidy imports"],
  },
  "adcode.navigation.fuzzyFileOpen": {
    actions: [command("go.file", "Go to a file")],
  },
  "adcode.navigation.symbolSearch": {
    actions: [command("go.symbol", "Go to a symbol")],
  },
  "adcode.navigation.globalSearch": {
    actions: [command("view.search", "Search the project")],
  },
  "adcode.navigation.goToDefinition": {
    actions: [command("go.definition", "Go to definition"), command("go.peek", "Peek definition")],
  },
  "adcode.navigation.outline": {
    actions: [
      command("go.line", "Go to a line"),
      command("go.nextEditor", "Next editor"),
      command("go.previousEditor", "Previous editor"),
      command("go.nextChange", "Next change"),
      command("go.previousChange", "Previous change"),
    ],
  },

  /* ── Understanding a project ───────────────────────────────────────────── */

  "adcode.structure.unusedSelectors": {
    actions: [command("structure.unusedCss", "Find them")],
    keywords: ["dead css", "unused rules", "stylesheet cleanup", "selector matches nothing"],
  },
  "adcode.structure.missingClasses": {
    actions: [command("structure.missingClasses", "Find them")],
    keywords: ["undefined class", "typo in class name", "class nothing styles"],
  },

  /* ── Git ───────────────────────────────────────────────────────────────── */

  "adcode.git.stageCommitUi": {
    actions: [
      command("git.commit", "Commit"),
      command("git.stageAll", "Stage all"),
      command("git.unstageAll", "Unstage all"),
      command("git.push", "Push"),
      command("git.pull", "Pull"),
      command("git.fetch", "Fetch"),
      command("git.init", "Initialise a repository"),
      command("workspace.clone", "Clone a repository"),
      command("view.scm", "Open Source Control"),
    ],
  },
  /*
   * Checkout and create-branch moved here from the commit feature.
   *
   * They were filed under "Stage, unstage, and commit", which is where they happened to be
   * written rather than where a person looking for them would look. "Branch switcher" is
   * the row that says branch.
   */
  "adcode.git.branchSwitcher": {
    actions: [
      command("git.checkout", "Switch branch"),
      command("git.createBranch", "Create a branch"),
    ],
    keywords: ["branch", "switch", "new branch", "checkout"],
  },
  "adcode.git.mergeConflict": {
    actions: [command("git.conflicts", "Check for conflicts")],
    keywords: [
      "merge conflict",
      "conflicts",
      "accept",
      "reject",
      "keep yours",
      "keep theirs",
      "both changed the same line",
    ],
  },
  "adcode.git.blame": {
    actions: [command("git.blame", "Blame this line")],
    keywords: ["who wrote this", "last author", "why is this line here"],
  },
  "adcode.git.fileTimeline": {
    actions: [command("git.timeline", "Show the timeline")],
    keywords: ["file history", "past versions", "when did this change"],
  },

  /* ── Session and updates ───────────────────────────────────────────────── */

  "adcode.session.localFileHistory": {
    actions: [command("file.localHistory", "Open local history")],
    keywords: ["undo history", "previous versions", "before i saved", "restore a version"],
  },
  "adcode.session.crashRecovery": {
    actions: [command("session.recover", "Recover unsaved files")],
    keywords: ["crash", "lost work", "unsaved", "recover"],
  },
  "adcode.updates.auto": {
    actions: [command("updates.check", "Check now")],
    keywords: ["update", "new version", "upgrade", "latest"],
  },

  /* ── Languages ─────────────────────────────────────────────────────────── */

  "adcode.language.dapClient": {
    actions: [
      command("debug.start", "Start debugging"),
      command("debug.stop", "Stop debugging"),
      command("debug.stepOver", "Step over"),
      command("debug.stepInto", "Step into"),
      command("debug.stepOut", "Step out"),
      command("view.debugConsole", "Debug console"),
    ],
  },
  "updates.whatsNew": {
    actions: [command("help.whatsNew", "Read it")],
  },
};

/**
 * Which commands belong to which feature, and which belong to no feature at all.
 *
 * `children` is now derived from `METADATA` rather than maintained beside it. Two hand-kept
 * lists of the same commands is how the catalogue ended up advertising a settings row as
 * the only way to commit: the second list was the one with the real routes in it, and
 * nothing read it. Deriving means a command declared once appears everywhere it should.
 *
 * `plumbing` stays a literal because it is the opposite claim - these commands deliberately
 * belong to no feature, and that is a judgement, not something to infer.
 */
export const FEATURE_COMMANDS: {
  readonly children: Readonly<Record<string, readonly string[]>>;
  readonly plumbing: readonly string[];
} = {
  children: Object.fromEntries(
    Object.entries(METADATA)
      .map(([id, meta]) => [id, (meta.actions ?? []).map((action) => action.command)] as const)
      .filter(([, commands]) => commands.length > 0),
  ),
  plumbing: ["app.quit"],
};

const groupTitle = (entry: HelpEntry): string =>
  GROUPS.find((group) => group.id === entry.group)?.title ?? entry.group;

/**
 * The routes into one feature, best first.
 *
 * Commands, then toggles, then the settings row. The order is the whole point: a surface
 * offers the first action it can run, and for sixty-eight features that used to be "open
 * Settings" - which answers "where is the switch" for somebody who asked "how do I use
 * this". A boolean switch is worth offering in place, because flipping it is the entire
 * interaction; an enum is not, because choosing between three named values needs the list.
 */
const records: readonly FeatureRecord[] = HELP_ENTRIES.map((entry) => {
  const metadata = METADATA[entry.id];
  const actions: FeatureAction[] = [...(metadata?.actions ?? [])];

  for (const settingId of entry.settingIds) {
    if (getSetting(settingId)?.kind === "boolean") {
      actions.push({ kind: "toggle", settingId, label: "Turn on or off" });
    }
  }

  for (const settingId of entry.settingIds) {
    const setting = getSetting(settingId);
    actions.push({
      kind: "setting",
      settingId,
      label: setting === undefined ? "Open setting" : `Open ${setting.label} setting`,
    });
  }

  return {
    entry,
    actions,
    keywords: [groupTitle(entry), ...(metadata?.keywords ?? [])],
  };
});

const byId = new Map(records.map((record) => [record.entry.id, record]));

export function featureRecords(): readonly FeatureRecord[] {
  return records;
}

export function featureFor(id: string): FeatureRecord | undefined {
  return byId.get(id);
}

const STOP_WORDS = new Set(["a", "an", "and", "can", "do", "for", "i", "of", "the", "to"]);

function words(value: string): readonly string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#\\]+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
}

function searchable(record: FeatureRecord): string {
  const { entry, actions, keywords } = record;
  return [
    entry.id,
    entry.title,
    entry.plain,
    entry.why,
    entry.how,
    groupTitle(entry),
    ...keywords,
    ...actions.flatMap((action) =>
      action.kind === "command"
        ? [action.command, action.label]
        : [action.settingId, action.label, getSetting(action.settingId)?.label ?? ""],
    ),
  ]
    .join(" ")
    .toLowerCase();
}

/** Search feature names, explanations, goals, groups, settings, commands, and access words. */
export function searchFeatures(query: string): readonly FeatureRecord[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return records;

  const queryWords = words(needle);
  return records
    .map((record, index) => {
      const haystack = searchable(record);
      const title = record.entry.title.toLowerCase();
      const matched = queryWords.filter((word) => haystack.includes(word)).length;
      const exact = haystack.includes(needle) ? 10_000 : 0;
      const titlePrefix = title.startsWith(needle) ? 5_000 : 0;
      return { record, index, score: exact + titlePrefix + matched * 100 };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ record }) => record);
}
