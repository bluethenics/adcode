import { describe, it, expect } from "vitest";
import {
  WORKER_BACKED,
  languagesWithKeywords,
  matching,
  suggestionsFor,
} from "../src/renderer/editor/completions/keywords.ts";

describe("suggestionsFor", () => {
  it("covers the languages a learner is most likely to be told to start with", () => {
    for (const language of ["python", "rust", "go", "java", "sql"]) {
      expect(suggestionsFor(language).length, `${language} has no suggestions`).toBeGreaterThan(5);
    }
  });

  it("offers nothing for a language that already has a real worker", () => {
    // A keyword list beside type-aware completions is strictly noise: it would offer
    // `class` with no idea whether `class` belongs there, next to something that knows.
    for (const language of WORKER_BACKED) {
      expect(suggestionsFor(language), `${language} should defer to its worker`).toEqual([]);
    }
  });

  it("offers nothing rather than guessing for a language it does not know", () => {
    expect(suggestionsFor("brainfuck")).toEqual([]);
    expect(suggestionsFor("")).toEqual([]);
  });

  it("gives Python the entry point a beginner cannot guess", () => {
    const ifmain = suggestionsFor("python").find((item) => item.label === "ifmain");

    expect(ifmain?.insert).toContain('if __name__ == "__main__"');
  });

  it("shares one table between C and C++ rather than maintaining two", () => {
    expect(suggestionsFor("cpp")).toBe(suggestionsFor("c"));
  });
});

describe("the suggestion tables themselves", () => {
  const everything = languagesWithKeywords().flatMap((language) => suggestionsFor(language));

  it("describes every suggestion in words that do not assume the answer", () => {
    const jargon = /\b(iterable|instantiate|dereference|polymorphi|invoke)\b/i;

    for (const item of everything) {
      expect(item.detail.length, `${item.label} has no description`).toBeGreaterThan(0);
      expect(jargon.test(item.detail), `"${item.detail}" leaks jargon`).toBe(false);
    }
  });

  it("gives every suggestion something to insert", () => {
    for (const item of everything) {
      expect(item.insert.length, `${item.label} inserts nothing`).toBeGreaterThan(0);
    }
  });

  it("finishes every snippet's tab stops with an explicit cursor position", () => {
    // A snippet with placeholders but no `$0` leaves the cursor wherever Monaco guesses,
    // which for a multi-line body is reliably the wrong line.
    for (const item of everything) {
      if (item.kind !== "snippet") continue;
      if (!item.insert.includes("${")) continue;

      // Both spellings are the final stop: bare `$0`, and `${0:placeholder}` when the
      // cursor lands on text worth pre-selecting.
      expect(
        /\$\{?0/.test(item.insert),
        `${item.label} has tab stops but no final cursor`,
      ).toBe(true);
    }
  });

  it("has no duplicate label inside one language", () => {
    for (const language of languagesWithKeywords()) {
      const labels = suggestionsFor(language).map((item) => item.label);
      expect(new Set(labels).size, `${language} repeats a label`).toBe(labels.length);
    }
  });
});

describe("matching", () => {
  const python = suggestionsFor("python");

  it("returns everything when nothing has been typed", () => {
    expect(matching(python, "")).toBe(python);
  });

  it("matches on a prefix, case-insensitively", () => {
    const labels = matching(python, "DE").map((item) => item.label);

    expect(labels).toContain("def");
    expect(labels).toContain("del");
    expect(labels).not.toContain("class");
  });

  it("returns nothing when nothing matches", () => {
    expect(matching(python, "zzzz")).toEqual([]);
  });
});
