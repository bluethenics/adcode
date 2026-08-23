import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createKeybindingsStore, KEYBINDINGS_VERSION } from "../src/main/keybindingsStore.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adcode-keys-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const file = (): string => join(dir, "keybindings.json");

const write = (contents: unknown): Promise<void> =>
  writeFile(file(), typeof contents === "string" ? contents : JSON.stringify(contents), "utf8");

describe("first run", () => {
  it("has no overrides when nothing is on disk", async () => {
    expect(await createKeybindingsStore(dir).read()).toEqual({});
  });

  it("writes nothing until a shortcut actually changes", async () => {
    const store = createKeybindingsStore(dir);
    await store.read();

    await expect(readFile(file(), "utf8")).rejects.toThrow();
  });
});

describe("writing", () => {
  it("keeps a shortcut across a restart", async () => {
    await createKeybindingsStore(dir).write("file.save", "CmdOrCtrl+Alt+S");

    // A second store is what the next launch gets: a fresh cache and the same file.
    expect(await createKeybindingsStore(dir).read()).toEqual({ "file.save": "CmdOrCtrl+Alt+S" });
  });

  it("stores a cleared shortcut as null, which is not the same as absent", async () => {
    const store = createKeybindingsStore(dir);
    await store.write("file.save", null);

    expect(await createKeybindingsStore(dir).read()).toEqual({ "file.save": null });
  });

  it("refuses a chord that would fire while you type", async () => {
    const store = createKeybindingsStore(dir);
    const after = await store.write("file.save", "S");

    expect(after).toEqual({});
  });

  it("tells listeners what changed", async () => {
    const store = createKeybindingsStore(dir);
    const seen: unknown[] = [];
    store.onChanged((overrides) => seen.push(overrides));

    await store.write("file.save", "CmdOrCtrl+Alt+S");

    expect(seen).toEqual([{ "file.save": "CmdOrCtrl+Alt+S" }]);
  });
});

describe("resetting", () => {
  it("forgets one command", async () => {
    const store = createKeybindingsStore(dir);
    await store.write("file.save", "CmdOrCtrl+Alt+S");
    await store.write("file.new", "CmdOrCtrl+Alt+N");

    expect(await store.reset("file.save")).toEqual({ "file.new": "CmdOrCtrl+Alt+N" });
  });

  it("forgets all of them", async () => {
    const store = createKeybindingsStore(dir);
    await store.write("file.save", "CmdOrCtrl+Alt+S");

    expect(await store.reset()).toEqual({});
    expect(await createKeybindingsStore(dir).read()).toEqual({});
  });
});

describe("what it survives", () => {
  /*
   * This file is the one somebody edits by hand when they have bound something they cannot
   * unbind, so every one of these is a real state it has to come back from. An editor whose
   * keyboard will not start because of its own keyboard file is worse than one that forgets
   * a remap.
   */
  it("treats an unreadable file as no overrides", async () => {
    await write("{ this is not json");

    expect(await createKeybindingsStore(dir).read()).toEqual({});
  });

  it("treats a file from another version as no overrides", async () => {
    await write({ version: KEYBINDINGS_VERSION + 99, overrides: { "file.save": "CmdOrCtrl+Alt+S" } });

    expect(await createKeybindingsStore(dir).read()).toEqual({});
  });

  it("drops a hand-written chord that is not bindable", async () => {
    await write({
      version: KEYBINDINGS_VERSION,
      overrides: { "file.save": "S", "file.new": "CmdOrCtrl+Alt+N" },
    });

    expect(await createKeybindingsStore(dir).read()).toEqual({ "file.new": "CmdOrCtrl+Alt+N" });
  });

  it("drops an entry that is not a chord at all", async () => {
    await write({ version: KEYBINDINGS_VERSION, overrides: { "file.save": 42, "file.new": ["a"] } });

    expect(await createKeybindingsStore(dir).read()).toEqual({});
  });

  it("drops an override for a command that no longer exists", async () => {
    await write({
      version: KEYBINDINGS_VERSION,
      overrides: { "file.save": "CmdOrCtrl+Alt+S", "removed.in.v2": "CmdOrCtrl+Alt+X" },
    });

    expect(await createKeybindingsStore(dir).read()).toEqual({ "file.save": "CmdOrCtrl+Alt+S" });
  });

  it("leaves no temporary file behind", async () => {
    await createKeybindingsStore(dir).write("file.save", "CmdOrCtrl+Alt+S");

    await expect(readFile(`${file()}.tmp`, "utf8")).rejects.toThrow();
  });
});
