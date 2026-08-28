import { describe, expect, it } from "vitest";

import {
  buildFileChoices,
  buildLocationCrumbs,
  buildSymbolChoices,
  filterBreadcrumbChoices,
} from "../src/renderer/editor/breadcrumbModel.ts";

describe("interactive breadcrumb model", () => {
  it("builds a workspace-to-file trail with absolute targets", () => {
    expect(
      buildLocationCrumbs("C:\\code\\adcode", "C:\\code\\adcode\\src\\editor\\main.ts"),
    ).toEqual([
      { kind: "workspace", label: "adcode", path: "C:\\code\\adcode" },
      { kind: "directory", label: "src", path: "C:\\code\\adcode\\src" },
      { kind: "directory", label: "editor", path: "C:\\code\\adcode\\src\\editor" },
      { kind: "file", label: "main.ts", path: "C:\\code\\adcode\\src\\editor\\main.ts" },
    ]);
  });

  it("falls back to one honest absolute file crumb outside the workspace", () => {
    expect(buildLocationCrumbs("C:\\code\\adcode", "D:\\notes\\todo.md")).toEqual([
      { kind: "file", label: "todo.md", path: "D:\\notes\\todo.md" },
    ]);
  });

  it("groups sibling files before deduplicated recent files", () => {
    expect(
      buildFileChoices(
        "C:\\code\\src\\main.ts",
        [
          { name: "parts", path: "C:\\code\\src\\parts", isDirectory: true },
          { name: "main.ts", path: "C:\\code\\src\\main.ts", isDirectory: false },
          { name: "other.ts", path: "C:\\code\\src\\other.ts", isDirectory: false },
        ],
        ["C:\\code\\README.md", "C:\\code\\src\\other.ts"],
      ),
    ).toEqual([
      { kind: "file", group: "In this folder", label: "other.ts", path: "C:\\code\\src\\other.ts" },
      { kind: "file", group: "Recent", label: "README.md", path: "C:\\code\\README.md" },
    ]);
  });

  it("flattens nearby and nested symbols without losing their depth", () => {
    expect(
      buildSymbolChoices([
        {
          name: "Editor",
          kind: "class",
          line: 2,
          endLine: 20,
          children: [
            { name: "open", kind: "method", line: 5, endLine: 8, children: [] },
          ],
        },
        { name: "boot", kind: "function", line: 24, endLine: 28, children: [] },
      ]),
    ).toEqual([
      { kind: "symbol", depth: 0, label: "Editor", detail: "class · line 2", line: 2 },
      { kind: "symbol", depth: 1, label: "open", detail: "method · line 5", line: 5 },
      { kind: "symbol", depth: 0, label: "boot", detail: "function · line 24", line: 24 },
    ]);
  });

  it("filters with subsequence matching across labels and details", () => {
    const choices = [
      { kind: "file" as const, group: "Recent", label: "automationHost.ts", path: "/src/automationHost.ts" },
      { kind: "file" as const, group: "Recent", label: "chatWidget.ts", path: "/src/chatWidget.ts" },
    ];

    expect(filterBreadcrumbChoices(choices, "ath").map((choice) => choice.label)).toEqual([
      "automationHost.ts",
    ]);
    expect(filterBreadcrumbChoices(choices, "recent")).toEqual(choices);
  });
});
