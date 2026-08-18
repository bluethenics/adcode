import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The same guard `packages/ads` puts on its five pure modules, for the same reason.
 *
 * dependency-cruiser proves what a module imports. It cannot prove what a module reaches
 * for out of ambient scope - `Date.now()` and `Math.random()` need no import at all. So
 * this test reads the source.
 *
 * It matters more here than it looks. The explanation table is the one place in this
 * package where someone will eventually be tempted to reach for the current file, the
 * clock, or a network lookup to make an explanation smarter. Explanations must be a pure
 * function of the diagnostic, or the same error explains itself differently twice.
 */
const MODULES = ["types", "table", "index"];

const BANNED = [
  { pattern: /\bDate\b/, why: "clock read - an explanation must not depend on when it ran" },
  { pattern: /Math\.random/, why: "nondeterminism - the same error must explain the same way" },
  { pattern: /\bprocess\b/, why: "ambient environment access" },
  { pattern: /\bfetch\b/, why: "network I/O" },
  { pattern: /\brequire\b/, why: "module I/O outside the declared import graph" },
  { pattern: /\bglobalThis\b/, why: "ambient escape hatch" },
  { pattern: /\bdocument\b/, why: "DOM access - this package is drawn by the renderer, not itself" },
  // The import specifier rather than the word: these files are expected to *discuss*
  // Monaco in their comments, since it is what fills the type today. What they must never
  // do is depend on it.
  { pattern: /["']monaco-editor["']/, why: "the editor is an adapter's problem, not this package's" },
];

describe("@adcode/diagnostics is pure", () => {
  for (const name of MODULES) {
    it(`${name}.ts reaches for no clock, randomness, I/O, or DOM`, () => {
      const path = fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url));
      expect(existsSync(path), `${name}.ts must exist`).toBe(true);

      const source = readFileSync(path, "utf8");
      for (const { pattern, why } of BANNED) {
        expect(source, `${name}.ts must not use ${pattern} (${why})`).not.toMatch(pattern);
      }
    });
  }
});
