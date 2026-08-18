import { describe, it, expect } from "vitest";
import { explain, subject, TABLE } from "../src/index.ts";
import type { Diagnostic } from "../src/index.ts";

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    file: "app.ts",
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 2,
    severity: "error",
    source: "ts",
    code: "0",
    message: "",
    ...overrides,
  };
}

describe("subject", () => {
  it("turns primitive type names into words a beginner already knows", () => {
    expect(subject("string")).toBe("text");
    expect(subject("number")).toBe("a number");
    expect(subject("boolean")).toBe("true or false");
  });

  it("describes a literal type as itself, since no paraphrase beats it", () => {
    expect(subject('"red"')).toBe('the exact text "red"');
    expect(subject("42")).toBe("exactly 42");
  });

  it("quotes an unknown type rather than inventing a description of it", () => {
    expect(subject("RequestHandler")).toBe("a `RequestHandler`");
  });

  it("reads an array type as a list", () => {
    expect(subject("string[]")).toBe("a list of text");
    expect(subject("User[]")).toBe("a list of `User` values");
  });

  it("trims, because compiler messages are not always tight", () => {
    expect(subject("  number  ")).toBe("a number");
  });
});

describe("explain", () => {
  it("rewrites the classic first-week assignment error", () => {
    const result = explain(
      diagnostic({
        code: "2322",
        message: "Type 'string' is not assignable to type 'number'.",
      }),
    );

    expect(result?.plain).toBe("You're putting text where a number belongs.");
    expect(result?.hint).toContain("5");
  });

  it("names the missing thing rather than saying a name was not found", () => {
    const result = explain(
      diagnostic({ code: "2304", message: "Cannot find name 'reslt'." }),
    );

    expect(result?.plain).toBe("Nothing called `reslt` has been defined yet.");
  });

  it("prefers the entry that carries the compiler's own suggestion", () => {
    const result = explain(
      diagnostic({
        code: "2552",
        message: "Cannot find name 'lenght'. Did you mean 'length'?",
      }),
    );

    expect(result?.hint).toBe("You probably meant `length`.");
  });

  it("counts arguments in words, and says which direction is wrong", () => {
    const tooMany = explain(
      diagnostic({ code: "2554", message: "Expected 1 arguments, but got 3." }),
    );
    expect(tooMany?.plain).toBe("This function takes 1 value, but 3 were given.");
    expect(tooMany?.hint).toBe("Remove the extra ones.");

    const tooFew = explain(
      diagnostic({ code: "2554", message: "Expected 2 arguments, but got 1." }),
    );
    expect(tooFew?.plain).toBe("This function takes 2 values, but 1 was given.");
    expect(tooFew?.hint).toContain("missing");
  });

  it("tells a relative import apart from a package import", () => {
    const local = explain(
      diagnostic({ code: "2307", message: "Cannot find module './helpres'." }),
    );
    expect(local?.hint).toContain("folder");

    const pkg = explain(
      diagnostic({ code: "2307", message: "Cannot find module 'lodash'." }),
    );
    expect(pkg?.hint).toContain("installing");
  });

  it("matches JSON and CSS on message text, which carry no useful code", () => {
    const json = explain(
      diagnostic({ source: "json", code: "", message: "Comma expected" }),
    );
    expect(json?.plain).toContain("comma is missing");

    const css = explain(
      diagnostic({ source: "css", code: "", message: "Unknown property: 'colr'." }),
    );
    expect(css?.plain).toBe("There's no CSS property called `colr`.");
  });

  it("returns null for an error it has nothing better to say about", () => {
    expect(explain(diagnostic({ code: "9999", message: "Some novel failure." }))).toBeNull();
    expect(explain(diagnostic({ source: "rust", code: "E0382", message: "borrow" }))).toBeNull();
  });

  it("never throws on a message that does not match the entry's pattern", () => {
    // A compiler upgrade can reword a message while keeping its code. That must degrade to
    // the raw message, not to a crash in the panel that was meant to help.
    expect(() =>
      explain(diagnostic({ code: "2322", message: "Types are incompatible." })),
    ).not.toThrow();
    expect(explain(diagnostic({ code: "2322", message: "Types are incompatible." }))).toBeNull();
  });
});

describe("the table itself", () => {
  it("has no entry that both omits a code and omits a pattern", () => {
    // Such an entry would explain every diagnostic from its source identically, which is
    // worse than explaining none of them.
    for (const entry of TABLE) {
      expect(
        entry.code !== undefined || entry.pattern !== undefined,
        `an entry for ${entry.source} matches everything`,
      ).toBe(true);
    }
  });

  it("writes every explanation as a sentence", () => {
    for (const entry of TABLE) {
      const rendered = entry.render(null, diagnostic());
      expect(rendered.plain.length, `${entry.source} entry is empty`).toBeGreaterThan(0);
      expect(
        /[.?]$/.test(rendered.plain),
        `"${rendered.plain}" should end like a sentence`,
      ).toBe(true);
    }
  });

  it("uses no compiler jargon in the words it puts in front of a beginner", () => {
    // The point of the table is that these words never reach the user. If one shows up in
    // a rewrite, the rewrite has not done its job.
    const jargon = /\b(assignable|instantiat|overload resolution|type parameter|generic)\b/i;

    for (const entry of TABLE) {
      const rendered = entry.render(null, diagnostic());
      expect(jargon.test(rendered.plain), `"${rendered.plain}" leaks jargon`).toBe(false);
    }
  });

  it("has a globally-unique source+code+pattern, so no entry is dead", () => {
    const seen = new Set<string>();

    for (const entry of TABLE) {
      const key = `${entry.source}:${entry.code ?? ""}:${entry.pattern?.source ?? ""}`;
      expect(seen.has(key), `duplicate table entry ${key}`).toBe(false);
      seen.add(key);
    }
  });
});
