import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { MEMORY_KINDS, isValidName, normalizeName, relativePathFor } from "../src/names.ts";

/**
 * `memory_write(name, ...)` is an MCP tool. The name arrives from whatever agent is
 * connected - Claude Code, Codex, anything that speaks the protocol - and becomes a path
 * on disk. It is untrusted input in exactly the way the ad client's creatives are, and
 * gets the same treatment: a compiled-in shape it must match, enforced last.
 */
describe("normalizeName", () => {
  it("lowercases, because the store must behave the same on a case-insensitive disk", () => {
    // Windows and macOS are case-insensitive by default. Without normalising, `Foo` and
    // `foo` would be one file but two memories, and which one won would depend on the
    // order they were written.
    expect(normalizeName("Chose-Electron")).toBe("chose-electron");
    expect(normalizeName("2026-08-15T14-22-claude-code")).toBe("2026-08-15t14-22-claude-code");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeName("  naming  ")).toBe("naming");
  });
});

describe("isValidName - accepts", () => {
  for (const name of [
    "chose-electron",
    "naming",
    "testing-posture",
    "2026-08-15-chose-electron",
    "2026-08-15t14-22-claude-code",
    "a",
    "a1",
  ]) {
    it(`accepts ${JSON.stringify(name)}`, () => {
      expect(isValidName(name)).toBe(true);
    });
  }
});

describe("isValidName - rejects", () => {
  const REJECTED: ReadonlyArray<[string, string]> = [
    ["", "empty"],
    ["   ", "whitespace only"],
    ["..", "traversal"],
    ["../secrets", "traversal"],
    ["../../etc/passwd", "traversal"],
    ["foo/bar", "path separator"],
    ["foo\\bar", "windows separator"],
    ["/absolute", "absolute path"],
    ["C:\\absolute", "windows absolute"],
    ["-leading-hyphen", "leading hyphen"],
    [".hidden", "leading dot"],
    ["trailing.", "trailing dot"],
    ["has space", "space"],
    ["has_underscore", "underscore is not in the alphabet"],
    ["has.dot", "dot"],
    ["name\u0000.md", "NUL byte"],
    ["café", "non-ascii"],
    ["a".repeat(129), "too long"],
    ["CON", "reserved on Windows"],
    ["con", "reserved on Windows, lowercased"],
    ["PRN", "reserved on Windows"],
    ["aux", "reserved on Windows"],
    ["nul", "reserved on Windows"],
    ["com1", "reserved on Windows"],
    ["lpt9", "reserved on Windows"],
  ];

  for (const [name, why] of REJECTED) {
    it(`rejects ${JSON.stringify(name)} (${why})`, () => {
      expect(isValidName(name)).toBe(false);
    });
  }
});

describe("relativePathFor", () => {
  it("places each kind in its own directory, per §5.1", () => {
    expect(relativePathFor("decision", "chose-electron")).toBe("decisions/chose-electron.md");
    expect(relativePathFor("convention", "naming")).toBe("conventions/naming.md");
    expect(relativePathFor("preference", "testing-posture")).toBe("preferences/testing-posture.md");
    expect(relativePathFor("session", "2026-08-15t14-22-claude-code")).toBe(
      "sessions/2026-08-15t14-22-claude-code.md",
    );
  });

  it("returns null for a name it will not accept", () => {
    expect(relativePathFor("decision", "../escape")).toBeNull();
    expect(relativePathFor("decision", "")).toBeNull();
  });

  it("normalises before building the path", () => {
    expect(relativePathFor("decision", "  Chose-Electron ")).toBe("decisions/chose-electron.md");
  });
});

describe("invariants", () => {
  it("never produces a path that escapes its kind directory, for arbitrary input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MEMORY_KINDS),
        fc.oneof(
          fc.string(),
          fc.string({ unit: "binary" }),
          fc.constantFrom(
            "../../../etc/passwd",
            "..\\..\\windows\\system32",
            "a/../../b",
            "\u0000",
            "con",
            "....//....//x",
          ),
        ),
        (kind, name) => {
          const path = relativePathFor(kind, name);
          if (path === null) return;

          expect(path).toMatch(/^[a-z]+\/[a-z0-9][a-z0-9-]*\.md$/);
          expect(path).not.toContain("..");
          expect(path.split("/")).toHaveLength(2);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("accepts exactly what it normalises to a valid name", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const normalized = normalizeName(raw);
        expect(isValidName(raw)).toBe(isValidName(normalized) && normalized.length > 0);
      }),
      { numRuns: 1000 },
    );
  });
});
