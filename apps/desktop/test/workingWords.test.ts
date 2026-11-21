import { describe, expect, it } from "vitest";
import { WORDS_EVERY_S, workingWord } from "../src/renderer/ai/workingWords.ts";

describe("working words", () => {
  it("changes the word every few seconds, never repeating one in a row", () => {
    const words = Array.from({ length: 12 }, (_, step) => workingWord("thinking", step * WORDS_EVERY_S, 0));
    expect(words[0]).toBe("Pondering");
    for (let index = 1; index < words.length; index++) expect(words[index]).not.toBe(words[index - 1]);
    expect(workingWord("thinking", WORDS_EVERY_S - 0.1, 0)).toBe(words[0]);
  });

  it("makes and creates while the reply is being written", () => {
    expect(workingWord("writing", 0, 0)).toBe("Making");
    expect(workingWord("writing", WORDS_EVERY_S, 0)).toBe("Creating");
  });
});
