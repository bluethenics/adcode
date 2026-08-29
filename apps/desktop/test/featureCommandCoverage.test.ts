import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_COMMANDS, featureRecords } from "@adcode/help";

const MAIN = readFileSync(join(import.meta.dirname, "../src/renderer/main.ts"), "utf8");

const REGISTERED = new Set(
  [...MAIN.matchAll(/(?:\badd|commands\.registerEditorAction)\("([^"]+)"/g)].map(
    (match) => match[1]!,
  ),
);

const DIRECT = featureRecords().flatMap((feature) =>
  feature.actions
    .filter((action) => action.kind === "command")
    .map((action) => action.command),
);

describe("feature command coverage", () => {
  it("registers every command used by a feature action", () => {
    expect(DIRECT.filter((command) => !REGISTERED.has(command))).toEqual([]);
  });

  it("classifies every public renderer command as direct, child, or plumbing", () => {
    const classified = new Set([
      ...DIRECT,
      ...Object.values(FEATURE_COMMANDS.children).flat(),
      ...FEATURE_COMMANDS.plumbing,
    ]);

    expect([...REGISTERED].filter((command) => !classified.has(command)).sort()).toEqual([]);
  });

  it("does not classify commands the renderer does not register", () => {
    const classified = [
      ...DIRECT,
      ...Object.values(FEATURE_COMMANDS.children).flat(),
      ...FEATURE_COMMANDS.plumbing,
    ];

    expect(classified.filter((command) => !REGISTERED.has(command))).toEqual([]);
  });
});
