/**
 * The menu bar cannot promise something the command registry does not provide.
 *
 * A menu entry whose command is unregistered looks completely normal and does nothing
 * when clicked - the failure is silent, and it is exactly the kind that creeps back in
 * every time a menu item is added. So this reads the two sources and compares them, the
 * same way `packages/ads/test/purity.test.ts` reads source to prove what it cannot import.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMenuBar,
  formatAccelerator,
  mnemonicOf,
  splitMnemonic,
  stripMnemonic,
  type MenuEntry,
  type MenuTop,
} from "../src/shared/menuModel.ts";

const MAIN = readFileSync(join(import.meta.dirname, "../src/renderer/main.ts"), "utf8");

/** Every command id the menu can invoke, submenus included. */
function commandsIn(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((entry) => {
    if ("kind" in entry && entry.kind === "separator") return [];
    if ("kind" in entry && entry.kind === "submenu") return commandsIn(entry.items);
    return [entry.command];
  });
}

/*
 * Built with recents present, so the rows that only exist when there are some - the
 * folders themselves - are checked too. They resolve `workspace.openRecentAt`, which is
 * a registered command like any other.
 */
const MENU_BAR = buildMenuBar({ recents: [{ path: "E:/work/site", name: "site" }] });

const MENU_COMMANDS = MENU_BAR.flatMap((top) => commandsIn(top.items));

/** Ids passed to `add(...)` or `commands.registerEditorAction(...)` in the renderer. */
const REGISTERED = new Set(
  [...MAIN.matchAll(/(?:\badd|commands\.registerEditorAction)\("([^"]+)"/g)].map((m) => m[1]!),
);

describe("the menu model", () => {
  it("has something to invoke for every entry", () => {
    const missing = MENU_COMMANDS.filter((command) => !REGISTERED.has(command));
    expect(missing).toEqual([]);
  });

  it("uses well-formed command ids", () => {
    // Not unique: a command may legitimately sit on two menus - "Terminal" is under both
    // View and Terminal, the way it is in VS Code. Only the shape is asserted.
    for (const command of MENU_COMMANDS) expect(command).toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/);
  });

  it("gives every top-level menu a label and at least one item", () => {
    for (const top of MENU_BAR) {
      expect(stripMnemonic(top.label).length).toBeGreaterThan(0);
      expect(commandsIn(top.items).length).toBeGreaterThan(0);
    }
  });

  it("never opens or closes a menu with a separator", () => {
    // Into the submenus too: the recents one is assembled at runtime, so it is the only
    // panel in the bar that could come back malformed.
    const check = (name: string, items: readonly MenuEntry[]): void => {
      const first = items.at(0);
      const last = items.at(-1);

      expect(first !== undefined && "kind" in first && first.kind === "separator", name).toBe(false);
      expect(last !== undefined && "kind" in last && last.kind === "separator", name).toBe(false);

      for (const entry of items) {
        if ("kind" in entry && entry.kind === "submenu") check(`${name} > ${entry.label}`, entry.items);
      }
    };

    for (const top of MENU_BAR) check(top.label, top.items);
  });

  it("keeps the shortcut on the menu the same one the keyboard table binds", () => {
    // The bindings the renderer installs, read out of its own table.
    const table = MAIN.slice(MAIN.indexOf("const KEYBINDINGS"), MAIN.indexOf("window.addEventListener(\"keydown\""));

    const bound = new Map<string, { mod: boolean; shift: boolean; alt: boolean; key: string }>();
    for (const line of table.split("\n")) {
      const key = /key: "([^"]+)"/.exec(line);
      const command = /command: "([^"]+)"/.exec(line);
      if (key === null || command === null) continue;

      bound.set(command[1]!, {
        key: key[1]!,
        mod: line.includes("mod: true"),
        shift: line.includes("shift: true"),
        alt: line.includes("alt: true"),
      });
    }

    expect(bound.size).toBeGreaterThan(10);

    for (const top of MENU_BAR) {
      for (const entry of top.items) {
        if ("kind" in entry && entry.kind !== undefined && entry.kind !== "item") continue;
        if (!("accelerator" in entry) || entry.accelerator === undefined) continue;

        const binding = bound.get(entry.command);
        if (binding === undefined) continue;

        // The menu says "Ctrl+Shift+`"; the table says {key:"`", mod, shift}. Rebuilding
        // the label from the table is what proves they describe the same keystroke.
        //
        // Case is not part of the keystroke - the dispatcher folds it, and Electron's
        // accelerators are conventionally capitalised - so both sides are normalised
        // before comparing, or every single-letter binding would report a false mismatch.
        const rebuilt = [
          binding.mod ? "CmdOrCtrl" : null,
          binding.shift ? "Shift" : null,
          binding.alt ? "Alt" : null,
          binding.key.length === 1 ? binding.key.toUpperCase() : binding.key,
        ]
          .filter((part) => part !== null)
          .join("+");

        const expected = entry.accelerator
          .split("+")
          .map((part) => (part.length === 1 ? part.toUpperCase() : part))
          .join("+");

        expect(`${entry.command}: ${rebuilt}`).toBe(`${entry.command}: ${expected}`);
      }
    }
  });
});

describe("formatAccelerator", () => {
  it("uses the symbols macOS uses", () => {
    expect(formatAccelerator("CmdOrCtrl+Shift+P", "darwin")).toBe("⌘⇧P");
    expect(formatAccelerator("Shift+Alt+F", "darwin")).toBe("⇧⌥F");
  });

  it("spells Ctrl out everywhere else", () => {
    expect(formatAccelerator("CmdOrCtrl+Shift+P", "win32")).toBe("Ctrl+Shift+P");
    expect(formatAccelerator("F11", "win32")).toBe("F11");
  });
});

/* ── The menu as a map of what the editor can do ──────────────────────── */

const folder = (path: string, name: string) => ({ path, name, openedAt: 0 });

/** Items directly in a panel: a submenu contributes its own label, not its contents. */
function rowsOf(entries: readonly MenuEntry[]): MenuEntry[] {
  return entries.filter((entry) => !("kind" in entry && entry.kind === "separator"));
}

/** Every panel in the bar - the tops and each submenu - since each is its own key scope. */
function panels(bar: readonly MenuTop[]): { name: string; entries: readonly MenuEntry[] }[] {
  const found: { name: string; entries: readonly MenuEntry[] }[] = [];

  const walk = (name: string, entries: readonly MenuEntry[]): void => {
    found.push({ name, entries });
    for (const entry of entries) {
      if ("kind" in entry && entry.kind === "submenu") {
        walk(`${name} > ${stripMnemonic(entry.label)}`, entry.items);
      }
    }
  };

  for (const top of bar) walk(stripMnemonic(top.label), top.items);
  return found;
}

describe("mnemonic markers", () => {
  it("splits a label around the marked letter", () => {
    expect(splitMnemonic("&File")).toEqual({ before: "", key: "F", after: "ile" });
    expect(splitMnemonic("G&it")).toEqual({ before: "G", key: "i", after: "t" });
    expect(splitMnemonic("Save &All")).toEqual({ before: "Save ", key: "A", after: "ll" });
  });

  it("reports no key when nothing is marked", () => {
    expect(splitMnemonic("Open Recent")).toEqual({ before: "Open Recent", key: null, after: "" });
    expect(mnemonicOf("Open Recent")).toBeNull();
  });

  it("lower-cases the key it reports, so matching a keystroke needs no second thought", () => {
    expect(mnemonicOf("&File")).toBe("f");
    expect(mnemonicOf("G&it")).toBe("i");
  });

  /*
   * `&&` is Electron's escape for a literal ampersand, and a recent folder called
   * `R&D` arrives here as `R&&D`. Without the escape the D would silently become the
   * mnemonic and the row would render as "R&D" with a stray underline.
   */
  it("treats a doubled ampersand as a literal one, not a marker", () => {
    expect(splitMnemonic("R&&D")).toEqual({ before: "R&D", key: null, after: "" });
    expect(stripMnemonic("R&&D")).toBe("R&D");
  });

  it("strips the marker for anywhere a plain string is wanted", () => {
    expect(stripMnemonic("&File")).toBe("File");
    expect(stripMnemonic("Close &All Editors")).toBe("Close All Editors");
  });
});

describe("the bar as a whole", () => {
  const bar = buildMenuBar({ recents: [] });

  it("gives every top-level menu its own mnemonic", () => {
    const keys = bar.map((top) => mnemonicOf(top.label));

    expect(keys).not.toContain(null);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every row in a panel its own mnemonic", () => {
    for (const panel of panels(bar)) {
      // A row that cannot be chosen needs no letter - "No Recent Folders" is a sentence,
      // not a command.
      const keys = rowsOf(panel.entries)
        .filter((entry) => !("enabled" in entry && entry.enabled === false))
        .map((entry) => mnemonicOf("label" in entry ? entry.label : ""));

      expect(keys, `${panel.name} has an unmarked row`).not.toContain(null);
      expect(new Set(keys).size, `${panel.name} claims a letter twice: ${keys.join(",")}`).toBe(
        keys.length,
      );
    }
  });

  /*
   * The Terminal menu carried "Run Active File" twice, on two different commands - one
   * running it through the Run button, one sending it to a terminal. Both are worth
   * having; presenting them under one name is not.
   */
  it("never says the same thing twice in one panel", () => {
    for (const panel of panels(bar)) {
      const labels = rowsOf(panel.entries).map((entry) =>
        stripMnemonic("label" in entry ? entry.label : ""),
      );

      expect(new Set(labels).size, `${panel.name} repeats a label: ${labels.join(",")}`).toBe(
        labels.length,
      );
    }
  });

  it("carries the features that used to be reachable only from the palette", () => {
    const commands = new Set<string>();
    const walk = (entries: readonly MenuEntry[]): void => {
      for (const entry of entries) {
        if ("kind" in entry && entry.kind === "submenu") walk(entry.items);
        else if ("command" in entry) commands.add(entry.command);
      }
    };
    for (const top of bar) walk(top.items);

    for (const command of [
      "view.earnings",
      "collab.panel",
      "collab.leave",
      "preview.reload",
      "preview.undock",
      "preview.switchMode",
      "git.commit",
      "git.push",
      "git.pull",
      "git.fetch",
      "git.checkout",
      "git.init",
    ]) {
      expect(commands, `${command} is in no menu`).toContain(command);
    }
  });
});

describe("the recent folders submenu", () => {
  it("offers the folders themselves, newest first, each carrying its own path", () => {
    const bar = buildMenuBar({
      recents: [folder("E:/work/site", "site"), folder("E:/work/api", "api")],
    });

    const recent = panels(bar).find((panel) => panel.name.endsWith("Open Recent"));
    const rows = rowsOf(recent?.entries ?? []);

    expect(rows.slice(0, 2)).toMatchObject([
      { command: "workspace.openRecentAt", arg: "E:/work/site" },
      { command: "workspace.openRecentAt", arg: "E:/work/api" },
    ]);
  });

  /*
   * The cap is the whole reason the picker survives underneath. Twelve full paths in a
   * dropdown is a wall; ten names with "More…" under them is a menu.
   */
  it("stops at ten and leaves the rest to the picker", () => {
    const many = Array.from({ length: 25 }, (_, at) => folder(`E:/p${at}`, `p${at}`));
    const bar = buildMenuBar({ recents: many });

    const recent = panels(bar).find((panel) => panel.name.endsWith("Open Recent"));
    const rows = rowsOf(recent?.entries ?? []);
    const folders = rows.filter((row) => "command" in row && row.command === "workspace.openRecentAt");

    expect(folders).toHaveLength(10);
    expect(rows.some((row) => "command" in row && row.command === "workspace.openRecent")).toBe(true);
    expect(rows.some((row) => "command" in row && row.command === "workspace.clearRecents")).toBe(true);
  });

  /*
   * An empty submenu is a menu that opens onto nothing, which reads as a bug. A row that
   * says so - and cannot be clicked - reads as an answer.
   */
  it("says so when there are none, rather than opening onto nothing", () => {
    const bar = buildMenuBar({ recents: [] });

    const recent = panels(bar).find((panel) => panel.name.endsWith("Open Recent"));
    const rows = rowsOf(recent?.entries ?? []);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ enabled: false });
  });

  it("shows where a folder is, so two called src are told apart", () => {
    const bar = buildMenuBar({
      recents: [folder("E:/work/site/src", "src"), folder("E:/play/toy/src", "src")],
    });

    const recent = panels(bar).find((panel) => panel.name.endsWith("Open Recent"));
    const rows = rowsOf(recent?.entries ?? []);

    expect(rows[0]).toMatchObject({ detail: "E:/work/site" });
    expect(rows[1]).toMatchObject({ detail: "E:/play/toy" });
  });

  /*
   * A folder called `R&D` is not a mnemonic instruction. The marker has to be escaped on
   * the way in, because these labels are the one part of the model that is user data.
   */
  it("escapes an ampersand in a folder name", () => {
    const bar = buildMenuBar({ recents: [folder("E:/R&D", "R&D")] });

    const recent = panels(bar).find((panel) => panel.name.endsWith("Open Recent"));
    const first = rowsOf(recent?.entries ?? [])[0];

    expect(stripMnemonic("label" in (first ?? {}) ? (first as { label: string }).label : "")).toBe(
      "R&D",
    );
  });
});
