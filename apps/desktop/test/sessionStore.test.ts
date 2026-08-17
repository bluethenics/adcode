/**
 * Session persistence - brief §4's "Restore workspace `on`: reopen the last folder and
 * editors on launch".
 *
 * Run against a real directory, because everything worth testing here is what happens
 * when the file is missing, truncated, or written by a different version of the app.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionStore, type SessionStore } from "../src/main/sessionStore.ts";

let dir: string;
let store: SessionStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adcode-session-"));
  store = createSessionStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a fresh install", () => {
  it("has nothing to restore", async () => {
    expect(await store.load()).toEqual({ root: null, openFiles: [], activeFile: null });
  });
});

describe("round trip", () => {
  it("remembers the folder and the open editors", async () => {
    await store.save({ root: "E:/work", openFiles: ["a.ts", "b.ts"], activeFile: "b.ts" });

    expect(await createSessionStore(dir).load()).toEqual({
      root: "E:/work",
      openFiles: ["a.ts", "b.ts"],
      activeFile: "b.ts",
    });
  });

  it("writes readable JSON, so a person can see what is stored", async () => {
    await store.save({ root: "E:/work", openFiles: [], activeFile: null });

    const text = await readFile(join(dir, "session.json"), "utf8");
    expect(text).toContain("\n");
    expect(JSON.parse(text)).toMatchObject({ state: { root: "E:/work" } });
  });

  it("creates the directory if it is not there yet", async () => {
    const nested = join(dir, "deep", "deeper");
    await createSessionStore(nested).save({ root: "E:/w", openFiles: [], activeFile: null });

    expect(await createSessionStore(nested).load()).toMatchObject({ root: "E:/w" });
  });

  it("leaves no temporary file behind", async () => {
    await store.save({ root: "E:/work", openFiles: [], activeFile: null });

    const { readdir } = await import("node:fs/promises");
    expect(await readdir(dir)).toEqual(["session.json"]);
  });
});

describe("failing soft", () => {
  /** A session file that cannot be read must never stop the editor from starting. */
  it("survives a corrupt file", async () => {
    await writeFile(join(dir, "session.json"), "{not json", "utf8");
    expect(await store.load()).toEqual({ root: null, openFiles: [], activeFile: null });
  });

  it("survives a file of the wrong shape", async () => {
    await writeFile(join(dir, "session.json"), JSON.stringify([1, 2, 3]), "utf8");
    expect(await store.load()).toEqual({ root: null, openFiles: [], activeFile: null });
  });

  it("drops entries that are not strings", async () => {
    await writeFile(
      join(dir, "session.json"),
      JSON.stringify({ state: { root: 7, openFiles: ["a.ts", 5, null], activeFile: {} } }),
      "utf8",
    );

    expect(await store.load()).toEqual({ root: null, openFiles: ["a.ts"], activeFile: null });
  });

  it("does not throw when the directory cannot be written", async () => {
    // A path with a NUL byte cannot exist on any platform, which is the portable way to
    // make the write fail without depending on file permissions.
    const broken = createSessionStore(join(dir, "no\u0000pe"));
    await expect(broken.save({ root: "x", openFiles: [], activeFile: null })).resolves.toBeUndefined();
  });

  it("caps how many editors it remembers", async () => {
    const many = Array.from({ length: 500 }, (_, i) => `file-${i}.ts`);
    await store.save({ root: "E:/work", openFiles: many, activeFile: null });

    const restored = await createSessionStore(dir).load();
    expect(restored.openFiles.length).toBeLessThanOrEqual(100);
    expect(restored.openFiles[0]).toBe("file-0.ts");
  });
});

/**
 * The adjustable layout's half of the session.
 *
 * The store's job here is narrow on purpose: it rejects what could never be a size, and
 * leaves "is 900px a sensible sidebar" to the renderer, which is the only layer that can
 * see how big the window actually is.
 */
describe("layout", () => {
  it("round-trips the sizes the user dragged to", async () => {
    const store = createSessionStore(dir);
    await store.save({
      root: null,
      openFiles: [],
      activeFile: null,
      layout: { sidebarWidth: 320, panelHeight: 400 },
    });

    expect((await store.load()).layout).toEqual({ sidebarWidth: 320, panelHeight: 400 });
  });

  it("omits the layout entirely for a session written before it existed", async () => {
    const store = createSessionStore(dir);
    await store.save({ root: null, openFiles: [], activeFile: null });

    expect((await store.load()).layout).toBeUndefined();
  });

  it("rejects sizes that could never be sizes", async () => {
    const store = createSessionStore(dir);

    for (const layout of [
      { sidebarWidth: -40, panelHeight: 300 },
      { sidebarWidth: 0, panelHeight: 300 },
      { sidebarWidth: 240, panelHeight: Number.NaN },
      { sidebarWidth: 99_999, panelHeight: 300 },
      { sidebarWidth: "wide", panelHeight: 300 } as unknown as { sidebarWidth: number; panelHeight: number },
    ]) {
      await store.save({ root: null, openFiles: [], activeFile: null, layout });
      expect((await store.load()).layout, JSON.stringify(layout)).toBeUndefined();
    }
  });

  it("keeps a large-but-plausible size, leaving the window fit to the renderer", async () => {
    // Stored on a wide monitor and opened on a laptop: still a number, still worth
    // keeping, and clamped where the window size is actually known.
    const store = createSessionStore(dir);
    await store.save({
      root: null,
      openFiles: [],
      activeFile: null,
      layout: { sidebarWidth: 900, panelHeight: 800 },
    });

    expect((await store.load()).layout).toEqual({ sidebarWidth: 900, panelHeight: 800 });
  });

  it("takes both sizes or neither", async () => {
    // Half a layout would restore one dimension and silently default the other, which
    // reads as the app forgetting at random.
    const store = createSessionStore(dir);
    await store.save({
      root: null,
      openFiles: [],
      activeFile: null,
      layout: { sidebarWidth: 320 } as unknown as { sidebarWidth: number; panelHeight: number },
    });

    expect((await store.load()).layout).toBeUndefined();
  });

  it("rounds to whole pixels", async () => {
    const store = createSessionStore(dir);
    await store.save({
      root: null,
      openFiles: [],
      activeFile: null,
      layout: { sidebarWidth: 320.7, panelHeight: 260.2 },
    });

    expect((await store.load()).layout).toEqual({ sidebarWidth: 321, panelHeight: 260 });
  });
});
