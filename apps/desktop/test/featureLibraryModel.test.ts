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
    expect(presentation.secondary.map((item) => item.action.kind)).toEqual(["setting"]);
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
