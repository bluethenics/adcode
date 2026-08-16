import { describe, it, expect } from "vitest";
import { validateFileName, suffixedName } from "../src/main/fileNames.ts";

/**
 * Names arrive from the renderer, which is hostile by assumption (brief §1) - and from the
 * AI layer, which makes that concrete rather than theoretical, since model output reaches
 * the same handlers.
 *
 * A name is one path segment. Anything that can traverse, address a device, or mean a
 * different file to the filesystem than it does to the person who typed it is refused
 * before it reaches the disk.
 */

const ok = (name: string): boolean => validateFileName(name).ok;
const why = (name: string): string => {
  const result = validateFileName(name);
  return result.ok ? "" : result.reason;
};

describe("validateFileName", () => {
  it("accepts ordinary names", () => {
    expect(ok("index.ts")).toBe(true);
    expect(ok("README.md")).toBe(true);
    expect(ok("my-file_2.test.tsx")).toBe(true);
    expect(ok(".gitignore")).toBe(true);
  });

  it("accepts non-ASCII names", () => {
    // Refusing these would make the editor unusable outside English, and they are not
    // dangerous - the danger is in separators and control characters, not in scripts.
    expect(ok("café.ts")).toBe(true);
    expect(ok("日本語.md")).toBe(true);
    expect(ok("Ω.ts")).toBe(true);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(ok("")).toBe(false);
    expect(ok("   ")).toBe(false);
  });

  it("rejects the directory entries", () => {
    expect(ok(".")).toBe(false);
    expect(ok("..")).toBe(false);
  });

  it("rejects anything containing a path separator", () => {
    // A name that can traverse is not a name. This is the one that turns "create a file"
    // into "write anywhere on the disk".
    expect(ok("../escape.ts")).toBe(false);
    expect(ok("..\\escape.ts")).toBe(false);
    expect(ok("sub/file.ts")).toBe(false);
    expect(ok("sub\\file.ts")).toBe(false);
    expect(ok("/etc/passwd")).toBe(false);
    expect(ok("C:\\Windows\\System32\\evil.dll")).toBe(false);
  });

  it("rejects a NUL byte", () => {
    // A NUL can truncate a path inside a native syscall, so `ok.ts\0.png` may create
    // `ok.ts` while passing any check that only looked at the extension.
    expect(ok("ok.ts\u0000.png")).toBe(false);
  });

  it("rejects other control characters", () => {
    expect(ok("bell\u0007.ts")).toBe(false);
    expect(ok("newline\n.ts")).toBe(false);
    expect(ok("tab\t.ts")).toBe(false);
    expect(ok("del\u007f.ts")).toBe(false);
  });

  it("rejects characters Windows forbids in a name", () => {
    for (const bad of ['a<b.ts', 'a>b.ts', 'a:b.ts', 'a"b.ts', "a|b.ts", "a?b.ts", "a*b.ts"]) {
      expect(ok(bad), bad).toBe(false);
    }
  });

  it("rejects a trailing dot or space", () => {
    // Windows strips both silently, so the file created is not the file requested and a
    // later lookup by the requested name misses.
    expect(ok("file.ts ")).toBe(false);
    expect(ok("file.ts.")).toBe(false);
    expect(ok("folder ")).toBe(false);
  });

  it("accepts a leading dot or space-containing name", () => {
    expect(ok(".env.local")).toBe(true);
    expect(ok("my notes.md")).toBe(true);
  });

  it("rejects reserved Windows device names", () => {
    for (const device of ["CON", "PRN", "AUX", "NUL", "COM1", "COM9", "LPT1", "LPT9"]) {
      expect(ok(device), device).toBe(false);
      expect(ok(device.toLowerCase()), device.toLowerCase()).toBe(false);
    }
  });

  it("rejects a reserved device with an extension", () => {
    // `CON.txt` addresses the console too - the reservation survives the extension, which
    // is the part that a naive check of the whole string misses.
    expect(ok("CON.txt")).toBe(false);
    expect(ok("nul.log")).toBe(false);
    expect(ok("Com1.tar.gz")).toBe(false);
  });

  it("accepts names that merely start like a reserved device", () => {
    expect(ok("CONFIG.ts")).toBe(true);
    expect(ok("console.ts")).toBe(true);
    expect(ok("COM10")).toBe(true);
    expect(ok("AUXILIARY.md")).toBe(true);
  });

  it("rejects a name longer than 255 characters", () => {
    expect(ok("a".repeat(255))).toBe(true);
    expect(ok("a".repeat(256))).toBe(false);
  });

  it("explains why it refused", () => {
    // The message is shown under the inline editor, so it has to be worth reading.
    expect(why("")).toMatch(/empty/i);
    expect(why("a/b")).toMatch(/separator|slash/i);
    expect(why("CON")).toMatch(/reserved/i);
    expect(why("file. ")).toMatch(/space|dot/i);
    expect(why("a".repeat(256))).toMatch(/long/i);
  });
});

describe("suffixedName", () => {
  it("adds a copy suffix before the extension", () => {
    expect(suffixedName("notes.md", 1)).toBe("notes copy.md");
    expect(suffixedName("index.test.ts", 1)).toBe("index.test copy.ts");
  });

  it("numbers later copies", () => {
    expect(suffixedName("notes.md", 2)).toBe("notes copy 2.md");
    expect(suffixedName("notes.md", 7)).toBe("notes copy 7.md");
  });

  it("handles a name with no extension", () => {
    expect(suffixedName("Makefile", 1)).toBe("Makefile copy");
    expect(suffixedName("Makefile", 3)).toBe("Makefile copy 3");
  });

  it("treats a dotfile's leading dot as part of the name", () => {
    // `.gitignore` is not an extension-only file; `. copy gitignore` would be nonsense.
    expect(suffixedName(".gitignore", 1)).toBe(".gitignore copy");
  });

  it("produces a name that validates", () => {
    expect(ok(suffixedName("notes.md", 1))).toBe(true);
    expect(ok(suffixedName(".gitignore", 2))).toBe(true);
  });
});
