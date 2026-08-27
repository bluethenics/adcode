import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Brief §8 marks five modules `pure`: no I/O, no clock reads, no UI imports.
 *
 * dependency-cruiser proves they import nothing they shouldn't. That leaves the other
 * half of purity — reaching for an ambient global needs no import at all. `Date.now()`
 * and `Math.random()` are always in scope. So this test reads the modules' own source.
 */
const PURE_MODULES = ["scheduler", "validation", "tagger", "ledger", "sponsorsView"];

const BANNED = [
  { pattern: /\bDate\b/, why: "clock read - `now` arrives in the state argument" },
  { pattern: /Math\.random/, why: "nondeterminism - a pure function cannot roll dice" },
  { pattern: /\bprocess\b/, why: "ambient environment access" },
  { pattern: /\bfetch\b/, why: "network I/O" },
  { pattern: /\brequire\b/, why: "module I/O outside the declared import graph" },
  { pattern: /\bglobalThis\b/, why: "ambient escape hatch" },
];

describe("the five pure modules are actually pure", () => {
  for (const name of PURE_MODULES) {
    it(`${name}.ts reaches for no clock, randomness, or I/O`, () => {
      const path = fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url));
      expect(existsSync(path), `${name}.ts must exist`).toBe(true);

      const source = readFileSync(path, "utf8");
      for (const { pattern, why } of BANNED) {
        expect(source, `${name}.ts must not use ${pattern} (${why})`).not.toMatch(pattern);
      }
    });
  }
});
