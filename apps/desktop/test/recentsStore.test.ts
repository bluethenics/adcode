/**
 * The recent-folders list.
 *
 * The interesting behaviour is all in the merge: re-opening a folder you already have in the
 * list has to move it rather than duplicate it, and on Windows "the same folder" is a question
 * about case and separators rather than about string equality. Both are the kind of thing that
 * looks right in a demo with two entries and produces a list full of the same project after a
 * week of real use.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_RECENTS,
  createRecentsStore,
  mergeRecent,
  parseRecents,
  recentKey,
  sortRecents,
} from "../src/main/recentsStore.ts";
import type { RecentFolder } from "../src/main/recentsStore.ts";

const entry = (path: string, openedAt = 1): RecentFolder => ({
  path,
  name: path.split(/[\\/]/).at(-1) ?? path,
  openedAt,
});

describe("recentKey", () => {
  it("treats the same Windows folder written three ways as one", () => {
    // `E:\Work\Project`, `E:/Work/Project` and lowercase are one folder on the platform this
    // ships on first. Comparing raw strings would list the same project three times.
    const forms = ["E:\\Work\\Project", "E:/Work/Project", "e:\\work\\project", "E:\\Work\\Project\\"];
    const keys = new Set(forms.map(recentKey));

    expect(keys.size).toBe(1);
  });

  it("keeps genuinely different folders apart", () => {
    expect(recentKey("/home/a/one")).not.toBe(recentKey("/home/a/two"));
  });
});

describe("mergeRecent", () => {
  it("puts a new folder at the top", () => {
    const merged = mergeRecent([entry("/a"), entry("/b")], entry("/c", 9));
    expect(merged.map((r) => r.path)).toEqual(["/c", "/a", "/b"]);
  });

  it("moves an existing folder to the top instead of duplicating it", () => {
    /*
     * The case a naive `[entry, ...list].slice(0, N)` gets wrong. Re-opening the folder you
     * already have open is the single most common thing this list sees, and getting it wrong
     * fills the list with one project.
     */
    const merged = mergeRecent([entry("/a", 1), entry("/b", 2)], entry("/a", 3));

    expect(merged.map((r) => r.path)).toEqual(["/a", "/b"]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.openedAt).toBe(3);
  });

  it("deduplicates across separator and case differences", () => {
    const merged = mergeRecent([entry("E:\\Work\\Project", 1)], entry("e:/work/project", 5));

    expect(merged).toHaveLength(1);
    expect(merged[0]?.openedAt).toBe(5);
    // The newest spelling wins, because it is the one the user just opened.
    expect(merged[0]?.path).toBe("e:/work/project");
  });

  it("caps the list", () => {
    let list: readonly RecentFolder[] = [];
    for (let i = 0; i < MAX_RECENTS + 8; i++) list = mergeRecent(list, entry(`/p${i}`, i));

    expect(list).toHaveLength(MAX_RECENTS);
    // The most recent survive, not the first ones seen.
    expect(list[0]?.path).toBe(`/p${MAX_RECENTS + 7}`);
  });

  it("does not mutate the list it was given", () => {
    const original = [entry("/a"), entry("/b")];
    mergeRecent(original, entry("/c"));
    expect(original.map((r) => r.path)).toEqual(["/a", "/b"]);
  });
});

describe("parseRecents", () => {
  it("reads back what was written", () => {
    const list = [entry("/a", 2), entry("/b", 1)];
    expect(parseRecents(JSON.parse(JSON.stringify(list)))).toEqual(list);
  });

  it("returns an empty list for anything that is not an array", () => {
    for (const value of [null, undefined, 42, "text", {}, true]) {
      expect(parseRecents(value)).toEqual([]);
    }
  });

  it("drops an entry with no path rather than repairing it", () => {
    // A recent folder with no path is a row that cannot be clicked.
    const parsed = parseRecents([{ name: "orphan", openedAt: 1 }, entry("/real")]);
    expect(parsed.map((r) => r.path)).toEqual(["/real"]);
  });

  it("recovers a missing name from the path", () => {
    const parsed = parseRecents([{ path: "/home/ada/project", openedAt: 1 }]);
    expect(parsed[0]?.name).toBe("project");
  });

  it("sorts a hand-edited file newest first", () => {
    const parsed = parseRecents([entry("/old", 1), entry("/new", 9), entry("/mid", 5)]);
    expect(parsed.map((r) => r.path)).toEqual(["/new", "/mid", "/old"]);
  });

  it("does not let a bad timestamp poison the sort", () => {
    // `NaN` makes every comparison false, which leaves the sort order arbitrary rather than
    // merely wrong - so a missing timestamp becomes 0 and sorts last.
    const parsed = parseRecents([
      { path: "/broken", name: "broken" },
      entry("/good", 5),
    ]);

    expect(parsed.map((r) => r.path)).toEqual(["/good", "/broken"]);
  });

  it("collapses duplicates left behind by an older build", () => {
    const parsed = parseRecents([entry("E:\\P", 1), entry("e:/p", 2)]);
    expect(parsed).toHaveLength(1);
  });
});

describe("sortRecents", () => {
  it("does not mutate its input", () => {
    const list = [entry("/a", 1), entry("/b", 2)];
    sortRecents(list);
    expect(list.map((r) => r.path)).toEqual(["/a", "/b"]);
  });
});

describe("createRecentsStore", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "adcode-recents-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts empty and survives a round trip", async () => {
    const store = createRecentsStore(dir);
    expect(await store.load()).toEqual([]);

    await store.remember("/home/ada/one", "one", 100);
    await store.remember("/home/ada/two", "two", 200);

    expect((await createRecentsStore(dir).load()).map((r) => r.path)).toEqual([
      "/home/ada/two",
      "/home/ada/one",
    ]);
  });

  it("forgets a folder that has gone away", async () => {
    const store = createRecentsStore(dir);
    await store.remember("/a", "a", 1);
    await store.remember("/b", "b", 2);

    expect((await store.forget("/a")).map((r) => r.path)).toEqual(["/b"]);
    expect((await store.load()).map((r) => r.path)).toEqual(["/b"]);
  });

  it("clears the list", async () => {
    const store = createRecentsStore(dir);
    await store.remember("/a", "a", 1);
    await store.clear();

    expect(await store.load()).toEqual([]);
  });

  it("returns an empty list rather than throwing on a corrupt file", async () => {
    // Losing the recents is an annoyance; refusing to launch is not.
    await writeFile(join(dir, "recents.json"), "{ not json", "utf8");
    expect(await createRecentsStore(dir).load()).toEqual([]);
  });

  it("writes through a temporary file so a crash cannot truncate the list", async () => {
    const store = createRecentsStore(dir);
    await store.remember("/a", "a", 1);

    // The real file is valid JSON and the temporary is gone.
    const text = await readFile(join(dir, "recents.json"), "utf8");
    expect(() => JSON.parse(text)).not.toThrow();
    await expect(readFile(join(dir, "recents.json.tmp"), "utf8")).rejects.toThrow();
  });
});
