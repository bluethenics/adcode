import { describe, expect, it } from "vitest";
import { ALL_WORKING_WORDS, WORDS_EVERY_S, WORKING_TONES, workingMood, workingTone, workingWord } from "../src/renderer/ai/workingWords.ts";
import { ADCODE_MASCOT_MOODS } from "../src/renderer/mascot/adcodeMascot.ts";

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

  it("has a hundred different words, none listed twice", () => {
    expect(ALL_WORKING_WORDS).toHaveLength(100);
    expect(new Set(ALL_WORKING_WORDS.map((word) => word.toLowerCase())).size).toBe(100);
  });

  it("goes through every word of a phase before one comes back, whatever the seed", () => {
    for (const seed of [0, 59, 61, 333, 999]) {
      const lap = new Set(Array.from({ length: 60 }, (_, step) => workingWord("thinking", step * WORDS_EVERY_S, seed)));
      expect(lap.size, `seed ${seed}`).toBe(60);
      const writing = new Set(Array.from({ length: 40 }, (_, step) => workingWord("writing", step * WORDS_EVERY_S, seed)));
      expect(writing.size, `seed ${seed}`).toBe(40);
    }
  });

  it("gives two chats with different seeds different orders", () => {
    const order = (seed: number) => Array.from({ length: 6 }, (_, step) => workingWord("thinking", step * WORDS_EVERY_S, seed)).join("|");
    expect(order(7)).not.toBe(order(700));
  });

  it("wears a new colour with every word", () => {
    for (let step = 1; step < 20; step++) {
      const before = workingTone("thinking", (step - 1) * WORDS_EVERY_S, 42), now = workingTone("thinking", step * WORDS_EVERY_S, 42);
      expect(now).not.toBe(before);
      expect(now).toBeGreaterThanOrEqual(0);
      expect(now).toBeLessThan(WORKING_TONES);
    }
  });
});

describe("Buck at the foot of a working turn", () => {
  it("changes pose with each word, never repeats one twice running, and only uses poses the mascot has", () => {
    for (const phase of ["thinking", "writing"] as const) {
      for (const seed of [0, 3, 41, 999]) {
        const poses = Array.from({ length: 30 }, (_, step) => workingMood(phase, step * WORDS_EVERY_S, seed));
        for (const pose of poses) expect(ADCODE_MASCOT_MOODS).toContain(pose);
        for (let step = 1; step < poses.length; step += 1) expect(poses[step]).not.toBe(poses[step - 1]);
        // The same pose for the whole of one word: it changes when the word does, not between.
        expect(workingMood(phase, WORDS_EVERY_S * 2 + 0.5, seed)).toBe(workingMood(phase, WORDS_EVERY_S * 2 + 2.9, seed));
      }
    }
    // Writing is mostly typing; thinking is everything else.
    const writing = Array.from({ length: 12 }, (_, step) => workingMood("writing", step * WORDS_EVERY_S, 0));
    expect(writing.filter((pose) => pose === "working").length).toBeGreaterThanOrEqual(5);
    const thinking = new Set(Array.from({ length: 14 }, (_, step) => workingMood("thinking", step * WORDS_EVERY_S, 0)));
    expect(thinking.size).toBeGreaterThanOrEqual(5);
  });
});
