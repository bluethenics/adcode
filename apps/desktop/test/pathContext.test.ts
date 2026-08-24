import { describe, expect, it } from "vitest";
import { pathContextAt } from "../src/renderer/editor/pathContext.ts";

describe("pathContextAt", () => {
  it("offers nothing outside a string", () => {
    expect(pathContextAt("const x = 1")).toBeNull();
  });

  it("offers nothing for an ordinary string", () => {
    // The feature people hate is the one that pops up on every quote.
    expect(pathContextAt('const label = "hello')).toBeNull();
  });

  it("offers nothing once the string is closed", () => {
    expect(pathContextAt('const a = "./done.ts"; const b = 2')).toBeNull();
  });

  it("recognises a relative path by its shape", () => {
    expect(pathContextAt('const x = "./comp')).toEqual({
      prefix: "./comp",
      directory: "./",
      partial: "comp",
    });
  });

  it("recognises an import even before the path looks like one", () => {
    expect(pathContextAt('import { a } from "')).toEqual({
      prefix: "",
      directory: "",
      partial: "",
    });
  });

  it("recognises require", () => {
    expect(pathContextAt('const fs = require("')?.partial).toBe("");
  });

  it("recognises an HTML src attribute", () => {
    expect(pathContextAt('<img src="')).toEqual({ prefix: "", directory: "", partial: "" });
  });

  it("recognises an href", () => {
    expect(pathContextAt('<a href="../about')).toEqual({
      prefix: "../about",
      directory: "../",
      partial: "about",
    });
  });

  it("splits a nested directory from the partial name", () => {
    expect(pathContextAt('import "./src/renderer/edit')).toEqual({
      prefix: "./src/renderer/edit",
      directory: "./src/renderer/",
      partial: "edit",
    });
  });

  it("treats a trailing slash as a directory with no partial", () => {
    expect(pathContextAt('import "./src/')).toEqual({
      prefix: "./src/",
      directory: "./src/",
      partial: "",
    });
  });

  it("accepts single quotes and backticks", () => {
    expect(pathContextAt("import './a")?.partial).toBe("a");
    expect(pathContextAt("import `./a")?.partial).toBe("a");
  });

  it("uses the innermost unclosed quote", () => {
    expect(pathContextAt(`const a = "done"; import "./b`)?.partial).toBe("b");
  });

  it("is not fooled by an escaped quote", () => {
    // The \" does not close the string, so the cursor is still inside it - and the content
    // is not a path, so nothing is offered.
    expect(pathContextAt('const a = "say \\"hi')).toBeNull();
  });

  it("recognises a bare package path by its slash", () => {
    // `@scope/name` has a slash, so it reads as a path even with no leading dot.
    expect(pathContextAt('import "@adcode/str')).toEqual({
      prefix: "@adcode/str",
      directory: "@adcode/",
      partial: "str",
    });
  });

  it("recognises an absolute path", () => {
    expect(pathContextAt('open("/etc/ho')?.directory).toBe("/etc/");
  });
});
