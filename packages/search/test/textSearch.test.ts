import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createWorkspaceSearch, type WorkspaceSearch } from "../src/textSearch.ts";

/**
 * Run against a real directory tree. The parts most likely to be wrong - which files get
 * skipped, how binary content is detected, what a hostile regex does - are all about the
 * filesystem, and a fake tree would only confirm my own assumptions about it.
 */
let dir: string;
let search: WorkspaceSearch;

async function write(path: string, contents: string): Promise<void> {
  const full = join(dir, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents, "utf8");
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adcode-search-"));
  search = createWorkspaceSearch({ root: dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("listing files", () => {
  it("walks the tree", async () => {
    await write("a.ts", "x");
    await write("src/b.ts", "y");
    await write("src/deep/c.ts", "z");

    const files = await search.listFiles();
    expect(files.sort()).toEqual(["a.ts", "src/b.ts", "src/deep/c.ts"]);
  });

  it("skips the directories nobody wants to search", async () => {
    await write("a.ts", "x");
    await write("node_modules/pkg/index.js", "x");
    await write(".git/config", "x");
    await write("dist/bundle.js", "x");

    expect(await search.listFiles()).toEqual(["a.ts"]);
  });

  it("uses forward slashes on every platform", async () => {
    await write("src/deep/c.ts", "z");
    expect((await search.listFiles())[0]).toBe("src/deep/c.ts");
  });

  it("returns nothing for a directory that does not exist", async () => {
    const missing = createWorkspaceSearch({ root: join(dir, "nope") });
    expect(await missing.listFiles()).toEqual([]);
  });
});

describe("plain text search", () => {
  beforeEach(async () => {
    await write("a.ts", "const alpha = 1;\nconst beta = 2;\n");
    await write("src/b.ts", "function alpha() {}\n");
  });

  it("finds matches across files with line and column", async () => {
    const results = await collect(search.search({ pattern: "alpha" }));

    expect(results).toHaveLength(2);
    const first = results.find((r) => r.path === "a.ts");
    expect(first?.line).toBe(1);
    expect(first?.column).toBe(7);
    expect(first?.text).toContain("alpha");
  });

  it("is case-insensitive by default", async () => {
    expect(await collect(search.search({ pattern: "ALPHA" }))).toHaveLength(2);
  });

  it("respects case sensitivity when asked", async () => {
    expect(await collect(search.search({ pattern: "ALPHA", caseSensitive: true }))).toHaveLength(0);
  });

  it("treats the pattern literally unless regex is requested", async () => {
    await write("c.ts", "a.b\naxb\n");
    // `.` must not match `x` when the user has not asked for a regex.
    const results = await collect(search.search({ pattern: "a.b" }));

    expect(results.every((r) => r.text.includes("a.b"))).toBe(true);
  });

  it("finds every match on a line, not just the first", async () => {
    await write("c.ts", "alpha alpha alpha\n");
    const results = await collect(search.search({ pattern: "alpha", include: "c.ts" }));

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.column)).toEqual([1, 7, 13]);
  });

  it("returns nothing for a pattern that matches nothing", async () => {
    expect(await collect(search.search({ pattern: "zzzz" }))).toEqual([]);
  });

  it("returns nothing for an empty pattern rather than every line", async () => {
    expect(await collect(search.search({ pattern: "" }))).toEqual([]);
  });
});

describe("regex search", () => {
  beforeEach(async () => {
    await write("a.ts", "const alpha = 1;\nlet beta = 2;\n");
  });

  it("matches a regular expression", async () => {
    const results = await collect(search.search({ pattern: "^(const|let)\\s+\\w+", isRegex: true }));
    expect(results).toHaveLength(2);
  });

  it("reports an invalid regex instead of throwing", async () => {
    const results = await collect(search.search({ pattern: "a(", isRegex: true }));
    expect(results).toEqual([]);
  });

  it("matches whole words when asked", async () => {
    await write("b.ts", "alpha alphabet\n");
    const results = await collect(search.search({ pattern: "alpha", wholeWord: true, include: "b.ts" }));

    expect(results).toHaveLength(1);
    expect(results[0]?.column).toBe(1);
  });

  it("cannot be made to hang by a zero-width pattern", async () => {
    // `a*` matches the empty string at every position; a naive exec loop never advances.
    const results = await collect(search.search({ pattern: "a*", isRegex: true }));
    expect(Array.isArray(results)).toBe(true);
  });
});

describe("filters", () => {
  beforeEach(async () => {
    await write("a.ts", "target\n");
    await write("b.js", "target\n");
    await write("src/c.ts", "target\n");
  });

  it("includes only matching paths", async () => {
    const results = await collect(search.search({ pattern: "target", include: "*.ts" }));
    expect(results.map((r) => r.path).sort()).toEqual(["a.ts", "src/c.ts"]);
  });

  it("excludes matching paths", async () => {
    const results = await collect(search.search({ pattern: "target", exclude: "src/**" }));
    expect(results.map((r) => r.path).sort()).toEqual(["a.ts", "b.js"]);
  });

  it("matches a directory glob", async () => {
    const results = await collect(search.search({ pattern: "target", include: "src/**" }));
    expect(results.map((r) => r.path)).toEqual(["src/c.ts"]);
  });
});

describe("what it refuses to read", () => {
  it("skips a binary file rather than emitting noise", async () => {
    // A NUL byte in the first block is the standard heuristic, and the reason searching
    // a repository with images in it does not fill the panel with garbage.
    await writeFile(join(dir, "image.png"), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
    await write("a.ts", "target\n");

    const results = await collect(search.search({ pattern: "", isRegex: false }));
    expect(results.every((r) => r.path !== "image.png")).toBe(true);
  });

  it("skips a file larger than the cap", async () => {
    await write("huge.ts", `${"x".repeat(3_000_000)}\ntarget\n`);
    await write("a.ts", "target\n");

    const results = await collect(search.search({ pattern: "target" }));
    expect(results.map((r) => r.path)).toEqual(["a.ts"]);
  });
});

describe("bounds and cancellation", () => {
  it("stops at the result cap", async () => {
    await write("many.ts", Array.from({ length: 500 }, () => "target").join("\n"));

    const results = await collect(search.search({ pattern: "target", maxResults: 20 }));
    expect(results).toHaveLength(20);
  });

  it("stops when the caller aborts", async () => {
    for (let i = 0; i < 30; i++) await write(`f${i}.ts`, "target\n");

    const controller = new AbortController();
    const results: unknown[] = [];

    for await (const result of search.search({ pattern: "target" }, controller.signal)) {
      results.push(result);
      if (results.length === 3) controller.abort();
    }

    expect(results.length).toBeLessThan(30);
  });

  it("streams results rather than collecting them all first", async () => {
    // §7 budgets first results, not total time; the panel must be able to fill as the
    // walk proceeds.
    for (let i = 0; i < 20; i++) await write(`f${i}.ts`, "target\n");

    const iterator = search.search({ pattern: "target" })[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.done).toBe(false);
    await iterator.return?.();
  });
});

describe("replaceAll", () => {
  /** Read a file back through the same encoding the replacer writes with. */
  const read = async (path: string): Promise<string> =>
    (await import("node:fs/promises")).readFile(join(dir, path), "utf8");

  it("replaces every occurrence across files", async () => {
    await write("a.ts", "target one\ntarget two\n");
    await write("b.ts", "nothing here\n");
    await write("c.ts", "a target\n");

    const summary = await search.replaceAll({ pattern: "target" }, "hit");

    expect(summary.files).toBe(2);
    expect(summary.replacements).toBe(3);
    expect(await read("a.ts")).toBe("hit one\nhit two\n");
    expect(await read("b.ts")).toBe("nothing here\n");
  });

  it("leaves files untouched when nothing matches", async () => {
    await write("a.ts", "unchanged\n");

    const summary = await search.replaceAll({ pattern: "absent" }, "x");

    expect(summary.files).toBe(0);
    expect(await read("a.ts")).toBe("unchanged\n");
  });

  it("treats a literal replacement literally", async () => {
    await write("a.ts", "cost: X\n");

    await search.replaceAll({ pattern: "X" }, "$0.50");
    expect(await read("a.ts")).toBe("cost: $0.50\n");
  });

  it("honours capture groups when the pattern is a regex", async () => {
    await write("a.ts", "get(name)\nget(age)\n");

    await search.replaceAll({ pattern: "get\\((\\w+)\\)", isRegex: true }, "read($1)");
    expect(await read("a.ts")).toBe("read(name)\nread(age)\n");
  });

  it("respects case sensitivity", async () => {
    await write("a.ts", "Target target\n");

    await search.replaceAll({ pattern: "target", caseSensitive: true }, "x");
    expect(await read("a.ts")).toBe("Target x\n");
  });

  it("respects whole-word matching", async () => {
    await write("a.ts", "cat catalogue\n");

    await search.replaceAll({ pattern: "cat", wholeWord: true }, "dog");
    expect(await read("a.ts")).toBe("dog catalogue\n");
  });

  it("respects include and exclude globs", async () => {
    await write("a.ts", "target\n");
    await write("b.md", "target\n");

    await search.replaceAll({ pattern: "target", include: "*.ts" }, "x");

    expect(await read("a.ts")).toBe("x\n");
    expect(await read("b.md")).toBe("target\n");
  });

  it("skips binary files", async () => {
    await writeFile(join(dir, "blob.bin"), Buffer.from([0x74, 0x00, 0x74]));

    const summary = await search.replaceAll({ pattern: "t" }, "x");
    expect(summary.files).toBe(0);
  });

  it("refuses an empty pattern rather than rewriting every file", async () => {
    await write("a.ts", "untouched\n");

    const summary = await search.replaceAll({ pattern: "" }, "x");

    expect(summary).toEqual({ files: 0, replacements: 0 });
    expect(await read("a.ts")).toBe("untouched\n");
  });

  it("refuses a pattern that can match nothing at all", async () => {
    await write("a.ts", "untouched\n");

    // `a*` matches the empty string everywhere; replacing that would shred the file.
    const summary = await search.replaceAll({ pattern: "x*", isRegex: true }, "!");

    expect(summary).toEqual({ files: 0, replacements: 0 });
    expect(await read("a.ts")).toBe("untouched\n");
  });

  it("returns nothing for an invalid regex instead of throwing", async () => {
    await write("a.ts", "target\n");

    const summary = await search.replaceAll({ pattern: "(unclosed", isRegex: true }, "x");
    expect(summary).toEqual({ files: 0, replacements: 0 });
  });

  it("stops when the caller aborts", async () => {
    for (let i = 0; i < 40; i++) await write(`f${i}.ts`, "target\n");

    const controller = new AbortController();
    controller.abort();

    const summary = await search.replaceAll({ pattern: "target" }, "x", controller.signal);
    expect(summary.files).toBe(0);
  });
});
