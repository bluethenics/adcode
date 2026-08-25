import { describe, it, expect } from "vitest";
import { commentTonesIn } from "../src/commentTones.ts";

const tones = (text: string, language = "typescript") =>
  commentTonesIn(text, language).map((tone) => tone.tone);

describe("comment tones", () => {
  it("reads ! as an alert", () => {
    expect(tones("// ! this deletes data")).toEqual(["alert"]);
  });

  it("reads ? as a query", () => {
    expect(tones("// ? is this still true")).toEqual(["query"]);
  });

  it("reads * as a highlight", () => {
    expect(tones("// * the important bit")).toEqual(["highlight"]);
  });

  it("reads a repeated comment marker as commented-out code", () => {
    expect(tones("// // const old = 1")).toEqual(["muted"]);
  });

  it("leaves an ordinary comment alone", () => {
    expect(tones("// just a comment")).toEqual([]);
  });

  /*
   * The trap this feature dies on.
   *
   * A JSDoc block's text begins with `*` the moment you strip `/*`, so a rule that reads
   * the first character paints every documented function in the project "highlight". This
   * repo writes nearly every comment that way, so getting it wrong would light up almost
   * every file - which is exactly how a feature like this earns being switched off.
   */
  it("does NOT tone a JSDoc block, whose text begins with * by convention", () => {
    expect(tones("/**\n * Ordinary documentation.\n */")).toEqual([]);
  });

  it("does not tone block comments at all, even with a real marker", () => {
    expect(tones("/* ! not toned */")).toEqual([]);
  });

  it("ignores a marker inside a string, which is not a comment", () => {
    expect(tones('const help = "// ! not a comment";')).toEqual([]);
  });

  it("works in a language whose comments are not //", () => {
    expect(tones("# ! danger", "python")).toEqual(["alert"]);
  });

  it("says nothing about a language it does not know", () => {
    expect(tones("// ! danger", "brainfuck")).toEqual([]);
  });

  it("tolerates no space between the marker and the delimiter", () => {
    expect(tones("//! danger")).toEqual(["alert"]);
  });

  it("colours from the delimiter, so the // is coloured too", () => {
    const [tone] = commentTonesIn("const x = 1; // ! danger", "typescript");
    if (tone === undefined) throw new Error("expected a tone");

    // One-based, and pointing at the first slash rather than at the `!`.
    expect(tone.startColumn).toBe("const x = 1; ".length + 1);
    expect(tone.endColumn).toBe("const x = 1; // ! danger".length + 1);
    expect(tone.line).toBe(1);
  });

  it("finds one on each line, in reading order", () => {
    expect(tones("// ! one\nconst x = 1;\n// ? two")).toEqual(["alert", "query"]);
  });
});
