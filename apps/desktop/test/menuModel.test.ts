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
import { MENU_BAR, formatAccelerator, type MenuEntry } from "../src/shared/menuModel.ts";

const MAIN = readFileSync(join(import.meta.dirname, "../src/renderer/main.ts"), "utf8");

/** Every command id the menu can invoke, submenus included. */
function commandsIn(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((entry) => {
    if ("kind" in entry && entry.kind === "separator") return [];
    if ("kind" in entry && entry.kind === "submenu") return commandsIn(entry.items);
    return [entry.command];
  });
}

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
      expect(top.label.length).toBeGreaterThan(0);
      expect(commandsIn(top.items).length).toBeGreaterThan(0);
    }
  });

  it("never opens or closes a menu with a separator", () => {
    for (const top of MENU_BAR) {
      const first = top.items.at(0);
      const last = top.items.at(-1);

      expect(first !== undefined && "kind" in first && first.kind === "separator").toBe(false);
      expect(last !== undefined && "kind" in last && last.kind === "separator").toBe(false);
    }
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
