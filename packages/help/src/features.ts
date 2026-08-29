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

/** Command routes that cannot be inferred from a Settings row. */
const METADATA: Readonly<Record<string, FeatureMetadata>> = {
  "workbench.allFeatures": {
    actions: [command("features.open", "Open")],
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
    actions: [command("terminal.toggle", "Open")],
    keywords: ["shell", "command line", "console"],
  },
  "workbench.run": {
    actions: [command("run.file", "Run")],
    keywords: ["execute", "start program", "active file"],
  },
  "workbench.preview": {
    actions: [command("preview.toggle", "Open")],
    keywords: ["browser", "website", "screen size", "responsive"],
  },
  "workbench.collab": {
    actions: [command("collab.panel", "Open")],
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
    actions: [command("view.explorer", "Open Explorer")],
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
};

/**
 * Fine-grained commands live under a parent feature; lifecycle-only commands are plumbing.
 * Tests compare this reviewed data with the public renderer registry so new commands cannot
 * silently disappear from discovery.
 */
export const FEATURE_COMMANDS: {
  readonly children: Readonly<Record<string, readonly string[]>>;
  readonly plumbing: readonly string[];
} = {
  children: {
    "workbench.allFeatures": [
      "settings.open",
      "view.fullScreen",
      "view.toggleSidebar",
      "view.togglePanel",
      "view.zoomIn",
      "view.zoomOut",
      "view.zoomReset",
      "view.problems",
      "view.output",
      "view.ports",
      "help.guide",
      "help.devTools",
      "help.about",
    ],
    "gestures.multiSelect": [
      "file.new",
      "file.open",
      "file.saveAs",
      "file.save",
      "file.saveAll",
      "file.revert",
      "editor.close",
      "editor.closeAll",
      "editor.insertTemplate",
      "workspace.open",
      "workspace.openRecent",
      "workspace.openRecentAt",
      "workspace.clearRecents",
      "workspace.close",
    ],
    "adcode.editing.suggestions": [
      "edit.undo",
      "edit.redo",
      "edit.find",
      "edit.replace",
      "edit.toggleLineComment",
      "edit.toggleBlockComment",
      "edit.cut",
      "edit.copy",
      "edit.paste",
      "view.toggleWordWrap",
    ],
    "adcode.formatting.formatter": ["edit.format"],
    "adcode.editing.multiCursor": [
      "selection.all",
      "selection.expand",
      "selection.shrink",
      "selection.copyLineUp",
      "selection.copyLineDown",
      "selection.moveLineUp",
      "selection.moveLineDown",
      "selection.duplicate",
      "selection.cursorAbove",
      "selection.cursorBelow",
      "selection.addNextOccurrence",
      "selection.selectAllOccurrences",
    ],
    "adcode.navigation.fuzzyFileOpen": ["go.file"],
    "adcode.navigation.symbolSearch": ["go.symbol"],
    "adcode.navigation.globalSearch": ["view.search"],
    "adcode.navigation.goToDefinition": ["go.definition", "go.peek"],
    "adcode.navigation.outline": [
      "go.line",
      "go.nextEditor",
      "go.previousEditor",
      "go.nextChange",
      "go.previousChange",
    ],
    "workbench.preview": [
      "preview.reload",
      "preview.undock",
      "preview.switchMode",
      "preview.device",
    ],
    "workbench.collab": ["collab.leave"],
    "workbench.terminal": [
      "terminal.new",
      "terminal.newWithProfile",
      "terminal.split",
      "terminal.next",
      "terminal.previous",
      "terminal.copy",
      "terminal.paste",
      "terminal.clear",
      "terminal.kill",
      "terminal.killAll",
      "terminal.runActiveFile",
    ],
    "adcode.git.stageCommitUi": [
      "git.commit",
      "git.stageAll",
      "git.unstageAll",
      "git.push",
      "git.pull",
      "git.fetch",
      "git.checkout",
      "git.createBranch",
      "git.init",
      "workspace.clone",
      "view.scm",
    ],
    "adcode.language.dapClient": [
      "debug.start",
      "debug.stop",
      "debug.stepOver",
      "debug.stepInto",
      "debug.stepOut",
      "view.debugConsole",
    ],
    "updates.whatsNew": ["help.whatsNew"],
  },
  plumbing: ["app.quit"],
};

const groupTitle = (entry: HelpEntry): string =>
  GROUPS.find((group) => group.id === entry.group)?.title ?? entry.group;

const records: readonly FeatureRecord[] = HELP_ENTRIES.map((entry) => {
  const metadata = METADATA[entry.id];
  const actions: FeatureAction[] = [...(metadata?.actions ?? [])];
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
