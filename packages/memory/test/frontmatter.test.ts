import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseMemory, serializeMemory, extractLinks } from "../src/frontmatter.ts";
import type { MemoryRecord } from "../src/types.ts";

const EXAMPLE = `---
name: chose-electron-over-tauri
description: Why the shell is Electron and not Tauri
type: decision
created: 2026-08-15
agents: [claude-code]
---

Electron was chosen over Tauri because node-pty and the LSP subprocess story are
first-class in Node and hand-rolled in Rust. Cost: ~75MB of installer size.

Related: [[terminal-architecture]]
`;

describe("parseMemory", () => {
  it("parses the example from §5.1 verbatim", () => {
    const record = parseMemory(EXAMPLE);

    expect(record).not.toBeNull();
    expect(record?.name).toBe("chose-electron-over-tauri");
    expect(record?.description).toBe("Why the shell is Electron and not Tauri");
    expect(record?.type).toBe("decision");
    expect(record?.created).toBe("2026-08-15");
    expect(record?.agents).toEqual(["claude-code"]);
    expect(record?.body).toContain("Electron was chosen over Tauri");
    expect(record?.body.startsWith("Electron")).toBe(true);
  });

  it("handles a value containing a colon", () => {
    const record = parseMemory(
      "---\nname: a\ndescription: Decision: use Electron\ntype: decision\ncreated: 2026-01-01\nagents: []\n---\n\nbody\n",
    );
    expect(record?.description).toBe("Decision: use Electron");
  });

  it("handles a quoted value", () => {
    const record = parseMemory(
      '---\nname: a\ndescription: "quoted: value"\ntype: decision\ncreated: 2026-01-01\nagents: []\n---\n\nbody\n',
    );
    expect(record?.description).toBe("quoted: value");
  });

  it("parses an empty agent list", () => {
    const record = parseMemory(
      "---\nname: a\ndescription: d\ntype: decision\ncreated: 2026-01-01\nagents: []\n---\n\nbody\n",
    );
    expect(record?.agents).toEqual([]);
  });

  it("parses multiple agents", () => {
    const record = parseMemory(
      "---\nname: a\ndescription: d\ntype: decision\ncreated: 2026-01-01\nagents: [claude-code, codex, gemini-cli]\n---\n\nbody\n",
    );
    expect(record?.agents).toEqual(["claude-code", "codex", "gemini-cli"]);
  });

  it("leaves a --- inside the body alone", () => {
    // A horizontal rule is ordinary markdown. Treating it as a frontmatter terminator
    // would truncate the memory at its first rule.
    const record = parseMemory(
      "---\nname: a\ndescription: d\ntype: decision\ncreated: 2026-01-01\nagents: []\n---\n\nbefore\n\n---\n\nafter\n",
    );
    expect(record?.body).toContain("before");
    expect(record?.body).toContain("after");
    expect(record?.body).toContain("---");
  });

  it("returns null for a file with no frontmatter", () => {
    expect(parseMemory("just a body\n")).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    expect(parseMemory("---\nname: a\n---\n\nbody\n")).toBeNull();
  });

  it("returns null for an unknown type", () => {
    expect(
      parseMemory("---\nname: a\ndescription: d\ntype: nonsense\ncreated: 2026-01-01\nagents: []\n---\n\nb\n"),
    ).toBeNull();
  });

  it("returns null for an invalid name rather than trusting the file", () => {
    // The store is user-editable and git-mergeable, so a file on disk is not
    // automatically a file this build wrote.
    expect(
      parseMemory("---\nname: ../escape\ndescription: d\ntype: decision\ncreated: 2026-01-01\nagents: []\n---\n\nb\n"),
    ).toBeNull();
  });

  it("survives arbitrary input without throwing", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(() => parseMemory(raw)).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });
});

describe("serializeMemory", () => {
  const record: MemoryRecord = {
    name: "chose-electron",
    description: "Why the shell is Electron",
    type: "decision",
    created: "2026-08-15",
    agents: ["claude-code"],
    body: "Because node-pty is first-class in Node.",
  };

  it("produces frontmatter a human can read and git can diff", () => {
    const text = serializeMemory(record);

    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("name: chose-electron");
    expect(text).toContain("agents: [claude-code]");
    expect(text).toContain("Because node-pty is first-class in Node.");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("quotes a value that would otherwise be ambiguous", () => {
    const text = serializeMemory({ ...record, description: "Decision: use Electron" });
    expect(text).toContain('description: "Decision: use Electron"');
  });

  it("round-trips", () => {
    expect(parseMemory(serializeMemory(record))).toEqual(record);
  });

  it("round-trips for arbitrary bodies and descriptions", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        fc.string(),
        (description, body) => {
          const subject: MemoryRecord = { ...record, description, body };
          const parsed = parseMemory(serializeMemory(subject));

          expect(parsed).not.toBeNull();
          expect(parsed?.name).toBe(subject.name);
          expect(parsed?.type).toBe(subject.type);
          expect(parsed?.description).toBe(description.trim());
          expect(parsed?.body).toBe(body.trim());
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("extractLinks", () => {
  it("finds wiki links, which is how §5.1 relates memories", () => {
    expect(extractLinks("see [[terminal-architecture]] and [[naming]]")).toEqual([
      "terminal-architecture",
      "naming",
    ]);
  });

  it("de-duplicates and normalises", () => {
    expect(extractLinks("[[A-Thing]] [[a-thing]]")).toEqual(["a-thing"]);
  });

  it("ignores links that are not valid memory names", () => {
    expect(extractLinks("[[../escape]] [[ok]]")).toEqual(["ok"]);
  });

  it("returns nothing when there are no links", () => {
    expect(extractLinks("plain text")).toEqual([]);
  });
});
