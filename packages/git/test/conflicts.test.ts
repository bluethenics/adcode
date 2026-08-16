/**
 * Merge-conflict parsing and resolution - brief §4's "merge-conflict resolution `on`".
 *
 * Everything here is pure text in, pure text out. The renderer draws the buttons; this
 * decides what they do, which is the part worth testing.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  applyResolution,
  findConflicts,
  hasConflictMarkers,
  type ConflictBlock,
} from "../src/conflicts.ts";

const CONFLICTED = [
  "before",
  "<<<<<<< HEAD",
  "mine one",
  "mine two",
  "=======",
  "theirs one",
  ">>>>>>> feature",
  "after",
].join("\n");

describe("hasConflictMarkers", () => {
  it("sees a conflict", () => {
    expect(hasConflictMarkers(CONFLICTED)).toBe(true);
  });

  it("does not see one in ordinary text", () => {
    expect(hasConflictMarkers("just\nsome\nlines")).toBe(false);
  });

  it("is not fooled by a marker that is not at the start of a line", () => {
    expect(hasConflictMarkers("a <<<<<<< HEAD b")).toBe(false);
  });

  it("is not fooled by a shorter run of angle brackets", () => {
    expect(hasConflictMarkers("<<<<<< HEAD")).toBe(false);
  });
});

describe("findConflicts", () => {
  it("finds one block and reports one-based line numbers", () => {
    const blocks = findConflicts(CONFLICTED);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual<ConflictBlock>({
      startLine: 2,
      separatorLine: 5,
      endLine: 7,
      currentLabel: "HEAD",
      incomingLabel: "feature",
      current: ["mine one", "mine two"],
      incoming: ["theirs one"],
    });
  });

  it("finds several blocks", () => {
    const text = [CONFLICTED, CONFLICTED].join("\n");
    expect(findConflicts(text)).toHaveLength(2);
  });

  it("returns nothing for a clean file", () => {
    expect(findConflicts("a\nb\nc")).toEqual([]);
  });

  it("ignores a start marker with no separator", () => {
    expect(findConflicts("<<<<<<< HEAD\nmine\n")).toEqual([]);
  });

  it("ignores a start marker with no end marker", () => {
    expect(findConflicts("<<<<<<< HEAD\nmine\n=======\ntheirs\n")).toEqual([]);
  });

  it("handles an empty side", () => {
    const text = "<<<<<<< HEAD\n=======\ntheirs\n>>>>>>> other";
    const [block] = findConflicts(text);

    expect(block?.current).toEqual([]);
    expect(block?.incoming).toEqual(["theirs"]);
  });

  it("keeps a diff3 base section out of both sides", () => {
    const text = [
      "<<<<<<< HEAD",
      "mine",
      "||||||| merged common ancestors",
      "base",
      "=======",
      "theirs",
      ">>>>>>> other",
    ].join("\n");

    const [block] = findConflicts(text);
    expect(block?.current).toEqual(["mine"]);
    expect(block?.incoming).toEqual(["theirs"]);
  });

  it("survives CRLF line endings", () => {
    const [block] = findConflicts(CONFLICTED.split("\n").join("\r\n"));
    expect(block?.current).toEqual(["mine one", "mine two"]);
  });

  it("reads a label that is empty", () => {
    const text = "<<<<<<<\nmine\n=======\ntheirs\n>>>>>>>";
    const [block] = findConflicts(text);

    expect(block?.currentLabel).toBe("");
    expect(block?.incomingLabel).toBe("");
  });
});

describe("applyResolution", () => {
  const [block] = findConflicts(CONFLICTED);

  it("takes the current side", () => {
    expect(applyResolution(CONFLICTED, block!, "current")).toBe(
      ["before", "mine one", "mine two", "after"].join("\n"),
    );
  });

  it("takes the incoming side", () => {
    expect(applyResolution(CONFLICTED, block!, "incoming")).toBe(
      ["before", "theirs one", "after"].join("\n"),
    );
  });

  it("takes both, current first", () => {
    expect(applyResolution(CONFLICTED, block!, "both")).toBe(
      ["before", "mine one", "mine two", "theirs one", "after"].join("\n"),
    );
  });

  it("leaves the file alone when the block does not belong to it", () => {
    const other: ConflictBlock = { ...block!, startLine: 999, separatorLine: 1000, endLine: 1001 };
    expect(applyResolution("a\nb", other, "current")).toBe("a\nb");
  });

  it("preserves CRLF endings when the file uses them", () => {
    const crlf = CONFLICTED.split("\n").join("\r\n");
    const [crlfBlock] = findConflicts(crlf);

    expect(applyResolution(crlf, crlfBlock!, "current")).toBe(
      ["before", "mine one", "mine two", "after"].join("\r\n"),
    );
  });

  it("preserves a trailing newline", () => {
    const withNewline = `${CONFLICTED}\n`;
    const [trailing] = findConflicts(withNewline);

    expect(applyResolution(withNewline, trailing!, "current")).toBe(
      `${["before", "mine one", "mine two", "after"].join("\n")}\n`,
    );
  });

  it("resolves every block when applied from the last one backwards", () => {
    const text = [CONFLICTED, CONFLICTED].join("\n");
    let resolved = text;

    // Back to front, so earlier blocks keep the line numbers they were found at.
    for (const found of [...findConflicts(text)].reverse()) {
      resolved = applyResolution(resolved, found, "current");
    }

    expect(hasConflictMarkers(resolved)).toBe(false);
    expect(resolved.split("\n").filter((line) => line === "mine one")).toHaveLength(2);
  });
});

describe("properties", () => {
  it("resolving every conflict always removes every marker", () => {
    const side = fc.array(fc.string({ minLength: 1 }).filter((s) => !/^[<>=|]{7}/.test(s)), {
      maxLength: 4,
    });

    fc.assert(
      fc.property(
        fc.array(fc.tuple(side, side), { minLength: 1, maxLength: 4 }),
        fc.constantFrom<"current" | "incoming" | "both">("current", "incoming", "both"),
        (blocks, choice) => {
          const text = blocks
            .flatMap(([mine, theirs]) => [
              "<<<<<<< HEAD",
              ...mine,
              "=======",
              ...theirs,
              ">>>>>>> other",
            ])
            .join("\n");

          let resolved = text;
          for (const found of [...findConflicts(text)].reverse()) {
            resolved = applyResolution(resolved, found, choice);
          }

          expect(hasConflictMarkers(resolved)).toBe(false);
        },
      ),
      { numRuns: 120 },
    );
  });

  it("never invents lines that were not in the file", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 4 }),
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 4 }),
        (mine, theirs) => {
          fc.pre(![...mine, ...theirs].some((line) => /^[<>=|]{7}/.test(line)));

          const text = ["<<<<<<< HEAD", ...mine, "=======", ...theirs, ">>>>>>> other"].join("\n");
          const [found] = findConflicts(text);
          if (found === undefined) return;

          const resolved = applyResolution(text, found, "both").split("\n").filter((l) => l !== "");
          const original = new Set(text.split("\n"));

          for (const line of resolved) expect(original.has(line)).toBe(true);
        },
      ),
      { numRuns: 120 },
    );
  });
});
