import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isSafeCloneUrl, isSafePathArg, isSafeRef } from "../src/argSafety.ts";

/**
 * Every one of these values reaches a `git` process, and every one of them arrives from
 * somewhere untrusted: a branch name typed into the branch switcher, a path from the
 * renderer, a clone URL pasted from anywhere at all - and, once the AI layer can drive
 * source control, from model output that has read the repository.
 *
 * Git's own CLI is unusually hostile territory for that. An argument beginning with `-`
 * is an option, not a value; `--upload-pack=` and the `ext::` transport both execute a
 * command of the attacker's choosing. Passing arguments as an array avoids the shell but
 * does nothing about any of that, so the values are checked here.
 */
describe("isSafeRef", () => {
  for (const ref of ["main", "feature/x", "release-1.2", "user/fix_thing", "v1.0.0", "HEAD"]) {
    it(`accepts ${JSON.stringify(ref)}`, () => {
      expect(isSafeRef(ref)).toBe(true);
    });
  }

  const REJECTED: ReadonlyArray<[string, string]> = [
    ["", "empty"],
    ["-f", "looks like an option"],
    ["--upload-pack=sh", "option injection"],
    ["-", "bare dash"],
    ["a b", "space"],
    ["a\tb", "tab"],
    ["a\nb", "newline"],
    ["a;rm -rf /", "shell metacharacter"],
    ["a|b", "pipe"],
    ["a$(x)", "command substitution"],
    ["a`x`", "backtick"],
    ["..", "traversal"],
    ["a..b", "range syntax"],
    ["a^", "revision syntax"],
    ["a~1", "revision syntax"],
    ["a:b", "refspec separator"],
    ["a?b", "glob"],
    ["a*b", "glob"],
    ["a[b", "glob"],
    ["a\\b", "backslash"],
    ["/leading", "leading slash"],
    ["trailing/", "trailing slash"],
    ["a//b", "double slash"],
    ["a.lock", "reserved suffix"],
    ["\u0000", "NUL"],
    ["a".repeat(300), "too long"],
  ];

  for (const [ref, why] of REJECTED) {
    it(`rejects ${JSON.stringify(ref)} (${why})`, () => {
      expect(isSafeRef(ref)).toBe(false);
    });
  }
});

describe("isSafePathArg", () => {
  it("accepts an ordinary repository path", () => {
    expect(isSafePathArg("src/main.ts")).toBe(true);
    expect(isSafePathArg("a b/c.txt")).toBe(true);
  });

  it("rejects anything git would read as an option", () => {
    // The reason `--` separators exist; belt and braces, since a path beginning with a
    // dash silently becomes a flag.
    expect(isSafePathArg("-f")).toBe(false);
    expect(isSafePathArg("--force")).toBe(false);
  });

  it("rejects a NUL byte", () => {
    expect(isSafePathArg("ok\u0000.txt")).toBe(false);
  });

  it("rejects an empty path", () => {
    expect(isSafePathArg("")).toBe(false);
  });
});

describe("isSafeCloneUrl", () => {
  for (const url of [
    "https://github.com/owner/repo.git",
    "https://gitlab.com/group/sub/repo",
    "ssh://git@github.com/owner/repo.git",
    "git@github.com:owner/repo.git",
  ]) {
    it(`accepts ${JSON.stringify(url)}`, () => {
      expect(isSafeCloneUrl(url)).toBe(true);
    });
  }

  const REJECTED: ReadonlyArray<[string, string]> = [
    ["", "empty"],
    ["--upload-pack=touch /tmp/pwned", "option injection"],
    ["-u", "looks like an option"],
    // `ext::` hands git an arbitrary command to run. It is a documented remote-code
    // execution vector and has no legitimate use here.
    ["ext::sh -c 'touch /tmp/pwned'", "ext transport executes a command"],
    ["EXT::sh -c x", "ext transport, uppercased"],
    ["file:///etc", "local file transport"],
    ["http://insecure.example/repo.git", "plain http"],
    ["javascript:alert(1)", "not a git transport"],
    ["repo.git", "no scheme or host"],
    ["https://host/repo\u0000", "NUL"],
    ["https://host/repo\nmore", "newline"],
    [`https://host/${"a".repeat(3000)}`, "absurdly long"],
  ];

  for (const [url, why] of REJECTED) {
    it(`rejects ${JSON.stringify(url.slice(0, 40))} (${why})`, () => {
      expect(isSafeCloneUrl(url)).toBe(false);
    });
  }
});

describe("invariants", () => {
  it("never accepts a value beginning with a dash, for any input", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        if (value.startsWith("-")) {
          expect(isSafeRef(value)).toBe(false);
          expect(isSafePathArg(value)).toBe(false);
          expect(isSafeCloneUrl(value)).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("never accepts a value containing a NUL byte", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const withNul = `${value}\u0000`;
        expect(isSafeRef(withNul)).toBe(false);
        expect(isSafePathArg(withNul)).toBe(false);
        expect(isSafeCloneUrl(withNul)).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });

  it("never accepts an ext:: transport, however it is cased or padded", () => {
    fc.assert(
      fc.property(fc.string(), (payload) => {
        expect(isSafeCloneUrl(`ext::${payload}`)).toBe(false);
        expect(isSafeCloneUrl(`ExT::${payload}`)).toBe(false);
        expect(isSafeCloneUrl(`  ext::${payload}`)).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });

  it("accepts nothing with whitespace or shell metacharacters as a ref", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        if (/[\s;|&$`<>(){}'"\\]/.test(value)) expect(isSafeRef(value)).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});
