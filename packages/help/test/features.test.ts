import { describe, expect, it } from "vitest";
import { getSetting } from "@adcode/settings";
import {
  FEATURE_COMMANDS,
  featureFor,
  featureRecords,
  searchFeatures,
} from "@adcode/help";

describe("feature catalogue", () => {
  it("gives every feature a unique id, complete explanation, and access route", () => {
    const records = featureRecords();
    const ids = records.map((feature) => feature.entry.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const feature of records) {
      expect(feature.entry.plain.trim(), feature.entry.id).not.toBe("");
      expect(feature.entry.why.trim(), feature.entry.id).not.toBe("");
      expect(feature.entry.how.trim(), feature.entry.id).not.toBe("");
      expect(feature.actions.length, feature.entry.id).toBeGreaterThan(0);
    }
  });

  it("points setting actions only at settings that exist", () => {
    const phantom = featureRecords().flatMap((feature) =>
      feature.actions
        .filter((action) => action.kind === "setting")
        .filter((action) => getSetting(action.settingId) === undefined)
        .map((action) => `${feature.entry.id} -> ${action.settingId}`),
    );

    expect(phantom).toEqual([]);
  });

  it("catalogues the new discovery and safe AI entry points", () => {
    expect(featureFor("workbench.allFeatures")?.actions[0]).toEqual({
      kind: "command",
      command: "features.open",
      label: "Open",
    });
    expect(featureFor("workbench.universalSearch")?.actions[0]).toEqual({
      kind: "command",
      command: "search.universal",
      label: "Search",
    });
    expect(featureFor("ai.team")?.actions[0]).toEqual({
      kind: "command",
      command: "ai.team",
      label: "Set up Team",
    });
    expect(featureFor("adcode.ai.scheduledMessages")?.actions[0]).toEqual({
      kind: "command",
      command: "ai.schedule",
      label: "Schedule",
    });
  });

  it("preserves catalogue order when the query is empty", () => {
    expect(searchFeatures("   ").map((feature) => feature.entry.id)).toEqual(
      featureRecords().map((feature) => feature.entry.id),
    );
  });

  it("finds features from plain goals and access words", () => {
    expect(searchFeatures("send something to ai later")[0]?.entry.id).toBe(
      "adcode.ai.scheduledMessages",
    );
    expect(searchFeatures("everything adcode can do")[0]?.entry.id).toBe(
      "workbench.allFeatures",
    );
    expect(searchFeatures("separate safe copy").map((feature) => feature.entry.id)).toContain(
      "adcode.ai.isolatedWorkspaces",
    );
  });

  it("classifies every declared command exactly once", () => {
    const direct = featureRecords().flatMap((feature) =>
      feature.actions
        .filter((action) => action.kind === "command")
        .map((action) => action.command),
    );
    const child = Object.values(FEATURE_COMMANDS.children).flat();
    const classified = [...direct, ...child, ...FEATURE_COMMANDS.plumbing];

    expect(new Set(classified).size).toBe(classified.length);
    expect(FEATURE_COMMANDS.children["workbench.preview"]).toContain("preview.reload");
    expect(FEATURE_COMMANDS.children["adcode.git.stageCommitUi"]).toContain("git.commit");
  });
});
