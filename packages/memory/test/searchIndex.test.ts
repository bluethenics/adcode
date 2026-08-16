import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { createSearchIndex, type SearchIndex } from "../src/searchIndex.ts";
import type { MemoryRecord } from "../src/types.ts";

const RECORDS: MemoryRecord[] = [
  {
    name: "chose-electron",
    description: "Why the shell is Electron and not Tauri",
    type: "decision",
    created: "2026-08-15",
    agents: ["claude-code"],
    body: "node-pty and the LSP subprocess story are first-class in Node and hand-rolled in Rust.",
  },
  {
    name: "naming",
    description: "How we name things",
    type: "convention",
    created: "2026-08-15",
    agents: [],
    body: "Kebab case for files, camelCase for identifiers.",
  },
  {
    name: "testing-posture",
    description: "How much testing is enough",
    type: "preference",
    created: "2026-08-16",
    agents: [],
    body: "Property tests for anything a user judges the product on.",
  },
];

let dir: string;
let index: SearchIndex;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adcode-index-"));
  index = createSearchIndex(join(dir, "index.sqlite"));
  index.rebuild(RECORDS);
});

afterEach(async () => {
  index.close();
  await rm(dir, { recursive: true, force: true });
});

describe("search", () => {
  it("finds a memory by a word in its body", () => {
    const hits = index.search("tauri");
    expect(hits.map((h) => h.name)).toContain("chose-electron");
  });

  it("finds a memory by a word in its description", () => {
    expect(index.search("naming").map((h) => h.name)).toContain("naming");
  });

  it("matches on a prefix, so partial words still find things", () => {
    expect(index.search("electr").map((h) => h.name)).toContain("chose-electron");
  });

  it("is case-insensitive", () => {
    expect(index.search("ELECTRON").map((h) => h.name)).toContain("chose-electron");
  });

  it("filters by kind", () => {
    const hits = index.search("how", "convention");
    expect(hits.every((h) => h.type === "convention")).toBe(true);
  });

  it("respects a limit", () => {
    expect(index.search("a", undefined, 1).length).toBeLessThanOrEqual(1);
  });

  it("returns a snippet showing why it matched", () => {
    const hit = index.search("tauri").find((h) => h.name === "chose-electron");
    expect(hit?.snippet.length).toBeGreaterThan(0);
  });

  it("returns nothing rather than everything for a query that matches nothing", () => {
    expect(index.search("zzzznothingmatches")).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(index.search("   ")).toEqual([]);
  });
});

describe("hostile queries", () => {
  // The query arrives from whatever agent is connected, so FTS5's own syntax has to be
  // neutralised: an unescaped quote is a syntax error, and `NEAR`/`OR`/`*` are operators.
  it("does not throw on FTS5 syntax", () => {
    for (const query of [
      '"',
      '""',
      "a OR b",
      "NEAR(a b)",
      "*",
      "^",
      "a AND (b",
      "-",
      "column:value",
      "'; DROP TABLE memories; --",
    ]) {
      expect(() => index.search(query), query).not.toThrow();
    }
  });

  it("does not throw for arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (query) => {
        expect(() => index.search(query)).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });

  it("still has its table after a query that looks like an injection", () => {
    index.search("'; DROP TABLE memories; --");
    expect(index.search("tauri").length).toBeGreaterThan(0);
  });
});

describe("rebuild", () => {
  // §5.1: "Markdown is the source of truth; SQLite is a cache. Deleting index.sqlite
  // must be a fully recoverable operation - rebuild it from the files."
  it("is fully recoverable after the index file is deleted", async () => {
    const path = join(dir, "index.sqlite");
    index.close();
    await rm(path, { force: true });

    const rebuilt = createSearchIndex(path);
    rebuilt.rebuild(RECORDS);

    expect(rebuilt.search("tauri").map((h) => h.name)).toContain("chose-electron");
    rebuilt.close();
  });

  it("recovers from a corrupt index file rather than refusing to start", async () => {
    const path = join(dir, "corrupt.sqlite");
    await writeFile(path, "this is not a database");

    const recovered = createSearchIndex(path);
    recovered.rebuild(RECORDS);

    expect(recovered.search("naming").length).toBeGreaterThan(0);
    recovered.close();
  });

  it("replaces rather than accumulates, so a deleted memory stops being findable", () => {
    index.rebuild(RECORDS.filter((r) => r.name !== "chose-electron"));

    expect(index.search("tauri")).toEqual([]);
    expect(index.search("naming").length).toBeGreaterThan(0);
  });

  it("handles an empty store", () => {
    index.rebuild([]);
    expect(index.search("anything")).toEqual([]);
  });

  it("creates the database file on disk", async () => {
    await expect(stat(join(dir, "index.sqlite"))).resolves.toBeDefined();
  });
});
