import { describe, it, expect } from "vitest";
import { misspellingsIn, splitWords } from "../src/index.ts";
import { CORRECTIONS } from "../src/corrections.ts";

const found = (text: string, language = "typescript") =>
  misspellingsIn(text, language).map((m) => `${m.word}->${m.suggestion}`);

describe("splitting words the way code is written", () => {
  const words = (text: string) => splitWords(text).map((w) => w.word);

  it("splits camelCase, so a typo inside an identifier is still found", () => {
    expect(words("recieveData")).toEqual(["recieve", "Data"]);
  });

  it("keeps an acronym together and starts the next word after it", () => {
    expect(words("HTTPRequest")).toEqual(["HTTP", "Request"]);
  });

  it("splits snake_case and kebab-case", () => {
    expect(words("user_name-value")).toEqual(["user", "name", "value"]);
  });

  it("ignores digits and punctuation entirely", () => {
    // `0xFF` yields `x` and `FF` rather than being recognised as a number - the pattern
    // matches letters and knows nothing about literals. Harmless: neither is a word the
    // corrections list has an opinion about, and inventing literal-awareness here would be
    // a parser's job for no gain.
    expect(words("sha256(total) = 0xFF;")).toEqual(["sha", "total", "x", "FF"]);
  });

  it("reports where each word starts, so a decoration can point at it", () => {
    const [second] = splitWords("aa bbb").slice(1);
    expect(second).toEqual({ word: "bbb", offset: 3 });
  });
});

describe("finding misspellings in comments", () => {
  it("finds a classic one and names the fix", () => {
    expect(found("// we recieve the value")).toEqual(["recieve->receive"]);
  });

  it("finds one inside an identifier", () => {
    expect(found("// call recieveData first")).toEqual(["recieve->receive"]);
  });

  /*
   * The property the whole design rests on.
   *
   * This checker flags only words it can name a correction for, rather than every word
   * missing from a dictionary. A dictionary-based checker underlines every identifier,
   * product name and abbreviation on the day it is switched on, and the thing people do
   * about that is switch it off - permanently, before it ever catches a real typo.
   */
  it("says nothing about jargon, names, or abbreviations it does not know", () => {
    expect(found("// the Kubernetes CRD reconciles a StatefulSet via kubelet")).toEqual([]);
  });

  it("leaves code alone and only reads comments", () => {
    expect(found("const recieve = 1;")).toEqual([]);
  });

  it("does not read a string that merely looks like a comment", () => {
    expect(found('const s = "// recieve";')).toEqual([]);
  });

  it("works in a language whose comments are not //", () => {
    expect(found("# we recieve it", "python")).toEqual(["recieve->receive"]);
  });

  it("reads block comments too", () => {
    expect(found("/* we seperate them */")).toEqual(["seperate->separate"]);
  });

  it("says nothing about a language it does not know", () => {
    expect(found("// recieve", "brainfuck")).toEqual([]);
  });
});

describe("matching the capitalisation of what was written", () => {
  it("keeps a lowercase word lowercase", () => {
    expect(found("// recieve")).toEqual(["recieve->receive"]);
  });

  it("keeps a leading capital", () => {
    expect(found("// Recieve the value")).toEqual(["Recieve->Receive"]);
  });

  it("keeps a shouted word shouted", () => {
    expect(found("// RECIEVE")).toEqual(["RECIEVE->RECEIVE"]);
  });
});

describe("positions", () => {
  it("points at the misspelled word, not the line", () => {
    const [only] = misspellingsIn("const x = 1; // recieve it", "typescript");
    if (only === undefined) throw new Error("expected a misspelling");

    expect(only.line).toBe(1);
    expect(only.startColumn).toBe("const x = 1; // ".length + 1);
    expect(only.endColumn).toBe(only.startColumn + "recieve".length);
  });

  it("reports the right line in a multi-line file", () => {
    const [only] = misspellingsIn("const x = 1;\n\n// seperate\n", "typescript");
    expect(only?.line).toBe(3);
  });
});

describe("the corrections list itself", () => {
  it("never maps a word to itself", () => {
    for (const [wrong, right] of Object.entries(CORRECTIONS)) {
      expect(wrong, `"${wrong}" is listed as a misspelling of itself`).not.toBe(right);
    }
  });

  it("is keyed in lowercase, since lookup lowercases first", () => {
    for (const wrong of Object.keys(CORRECTIONS)) {
      expect(wrong).toBe(wrong.toLowerCase());
    }
  });

  /*
   * A correction that is itself a misspelling would loop: fix it, and the fixed text is
   * flagged again on the next scan.
   */
  it("never suggests a word that is itself on the list", () => {
    for (const [wrong, right] of Object.entries(CORRECTIONS)) {
      expect(CORRECTIONS[right.toLowerCase()], `"${wrong}" -> "${right}" is a loop`).toBeUndefined();
    }
  });
});
