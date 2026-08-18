/**
 * Where the arrows and the letters land in an open menu.
 *
 * Pure for the same reason `altMenuActivation.ts` is: the rules are ordering rules, and
 * ordering rules are what a browserless test can hold still. Separators and disabled rows
 * are the whole difficulty - they are in the list, they are never a destination, and the
 * wrap has to skip them without ever spinning forever on a panel that is all separators.
 */
import { describe, expect, it } from "vitest";
import { edgeIndex, matchLetter, stepIndex, type MenuRow } from "../src/renderer/workbench/menuKeyboard.ts";

const rows = (...labels: string[]): MenuRow[] => labels.map((label) => ({ label }));

describe("stepping with the arrows", () => {
  const three = rows("&New File", "&Open Folder", "&Save");

  it("moves one row at a time", () => {
    expect(stepIndex(three, 0, 1)).toBe(1);
    expect(stepIndex(three, 2, -1)).toBe(1);
  });

  it("wraps at both ends, the way a menu always has", () => {
    expect(stepIndex(three, 2, 1)).toBe(0);
    expect(stepIndex(three, 0, -1)).toBe(2);
  });

  /* Down from nowhere is the first row: it is what Alt then Down has to do. */
  it("starts at the first row when nothing is focused yet", () => {
    expect(stepIndex(three, -1, 1)).toBe(0);
    expect(stepIndex(three, -1, -1)).toBe(2);
  });

  it("steps over rows that cannot be chosen", () => {
    const withDead = [
      { label: "&New File" },
      { label: "Nothing here", enabled: false },
      { label: "&Save" },
    ];

    expect(stepIndex(withDead, 0, 1)).toBe(2);
    expect(stepIndex(withDead, 2, 1)).toBe(0);
  });

  it("stays put rather than spinning when there is nowhere to go", () => {
    expect(stepIndex([{ label: "Nothing here", enabled: false }], 0, 1)).toBe(0);
    expect(stepIndex([], 0, 1)).toBe(-1);
  });
});

describe("Home and End", () => {
  it("go to the first and last row that can actually be chosen", () => {
    const padded = [
      { label: "Nothing here", enabled: false },
      { label: "&Open" },
      { label: "&Save" },
      { label: "Also dead", enabled: false },
    ];

    expect(edgeIndex(padded, "first")).toBe(1);
    expect(edgeIndex(padded, "last")).toBe(2);
  });

  it("report nothing for a panel with no live rows", () => {
    expect(edgeIndex([{ label: "Nothing here", enabled: false }], "first")).toBe(-1);
  });
});

describe("typing a letter", () => {
  const file = rows("&New File", "&Open Folder…", "Ope&n Recent", "&Save", "Save &As…");

  /*
   * One claimant means Windows does not wait: the row runs. This is the half people
   * actually feel - Alt, F, S saves, and it saves on the S.
   */
  it("activates outright when exactly one row claims the letter", () => {
    expect(matchLetter(file, "s", -1)).toEqual({ index: 3, unique: true });
  });

  it("is not case sensitive", () => {
    expect(matchLetter(file, "S", -1)).toEqual({ index: 3, unique: true });
  });

  it("only moves when several rows claim it, and cycles through them", () => {
    const twice = rows("&Commit", "&Checkout Branch…", "&Create Branch…");

    expect(matchLetter(twice, "c", -1)).toEqual({ index: 0, unique: false });
    expect(matchLetter(twice, "c", 0)).toEqual({ index: 1, unique: false });
    expect(matchLetter(twice, "c", 2)).toEqual({ index: 0, unique: false });
  });

  /*
   * The fallback is why a recent folder is reachable by keyboard at all: those rows are
   * folder names, so they carry no marker to claim a letter with.
   */
  it("falls back to the first letter of rows that carry no marker", () => {
    const recents = rows("adcode", "bklit-ui", "atlas");

    expect(matchLetter(recents, "b", -1)).toEqual({ index: 1, unique: true });
    expect(matchLetter(recents, "a", -1)).toEqual({ index: 0, unique: false });
    expect(matchLetter(recents, "a", 0)).toEqual({ index: 2, unique: false });
  });

  /* A marked row wins over one that merely starts with the letter. */
  it("prefers a marker to a first letter", () => {
    const mixed = [{ label: "Save All" }, { label: "&Save" }];

    expect(matchLetter(mixed, "s", -1)).toEqual({ index: 1, unique: true });
  });

  it("ignores rows that cannot be chosen", () => {
    const withDead = [{ label: "&Save", enabled: false }, { label: "&Stage All" }];

    expect(matchLetter(withDead, "s", -1)).toEqual({ index: 1, unique: true });
  });

  it("reports nothing when no row wants the letter", () => {
    expect(matchLetter(file, "z", -1)).toBeNull();
  });
});
