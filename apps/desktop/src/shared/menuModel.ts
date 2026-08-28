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
 *
 * A function rather than a constant, because one part of the bar is not knowable when the
 * module loads: the recent folders. Both consumers rebuild from it - the main process
 * when the recents file changes, the renderer when a folder is opened - so neither can
 * end up showing a list the other has moved on from.
 */

/** A folder the recents submenu names. Structurally what `RecentFolderView` already is. */
export interface RecentFolder {
  readonly path: string;
  readonly name: string;
}

/** Everything the bar needs to know that is not fixed at build time. */
export interface MenuContext {
  readonly recents: readonly RecentFolder[];
}

export interface MenuItem {
  readonly kind?: "item";
  /**
   * The label, with `&` before the mnemonic letter - Electron's own notation, which the
   * custom bar reads with `splitMnemonic` and draws as an underline. `&&` is a literal
   * ampersand, which is what a folder called `R&D` needs.
   */
  readonly label: string;
  readonly command: string;
  /**
   * What the command is being asked to act on - a recent folder's path, so far.
   *
   * The alternative was a command id per recent folder, which would have put ten of them
   * in the command palette every time somebody opened a project.
   */
  readonly arg?: string;
  /** A dimmed second string on the right of the row: where a recent folder lives. */
  readonly detail?: string;
  /** Electron accelerator syntax, also rendered as the hint in the custom bar. */
  readonly accelerator?: string;
  /** Absent means choosable. `false` is for a row that exists to say there is nothing. */
  readonly enabled?: boolean;
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
 * How many recent folders go in the menu before the picker takes over.
 *
 * The picker survives underneath precisely because of this number. Twelve full paths in a
 * dropdown is a wall you have to read; ten folder names with "More…" beneath them is a
 * menu you can glance at.
 */
const RECENTS_IN_MENU = 10;

/* ── Mnemonics ─────────────────────────────────────────────────────────── */

export interface SplitLabel {
  readonly before: string;
  /** The marked letter, exactly as written, or null when the label marks none. */
  readonly key: string | null;
  readonly after: string;
}

/** A label split around its mnemonic, with `&&` already resolved to a literal `&`. */
export function splitMnemonic(label: string): SplitLabel {
  let before = "";

  for (let at = 0; at < label.length; at += 1) {
    const char = label[at];

    if (char !== "&") {
      before += char;
      continue;
    }

    if (label[at + 1] === "&") {
      before += "&";
      at += 1;
      continue;
    }

    const key = label[at + 1];
    // A trailing lone `&` marks nothing; drop it rather than render it.
    if (key === undefined) continue;

    return { before, key, after: label.slice(at + 2).replace(/&&/g, "&") };
  }

  return { before, key: null, after: "" };
}

/** The label as a human reads it: no markers, escapes resolved. */
export function stripMnemonic(label: string): string {
  const split = splitMnemonic(label);
  return split.key === null ? split.before : `${split.before}${split.key}${split.after}`;
}

/** The letter this label answers to, lower-cased so matching a keystroke is one compare. */
export function mnemonicOf(label: string): string | null {
  return splitMnemonic(label).key?.toLowerCase() ?? null;
}

/** For labels made of user data - a folder name - where `&` means an ampersand. */
export function escapeMnemonic(text: string): string {
  return text.replace(/&/g, "&&");
}

/* ── The bar ───────────────────────────────────────────────────────────── */

/**
 * The recent folders, as rows.
 *
 * Names rather than paths, with the containing directory dimmed on the right: two
 * projects both called `src` are indistinguishable by name, and unreadable by full path.
 */
function recentsSubmenu(recents: readonly RecentFolder[]): MenuSubmenu {
  if (recents.length === 0) {
    return {
      kind: "submenu",
      label: "Open &Recent",
      // An empty submenu opens onto nothing, which reads as a bug rather than an answer.
      items: [{ label: "No Recent Folders", command: "workspace.openRecent", enabled: false }],
    };
  }

  const rows: MenuEntry[] = recents.slice(0, RECENTS_IN_MENU).map((folder) => ({
    label: escapeMnemonic(folder.name),
    command: "workspace.openRecentAt",
    arg: folder.path,
    detail: folder.path.replace(/[\\/][^\\/]*$/, ""),
  }));

  return {
    kind: "submenu",
    label: "Open &Recent",
    items: [
      ...rows,
      separator,
      { label: "&More…", command: "workspace.openRecent", accelerator: "CmdOrCtrl+R" },
      { label: "&Clear Recently Opened", command: "workspace.clearRecents" },
    ],
  };
}

/**
 * The menus, in VS Code's order and largely with its labels.
 *
 * Only commands that are actually implemented appear. There was no Run menu here for a long
 * time, precisely because of that rule - a Run menu whose entries do nothing because there
 * is no debugger would teach the user that the menu bar lies. There is a debugger now, so
 * there is a Run menu. "New Window" is absent for the same reason: the workspace
 * root is process-wide, so a second window would fight the first over which folder is
 * open, and that is a data-loss bug rather than a missing feature.
 *
 * Git is the one menu VS Code does not have. It earns the place here because everything
 * under it already exists and was reachable only by finding the right button inside one
 * panel - and because "how do I commit" is the question this editor is most often asked.
 */
export function buildMenuBar(context: MenuContext = { recents: [] }): readonly MenuTop[] {
  return [
    {
      label: "&File",
      items: [
        { label: "&New File", command: "file.new", accelerator: "CmdOrCtrl+N" },
        separator,
        { label: "Open &Folder…", command: "workspace.open", accelerator: "CmdOrCtrl+O" },
        { label: "&Open File…", command: "file.open", accelerator: "CmdOrCtrl+Shift+O" },
        recentsSubmenu(context.recents),
        { label: "&Clone Repository…", command: "workspace.clone" },
        { label: "Close Fol&der", command: "workspace.close" },
        separator,
        { label: "&Save", command: "file.save", accelerator: "CmdOrCtrl+S" },
        { label: "Save &As…", command: "file.saveAs", accelerator: "CmdOrCtrl+Shift+S" },
        { label: "Save A&ll", command: "file.saveAll", accelerator: "CmdOrCtrl+Alt+S" },
        separator,
        { label: "Re&vert File", command: "file.revert" },
        { label: "Close &Editor", command: "editor.close", accelerator: "CmdOrCtrl+W" },
        {
          label: "Close All Edi&tors",
          command: "editor.closeAll",
          accelerator: "CmdOrCtrl+K CmdOrCtrl+W",
        },
        separator,
        { label: "&Preferences", command: "settings.open", accelerator: "CmdOrCtrl+," },
        separator,
        { label: "E&xit", command: "app.quit", role: "quit" },
      ],
    },
    {
      label: "&Edit",
      items: [
        { label: "&Undo", command: "edit.undo", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "&Redo", command: "edit.redo", accelerator: "CmdOrCtrl+Y", role: "redo" },
        separator,
        { label: "Cu&t", command: "edit.cut", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "&Copy", command: "edit.copy", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "&Paste", command: "edit.paste", accelerator: "CmdOrCtrl+V", role: "paste" },
        separator,
        { label: "&Find", command: "edit.find", accelerator: "CmdOrCtrl+F" },
        { label: "R&eplace", command: "edit.replace", accelerator: "CmdOrCtrl+H" },
        separator,
        // `view.search`, not an id of its own: this row and View > Search are the same
        // action, and two commands sharing one accelerator means Electron registers it
        // twice and the second one never fires.
        { label: "Find &in Files", command: "view.search", accelerator: "CmdOrCtrl+Shift+F" },
        separator,
        {
          label: "Toggle &Line Comment",
          command: "edit.toggleLineComment",
          accelerator: "CmdOrCtrl+/",
        },
        {
          label: "Toggle &Block Comment",
          command: "edit.toggleBlockComment",
          accelerator: "Shift+Alt+A",
        },
        separator,
        { label: "Format &Document", command: "edit.format", accelerator: "Shift+Alt+F" },
        { label: "Suggest Code with &AI", command: "ai.complete", accelerator: "Alt+\\" },
      ],
    },
    {
      label: "&Selection",
      items: [
        { label: "Select &All", command: "selection.all", accelerator: "CmdOrCtrl+A" },
        { label: "&Expand Selection", command: "selection.expand", accelerator: "Shift+Alt+Right" },
        { label: "&Shrink Selection", command: "selection.shrink", accelerator: "Shift+Alt+Left" },
        separator,
        { label: "&Copy Line Up", command: "selection.copyLineUp", accelerator: "Shift+Alt+Up" },
        {
          label: "Copy Line &Down",
          command: "selection.copyLineDown",
          accelerator: "Shift+Alt+Down",
        },
        { label: "&Move Line Up", command: "selection.moveLineUp", accelerator: "Alt+Up" },
        { label: "Move &Line Down", command: "selection.moveLineDown", accelerator: "Alt+Down" },
        { label: "D&uplicate Selection", command: "selection.duplicate" },
        separator,
        {
          label: "Add Cursor A&bove",
          command: "selection.cursorAbove",
          accelerator: "CmdOrCtrl+Alt+Up",
        },
        {
          label: "Add Cursor Belo&w",
          command: "selection.cursorBelow",
          accelerator: "CmdOrCtrl+Alt+Down",
        },
        {
          label: "Add &Next Occurrence",
          command: "selection.addNextOccurrence",
          accelerator: "CmdOrCtrl+D",
        },
        {
          label: "Select All &Occurrences",
          command: "selection.selectAllOccurrences",
          accelerator: "CmdOrCtrl+Shift+L",
        },
      ],
    },
    {
      label: "&View",
      items: [
        { label: "Command &Palette…", command: "palette.open", accelerator: "CmdOrCtrl+Shift+P" },
        separator,
        {
          kind: "submenu",
          label: "&Appearance",
          items: [
            { label: "Toggle &Full Screen", command: "view.fullScreen", accelerator: "F11" },
            {
              label: "Toggle Primary &Side Bar",
              command: "view.toggleSidebar",
              accelerator: "CmdOrCtrl+B",
            },
            { label: "Toggle &Panel", command: "view.togglePanel", accelerator: "CmdOrCtrl+J" },
            separator,
            { label: "Zoom &In", command: "view.zoomIn", accelerator: "CmdOrCtrl+=" },
            { label: "Zoom &Out", command: "view.zoomOut", accelerator: "CmdOrCtrl+-" },
            { label: "&Reset Zoom", command: "view.zoomReset", accelerator: "CmdOrCtrl+0" },
          ],
        },
        separator,
        { label: "&Explorer", command: "view.explorer", accelerator: "CmdOrCtrl+Shift+E" },
        { label: "&Search", command: "view.search", accelerator: "CmdOrCtrl+Shift+F" },
        // "u", because S belongs to Search and T to Terminal. Ctrl+Shift+O is what every
        // other editor binds to "go to symbol in this file", which is what this is.
        { label: "Str&ucture", command: "view.structure", accelerator: "CmdOrCtrl+Shift+U" },
        // The other half of the same popup. Its own row rather than a tab nobody finds:
        // "what are all these folders" is asked once, on the first morning, by somebody
        // who does not yet know this editor has an answer.
        { label: "Explain This Pro&ject", command: "view.projectMap" },
        { label: "Source &Control", command: "view.scm", accelerator: "CmdOrCtrl+Shift+G" },
        { label: "Pr&oblems", command: "view.problems", accelerator: "CmdOrCtrl+Shift+M" },
        { label: "&Terminal", command: "terminal.toggle", accelerator: "CmdOrCtrl+`" },
        separator,
        {
          kind: "submenu",
          label: "Live Pre&view",
          items: [
            {
              label: "&Toggle Live Preview",
              command: "preview.toggle",
              accelerator: "CmdOrCtrl+Shift+V",
            },
            { label: "&Reload Preview", command: "preview.reload" },
            { label: "&Undock Into a Floating Window", command: "preview.undock" },
            { label: "&Switch Between Project and Files", command: "preview.switchMode" },
          ],
        },
        separator,
        // The two surfaces that reach outside this window, kept together and kept away
        // from the panel toggles above: one spends money, one shares your code.
        { label: "&Live Session…", command: "collab.panel" },
        { label: "Leave Live Sess&ion", command: "collab.leave" },
        { label: "Ea&rnings", command: "view.earnings" },
        separator,
        { label: "Assista&nt", command: "ai.toggle", accelerator: "CmdOrCtrl+I" },
        { label: "&Word Wrap", command: "view.toggleWordWrap", accelerator: "Alt+Z" },
      ],
    },
    {
      label: "G&o",
      items: [
        { label: "Go to &File…", command: "go.file", accelerator: "CmdOrCtrl+P" },
        { label: "Go to &Line/Column…", command: "go.line", accelerator: "CmdOrCtrl+G" },
        { label: "Go to &Symbol…", command: "go.symbol", accelerator: "CmdOrCtrl+T" },
        separator,
        { label: "Go to &Definition", command: "go.definition", accelerator: "F12" },
        { label: "Pee&k Definition", command: "go.peek", accelerator: "Alt+F12" },
        separator,
        { label: "&Next Editor", command: "go.nextEditor", accelerator: "CmdOrCtrl+PageDown" },
        { label: "&Previous Editor", command: "go.previousEditor", accelerator: "CmdOrCtrl+PageUp" },
        separator,
        { label: "Next &Change", command: "go.nextChange", accelerator: "Alt+F3" },
        { label: "Previous C&hange", command: "go.previousChange", accelerator: "Shift+Alt+F3" },
      ],
    },
    {
      label: "&Run",
      items: [
        { label: "Start &Debugging", command: "debug.start", accelerator: "F5" },
        { label: "&Stop Debugging", command: "debug.stop", accelerator: "Shift+F5" },
        separator,
        { label: "Step &Over", command: "debug.stepOver", accelerator: "F10" },
        /*
         * `Ctrl+F11`, not the conventional `F11`.
         *
         * F11 is full screen, and has been since before there was a debugger. Editors that
         * use F11 for Step Into resolve the clash by context - the debug binding wins while
         * a session is running - and this keybinding model is static, so it cannot. Taking
         * full screen away from every user for a key that matters during a debug session is
         * the wrong trade; the F11 family stays coherent instead.
         */
        { label: "Step &Into", command: "debug.stepInto", accelerator: "CmdOrCtrl+F11" },
        { label: "Step O&ut", command: "debug.stepOut", accelerator: "Shift+F11" },
        separator,
        { label: "Run &Without Debugging", command: "run.file", accelerator: "CmdOrCtrl+F5" },
      ],
    },
    {
      label: "&Git",
      items: [
        // No accelerator: a menu accelerator is registered application-wide, and Ctrl+Enter
        // already belongs to the commit box itself. Claiming it here would take it away
        // from the textarea the user is typing the message into.
        { label: "&Commit…", command: "git.commit" },
        { label: "&Stage All Changes", command: "git.stageAll" },
        { label: "&Unstage All Changes", command: "git.unstageAll" },
        separator,
        { label: "Pus&h", command: "git.push" },
        { label: "&Pull", command: "git.pull" },
        { label: "&Fetch", command: "git.fetch" },
        separator,
        { label: "Chec&kout Branch…", command: "git.checkout" },
        { label: "Create &Branch…", command: "git.createBranch" },
        separator,
        { label: "&Initialise Repository", command: "git.init" },
        { label: "Clone &Repository…", command: "workspace.clone" },
        separator,
        { label: "Open Source Contro&l", command: "view.scm" },
      ],
    },
    {
      label: "&Terminal",
      items: [
        // First, because it is the reason most people open this menu. It runs in a terminal,
        // which is why it lives here rather than under View with the preview.
        { label: "&Run Active File", command: "run.file", accelerator: "CmdOrCtrl+F5" },
        separator,
        { label: "&New Terminal", command: "terminal.new", accelerator: "CmdOrCtrl+Shift+`" },
        // One static entry that opens the picker, rather than a row per shell. Which shells
        // exist is decided at runtime by what is installed, and this model is also what
        // macOS builds its *native* menu from - so a hardcoded "Git Bash" would be a menu
        // item that does nothing on every machine without Git Bash. The per-shell entries
        // live in the palette, which is built after detection.
        { label: "New Terminal With &Profile…", command: "terminal.newWithProfile" },
        { label: "&Split Terminal", command: "terminal.split", accelerator: "CmdOrCtrl+Shift+5" },
        separator,
        { label: "Ne&xt Terminal", command: "terminal.next" },
        { label: "Pre&vious Terminal", command: "terminal.previous" },
        separator,
        /*
         * No accelerators on these two, deliberately.
         *
         * A menu accelerator is global: binding Ctrl+Shift+V here would take it from the
         * live preview toggle everywhere in the app, including when no terminal is even
         * open. Copy and paste inside a terminal are only meaningful while that terminal
         * has focus, so the terminal handles those keys itself - Ctrl+V, Ctrl+Shift+V, and
         * Ctrl+Shift+C, with Ctrl+C left alone unless there is a selection so that it can
         * still interrupt. These rows exist for discoverability.
         */
        { label: "C&opy", command: "terminal.copy" },
        { label: "Past&e", command: "terminal.paste" },
        separator,
        { label: "&Clear Terminal", command: "terminal.clear", accelerator: "CmdOrCtrl+K" },
        { label: "&Kill Terminal", command: "terminal.kill" },
        { label: "Kill &All Terminals", command: "terminal.killAll" },
        separator,
        // Named apart from "Run Active File" above, which it sat under twice with the same
        // words on both. They do different things - one uses the runner the Run button
        // picked, one sends the command to the terminal you are looking at - and a menu
        // that gives two commands one name has told you nothing about either.
        { label: "Run Active File in &Terminal", command: "terminal.runActiveFile" },
      ],
    },
    {
      label: "&Help",
      items: [
        // First, and above the separator, because it is the item somebody opening this menu
        // for the first time is actually looking for. Shortcuts are for people who already
        // know what the features are called.
        { label: "ADCode &Guide", command: "help.guide" },
        { label: "&What’s New", command: "help.whatsNew" },
        { label: "&Keyboard Shortcuts", command: "help.shortcuts" },
        {
          label: "Toggle &Developer Tools",
          command: "help.devTools",
          accelerator: "CmdOrCtrl+Shift+I",
        },
        separator,
        { label: "&About ADCode", command: "help.about" },
      ],
    },
  ];
}

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
