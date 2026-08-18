/**
 * Alt opens the menu bar; Alt+something edits the code.
 *
 * Every case here is a real keystroke a developer makes constantly, and each one used to
 * open the menu bar and move focus off the editor because the decision was made on the
 * `Alt` keydown - which arrives before the key it modifies, and before the other modifier
 * if the user happens to press Alt first.
 */
import { describe, expect, it } from "vitest";
import { createAltMenuActivation, type KeyLike } from "../src/renderer/workbench/altMenuActivation.ts";

const key = (name: string, modifiers: Partial<KeyLike> = {}): KeyLike => ({
  key: name,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
});

describe("a bare Alt", () => {
  it("opens the menu on release, not on press", () => {
    const alt = createAltMenuActivation();

    alt.keydown(key("Alt"));
    expect(alt.isArmed()).toBe(true);

    expect(alt.keyup(key("Alt"))).toBe(true);
  });

  it("does not open twice from one press", () => {
    const alt = createAltMenuActivation();

    alt.keydown(key("Alt"));
    expect(alt.keyup(key("Alt"))).toBe(true);
    expect(alt.keyup(key("Alt"))).toBe(false);
  });

  it("survives the repeats that arrive while it is held", () => {
    const alt = createAltMenuActivation();

    alt.keydown(key("Alt"));
    alt.keydown(key("Alt", { repeat: true }));
    alt.keydown(key("Alt", { repeat: true }));

    expect(alt.keyup(key("Alt"))).toBe(true);
  });
});

describe("Alt as part of an editing chord", () => {
  // The table from the Selection menu. Each is Alt pressed first, which is the ordering
  // the old point-in-time modifier check could not see.
  const chords: ReadonlyArray<readonly [string, KeyLike]> = [
    ["move line up", key("ArrowUp")],
    ["move line down", key("ArrowDown")],
    ["copy line up", key("ArrowUp", { shiftKey: true })],
    ["copy line down", key("ArrowDown", { shiftKey: true })],
    ["expand selection", key("ArrowRight", { shiftKey: true })],
    ["shrink selection", key("ArrowLeft", { shiftKey: true })],
    ["add cursor above", key("ArrowUp", { ctrlKey: true })],
    ["add cursor below", key("ArrowDown", { ctrlKey: true })],
  ];

  for (const [name, second] of chords) {
    it(`leaves the menu shut for ${name}`, () => {
      const alt = createAltMenuActivation();

      alt.keydown(key("Alt"));
      alt.keydown(second);

      expect(alt.isArmed()).toBe(false);
      expect(alt.keyup(key("Alt"))).toBe(false);
    });
  }

  it("leaves it shut when the other modifier is pressed first", () => {
    const alt = createAltMenuActivation();

    // Shift down, then Alt - so the Alt keydown does carry shiftKey. Both orders must
    // reach the same answer, which is the whole point.
    alt.keydown(key("Shift"));
    alt.keydown(key("Alt", { shiftKey: true }));

    expect(alt.isArmed()).toBe(false);
    expect(alt.keyup(key("Alt", { shiftKey: true }))).toBe(false);
  });

  it("ignores AltGr, which is Ctrl+Alt on several layouts", () => {
    const alt = createAltMenuActivation();

    alt.keydown(key("Alt", { ctrlKey: true }));

    expect(alt.keyup(key("Alt", { ctrlKey: true }))).toBe(false);
  });

  it("does not re-arm when Alt repeats after a chord key", () => {
    const alt = createAltMenuActivation();

    // Holding Alt+Up long enough repeats both keys, interleaved.
    alt.keydown(key("Alt"));
    alt.keydown(key("ArrowUp"));
    alt.keydown(key("Alt", { repeat: true }));
    alt.keydown(key("ArrowUp", { repeat: true }));

    expect(alt.keyup(key("Alt"))).toBe(false);
  });
});

describe("cancelling", () => {
  it("forgets a pending Alt when the pointer is used", () => {
    const alt = createAltMenuActivation();

    // Alt+click is a chord too - it must not leave the menu opening on release.
    alt.keydown(key("Alt"));
    alt.cancel();

    expect(alt.keyup(key("Alt"))).toBe(false);
  });

  it("forgets a pending Alt when the window goes away mid-press", () => {
    const alt = createAltMenuActivation();

    alt.keydown(key("Alt"));
    alt.cancel();
    expect(alt.isArmed()).toBe(false);

    // And the next clean press still works.
    alt.keydown(key("Alt"));
    expect(alt.keyup(key("Alt"))).toBe(true);
  });
});
