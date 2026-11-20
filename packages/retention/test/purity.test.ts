import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The same source-reading guard `packages/diagnostics` has. These rules are replayed by the
 * SQL rollup and compared, which only works if they depend on nothing but their arguments:
 * a rule that read the clock would answer differently in a test and in production.
 */
const BANNED = [
  { pattern: /\bDate\b/, why: "clock read - `now` is an argument" },
  { pattern: /Math\.random/, why: "nondeterminism" },
  { pattern: /\bprocess\b/, why: "ambient environment access" },
  { pattern: /\bfetch\b/, why: "network I/O" },
  { pattern: /\brequire\b/, why: "module I/O" },
  { pattern: /\bglobalThis\b/, why: "ambient escape hatch" },
  { pattern: /\bdocument\b|\bwindow\b/, why: "DOM access" },
  { pattern: /from ["']electron["']|from ["']node:/, why: "runtime imports" },
];

describe("@adcode/retention is pure", () => {
  for (const name of ["events", "rules", "client", "index"]) {
    it(`${name}.ts reaches for no clock, randomness, I/O or DOM`, () => {
      const source = readFileSync(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)), "utf8")
        // Comments may talk about these things; code may not use them.
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      for (const { pattern, why } of BANNED) expect(pattern.test(source), `${name}.ts: ${why}`).toBe(false);
    });
  }
});
