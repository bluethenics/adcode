import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { fuzzyMatch, rankCandidates } from "../src/fuzzy.ts";

/**
 * Brief §4: fuzzy file open, and §7 budgets it at "first results < 100ms" over 50,000
 * files. Ranking quality is the whole feature - a matcher that finds the right file
 * third is one a developer stops trusting, and then stops using.
 */
describe("fuzzyMatch", () => {
  it("matches a contiguous substring", () => {
    expect(fuzzyMatch("main", "src/main.ts")).not.toBeNull();
  });

  it("matches a subsequence with gaps", () => {
    expect(fuzzyMatch("mts", "src/main.ts")).not.toBeNull();
  });

  it("does not match when a character is missing", () => {
    expect(fuzzyMatch("xyz", "src/main.ts")).toBeNull();
  });

  it("does not match when characters are out of order", () => {
    expect(fuzzyMatch("niam", "main.ts")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("MAIN", "src/main.ts")).not.toBeNull();
    expect(fuzzyMatch("main", "src/MAIN.ts")).not.toBeNull();
  });

  it("matches everything on an empty query", () => {
    expect(fuzzyMatch("", "anything")).not.toBeNull();
  });

  it("reports the positions it matched, so the UI can highlight them", () => {
    // "main" is m(0) a(1) i(2) n(3).
    const match = fuzzyMatch("mn", "main");
    expect(match?.positions).toEqual([0, 3]);
  });
});

describe("ranking", () => {
  const rank = (query: string, candidates: string[]): string[] =>
    rankCandidates(query, candidates).map((result) => result.value);

  it("prefers a match in the filename over one in the directory", () => {
    // Typing "user" almost always means a file about users, not every file in a
    // directory that happens to be called user/.
    const ranked = rank("user", ["src/user/index.ts", "src/models/user.ts"]);
    expect(ranked[0]).toBe("src/models/user.ts");
  });

  it("prefers a prefix match over a match in the middle", () => {
    const ranked = rank("app", ["src/myapp.ts", "src/app.ts"]);
    expect(ranked[0]).toBe("src/app.ts");
  });

  it("prefers consecutive characters over scattered ones", () => {
    const ranked = rank("abc", ["a-b-c-x.ts", "abc.ts"]);
    expect(ranked[0]).toBe("abc.ts");
  });

  it("rewards matches on word boundaries", () => {
    const ranked = rank("gsc", ["gascon.ts", "get-session-config.ts"]);
    expect(ranked[0]).toBe("get-session-config.ts");
  });

  it("rewards camelCase boundaries the same way", () => {
    const ranked = rank("gsc", ["gascon.ts", "getSessionConfig.ts"]);
    expect(ranked[0]).toBe("getSessionConfig.ts");
  });

  it("prefers a shorter path when the match is otherwise equal", () => {
    const ranked = rank("index", ["a/b/c/d/e/index.ts", "a/index.ts"]);
    expect(ranked[0]).toBe("a/index.ts");
  });

  it("drops candidates that do not match at all", () => {
    expect(rank("zzz", ["a.ts", "b.ts"])).toEqual([]);
  });

  it("returns everything for an empty query, in the order given", () => {
    expect(rank("", ["b.ts", "a.ts"])).toEqual(["b.ts", "a.ts"]);
  });

  it("respects a result limit", () => {
    const many = Array.from({ length: 500 }, (_, i) => `file${i}.ts`);
    expect(rankCandidates("file", many, 10)).toHaveLength(10);
  });

  it("finds an exact filename first even in a large set", () => {
    const candidates = [
      "src/components/button/index.ts",
      "src/utils/button-helpers.ts",
      "src/button.ts",
      "test/button.spec.ts",
    ];
    expect(rank("button.ts", candidates)[0]).toBe("src/button.ts");
  });
});

describe("performance", () => {
  it("ranks 50,000 candidates well inside the §7 budget", () => {
    // §7: "Fuzzy file open, 50k files - first results < 100ms."
    const candidates = Array.from(
      { length: 50_000 },
      (_, i) => `src/module${i % 97}/component${i}/handler${i}.ts`,
    );

    // Best of several runs. A single timing sample on a shared machine measures the
    // scheduler as much as the code, and a budget assertion that flickers run to run
    // gets muted rather than fixed.
    let best = Infinity;
    let results = rankCandidates("handler", candidates, 50);

    for (let attempt = 0; attempt < 5; attempt++) {
      const started = performance.now();
      results = rankCandidates("handler", candidates, 50);
      best = Math.min(best, performance.now() - started);
    }

    expect(results.length).toBe(50);
    expect(best).toBeLessThan(100);
  });
});

describe("invariants", () => {
  const pathArb = fc
    .array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 4 })
    .map((parts) => `${parts.join("/")}.ts`);

  it("never returns a candidate that is not a subsequence of the query", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{0,6}$/), fc.array(pathArb, { maxLength: 40 }), (query, paths) => {
        for (const result of rankCandidates(query, paths)) {
          const haystack = result.value.toLowerCase();
          let index = 0;

          for (const character of query.toLowerCase()) {
            index = haystack.indexOf(character, index);
            expect(index).toBeGreaterThanOrEqual(0);
            index += 1;
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("returns results in non-increasing score order", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,5}$/), fc.array(pathArb, { maxLength: 40 }), (query, paths) => {
        const scores = rankCandidates(query, paths).map((result) => result.score);
        for (let i = 1; i < scores.length; i++) {
          expect(scores[i - 1]!).toBeGreaterThanOrEqual(scores[i]!);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("never reports a match position outside the candidate", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,5}$/), pathArb, (query, path) => {
        const match = fuzzyMatch(query, path);
        if (match === null) return;

        for (const position of match.positions) {
          expect(position).toBeGreaterThanOrEqual(0);
          expect(position).toBeLessThan(path.length);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("does not throw on any input", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (query, candidate) => {
        expect(() => fuzzyMatch(query, candidate)).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });
});
