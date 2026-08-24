/**
 * The formatter.
 *
 * The first describe block is the one that matters most: **formatting twice must equal
 * formatting once**, for every language, over generated input. A formatter that is not
 * idempotent fights the user - every save produces a different file and every diff is
 * noise - and it is the bug this whole package is shaped around avoiding.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_OPTIONS, format, formatSupported, organizeImports } from "@adcode/format";

const LANGUAGES = ["json", "css", "scss", "html", "markdown", "typescript", "rust", "go"];

/*
 * Found by the idempotence property, not by review.
 *
 * Formatting an unterminated block comment returned it with a newline appended, and
 * formatting that returned it with two - one extra blank line on every save, forever. An
 * unclosed comment runs to the end of the file, so it swallowed the trailing newline that
 * the line joiner then added back.
 *
 * Unterminated comments are not an exotic input. They are what a file looks like in the
 * seconds after somebody opens one, which is exactly when format-on-save runs.
 */
describe("an unterminated comment", () => {
  it.each(["css", "scss", "less"])("does not grow on every format in %s", (language) => {
    let text = "/*";
    for (let pass = 0; pass < 5; pass += 1) text = format(text, language, DEFAULT_OPTIONS);
    expect(text).toBe("/*\n");
  });

  it("does not grow when there is code before it", () => {
    const once = format("a{}/*", "css", DEFAULT_OPTIONS);
    expect(format(once, "css", DEFAULT_OPTIONS)).toBe(once);
  });

  it("keeps the text of a comment that is closed", () => {
    const once = format("/* keep  me */\na{color:red}", "css", DEFAULT_OPTIONS);
    expect(once).toContain("/* keep  me */");
    expect(format(once, "css", DEFAULT_OPTIONS)).toBe(once);
  });

  it("keeps the lines of a multi-line comment", () => {
    const source = "/*\n * one\n * two\n */\na{color:red}";
    const once = format(source, "css", DEFAULT_OPTIONS);
    expect(once).toContain(" * one");
    expect(once).toContain(" * two");
    expect(format(once, "css", DEFAULT_OPTIONS)).toBe(once);
  });
});

describe("idempotence", () => {
  it.each(LANGUAGES)("formatting %s twice is the same as once", (language) => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (text) => {
        const once = format(text, language, DEFAULT_OPTIONS);
        const twice = format(once, language, DEFAULT_OPTIONS);
        expect(twice).toBe(once);
      }),
      // 250 found the unterminated-comment bug below, but only on some seeds. The whole
      // suite runs in about a tenth of a second, so the extra runs cost nothing and make
      // the *next* bug of that shape likelier to be found here than by a user.
      { numRuns: 600 },
    );
  });

  /*
   * Generated strings are mostly not valid source, which exercises the "give up safely"
   * paths but rarely the real ones. These are hand-written samples of each language, run
   * through the same property.
   */
  const SAMPLES: readonly [string, string][] = [
    ["json", '{"b":1,"a":[1,2,3],"c":{"d":null}}'],
    ["css", "a{color:red;background:blue}\n\n.b , .c{margin:0}"],
    ["scss", ".a{ .b{color:red} // note\n}"],
    ["html", "<div><p>hi</p><img src=x></div>"],
    ["markdown", "# Title\ntext\n## Next\n- a\n- b"],
    ["typescript", "function a(){\nif(x){\nreturn 1\n}\n}"],
    ["rust", "fn main(){\nlet x=1;\n}"],
  ];

  it.each(SAMPLES)("formatting real %s twice is the same as once", (language, sample) => {
    const once = format(sample, language, DEFAULT_OPTIONS);
    const twice = format(once, language, DEFAULT_OPTIONS);
    expect(twice).toBe(once);
  });
});

describe("safety", () => {
  it("never throws", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...LANGUAGES), (text, language) => {
        expect(() => format(text, language, DEFAULT_OPTIONS)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  it("returns unknown languages untouched", () => {
    const text = "some   text\n\n\n";
    expect(format(text, "brainfuck", DEFAULT_OPTIONS)).toBe(text);
  });

  it("says which languages it can handle", () => {
    expect(formatSupported("json")).toBe(true);
    expect(formatSupported("typescript")).toBe(true);
    expect(formatSupported("brainfuck")).toBe(false);
  });

  it("returns invalid JSON exactly as it came in", () => {
    // Mangling what it could not parse is the reason people fear format-on-save.
    const broken = '{"a": 1,,}';
    expect(format(broken, "json", DEFAULT_OPTIONS)).toBe(broken);
  });
});

describe("json", () => {
  it("indents and spaces consistently", () => {
    expect(format('{"a":1,"b":{"c":2}}', "json", DEFAULT_OPTIONS)).toBe(
      ['{', '  "a": 1,', '  "b": {', '    "c": 2', '  }', '}', ''].join("\n"),
    );
  });

  it("keeps a short array of primitives on one line", () => {
    expect(format('{"a":[1,2,3]}', "json", DEFAULT_OPTIONS)).toBe(
      ["{", '  "a": [1, 2, 3]', "}", ""].join("\n"),
    );
  });

  it("breaks an array of objects", () => {
    const result = format('{"a":[{"b":1}]}', "json", DEFAULT_OPTIONS);
    expect(result).toContain('"a": [\n');
  });

  it("does not reorder keys", () => {
    // Alphabetising package.json on save would be an editorial decision nobody asked for.
    const result = format('{"name":"x","description":"y","author":"z"}', "json", DEFAULT_OPTIONS);
    expect(result.indexOf('"name"')).toBeLessThan(result.indexOf('"description"'));
    expect(result.indexOf('"description"')).toBeLessThan(result.indexOf('"author"'));
  });
});

describe("css", () => {
  it("puts each declaration on its own line", () => {
    expect(format("a{color:red;background:blue}", "css", DEFAULT_OPTIONS)).toBe(
      ["a {", "  color: red;", "  background: blue;", "}", ""].join("\n"),
    );
  });

  it("indents nested rules", () => {
    const result = format(".a{.b{color:red}}", "scss", DEFAULT_OPTIONS);
    expect(result).toBe([".a {", "  .b {", "    color: red;", "  }", "}", ""].join("\n"));
  });

  it("keeps comments", () => {
    expect(format("/* keep me */a{color:red}", "css", DEFAULT_OPTIONS)).toContain("/* keep me */");
  });

  it("does not break a brace inside a string", () => {
    const result = format(`a{content:"}"}`, "css", DEFAULT_OPTIONS);
    expect(result).toContain(`content: "}"`);
  });

  it("does not reorder declarations", () => {
    // `border` after `border-radius` renders differently from the reverse.
    const result = format("a{border-radius:4px;border:0}", "css", DEFAULT_OPTIONS);
    expect(result.indexOf("border-radius")).toBeLessThan(result.indexOf("border:"));
  });
});

describe("brace languages", () => {
  it("re-indents by depth", () => {
    expect(format("function a(){\nif(x){\nreturn 1\n}\n}", "typescript", DEFAULT_OPTIONS)).toBe(
      ["function a(){", "  if(x){", "    return 1", "  }", "}", ""].join("\n"),
    );
  });

  it("does not re-flow the code itself", () => {
    // The contract: whitespace at the front of lines moves, nothing else does.
    const result = format("const x = {a:1,   b:2}", "typescript", DEFAULT_OPTIONS);
    expect(result.trim()).toBe("const x = {a:1,   b:2}");
  });

  it("ignores braces inside strings", () => {
    const result = format('const a = "{";\nconst b = 1;', "typescript", DEFAULT_OPTIONS);
    expect(result).toBe(['const a = "{";', "const b = 1;", ""].join("\n"));
  });

  it("leaves the inside of a template literal alone", () => {
    const source = ["const a = `", "    keep   this", "`;"].join("\n");
    expect(format(source, "typescript", DEFAULT_OPTIONS)).toBe(`${source}\n`);
  });

  it("ignores braces inside a block comment", () => {
    const result = format("/* { */\nconst a = 1;", "typescript", DEFAULT_OPTIONS);
    expect(result).toBe(["/* { */", "const a = 1;", ""].join("\n"));
  });

  it("collapses runs of blank lines to one", () => {
    expect(format("const a = 1;\n\n\n\nconst b = 2;", "typescript", DEFAULT_OPTIONS)).toBe(
      ["const a = 1;", "", "const b = 2;", ""].join("\n"),
    );
  });

  it("strips trailing whitespace and ends with a newline", () => {
    expect(format("const a = 1;   ", "typescript", DEFAULT_OPTIONS)).toBe("const a = 1;\n");
  });
});

describe("markup", () => {
  it("indents by tag depth", () => {
    const source = ["<div>", "<p>hi</p>", "</div>"].join("\n");
    expect(format(source, "html", DEFAULT_OPTIONS)).toBe(
      ["<div>", "  <p>hi</p>", "</div>", ""].join("\n"),
    );
  });

  it("does not open a level for a void element", () => {
    const source = ["<div>", "<img src=x>", "<p>a</p>", "</div>"].join("\n");
    expect(format(source, "html", DEFAULT_OPTIONS)).toBe(
      ["<div>", "  <img src=x>", "  <p>a</p>", "</div>", ""].join("\n"),
    );
  });

  it("leaves the inside of a pre block exactly as found", () => {
    const source = ["<pre>", "   spaced   ", "</pre>"].join("\n");
    expect(format(source, "html", DEFAULT_OPTIONS)).toBe(`${source}\n`);
  });

  it("leaves script contents alone", () => {
    const source = ["<script>", "let x = {a:1}", "</script>"].join("\n");
    expect(format(source, "html", DEFAULT_OPTIONS)).toBe(`${source}\n`);
  });
});

describe("markdown", () => {
  it("keeps a two-space hard break", () => {
    // Stripping it would silently reflow the rendered document.
    const source = "line one  \nline two";
    expect(format(source, "markdown", DEFAULT_OPTIONS)).toBe("line one  \nline two\n");
  });

  it("strips other trailing whitespace", () => {
    expect(format("text     ", "markdown", DEFAULT_OPTIONS)).toBe("text\n");
  });

  it("puts a blank line around a heading", () => {
    expect(format("text\n# Title\nmore", "markdown", DEFAULT_OPTIONS)).toBe(
      ["text", "", "# Title", "", "more", ""].join("\n"),
    );
  });

  it("leaves a fenced code block untouched", () => {
    const source = ["```", "   spaced   ", "", "", "still code", "```"].join("\n");
    expect(format(source, "markdown", DEFAULT_OPTIONS)).toBe(`${source}\n`);
  });

  it("does not re-indent list nesting", () => {
    const source = ["- a", "    - b", "        - c"].join("\n");
    expect(format(source, "markdown", DEFAULT_OPTIONS)).toBe(`${source}\n`);
  });
});

describe("organizeImports", () => {
  const run = (text: string): string => organizeImports(text, DEFAULT_OPTIONS);

  it("sorts packages before relative paths", () => {
    const source = ['import a from "./a";', 'import b from "react";', "", "a; b;"].join("\n");
    expect(run(source)).toBe(
      ['import b from "react";', 'import a from "./a";', "", "a; b;"].join("\n") + "\n",
    );
  });

  it("puts node builtins first", () => {
    const source = ['import a from "react";', 'import b from "node:fs";', "", "a; b;"].join("\n");
    expect(run(source).startsWith('import b from "node:fs";')).toBe(true);
  });

  it("drops an import nothing uses", () => {
    const source = ['import a from "./a";', 'import b from "./b";', "", "a;"].join("\n");
    expect(run(source)).toBe(['import a from "./a";', "", "a;"].join("\n") + "\n");
  });

  it("keeps a side-effect import", () => {
    // It binds nothing, so "is it used" cannot be asked of it.
    const source = ['import "./styles.css";', 'import a from "./a";', "", "a;"].join("\n");
    expect(run(source)).toContain('import "./styles.css";');
  });

  it("keeps a statement where only some names are used", () => {
    // Rewriting a binding list means handling aliases and type specifiers correctly, and
    // getting that wrong deletes code somebody needs.
    const source = ['import { a, b } from "./x";', 'import c from "./c";', "", "a; c;"].join("\n");
    expect(run(source)).toContain('import { a, b } from "./x";');
  });

  it("understands an alias", () => {
    const source = ['import { a as renamed } from "./x";', 'import c from "./c";', "", "renamed; c;"].join("\n");
    expect(run(source)).toContain("renamed");
  });

  it("removes an exact duplicate", () => {
    const source = ['import a from "./a";', 'import a from "./a";', 'import b from "./b";', "", "a; b;"].join("\n");
    expect(run(source).match(/import a/g)).toHaveLength(1);
  });

  it("leaves a single import alone", () => {
    const source = ['import a from "./a";', "", "a;"].join("\n");
    expect(run(source)).toBe(source);
  });

  it("does not touch imports further down the file", () => {
    const source = ['import a from "./a";', 'import b from "./b";', "", "a; b;", 'const c = require("./c");'].join("\n");
    expect(run(source)).toContain('const c = require("./c");');
  });

  it("is idempotent", () => {
    const source = ['import a from "./a";', 'import b from "react";', "", "a; b;"].join("\n");
    const once = run(source);
    expect(run(once)).toBe(once);
  });
});
