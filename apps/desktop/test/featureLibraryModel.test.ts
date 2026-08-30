import { describe, expect, it } from "vitest";
import { featureFor, featureRecords } from "@adcode/help";
import {
  featureActionPresentation,
  featureLibraryCategories,
  filterFeatureLibrary,
  moveFeatureSelection,
} from "../src/renderer/features/featureLibraryModel.ts";

describe("feature library model", () => {
  it("lists All first and keeps catalogue group order", () => {
    expect(featureLibraryCategories(featureRecords()).slice(0, 5)).toEqual([
      "all",
      "ads",
      "appearance",
      "editing",
      "formatting",
    ]);
    expect(featureLibraryCategories(featureRecords())).toContain("workbench");
    expect(featureLibraryCategories(featureRecords())).toContain("ai");
  });

  it("filters one category or searches every category", () => {
    expect(
      filterFeatureLibrary(featureRecords(), { category: "ai", query: "" }).every(
        (feature) => feature.entry.group === "ai",
      ),
    ).toBe(true);

    expect(
      filterFeatureLibrary(featureRecords(), {
        category: "editing",
        query: "send something to ai later",
      })[0]?.entry.id,
    ).toBe("adcode.ai.scheduledMessages");
  });

  it("chooses the first available action and preserves secondary routes", () => {
    const scheduled = featureFor("adcode.ai.scheduledMessages")!;
    const presentation = featureActionPresentation(
      scheduled,
      (command) => command === "ai.schedule",
    );

    expect(presentation.primary?.action).toEqual({
      kind: "command",
      command: "ai.schedule",
      label: "Schedule",
    });
    expect(presentation.secondary.map((item) => item.action.kind)).toEqual([
      "toggle",
      "setting",
    ]);
    expect(presentation.disabledReason).toBeNull();
  });

  /*
   * The complaint that started this: choosing "Merge conflict resolution" offered one
   * route, and it was the switch. The command has to come first, or the catalogue is a
   * settings screen with extra steps.
   */
  it("offers the command before the switch for a feature that acts", () => {
    const conflicts = featureFor("adcode.git.mergeConflict")!;
    const presentation = featureActionPresentation(conflicts, () => true);

    expect(presentation.primary?.action).toEqual({
      kind: "command",
      command: "git.conflicts",
      label: "Check for conflicts",
    });
  });

  it("says which way a switch will go, when it knows where the switch is", () => {
    const minimap = featureFor("adcode.editing.minimap")!;

    expect(featureActionPresentation(minimap, () => true, () => true).primary?.label).toBe(
      "Turn off",
    );
    expect(featureActionPresentation(minimap, () => true, () => false).primary?.label).toBe(
      "Turn on",
    );
  });

  it("keeps the catalogue's own wording when no value is to hand", () => {
    const minimap = featureFor("adcode.editing.minimap")!;

    expect(featureActionPresentation(minimap, () => true).primary?.label).toBe("Turn on or off");
  });

  it("falls back to the switch when the command is not available in this window", () => {
    const conflicts = featureFor("adcode.git.mergeConflict")!;
    const presentation = featureActionPresentation(conflicts, () => false);

    expect(presentation.primary?.action.kind).toBe("toggle");
    expect(presentation.disabledReason).toBeNull();
  });

  it("explains when no command action is currently available", () => {
    const feature = featureFor("workbench.allFeatures")!;
    const presentation = featureActionPresentation(feature, () => false);

    expect(presentation.primary?.enabled).toBe(false);
    expect(presentation.disabledReason).toBe("This feature is not available in this window.");
  });

  it("clamps keyboard selection without losing the nearest row", () => {
    expect(moveFeatureSelection(-1, 1, 3)).toBe(0);
    expect(moveFeatureSelection(0, -1, 3)).toBe(0);
    expect(moveFeatureSelection(1, 1, 3)).toBe(2);
    expect(moveFeatureSelection(2, 1, 3)).toBe(2);
    expect(moveFeatureSelection(2, 1, 0)).toBe(-1);
  });
});
