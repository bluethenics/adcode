import { describe, expect, it } from "vitest";
import { featureFor, featureRecords } from "@adcode/help";
import {
  commandUniversalItems,
  featureUniversalItems,
  fileUniversalItems,
  recentUniversalItems,
  symbolUniversalItems,
} from "../src/renderer/workbench/universalSearchModel.ts";
import { findWorkspaceSymbols } from "../src/renderer/panels/workspaceSymbols.ts";

describe("desktop universal result mapping", () => {
  it("maps every feature once and keeps its explanation attached", () => {
    const mapped = featureUniversalItems(featureRecords());

    expect(mapped).toHaveLength(featureRecords().length);
    expect(new Set(mapped.map((item) => item.id)).size).toBe(mapped.length);
    expect(mapped.find((item) => item.id === "feature:adcode.ai.scheduledMessages")).toMatchObject({
      kind: "feature",
      title: "Scheduled AI messages",
      helpId: "adcode.ai.scheduledMessages",
      action: { kind: "feature", featureId: "adcode.ai.scheduledMessages" },
    });
    expect(mapped.some((item) => item.kind === "setting")).toBe(false);
    expect(featureFor(mapped[0]!.helpId!)).toBeDefined();
  });

  it("maps every public registry command without losing its id", () => {
    const mapped = commandUniversalItems([
      { id: "ai.toggle", title: "Assistant" },
      { id: "features.open", title: "All Features" },
    ]);

    expect(mapped.map((item) => item.id)).toEqual([
      "command:ai.toggle",
      "command:features.open",
    ]);
    expect(mapped[0]?.action).toEqual({ kind: "command", command: "ai.toggle" });
  });

  it("keeps filename, path, and symbol location distinct", () => {
    expect(fileUniversalItems([{ path: "src/editor/main.ts", positions: [0] }])[0]).toMatchObject({
      id: "file:src/editor/main.ts",
      kind: "file",
      title: "main.ts",
      detail: "src/editor/main.ts",
      action: { kind: "file", path: "src/editor/main.ts" },
    });
    expect(
      symbolUniversalItems([
        { kind: "function", name: "openFile", path: "src/main.ts", line: 42, column: 3 },
      ])[0],
    ).toMatchObject({
      id: "symbol:src/main.ts:42:3:openFile",
      kind: "symbol",
      title: "openFile",
      detail: "function · src/main.ts:42",
    });
  });

  it("reuses one declaration parser for focused and universal symbol search", () => {
    const found = findWorkspaceSymbols(
      [
        { path: "src/main.ts", line: 4, column: 9, text: "export function openFile() {}" },
        { path: "src/main.ts", line: 8, column: 3, text: "openFile();" },
      ],
      "open",
      () => "typescript",
    );

    expect(found).toMatchObject([
      { kind: "function", name: "openFile", path: "src/main.ts", line: 4 },
    ]);
  });

  it("opens recents only through the validated recent-folder command", () => {
    expect(
      recentUniversalItems([{ path: "E:/work/site", name: "site", openedAt: 10 }])[0],
    ).toMatchObject({
      id: "recent:E:/work/site",
      kind: "recent",
      title: "site",
      detail: "E:/work/site",
      action: {
        kind: "command",
        command: "workspace.openRecentAt",
        arg: "E:/work/site",
      },
    });
  });
});
