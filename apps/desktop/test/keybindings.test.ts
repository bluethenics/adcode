import { describe, expect, it } from "vitest";
import {
  applyOverrides,
  chordFromEvent,
  conflicts,
  formatChord,
  isBindableChord,
  matchesChord,
  parseChord,
  pruneOverrides,
  resolveBindings,
} from "../src/shared/keybindings.ts";
import { buildMenuBar } from "../src/shared/menuModel.ts";

const press = (key: string, modifiers: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
  key,
  ctrlKey: modifiers.ctrlKey ?? false,
  metaKey: modifiers.metaKey ?? false,
  shiftKey: modifiers.shiftKey ?? false,
  altKey: modifiers.altKey ?? false,
});

describe("parseChord", () => {
  it("reads modifiers and the key", () => {
    expect(parseChord("CmdOrCtrl+Shift+P")).toEqual({ key: "p", mod: true, shift: true, alt: false });
  });

  it("accepts every spelling of the command modifier", () => {
    for (const chord of ["Cmd+P", "Command+P", "Ctrl+P", "Control+P", "CmdOrCtrl+P"]) {
      expect(parseChord(chord)?.mod, chord).toBe(true);
    }
  });

  it("keeps a named key as written", () => {
    expect(parseChord("F11")).toEqual({ key: "F11", mod: false, shift: false, alt: false });
    expect(parseChord("CmdOrCtrl+PageDown")?.key).toBe("PageDown");
  });

  it("refuses what is not a chord", () => {
    expect(parseChord("")).toBeNull();
    expect(parseChord("Ctrl+")).toBeNull();
    expect(parseChord("Ctrl+A+B")).toBeNull();
    expect(parseChord("Shift")).toBeNull();
  });
});

describe("chordFromEvent", () => {
  it("builds a chord in the order Electron writes one", () => {
    expect(chordFromEvent(press("p", { ctrlKey: true, shiftKey: true }))).toBe("CmdOrCtrl+Shift+P");
  });

  it("treats Meta as the command modifier, for macOS", () => {
    expect(chordFromEvent(press("k", { metaKey: true }))).toBe("CmdOrCtrl+K");
  });

  it("records the key, not the character shift produced", () => {
    // On a US layout Shift+1 is `!`; storing that gives a chord no other keyboard can press.
    expect(chordFromEvent(press("1", { ctrlKey: true, shiftKey: true }))).toBe("CmdOrCtrl+Shift+1");
  });

  it("is null while only a modifier is held", () => {
    for (const key of ["Control", "Shift", "Alt", "Meta"]) {
      expect(chordFromEvent(press(key, { ctrlKey: true })), key).toBeNull();
    }
  });

  it("round-trips through parseChord", () => {
    const chord = chordFromEvent(press("F", { ctrlKey: true, altKey: true }));
    expect(chord).not.toBeNull();
    expect(matchesChord(parseChord(chord!)!, press("f", { ctrlKey: true, altKey: true }))).toBe(true);
  });
});

describe("matchesChord", () => {
  const chord = parseChord("CmdOrCtrl+Shift+F")!;

  it("matches the press it describes", () => {
    expect(matchesChord(chord, press("F", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesChord(chord, press("f", { metaKey: true, shiftKey: true }))).toBe(true);
  });

  it("does not match a press with a modifier too few or too many", () => {
    expect(matchesChord(chord, press("f", { ctrlKey: true }))).toBe(false);
    expect(matchesChord(chord, press("f", { ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });

  it("does not match a different key", () => {
    expect(matchesChord(chord, press("g", { ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});

describe("isBindableChord", () => {
  it("takes a chord with a modifier", () => {
    expect(isBindableChord("CmdOrCtrl+K")).toBe(true);
    expect(isBindableChord("Alt+Z")).toBe(true);
  });

  it("takes a function key or a navigation key on its own", () => {
    expect(isBindableChord("F11")).toBe(true);
    expect(isBindableChord("Delete")).toBe(true);
  });

  it("refuses a bare letter, which would fire while you type", () => {
    expect(isBindableChord("K")).toBe(false);
    expect(isBindableChord("Shift+A")).toBe(false);
  });

  it("refuses nonsense", () => {
    expect(isBindableChord("")).toBe(false);
    expect(isBindableChord("Ctrl+")).toBe(false);
  });
});

describe("formatChord", () => {
  it("says Ctrl off a Mac", () => {
    expect(formatChord("CmdOrCtrl+Shift+P", "win32")).toBe("Ctrl+Shift+P");
  });

  it("uses the glyphs on a Mac", () => {
    expect(formatChord("CmdOrCtrl+Shift+P", "darwin")).toBe("⌘⇧P");
  });
});

describe("resolveBindings", () => {
  it("finds every command on the menu that carries a shortcut", () => {
    const bindings = resolveBindings();
    const byCommand = new Map(bindings.map((binding) => [binding.command, binding]));

    expect(byCommand.get("palette.open")?.chord).toBe("CmdOrCtrl+Shift+P");
    expect(byCommand.get("file.save")?.chord).toBe("CmdOrCtrl+S");
  });

  it("groups a row under the menu it came from", () => {
    const binding = resolveBindings().find((entry) => entry.command === "file.save");
    expect(binding?.group).toBe("File");
  });

  it("keeps commands that have no shortcut, so one can be given", () => {
    const unbound = resolveBindings().filter((binding) => binding.chord === null);
    expect(unbound.length).toBeGreaterThan(0);
  });

  it("leaves the recent-folder rows out", () => {
    // Ten menu rows share `workspace.openRecent`; a shortcut for "whichever folder is third
    // today" is not a shortcut.
    const bar = buildMenuBar({ recents: [{ path: "C:/a", name: "a" }] });
    const bindings = resolveBindings({}, bar);

    expect(bindings.filter((binding) => binding.command === "workspace.openRecent").length).toBeLessThan(2);
  });

  it("applies an override", () => {
    const bindings = resolveBindings({ "file.save": "CmdOrCtrl+Alt+S" });
    const save = bindings.find((binding) => binding.command === "file.save");

    expect(save?.chord).toBe("CmdOrCtrl+Alt+S");
    // The factory value survives, so the row can offer to put it back.
    expect(save?.defaultChord).toBe("CmdOrCtrl+S");
  });

  it("treats a null override as cleared, not as absent", () => {
    const save = resolveBindings({ "file.save": null }).find((binding) => binding.command === "file.save");

    expect(save?.chord).toBeNull();
    expect(save?.defaultChord).toBe("CmdOrCtrl+S");
  });

  it("ignores an override that is not bindable", () => {
    const save = resolveBindings({ "file.save": "S" }).find((binding) => binding.command === "file.save");
    expect(save?.chord).toBe("CmdOrCtrl+S");
  });

  it("marks the rows Electron implements itself", () => {
    const copy = resolveBindings().find((binding) => binding.command.includes("copy"));
    if (copy !== undefined) expect(typeof copy.nativeRole).toBe("boolean");
  });
});

describe("conflicts", () => {
  /*
   * The guard that matters most in this file.
   *
   * Two commands on one chord means one of them silently never runs, and it is invisible
   * in review - the two menu rows are hundreds of lines apart. This found a real one the
   * day it was written: Structure had been given Ctrl+Shift+O, which Open File already had.
   */
  it("the shipped defaults do not collide", () => {
    const collisions = conflicts(resolveBindings());
    const readable = [...collisions].map(([chord, commands]) => `${chord}: ${commands.join(", ")}`);

    expect(readable).toEqual([]);
  });

  it("reports a collision an override introduces", () => {
    const collisions = conflicts(resolveBindings({ "file.new": "CmdOrCtrl+S" }));

    expect(collisions.get("CmdOrCtrl+S")?.sort()).toEqual(["file.new", "file.save"]);
  });

  it("says nothing about unbound rows", () => {
    // Both cleared, so neither can collide with anything - including with each other.
    const collisions = conflicts(resolveBindings({ "file.new": null, "file.save": null }));

    for (const commands of collisions.values()) {
      expect(commands).not.toContain("file.new");
      expect(commands).not.toContain("file.save");
    }
  });
});

describe("applyOverrides", () => {
  it("writes the user's shortcut onto the menu the user sees", () => {
    const bar = applyOverrides(buildMenuBar(), { "file.save": "CmdOrCtrl+Alt+S" });

    const file = bar.find((top) => top.label === "&File");
    const save = file?.items.find((entry) => "command" in entry && entry.command === "file.save");

    expect(save).toBeDefined();
    expect((save as { accelerator?: string }).accelerator).toBe("CmdOrCtrl+Alt+S");
  });

  it("removes the accelerator when a shortcut is cleared", () => {
    const bar = applyOverrides(buildMenuBar(), { "file.save": null });
    const file = bar.find((top) => top.label === "&File");
    const save = file?.items.find((entry) => "command" in entry && entry.command === "file.save");

    expect(Object.hasOwn(save as object, "accelerator")).toBe(false);
  });

  it("reaches into submenus", () => {
    const bar = applyOverrides(buildMenuBar(), { "view.zoomIn": "CmdOrCtrl+Alt+=" });

    const view = bar.find((top) => top.label === "&View");
    const appearance = view?.items.find((entry) => "kind" in entry && entry.kind === "submenu");
    const zoom = (appearance as { items: readonly { command?: string; accelerator?: string }[] }).items.find(
      (entry) => entry.command === "view.zoomIn",
    );

    expect(zoom?.accelerator).toBe("CmdOrCtrl+Alt+=");
  });

  it("leaves everything else exactly as it was", () => {
    const before = JSON.stringify(buildMenuBar());
    applyOverrides(buildMenuBar(), { "file.save": "CmdOrCtrl+Alt+S" });

    expect(JSON.stringify(buildMenuBar())).toBe(before);
  });
});

describe("pruneOverrides", () => {
  it("drops a command that no longer exists", () => {
    const kept = pruneOverrides({ "file.save": "CmdOrCtrl+Alt+S", "command.removed.in.v2": "Ctrl+Q" });

    expect(Object.keys(kept)).toEqual(["file.save"]);
  });
});
