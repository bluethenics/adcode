/**
 * The menu bar, defined once.
 *
 * macOS puts menus in the system bar, so there the main process builds a native `Menu`
 * from this. Windows and Linux get a custom bar drawn in the window, because the shell
 * uses a hidden title bar (§3) and a native menu has nowhere to live under one - the same
 * reason VS Code draws its own.
 *
 * Every item is a command id. Nothing here knows what a command *does*; the renderer's
 * registry owns that, so the menu cannot drift away from the keyboard shortcuts.
 */

export interface MenuItem {
  readonly kind?: "item";
  readonly label: string;
  readonly command: string;
  /** Electron accelerator syntax, also rendered as the hint in the custom bar. */
  readonly accelerator?: string;
  /** Roles Electron implements natively; the custom bar runs the command instead. */
  readonly role?: string;
}

export interface MenuSeparator {
  readonly kind: "separator";
}

export interface MenuSubmenu {
  readonly kind: "submenu";
  readonly label: string;
  readonly items: readonly MenuEntry[];
}

export type MenuEntry = MenuItem | MenuSeparator | MenuSubmenu;

export interface MenuTop {
  readonly label: string;
  readonly items: readonly MenuEntry[];
}

const separator: MenuSeparator = { kind: "separator" };

/**
 * The menus, in VS Code's order and largely with its labels.
 *
 * Only commands that are actually implemented appear. A Run menu whose entries do nothing
 * because there is no debug adapter yet would be worse than no Run menu: it teaches the
 * user that the menu bar lies. "New Window" is absent for the same reason: the workspace
 * root is process-wide, so a second window would fight the first over which folder is
 * open, and that is a data-loss bug rather than a missing feature.
 */
export const MENU_BAR: readonly MenuTop[] = [
  {
    label: "File",
    items: [
      { label: "New File", command: "file.new", accelerator: "CmdOrCtrl+N" },
      separator,
      { label: "Open Folder…", command: "workspace.open", accelerator: "CmdOrCtrl+O" },
      { label: "Close Folder", command: "workspace.close" },
      separator,
      { label: "Save", command: "file.save", accelerator: "CmdOrCtrl+S" },
      { label: "Save As…", command: "file.saveAs", accelerator: "CmdOrCtrl+Shift+S" },
      { label: "Save All", command: "file.saveAll", accelerator: "CmdOrCtrl+Alt+S" },
      separator,
      { label: "Revert File", command: "file.revert" },
      { label: "Close Editor", command: "editor.close", accelerator: "CmdOrCtrl+W" },
      { label: "Close All Editors", command: "editor.closeAll", accelerator: "CmdOrCtrl+K CmdOrCtrl+W" },
      separator,
      { label: "Preferences", command: "settings.open", accelerator: "CmdOrCtrl+," },
      separator,
      { label: "Exit", command: "app.quit", role: "quit" },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Undo", command: "edit.undo", accelerator: "CmdOrCtrl+Z", role: "undo" },
      { label: "Redo", command: "edit.redo", accelerator: "CmdOrCtrl+Y", role: "redo" },
      separator,
      { label: "Cut", command: "edit.cut", accelerator: "CmdOrCtrl+X", role: "cut" },
      { label: "Copy", command: "edit.copy", accelerator: "CmdOrCtrl+C", role: "copy" },
      { label: "Paste", command: "edit.paste", accelerator: "CmdOrCtrl+V", role: "paste" },
      separator,
      { label: "Find", command: "edit.find", accelerator: "CmdOrCtrl+F" },
      { label: "Replace", command: "edit.replace", accelerator: "CmdOrCtrl+H" },
      separator,
      { label: "Find in Files", command: "search.open", accelerator: "CmdOrCtrl+Shift+F" },
      separator,
      { label: "Toggle Line Comment", command: "edit.toggleLineComment", accelerator: "CmdOrCtrl+/" },
      { label: "Toggle Block Comment", command: "edit.toggleBlockComment", accelerator: "Shift+Alt+A" },
      separator,
      { label: "Format Document", command: "edit.format", accelerator: "Shift+Alt+F" },
    ],
  },
  {
    label: "Selection",
    items: [
      { label: "Select All", command: "selection.all", accelerator: "CmdOrCtrl+A" },
      { label: "Expand Selection", command: "selection.expand", accelerator: "Shift+Alt+Right" },
      { label: "Shrink Selection", command: "selection.shrink", accelerator: "Shift+Alt+Left" },
      separator,
      { label: "Copy Line Up", command: "selection.copyLineUp", accelerator: "Shift+Alt+Up" },
      { label: "Copy Line Down", command: "selection.copyLineDown", accelerator: "Shift+Alt+Down" },
      { label: "Move Line Up", command: "selection.moveLineUp", accelerator: "Alt+Up" },
      { label: "Move Line Down", command: "selection.moveLineDown", accelerator: "Alt+Down" },
      { label: "Duplicate Selection", command: "selection.duplicate" },
      separator,
      { label: "Add Cursor Above", command: "selection.cursorAbove", accelerator: "CmdOrCtrl+Alt+Up" },
      { label: "Add Cursor Below", command: "selection.cursorBelow", accelerator: "CmdOrCtrl+Alt+Down" },
      { label: "Add Next Occurrence", command: "selection.addNextOccurrence", accelerator: "CmdOrCtrl+D" },
      { label: "Select All Occurrences", command: "selection.selectAllOccurrences", accelerator: "CmdOrCtrl+Shift+L" },
    ],
  },
  {
    label: "View",
    items: [
      { label: "Command Palette…", command: "palette.open", accelerator: "CmdOrCtrl+Shift+P" },
      separator,
      {
        kind: "submenu",
        label: "Appearance",
        items: [
          { label: "Toggle Full Screen", command: "view.fullScreen", accelerator: "F11" },
          { label: "Toggle Primary Side Bar", command: "view.toggleSidebar", accelerator: "CmdOrCtrl+B" },
          { label: "Toggle Panel", command: "view.togglePanel", accelerator: "CmdOrCtrl+J" },
          separator,
          { label: "Zoom In", command: "view.zoomIn", accelerator: "CmdOrCtrl+=" },
          { label: "Zoom Out", command: "view.zoomOut", accelerator: "CmdOrCtrl+-" },
          { label: "Reset Zoom", command: "view.zoomReset", accelerator: "CmdOrCtrl+0" },
        ],
      },
      separator,
      { label: "Explorer", command: "view.explorer", accelerator: "CmdOrCtrl+Shift+E" },
      { label: "Search", command: "view.search", accelerator: "CmdOrCtrl+Shift+F" },
      { label: "Source Control", command: "view.scm", accelerator: "CmdOrCtrl+Shift+G" },
      { label: "Terminal", command: "terminal.toggle", accelerator: "CmdOrCtrl+`" },
      separator,
      { label: "Assistant", command: "ai.toggle", accelerator: "CmdOrCtrl+I" },
      { label: "Word Wrap", command: "view.toggleWordWrap", accelerator: "Alt+Z" },
    ],
  },
  {
    label: "Go",
    items: [
      { label: "Go to File…", command: "go.file", accelerator: "CmdOrCtrl+P" },
      { label: "Go to Line/Column…", command: "go.line", accelerator: "CmdOrCtrl+G" },
      separator,
      { label: "Next Editor", command: "go.nextEditor", accelerator: "CmdOrCtrl+PageDown" },
      { label: "Previous Editor", command: "go.previousEditor", accelerator: "CmdOrCtrl+PageUp" },
      separator,
      { label: "Next Change", command: "go.nextChange", accelerator: "Alt+F3" },
      { label: "Previous Change", command: "go.previousChange", accelerator: "Shift+Alt+F3" },
    ],
  },
  {
    label: "Terminal",
    items: [
      { label: "New Terminal", command: "terminal.new", accelerator: "CmdOrCtrl+Shift+`" },
      { label: "Split Terminal", command: "terminal.split", accelerator: "CmdOrCtrl+Shift+5" },
      separator,
      { label: "Next Terminal", command: "terminal.next" },
      { label: "Previous Terminal", command: "terminal.previous" },
      separator,
      { label: "Clear Terminal", command: "terminal.clear", accelerator: "CmdOrCtrl+K" },
      { label: "Kill Terminal", command: "terminal.kill" },
      { label: "Kill All Terminals", command: "terminal.killAll" },
      separator,
      { label: "Run Active File", command: "terminal.runActiveFile" },
    ],
  },
  {
    label: "Help",
    items: [
      { label: "Keyboard Shortcuts", command: "help.shortcuts" },
      { label: "Toggle Developer Tools", command: "help.devTools", accelerator: "CmdOrCtrl+Shift+I" },
      separator,
      { label: "About ADCode", command: "help.about" },
    ],
  },
];

/** Accelerators rendered for a human, in the platform's own shorthand. */
export function formatAccelerator(accelerator: string, platform: string): string {
  if (platform === "darwin") {
    return accelerator
      .replace(/CmdOrCtrl|Cmd/g, "⌘")
      .replace(/Ctrl/g, "⌃")
      .replace(/Alt|Option/g, "⌥")
      .replace(/Shift/g, "⇧")
      .replace(/\+/g, "");
  }

  return accelerator.replace(/CmdOrCtrl|Cmd/g, "Ctrl");
}
