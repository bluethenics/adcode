/**
 * Session: what survives a restart, and what survives a crash.
 */
import type { HelpEntry } from "../types.ts";

export const SESSION_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.session.workspaceRestore",
    title: "Restore workspace",
    plain: "Open ADCode again and everything is how you left it - the same folder, the same tabs.",
    why: "Setting your work back up every morning is a small tax you should not have to pay.",
    how: "On by default. Just close the window; next time you open it, your files are back.",
    group: "session",
    settingIds: ["adcode.session.workspaceRestore"],
    related: ["adcode.session.crashRecovery"],
  },
  {
    id: "adcode.session.autoSave",
    title: "Auto-save after delay",
    plain: "Stop typing for a moment and your file saves itself.",
    why: "So losing work stops being possible, and so you stop pressing Ctrl+S out of habit every few seconds.",
    how: "On by default. It waits until you pause, so it never saves a half-typed word. You can still save whenever you like with Ctrl+S.",
    group: "session",
    settingIds: ["adcode.session.autoSave"],
    shortcut: "CmdOrCtrl+S",
    related: ["adcode.formatting.formatOnSave", "adcode.session.localFileHistory"],
  },
  {
    id: "adcode.session.localFileHistory",
    title: "Local file history",
    plain:
      "ADCode quietly keeps its own copies of files as you edit them, separate from your project's history.",
    why: "For the moment you delete something you needed and had not saved into your project's history yet. It is the undo that survives closing the file.",
    how: "On by default. Open the Timeline for a file to see the local copies alongside the committed ones, and open or restore any of them.",
    group: "session",
    settingIds: ["adcode.session.localFileHistory"],
    related: ["adcode.git.fileTimeline", "adcode.session.crashRecovery"],
  },
  {
    id: "adcode.session.crashRecovery",
    title: "Crash recovery",
    plain: "If ADCode closes unexpectedly, your unsaved typing is still there when it opens again.",
    why: "Crashes and power cuts happen, and losing an hour to one is miserable.",
    how: "On by default, and there is nothing to do. Reopen ADCode and it offers your unsaved work back.",
    group: "session",
    settingIds: ["adcode.session.crashRecovery"],
    related: ["adcode.session.autoSave", "adcode.session.workspaceRestore"],
  },
];
