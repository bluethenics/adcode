import { describe, expect, it } from "vitest";
import { identifierFrom, languagesWithScaffolds, outlineOf, scaffoldFor } from "@adcode/structure";

describe("scaffoldFor", () => {
  it("writes the HTML boilerplate nobody remembers", () => {
    const scaffold = scaffoldFor("html", "index.html");

    expect(scaffold?.text).toContain("<!doctype html>");
    expect(scaffold?.text).toContain('<meta charset="utf-8" />');
    expect(scaffold?.text).toContain('<meta name="viewport"');
    expect(scaffold?.text).toContain("</html>");
  });

  it("titles the page after the file", () => {
    expect(scaffoldFor("html", "about.html")?.text).toContain("<title>about</title>");
  });

  it("writes a complete program for the compiled languages", () => {
    expect(scaffoldFor("c", "main.c")?.text).toContain("#include <stdio.h>");
    expect(scaffoldFor("c", "main.c")?.text).toContain("int main(void)");
    expect(scaffoldFor("cpp", "main.cpp")?.text).toContain("#include <iostream>");
    expect(scaffoldFor("go", "main.go")?.text).toContain("package main");
    expect(scaffoldFor("rust", "main.rs")?.text).toContain("fn main()");
  });

  it("names a Java class after its file, which is the rule that makes it compile", () => {
    expect(scaffoldFor("java", "Widget.java")?.text).toContain("public class Widget {");
  });

  it("puts the caret where the work starts, not at line 1", () => {
    const scaffold = scaffoldFor("python", "run.py");

    expect(scaffold).not.toBeNull();
    expect(scaffold!.cursor).toBeGreaterThan(0);

    // Inside `main`, past everything the template wrote.
    const before = scaffold!.text.slice(0, scaffold!.cursor);
    expect(before).toContain("def main()");
  });

  it("strips the caret marker from the text", () => {
    for (const language of languagesWithScaffolds()) {
      expect(scaffoldFor(language, `thing.${language}`)?.text, language).not.toContain("$0");
    }
  });

  it("says nothing for a language it has no honest template for", () => {
    expect(scaffoldFor("plaintext", "notes.txt")).toBeNull();
    expect(scaffoldFor("xml", "a.xml")).toBeNull();
  });

  /*
   * Rule two of the module: every template must be a working program of its kind.
   *
   * Checked by outlining it - the outline engine reads declarations, so a template whose
   * `main` it cannot find is a template whose structure is wrong. Not a compiler, but it
   * catches the mistake that actually happens: a brace or a keyword lost in an edit.
   */
  it("produces something the outline engine can read back", () => {
    const cases: Readonly<Record<string, string>> = {
      python: "main",
      c: "main",
      cpp: "main",
      go: "main",
      rust: "main",
      java: "Widget",
      csharp: "Widget",
      // The filename's own case is kept - `Widget.ts` exports `Widget`, not `widget`.
      // Renaming somebody's file for them is not a template's job.
      typescript: "Widget",
      javascript: "Widget",
    };

    for (const [language, expected] of Object.entries(cases)) {
      const scaffold = scaffoldFor(language, `Widget.${language}`);
      expect(scaffold, language).not.toBeNull();

      const names = outlineOf(language, scaffold!.text).flatMap(function names(node): string[] {
        return [node.name, ...node.children.flatMap(names)];
      });

      expect(names, `${language}: ${names.join(",")}`).toContain(expected);
    }
  });

  it("never writes an identifier a language would reject", () => {
    // `my-component.ts` must not become `export function my-component()`.
    const scaffold = scaffoldFor("typescript", "my-component.ts");

    expect(scaffold?.text).toContain("export function my_component()");
    expect(scaffold?.text).not.toContain("my-component()");
  });
});

describe("identifierFrom", () => {
  it("keeps a name that is already legal", () => {
    expect(identifierFrom("widget.ts")).toBe("widget");
    expect(identifierFrom("Widget.java")).toBe("Widget");
  });

  it("replaces what no language allows", () => {
    expect(identifierFrom("my-component.tsx")).toBe("my_component");
    // Only the last suffix is an extension: `a.b.c.js` is a file called `a.b.c`, and all
    // three parts of its name survive as one identifier.
    expect(identifierFrom("a.b.c.js")).toBe("a_b_c");
  });

  it("does not start with a digit", () => {
    expect(identifierFrom("2fa.ts")).toBe("_2fa");
  });

  it("falls back rather than returning nothing", () => {
    expect(identifierFrom("---.ts")).toBe("___");
    expect(identifierFrom(".ts")).toBe("main");
  });

  it("reads a path, not only a bare name", () => {
    expect(identifierFrom("src/deep/widget.ts")).toBe("widget");
  });
});
