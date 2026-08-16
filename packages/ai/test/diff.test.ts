import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyHunks, computeHunks } from "../src/diff.ts";

/**
 * Brief §5.3: "proposed changes appear at the edit site as a reviewable diff, accepted
 * or rejected per hunk. **Nothing is ever written to disk unseen.**"
 *
 * Per-hunk acceptance is what makes that promise real, and it is also where a diff
 * implementation is most likely to be quietly wrong - accepting hunks 1 and 3 but not 2
 * has to produce exactly the file the user was shown. The properties below are the
 * guarantee; the examples are there to make failures legible.
 */
const lines = (...values: string[]): string => values.join("\n");

describe("computeHunks", () => {
  it("finds nothing when the text is unchanged", () => {
    expect(computeHunks("a\nb\nc", "a\nb\nc")).toEqual([]);
  });

  it("finds a single changed line", () => {
    const hunks = computeHunks(lines("a", "b", "c"), lines("a", "B", "c"));

    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.original).toEqual(["b"]);
    expect(hunks[0]!.replacement).toEqual(["B"]);
  });

  it("finds a pure insertion", () => {
    const hunks = computeHunks(lines("a", "c"), lines("a", "b", "c"));

    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.original).toEqual([]);
    expect(hunks[0]!.replacement).toEqual(["b"]);
  });

  it("finds a pure deletion", () => {
    const hunks = computeHunks(lines("a", "b", "c"), lines("a", "c"));

    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.original).toEqual(["b"]);
    expect(hunks[0]!.replacement).toEqual([]);
  });

  it("separates changes that are far apart into distinct hunks", () => {
    const original = lines("a", "b", "c", "d", "e", "f", "g", "h");
    const modified = lines("A", "b", "c", "d", "e", "f", "g", "H");

    expect(computeHunks(original, modified)).toHaveLength(2);
  });

  it("reports where each hunk starts, so it can be rendered at the edit site", () => {
    const hunks = computeHunks(lines("a", "b", "c"), lines("a", "B", "c"));
    expect(hunks[0]!.startLine).toBe(1);
  });

  it("handles an empty original", () => {
    const hunks = computeHunks("", lines("a", "b"));
    expect(applyHunks("", hunks, hunks.map((h) => h.id))).toBe(lines("a", "b"));
  });

  it("handles an empty replacement", () => {
    const hunks = computeHunks(lines("a", "b"), "");
    expect(applyHunks(lines("a", "b"), hunks, hunks.map((h) => h.id))).toBe("");
  });

  it("gives each hunk a distinct id", () => {
    const hunks = computeHunks(
      lines("a", "b", "c", "d", "e", "f", "g", "h"),
      lines("A", "b", "c", "d", "e", "f", "g", "H"),
    );

    expect(new Set(hunks.map((h) => h.id)).size).toBe(hunks.length);
  });
});

describe("applyHunks", () => {
  const original = lines("a", "b", "c", "d", "e", "f", "g", "h");
  const modified = lines("A", "b", "c", "d", "e", "f", "g", "H");

  it("accepting nothing leaves the file exactly as it was", () => {
    // The rejection path is the one that must never corrupt anything: a user who reads
    // a proposal and says no should be left with byte-identical content.
    expect(applyHunks(original, computeHunks(original, modified), [])).toBe(original);
  });

  it("accepting everything produces the proposed file", () => {
    const hunks = computeHunks(original, modified);
    expect(applyHunks(original, hunks, hunks.map((h) => h.id))).toBe(modified);
  });

  it("accepting one hunk applies only that hunk", () => {
    const hunks = computeHunks(original, modified);
    const result = applyHunks(original, hunks, [hunks[0]!.id]);

    expect(result).toBe(lines("A", "b", "c", "d", "e", "f", "g", "h"));
  });

  it("accepting a later hunk is not thrown off by an earlier one being rejected", () => {
    // The classic off-by-N: applying hunks in order without accounting for the line
    // shift each one introduces.
    const hunks = computeHunks(original, modified);
    const result = applyHunks(original, hunks, [hunks[1]!.id]);

    expect(result).toBe(lines("a", "b", "c", "d", "e", "f", "g", "H"));
  });

  it("ignores an unknown hunk id rather than corrupting the file", () => {
    const hunks = computeHunks(original, modified);
    expect(applyHunks(original, hunks, ["not-a-real-hunk"])).toBe(original);
  });

  it("preserves a trailing newline", () => {
    const withTrailing = "a\nb\n";
    const hunks = computeHunks(withTrailing, "a\nB\n");
    expect(applyHunks(withTrailing, hunks, hunks.map((h) => h.id))).toBe("a\nB\n");
  });

  it("handles CRLF without corrupting line endings", () => {
    const crlf = "a\r\nb\r\nc";
    const hunks = computeHunks(crlf, "a\r\nB\r\nc");
    expect(applyHunks(crlf, hunks, hunks.map((h) => h.id))).toBe("a\r\nB\r\nc");
  });
});

describe("invariants", () => {
  const textArb = fc
    .array(fc.constantFrom("a", "b", "c", "d", "", "  indented", "}"), { maxLength: 30 })
    .map((values) => values.join("\n"));

  it("accepting every hunk always reproduces the proposed text", () => {
    fc.assert(
      fc.property(textArb, textArb, (original, modified) => {
        const hunks = computeHunks(original, modified);
        expect(applyHunks(original, hunks, hunks.map((h) => h.id))).toBe(modified);
      }),
      { numRuns: 1000 },
    );
  });

  it("accepting no hunk always leaves the original untouched", () => {
    fc.assert(
      fc.property(textArb, textArb, (original, modified) => {
        expect(applyHunks(original, computeHunks(original, modified), [])).toBe(original);
      }),
      { numRuns: 1000 },
    );
  });

  it("any subset of hunks applies without throwing and without losing unrelated lines", () => {
    fc.assert(
      fc.property(textArb, textArb, fc.array(fc.boolean(), { maxLength: 30 }), (original, modified, mask) => {
        const hunks = computeHunks(original, modified);
        const accepted = hunks.filter((_, index) => mask[index] === true).map((h) => h.id);

        const result = applyHunks(original, hunks, accepted);
        expect(typeof result).toBe("string");

        // Every line that no hunk touches must survive verbatim.
        const touched = new Set<number>();
        for (const hunk of hunks) {
          for (let i = 0; i < hunk.original.length; i++) touched.add(hunk.startLine + i);
        }

        const originalLines = original.split("\n");
        const resultLines = result.split("\n");
        for (let i = 0; i < originalLines.length; i++) {
          if (!touched.has(i)) expect(resultLines).toContain(originalLines[i]);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(textArb, textArb, (original, modified) => {
        expect(computeHunks(original, modified)).toEqual(computeHunks(original, modified));
      }),
      { numRuns: 500 },
    );
  });
});
