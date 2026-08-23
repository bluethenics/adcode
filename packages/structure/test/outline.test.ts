import { describe, expect, it } from "vitest";
import { declarationOn, nodeAtLine, outlineOf, outlineSupported, walkOutline } from "@adcode/structure";
import type { OutlineNode } from "@adcode/structure";

/** `name` and nothing else, for asserting shape without asserting every column. */
const names = (nodes: readonly OutlineNode[]): string[] => nodes.map((node) => node.name);

const find = (nodes: readonly OutlineNode[], name: string): OutlineNode | undefined =>
  walkOutline(nodes).find((node) => node.name === name);

describe("outlineOf - TypeScript and JavaScript", () => {
  it("finds functions, classes and their methods, nested by brace", () => {
    const source = [
      "import { join } from 'node:path';",
      "",
      "export function greet(name) {",
      "  return `hi ${name}`;",
      "}",
      "",
      "class Widget extends Base {",
      "  constructor(host) {",
      "    this.host = host;",
      "  }",
      "",
      "  render() {",
      "    return null;",
      "  }",
      "}",
    ].join("\n");

    const outline = outlineOf("typescript", source);

    expect(names(outline)).toEqual(["{ join }", "greet", "Widget"]);

    const widget = find(outline, "Widget");
    expect(names(widget?.children ?? [])).toEqual(["constructor", "render"]);
    expect(widget?.line).toBe(7);
    expect(widget?.endLine).toBe(15);
  });

  it("treats an arrow bound to a name as a function, not a variable", () => {
    const outline = outlineOf("typescript", "export const handle = async (event) => {\n  return 1;\n};");

    expect(outline[0]?.kind).toBe("function");
    expect(outline[0]?.name).toBe("handle");
    expect(outline[0]?.detail).toBe("(event)");
  });

  it("shows a test file as its describe blocks", () => {
    const source = [
      "describe('the parser', () => {",
      "  it('handles empty input', () => {",
      "    expect(1).toBe(1);",
      "  });",
      "});",
    ].join("\n");

    const outline = outlineOf("javascript", source);

    expect(outline[0]?.detail).toBe("the parser");
    expect(outline[0]?.children[0]?.detail).toBe("handles empty input");
  });

  it("ignores a commented-out declaration", () => {
    const outline = outlineOf("typescript", "// function ghost() {}\nfunction real() {}");

    expect(names(outline)).toEqual(["real"]);
  });

  it("ignores a brace inside a string literal", () => {
    const source = ['function a() {', '  const open = "{";', "}", "function b() {}"].join("\n");

    // Without string blanking the stray `{` never closes and `b` becomes a child of `a`.
    expect(names(outlineOf("typescript", source))).toEqual(["a", "b"]);
  });

  it("ignores a declaration inside a block comment", () => {
    const source = ["/*", " * function documented() {}", " */", "function real() {}"].join("\n");

    expect(names(outlineOf("typescript", source))).toEqual(["real"]);
  });
});

describe("outlineOf - Python", () => {
  it("nests methods inside their class by indentation", () => {
    const source = [
      "import os",
      "",
      "MAX_RETRIES = 3",
      "",
      "class Client:",
      "    def __init__(self, host):",
      "        self.host = host",
      "",
      "    def fetch(self, path):",
      "        return None",
      "",
      "def main():",
      "    pass",
    ].join("\n");

    const outline = outlineOf("python", source);

    expect(names(outline)).toEqual(["os", "MAX_RETRIES", "Client", "main"]);

    const client = find(outline, "Client");
    expect(names(client?.children ?? [])).toEqual(["__init__", "fetch"]);
    // The class ends at its last line of content, not at the blank line after it.
    expect(client?.endLine).toBe(10);
  });

  it("does not read a docstring's example code as declarations", () => {
    const source = [
      "def outer():",
      '    """',
      "    def not_a_function():",
      "        pass",
      '    """',
      "    return 1",
    ].join("\n");

    expect(names(outlineOf("python", source))).toEqual(["outer"]);
  });

  it("leaves ordinary assignments out and keeps shouting ones", () => {
    const outline = outlineOf("python", "TIMEOUT = 30\ncount = 0");

    expect(names(outline)).toEqual(["TIMEOUT"]);
  });
});

describe("outlineOf - C and C++", () => {
  it("finds includes, macros, classes and definitions", () => {
    const source = [
      "#include <vector>",
      "#define MAX 10",
      "",
      "namespace app {",
      "",
      "class Buffer : public Base {",
      "public:",
      "  Buffer(int size) {",
      "  }",
      "};",
      "",
      "int main(int argc, char** argv) {",
      "  return 0;",
      "}",
      "",
      "}",
    ].join("\n");

    const outline = outlineOf("cpp", source);

    expect(names(outline)).toEqual(["vector", "MAX", "app"]);
    expect(names(find(outline, "app")?.children ?? [])).toEqual(["Buffer", "main"]);
  });

  it("does not mistake a conditional for a function", () => {
    const source = ["void run() {", "  if (ready) {", "  }", "  while (x) {", "  }", "}"].join("\n");

    expect(walkOutline(outlineOf("c", source)).map((node) => node.name)).toEqual(["run"]);
  });

  it("leaves prototypes out, so a header lists its types", () => {
    const outline = outlineOf("c", "int compute(int a);\nstruct Point { int x; };");

    expect(names(outline)).toEqual(["Point"]);
  });
});

describe("outlineOf - the other languages", () => {
  it("reads Go functions and their receivers", () => {
    const outline = outlineOf("go", "package main\n\nfunc (c *Client) Do(r *Request) error {\n}\n");

    expect(names(outline)).toEqual(["main", "Do"]);
    expect(find(outline, "Do")?.detail).toBe("(c *Client)");
  });

  it("reads Rust impl blocks as containers", () => {
    const source = ["impl Widget {", "    pub fn draw(&self) {", "    }", "}"].join("\n");
    const outline = outlineOf("rust", source);

    expect(names(outline)).toEqual(["Widget"]);
    expect(names(outline[0]?.children ?? [])).toEqual(["draw"]);
  });

  it("reads a Java class and its methods", () => {
    const source = [
      "package app;",
      "public class Main {",
      "  public static void main(String[] args) {",
      "  }",
      "}",
    ].join("\n");

    const outline = outlineOf("java", source);
    expect(names(find(outline, "Main")?.children ?? [])).toEqual(["main"]);
  });

  it("reads a JSON file's keys, nested as its braces nest", () => {
    const source = ['{', '  "name": "adcode",', '  "scripts": {', '    "start": "node ."', "  }", "}"].join("\n");

    const outline = outlineOf("json", source);
    expect(names(outline)).toEqual(["name", "scripts"]);
    expect(names(find(outline, "scripts")?.children ?? [])).toEqual(["start"]);
  });

  it("reads Markdown headings, and skips fenced code", () => {
    const source = ["# Title", "", "```sh", "# not a heading", "```", "", "## Section"].join("\n");

    const outline = outlineOf("markdown", source);
    expect(names(outline)).toEqual(["Title"]);
    expect(names(outline[0]?.children ?? [])).toEqual(["Section"]);
  });

  it("reads SQL as a flat list of objects", () => {
    const outline = outlineOf("sql", "CREATE TABLE users (id INT);\nCREATE VIEW active AS SELECT 1;");

    expect(names(outline)).toEqual(["users", "active"]);
  });
});

describe("nodeAtLine", () => {
  it("reports the innermost node containing a line", () => {
    const source = ["class A {", "  run() {", "    return 1;", "  }", "}"].join("\n");
    const outline = outlineOf("typescript", source);

    expect(nodeAtLine(outline, 3)?.name).toBe("run");
    expect(nodeAtLine(outline, 1)?.name).toBe("A");
    expect(nodeAtLine(outline, 9)).toBeNull();
  });
});

describe("declarationOn", () => {
  it("recognises the line that defines a symbol", () => {
    expect(declarationOn("typescript", "export function handle(event) {")).toEqual({
      kind: "function",
      name: "handle",
    });
  });

  it("returns null for a line that merely uses one", () => {
    expect(declarationOn("typescript", "  handle(event);")).toBeNull();
  });
});

describe("outlineSupported", () => {
  it("covers the languages the editor claims to support", () => {
    for (const language of ["html", "css", "javascript", "typescript", "cpp", "python", "java", "go", "rust"]) {
      expect(outlineSupported(language)).toBe(true);
    }
  });

  it("is honest about one it does not know", () => {
    expect(outlineSupported("plaintext")).toBe(false);
    expect(outlineOf("plaintext", "anything")).toEqual([]);
  });
});
