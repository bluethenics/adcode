import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, type MemoryStore } from "../src/store.ts";
import type { Clock, MemoryFileSystem } from "../src/types.ts";

/** In-memory filesystem, so store behaviour is testable in milliseconds. */
class FakeFs implements MemoryFileSystem {
  readonly files = new Map<string, string>();

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeFile(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async listFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }

  async ensureDirectory(): Promise<void> {
    // Nothing to do in memory.
  }
}

const clock: Clock = { now: () => new Date("2026-08-16T14:22:00Z") };

let fs: FakeFs;
let store: MemoryStore;

beforeEach(() => {
  fs = new FakeFs();
  store = createMemoryStore({ fs, clock });
});

describe("write and read", () => {
  it("round-trips a memory through markdown", async () => {
    // §11: "round-trip through markdown and index".
    const written = await store.write({
      name: "chose-electron",
      description: "Why the shell is Electron",
      type: "decision",
      body: "node-pty is first-class in Node.",
      agent: "claude-code",
    });

    expect(written).not.toBeNull();

    const read = await store.read("chose-electron");
    expect(read?.description).toBe("Why the shell is Electron");
    expect(read?.body).toBe("node-pty is first-class in Node.");
    expect(read?.type).toBe("decision");
    expect(read?.created).toBe("2026-08-16");
    expect(read?.agents).toEqual(["claude-code"]);
  });

  it("writes one fact per file, at the §5.1 path", async () => {
    await store.write({ name: "naming", description: "d", type: "convention", body: "b" });
    expect(fs.files.has("conventions/naming.md")).toBe(true);
  });

  it("stores plain markdown a human can open and edit", async () => {
    await store.write({ name: "naming", description: "How we name things", type: "convention", body: "Kebab case." });
    const raw = fs.files.get("conventions/naming.md") ?? "";

    expect(raw.startsWith("---\n")).toBe(true);
    expect(raw).toContain("Kebab case.");
  });

  it("rejects a hostile name instead of writing outside the store", async () => {
    const written = await store.write({
      name: "../../../etc/passwd",
      description: "d",
      type: "decision",
      body: "b",
    });

    expect(written).toBeNull();
    expect([...fs.files.keys()].every((p) => !p.includes(".."))).toBe(true);
  });

  it("updates in place and records each agent that has touched it", async () => {
    await store.write({ name: "naming", description: "d", type: "convention", body: "one", agent: "claude-code" });
    await store.write({ name: "naming", description: "d2", type: "convention", body: "two", agent: "codex" });

    const read = await store.read("naming");
    expect(read?.body).toBe("two");
    expect(read?.description).toBe("d2");
    expect([...(read?.agents ?? [])].sort()).toEqual(["claude-code", "codex"]);
  });

  it("preserves the original creation date across updates", async () => {
    await store.write({ name: "naming", description: "d", type: "convention", body: "one" });

    const later = createMemoryStore({ fs, clock: { now: () => new Date("2027-01-01T00:00:00Z") } });
    await later.write({ name: "naming", description: "d", type: "convention", body: "two" });

    expect((await store.read("naming"))?.created).toBe("2026-08-16");
  });

  it("moves the file when a memory changes kind, leaving no duplicate", async () => {
    await store.write({ name: "naming", description: "d", type: "convention", body: "b" });
    await store.write({ name: "naming", description: "d", type: "preference", body: "b" });

    expect(fs.files.has("conventions/naming.md")).toBe(false);
    expect(fs.files.has("preferences/naming.md")).toBe(true);
    expect((await store.list()).filter((m) => m.name === "naming")).toHaveLength(1);
  });

  it("returns null for a memory that does not exist", async () => {
    expect(await store.read("nothing-here")).toBeNull();
  });
});

describe("list and delete", () => {
  beforeEach(async () => {
    await store.write({ name: "a-decision", description: "d", type: "decision", body: "b" });
    await store.write({ name: "a-convention", description: "d", type: "convention", body: "b" });
    await store.write({ name: "a-preference", description: "d", type: "preference", body: "b" });
  });

  it("lists everything", async () => {
    expect((await store.list()).map((m) => m.name).sort()).toEqual([
      "a-convention",
      "a-decision",
      "a-preference",
    ]);
  });

  it("filters by kind", async () => {
    expect((await store.list("decision")).map((m) => m.name)).toEqual(["a-decision"]);
  });

  it("deletes, so the user can point at a memory and remove it", async () => {
    expect(await store.delete("a-decision")).toBe(true);
    expect(await store.read("a-decision")).toBeNull();
    expect(fs.files.has("decisions/a-decision.md")).toBe(false);
  });

  it("reports a delete that matched nothing", async () => {
    expect(await store.delete("never-existed")).toBe(false);
  });

  it("ignores files that are not parseable memories", async () => {
    // The store is git-mergeable and hand-editable, so junk will appear in it.
    await fs.writeFile("decisions/broken.md", "not a memory");
    await fs.writeFile("decisions/notes.txt", "---\nname: x\n---\n");

    expect((await store.list()).map((m) => m.name)).not.toContain("broken");
  });
});

describe("generated mirrors", () => {
  // §5.1: "AGENTS.md and CLAUDE.md are generated mirrors, rewritten on every memory
  // write. They exist so an agent that speaks neither MCP nor your schema still gets the
  // context by reading a file it already looks for."
  it("writes both mirrors on every memory write", async () => {
    await store.write({ name: "naming", description: "How we name things", type: "convention", body: "b" });

    expect(fs.files.has("AGENTS.md")).toBe(true);
    expect(fs.files.has("CLAUDE.md")).toBe(true);
    expect(fs.files.get("AGENTS.md")).toContain("How we name things");
  });

  it("keeps the two mirrors identical", async () => {
    await store.write({ name: "naming", description: "d", type: "convention", body: "b" });
    expect(fs.files.get("AGENTS.md")).toBe(fs.files.get("CLAUDE.md"));
  });

  it("says plainly that it is generated, since it must never be hand-edited", async () => {
    await store.write({ name: "naming", description: "d", type: "convention", body: "b" });
    expect(fs.files.get("AGENTS.md")?.toLowerCase()).toContain("generated");
  });

  it("rewrites the mirrors on delete too", async () => {
    await store.write({ name: "naming", description: "unique-marker-text", type: "convention", body: "b" });
    expect(fs.files.get("AGENTS.md")).toContain("unique-marker-text");

    await store.delete("naming");
    expect(fs.files.get("AGENTS.md")).not.toContain("unique-marker-text");
  });
});

describe("sessions", () => {
  it("appends a session log entry under a timestamped name", async () => {
    const record = await store.appendSession("claude-code", "Built the settings screen.");

    expect(record).not.toBeNull();
    expect(record?.type).toBe("session");
    expect(record?.name).toMatch(/^2026-08-16t\d{2}-\d{2}-claude-code$/);
    expect(record?.body).toContain("Built the settings screen.");
  });

  it("rejects an agent name that would not make a valid file", async () => {
    expect(await store.appendSession("../../etc", "summary")).toBeNull();
  });

  it("accumulates within the same minute rather than overwriting", async () => {
    await store.appendSession("claude-code", "first");
    await store.appendSession("claude-code", "second");

    const sessions = await store.list("session");
    expect(sessions).toHaveLength(1);

    const record = await store.read(sessions[0]!.name);
    expect(record?.body).toContain("first");
    expect(record?.body).toContain("second");
  });
});

describe("project context", () => {
  it("is the digest a fresh agent should read first", async () => {
    await store.write({ name: "chose-electron", description: "Why Electron", type: "decision", body: "b" });
    await store.write({ name: "naming", description: "Kebab case", type: "convention", body: "b" });

    const context = await store.projectContext();
    expect(context).toContain("Why Electron");
    expect(context).toContain("Kebab case");
  });

  it("says so plainly when the store is empty, rather than returning nothing", async () => {
    const context = await store.projectContext();
    expect(context.length).toBeGreaterThan(0);
    expect(context.toLowerCase()).toContain("no memories");
  });
});

describe("concurrent clients", () => {
  // §11: "concurrent writes from two MCP clients". Two processes share one store; the
  // markdown files are the source of truth and each write is one whole file.
  it("keeps both memories when two clients write different names at once", async () => {
    const clientA = createMemoryStore({ fs, clock });
    const clientB = createMemoryStore({ fs, clock });

    await Promise.all([
      clientA.write({ name: "from-a", description: "a", type: "decision", body: "a", agent: "claude-code" }),
      clientB.write({ name: "from-b", description: "b", type: "decision", body: "b", agent: "codex" }),
    ]);

    const names = (await clientA.list()).map((m) => m.name).sort();
    expect(names).toEqual(["from-a", "from-b"]);
  });

  it("leaves one intact, valid memory when two clients write the same name", async () => {
    const clientA = createMemoryStore({ fs, clock });
    const clientB = createMemoryStore({ fs, clock });

    await Promise.all([
      clientA.write({ name: "shared", description: "from a", type: "decision", body: "a" }),
      clientB.write({ name: "shared", description: "from b", type: "decision", body: "b" }),
    ]);

    const record = await clientA.read("shared");
    expect(record).not.toBeNull();
    expect(["from a", "from b"]).toContain(record?.description);
  });

  it("lets a second client see what the first wrote, with no shared process state", async () => {
    const clientA = createMemoryStore({ fs, clock });
    await clientA.write({ name: "written-by-a", description: "d", type: "decision", body: "b" });

    const clientB = createMemoryStore({ fs, clock });
    expect(await clientB.read("written-by-a")).not.toBeNull();
  });
});
