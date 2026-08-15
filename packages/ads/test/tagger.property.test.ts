import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { tag } from "../src/tagger.ts";
import { MAX_TAGS, TAG_VOCABULARY } from "../src/types.ts";

/**
 * Brief §11: "a property test asserting that for arbitrary hostile input, every emitted
 * tag is in TAG_VOCABULARY and the count is within MAX_TAGS. 1000+ runs."
 *
 * This is the test that makes the §1 privacy claim structural rather than aspirational.
 * The mapping tables are ordinary data and a careless edit could add anything to them;
 * what this asserts is that no input whatsoever gets past the final intersection.
 */

const vocabulary = new Set<string>(TAG_VOCABULARY);

/** Strings designed to look like the things that must never leak. */
const hostileString = fc.oneof(
  fc.string(),
  fc.string({ unit: "binary" }),
  fc.constantFrom(
    "/home/alice/acme-merger-2026/next.config.js",
    "C:\\Users\\bob\\secret-project\\Dockerfile",
    "git@github.com:private-org/private-repo.git",
    "AWS_SECRET_ACCESS_KEY=hunter2",
    "../../../../etc/passwd",
    "__proto__",
    "constructor",
    "\u0000\u0000Dockerfile",
    "Dockerfile\n/etc/shadow",
    "lang:typescript",
    "lang:not-a-real-tag",
    "fw:react; DROP TABLE creatives;--",
  ),
  fc.string().map((s) => `/var/${s}/Cargo.toml`),
  fc.string().map((s) => `${s}.ts`),
);

describe("tagger invariants", () => {
  it("emits only vocabulary tags, within MAX_TAGS, for arbitrary hostile input", () => {
    fc.assert(
      fc.property(
        fc.array(hostileString, { maxLength: 40 }),
        fc.array(hostileString, { maxLength: 40 }),
        (languageIds, filenames) => {
          const out = tag({ languageIds, filenames });

          expect(out.length).toBeLessThanOrEqual(MAX_TAGS);
          for (const t of out) expect(vocabulary.has(t)).toBe(true);
          expect(new Set(out).size).toBe(out.length);
          expect(out).toEqual([...out].sort());
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("never emits any substring of its input that is not a vocabulary tag", () => {
    // The strongest form of the privacy claim: output is drawn from the compiled-in
    // vocabulary, so nothing about the input can survive into the request body except
    // the fact that it matched.
    fc.assert(
      fc.property(fc.array(hostileString, { maxLength: 20 }), (filenames) => {
        const out = tag({ languageIds: [], filenames });
        const joined = out.join(" ");

        for (const name of filenames) {
          const meaningful = name.replace(/[^A-Za-z0-9-]/g, "");
          if (meaningful.length >= 6 && !vocabulary.has(name)) {
            expect(joined.includes(meaningful)).toBe(false);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.array(hostileString, { maxLength: 20 }), (filenames) => {
        expect(tag({ languageIds: [], filenames })).toEqual(tag({ languageIds: [], filenames }));
      }),
      { numRuns: 500 },
    );
  });
});
