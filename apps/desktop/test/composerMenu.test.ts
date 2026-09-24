import { describe, expect, it } from "vitest";
import {
  SLASH_COMMANDS,
  contextChipName,
  matchSlashCommands,
  menuTriggerAt,
  rememberPrompt,
  replaceTrigger,
} from "../src/renderer/ai/composerMenu.ts";

describe("menuTriggerAt", () => {
  it("opens slash only as the very first character", () => {
    expect(menuTriggerAt("/re", 3)).toEqual({ kind: "slash", start: 0, query: "re" });
    expect(menuTriggerAt("/", 1)).toEqual({ kind: "slash", start: 0, query: "" });
    expect(menuTriggerAt("fix /re", 7)).toBeNull();
    expect(menuTriggerAt("src/app", 7)).toBeNull();
  });

  it("opens mentions at the start or after whitespace, never inside words", () => {
    expect(menuTriggerAt("@src", 4)).toEqual({ kind: "mention", start: 0, query: "src" });
    expect(menuTriggerAt("read @src/ap", 12)).toEqual({ kind: "mention", start: 5, query: "src/ap" });
    expect(menuTriggerAt("me@example.com", 14)).toBeNull();
    expect(menuTriggerAt("no trigger here", 15)).toBeNull();
  });
});

describe("matchSlashCommands", () => {
  it("lists everything on an empty query", () => {
    expect(matchSlashCommands("")).toHaveLength(SLASH_COMMANDS.length);
  });

  it("ranks prefix matches before substring matches", () => {
    expect(matchSlashCommands("re").map((command) => command.id)).toEqual([
      "review",
      "refactor",
      "build",
      "preview",
    ]);
  });

  it("matches hints as well as ids", () => {
    expect(matchSlashCommands("commit message").map((command) => command.id)).toContain("commit");
  });
});

describe("replaceTrigger", () => {
  it("swaps the trigger span for the insert and lands the caret after it", () => {
    expect(replaceTrigger("/re", 3, { kind: "slash", start: 0, query: "re" }, "")).toEqual({
      text: "",
      caret: 0,
    });
    expect(
      replaceTrigger("read @src/ap", 12, { kind: "mention", start: 5, query: "src/ap" }, "@src/app.ts "),
    ).toEqual({ text: "read @src/app.ts ", caret: 17 });
  });
});

describe("contextChipName", () => {
  it("names file slices like an editor status bar", () => {
    expect(contextChipName("src/app.ts")).toBe("app.ts");
    expect(contextChipName("src/app.ts", 12, 12)).toBe("app.ts:12");
    expect(contextChipName("src/app.ts", 12, 40)).toBe("app.ts:12-40");
  });
});

describe("rememberPrompt", () => {
  it("bounds history and drops consecutive duplicates", () => {
    expect(rememberPrompt(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(rememberPrompt(["a"], "b")).toEqual(["a", "b"]);
    expect(rememberPrompt([], "   ")).toEqual([]);
    expect(rememberPrompt(["a", "b", "c"], "d", 2)).toEqual(["c", "d"]);
  });
});
