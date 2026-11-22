import { describe, expect, it } from "vitest";
import { shouldSeedStarters } from "../src/renderer/agents/starterAgents.ts";

const state = (over: Partial<Parameters<typeof shouldSeedStarters>[0]>) => ({ agents: 0, emptied: false, offeredBefore: false, web: false, ...over });

describe("starter agents", () => {
  it("are added to a list nobody has touched", () => {
    expect(shouldSeedStarters(state({}))).toBe(true);
    expect(shouldSeedStarters(state({ web: true }))).toBe(true);
  });

  it("never join a list that has agents", () => {
    expect(shouldSeedStarters(state({ agents: 1 }))).toBe(false);
    expect(shouldSeedStarters(state({ agents: 5, web: true }))).toBe(false);
  });

  it("stay away once the person emptied the list themselves", () => {
    expect(shouldSeedStarters(state({ emptied: true }))).toBe(false);
    expect(shouldSeedStarters(state({ emptied: true, web: true }))).toBe(false);
  });

  /*
   * 22 Nov 2026: on the web the old "offered" note reached localStorage at once while the list
   * reached IndexedDB a moment later, so a reload in between left the note and lost the agents.
   */
  it("come back on the web when only the old offered note survived a lost save", () => {
    expect(shouldSeedStarters(state({ offeredBefore: true, web: true }))).toBe(true);
  });

  it("keep the old note's meaning on the desktop, where the list was saved before it", () => {
    expect(shouldSeedStarters(state({ offeredBefore: true }))).toBe(false);
  });
});
