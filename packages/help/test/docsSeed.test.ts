import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_ENTRIES } from "../src/index.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SEED = join(ROOT, "apps", "web", "src", "lib", "docsSeed.ts");

/*
 * The website's `/docs` pages are generated from these entries rather than imported from
 * them - the marketing site does not compile the desktop packages. That is a copy, and a
 * copy that nobody checks is a copy that goes stale. This is the check.
 */
describe("the generated docs seed", () => {
  it("matches what the generator would write today", () => {
    // Throws with the generator's own message if the committed file has drifted.
    const output = execFileSync(
      process.execPath,
      [join(ROOT, "scripts", "docs-seed.mjs"), "--check"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(output).toContain("up to date");
  });

  it("carries a page for every help entry in a documented group", () => {
    const seed = readFileSync(SEED, "utf8");

    // Groups the generator deliberately publishes. An entry outside them is not a bug.
    const published = new Set([
      "editing", "navigation", "formatting", "structure", "language",
      "ai", "git", "session", "workbench", "appearance", "account", "gestures",
      "ads", "updates",
    ]);

    const missing = HELP_ENTRIES.filter((entry) => published.has(entry.group)).filter(
      (entry) => !seed.includes(JSON.stringify(entry.title)),
    );

    expect(missing.map((entry) => entry.id)).toEqual([]);
  });

  it("never publishes a page with an empty explanation", () => {
    const seed = readFileSync(SEED, "utf8");
    expect(seed).not.toContain('description: ""');
    expect(seed).not.toContain('why: ""');
    expect(seed).not.toContain('how: ""');
  });

  it("publishes search keywords and a route into every documented feature", () => {
    const seed = readFileSync(SEED, "utf8");

    expect(seed).toContain("readonly keywords: readonly string[]");
    expect(seed).toContain("readonly access: readonly string[]");
    expect(seed).not.toContain("keywords: []");
    expect(seed).not.toContain("access: []");
  });
});
