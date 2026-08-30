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
    const classified = [...direct, ...FEATURE_COMMANDS.plumbing];

    expect(new Set(classified).size).toBe(classified.length);
    expect(FEATURE_COMMANDS.children["workbench.preview"]).toContain("preview.reload");
    expect(FEATURE_COMMANDS.children["adcode.git.stageCommitUi"]).toContain("git.commit");
  });

  /*
   * The regression this whole change exists for.
   *
   * `git.commit` and ten more were declared in `FEATURE_COMMANDS.children` and read by
   * nothing but a coverage test, so "Stage, unstage, and commit" offered one route: open
   * the settings row. Folding the children in is what turns a catalogue of switches back
   * into a catalogue of things you can do.
   */
  it("offers a feature's own commands rather than only its settings row", () => {
    const commit = featureFor("adcode.git.stageCommitUi");

    expect(commit?.actions[0]).toEqual({
      kind: "command",
      command: "git.commit",
      label: "Commit",
    });
    expect(
      commit?.actions.filter((action) => action.kind === "command").map((one) => one.command),
    ).toContain("git.push");
  });

  it("lets a switch be flipped where it is found, not only in Settings", () => {
    const minimap = featureFor("adcode.editing.minimap");

    expect(minimap?.actions[0]).toEqual({
      kind: "toggle",
      settingId: "adcode.editing.minimap",
      label: "Turn on or off",
    });
  });

  it("never leaves a settings deep-link as the only way into a feature that acts", () => {
    const settingsOnly = featureRecords()
      .filter((feature) => feature.actions.every((action) => action.kind === "setting"))
      .map((feature) => feature.entry.id)
      .sort();

    // Enum settings are the honest exception: picking "compact" or "cosy" is a choice from
    // a list, and a catalogue row cannot make it for you. Sorted, so reordering the
    // catalogue does not fail a test about what is in it.
    expect(settingsOnly).toEqual([
      "adcode.ads.frequency",
      "adcode.ai.customBaseUrl",
      "adcode.ai.editPolicy",
      "adcode.ai.model",
      "adcode.ai.provider",
      "adcode.ai.taskTokenBudget",
      "adcode.appearance.density",
      "adcode.appearance.theme",
      "adcode.language.customServers",
      "ai.workspaceStorage",
    ]);
  });

  it("keeps a toggle behind a command, and the settings row behind both", () => {
    const kinds = featureFor("adcode.git.mergeConflict")?.actions.map((action) => action.kind);

    expect(kinds).toEqual(["command", "toggle", "setting"]);
  });
});
