/**
 * Navigation: finding your way around code somebody else wrote.
 *
 * Including the two entries that describe the honesty rule - go-to-definition and
 * references both answer either from a language server or from a name match, and the
 * entries say so, because a reader who does not know which one answered cannot judge the
 * answer.
 */
import type { HelpEntry } from "../types.ts";

export const NAVIGATION_ENTRIES: readonly HelpEntry[] = [
  {
    id: "adcode.navigation.fuzzyFileOpen",
    title: "Fuzzy file open",
    plain:
      "Open any file by typing a few letters of its name. You do not have to get them right, or in order.",
    why: "Clicking through folders to find a file you already know the name of is the slowest thing in any editor.",
    how: "Press Ctrl+P and start typing. 'ushnd' will find 'useHandler.ts'. Enter opens the highlighted one.",
    group: "navigation",
    settingIds: ["adcode.navigation.fuzzyFileOpen"],
    shortcut: "CmdOrCtrl+P",
    related: ["adcode.navigation.symbolSearch", "adcode.navigation.globalSearch"],
  },
  {
    id: "adcode.navigation.symbolSearch",
    title: "Symbol search",
    plain:
      "Find a function, class, or variable by name anywhere in the project, without knowing which file it is in.",
    why: "You almost always remember what a thing is called and almost never remember where it lives.",
    how: "Press Ctrl+T and type the name. The list shows what kind of thing each result is and which file it is in.",
    group: "navigation",
    settingIds: ["adcode.navigation.symbolSearch"],
    shortcut: "CmdOrCtrl+T",
    related: ["adcode.navigation.goToDefinition", "adcode.navigation.outline"],
  },
  {
    id: "adcode.navigation.globalSearch",
    title: "Global search and replace",
    plain: "Search every file in the project for some text, and change it everywhere at once.",
    why: "Renaming something, or finding every place a mistake was copied to.",
    how: "Press Ctrl+Shift+F. You can search for a pattern rather than exact text, restrict it to certain files, and see every change before you make it.",
    group: "navigation",
    settingIds: ["adcode.navigation.globalSearch"],
    shortcut: "CmdOrCtrl+Shift+F",
    related: ["adcode.navigation.fuzzyFileOpen", "adcode.editing.multiCursor"],
  },
  {
    id: "adcode.navigation.goToDefinition",
    title: "Go to definition and references",
    plain:
      "Click a name to see where it was made, or to see everywhere else it is used. A small preview opens under the line so you do not lose your place.",
    why: "It is the difference between reading code and searching it. Following a function to its body is the single most common thing anybody does in an unfamiliar project.",
    how: "Click a name for the preview, click the preview's title or Ctrl+click the name to go there properly, and Escape to close. ADCode tells you how it found the answer: 'resolved' means a language server worked it out for certain, and 'matched by name' means ADCode found things with the same name - which is usually right and is not a promise.",
    group: "navigation",
    settingIds: ["adcode.navigation.goToDefinition"],
    related: ["adcode.language.lspClient", "adcode.navigation.symbolSearch", "structure.popup"],
  },
  {
    id: "adcode.navigation.breadcrumbs",
    title: "Breadcrumbs",
    plain:
      "A line above the editor showing the trail to where you are: the folder, the file, and the function your cursor is inside.",
    why: "It answers 'where am I' at a glance, and every part of the trail is a button.",
    how: "On by default. Click a workspace or folder to browse inside it and across sibling folders. Click the file for sibling and recent files, Quick Open, copy, reveal, rename, and comparison/history actions. Click a symbol to search the file outline. With a crumb focused, use Left and Right to move through levels, Down or Enter to open one, then type to filter and press Enter to switch.",
    group: "navigation",
    settingIds: ["adcode.navigation.breadcrumbs"],
    related: ["adcode.editing.stickyScroll", "adcode.navigation.outline"],
  },
  {
    id: "adcode.navigation.outline",
    title: "Outline",
    plain: "A list of everything in the file you are looking at - its functions, classes, and sections.",
    why: "It is the table of contents for a file, and the fastest way to jump around inside a long one.",
    how: "On by default. Open the Structure popup to see it drawn as a tree, with lines connecting each thing to what it belongs to. Click any entry to jump to it.",
    group: "navigation",
    settingIds: ["adcode.navigation.outline"],
    related: ["structure.popup", "adcode.editing.codeFolding", "adcode.navigation.breadcrumbs"],
  },
];
