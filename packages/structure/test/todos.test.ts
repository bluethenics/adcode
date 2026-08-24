import { describe, expect, it } from "vitest";
import { todoMarksIn } from "@adcode/structure";

/** Marks as `KEYWORD@line:column`, which is what the assertions actually care about. */
const marks = (text: string, language: string): string[] =>
  todoMarksIn(text, language).map((m) => `${m.keyword}@${String(m.line)}:${String(m.startColumn)}`);

describe("todoMarksIn", () => {
  it("finds a note in a line comment", () => {
    expect(marks("// TODO: fix this", "typescript")).toEqual(["TODO@1:4"]);
  });

  it("finds every keyword it knows", () => {
    const text = ["// TODO a", "// FIXME b", "// HACK c", "// XXX d", "// NOTE e"].join("\n");
    expect(marks(text, "typescript")).toEqual([
      "TODO@1:4",
      "FIXME@2:4",
      "HACK@3:4",
      "XXX@4:4",
      "NOTE@5:4",
    ]);
  });

  /*
   * The test this whole module exists for. Highlighting every occurrence of the word is
   * what makes the feature annoying rather than useful.
   */
  it("ignores the keyword in code", () => {
    expect(marks('const TODO = "nope";', "typescript")).toEqual([]);
  });

  it("ignores the keyword inside a string", () => {
    expect(marks('const label = "TODO: not a comment";', "typescript")).toEqual([]);
  });

  it("ignores a comment marker that is inside a string", () => {
    // The `//` here is part of a URL, so nothing after it is a comment.
    expect(marks('const url = "https://example.com/TODO";', "typescript")).toEqual([]);
  });

  it("finds a note after code on the same line", () => {
    expect(marks("doThing(); // TODO tidy", "typescript")).toEqual(["TODO@1:15"]);
  });

  it("finds notes in a block comment across lines", () => {
    const text = ["/*", " * TODO one", " * FIXME two", " */"].join("\n");
    expect(marks(text, "typescript")).toEqual(["TODO@2:4", "FIXME@3:4"]);
  });

  it("stops at the end of a block comment", () => {
    expect(marks("/* TODO yes */ const TODO = 1;", "typescript")).toEqual(["TODO@1:4"]);
  });

  it("reads hash comments in Python", () => {
    expect(marks("# TODO: port this", "python")).toEqual(["TODO@1:3"]);
  });

  it("reads docstrings in Python", () => {
    const text = ['"""', "TODO write this", '"""'].join("\n");
    expect(marks(text, "python")).toEqual(["TODO@2:1"]);
  });

  it("reads HTML comments", () => {
    expect(marks("<!-- TODO: replace -->", "html")).toEqual(["TODO@1:6"]);
  });

  it("does not treat HTML text as a comment", () => {
    expect(marks("<p>TODO</p>", "html")).toEqual([]);
  });

  it("requires the keyword to be shouted", () => {
    // `todo` is an ordinary word and a common variable name.
    expect(marks("// todo: lowercase", "typescript")).toEqual([]);
  });

  it("requires a word boundary", () => {
    expect(marks("// TODOS are plural", "typescript")).toEqual([]);
    expect(marks("// XXXVI is a number", "typescript")).toEqual([]);
  });

  it("survives an escaped quote before a comment", () => {
    expect(marks('const q = "\\""; // TODO after', "typescript")).toEqual(["TODO@1:20"]);
  });

  it("returns nothing for a language it does not know", () => {
    expect(marks("// TODO", "not-a-language")).toEqual([]);
  });

  it("finds several notes on one line", () => {
    expect(marks("// TODO one FIXME two", "typescript")).toEqual(["TODO@1:4", "FIXME@1:13"]);
  });
});
