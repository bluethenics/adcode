/**
 * Formatting: tidying code, and being told when it is wrong.
 */
import type { HelpEntry } from "../types.ts";

export const FORMATTING_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.formatting.formatter",
    title: "Built-in formatter",
    plain:
      "Tidies your code for you - puts the spaces, indents and line breaks in the same places every time.",
    why: "Arguing about where the spaces go is the least valuable thing a person can do with their day. A formatter ends the argument by always doing the same thing.",
    how: "On by default, and there is nothing to install. Press Shift+Alt+F to tidy the open file. If a language server is running for that language, ADCode asks it first, because it knows the language better than we do; otherwise ADCode's own formatter does it.",
    group: "formatting",
    settingIds: ["adcode.formatting.formatter"],
    shortcut: "Shift+Alt+F",
    related: ["adcode.formatting.formatOnSave", "adcode.language.lspClient"],
  },
  {
    id: "adcode.formatting.formatOnSave",
    title: "Format on save",
    plain: "Every time you save, the file gets tidied first.",
    why: "So you never think about it again. Code that is formatted on every save is never messy, and nobody has to remember a shortcut.",
    how: "On by default. Save as usual with Ctrl+S. If the formatter cannot handle that language, the file is saved exactly as you wrote it rather than mangled.",
    group: "formatting",
    settingIds: ["adcode.formatting.formatOnSave"],
    shortcut: "CmdOrCtrl+S",
    related: ["adcode.formatting.formatter", "adcode.session.autoSave"],
  },
  {
    id: "adcode.formatting.lintDiagnostics",
    title: "Lint diagnostics",
    plain: "Underlines the things that are wrong, or look wrong, while you type.",
    why: "Finding a mistake as you make it costs a second. Finding it when the program runs costs a lot more.",
    how: "On by default. Red means it is broken, yellow means it is suspicious. All of them are collected in the Problems panel, and hovering one shows the detail.",
    group: "formatting",
    settingIds: ["adcode.formatting.lintDiagnostics"],
    related: ["adcode.editing.inlineErrorLens", "adcode.editing.plainEnglishErrors"],
  },
  {
    id: "adcode.formatting.organizeImportsOnSave",
    title: "Organize imports on save",
    plain:
      "When you save, the list of other files your file uses gets sorted, and any it no longer uses are removed.",
    why: "Import lists grow messy on their own and nobody ever tidies them on purpose.",
    how: "Off by default, because deleting a line you did not ask to delete deserves to be a choice. Edit → Organize Imports does it once, on demand, and tells you when the imports were already tidy. Turn the setting on and it happens on every save instead.",
    group: "formatting",
    settingIds: ["adcode.formatting.organizeImportsOnSave"],
    related: ["adcode.formatting.formatOnSave"],
  },
];
