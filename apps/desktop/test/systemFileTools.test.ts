/*
 * "Work without an open folder" (adcode.ai.systemFileTools): opt-in scope for file
 * tools with no project folder open - the home folder. Issue bluethenics/adcode#11.
 *
 * Source-regex checks, the same style as chatNoFolderNudge.test.ts: these are the
 * gates that must exist in main, and they fail if anyone makes the mode wider than
 * the home folder, blocks it silently, or puts review mode in front of it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTINGS_SCHEMA } from "@adcode/settings";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const main = read("../src/main/ai.ts");
const guarded = read("../src/main/adcodeAppTools.ts");
const agent = read("../../../packages/ai/src/agent.ts");
const settingsSchema = read("../../../packages/settings/src/index.ts");

const setting = SETTINGS_SCHEMA.find((item) => item.id === "adcode.ai.systemFileTools");

describe("adcode.ai.systemFileTools", () => {
  it("exists, is a boolean, and defaults to off", () => {
    expect(setting).toBeDefined();
    expect(setting?.kind).toBe("boolean");
    expect(setting?.default).toBe(false);
    expect(setting?.available).toBe(true);
  });

  it("is guarded against agent-driven changes", () => {
    expect(guarded).toContain('"adcode.ai.systemFileTools"');
  });

  it("resolves its scope to the home folder, and only while the setting is on", () => {
    // The one helper every gate reads; scope is never widened without it.
    expect(main).toContain("function toolScopeFallback(): string | null");
    expect(main).toContain('currentSettings()["adcode.ai.systemFileTools"] === true ? homedir() : null');
    // A project folder always wins: the fallback is never consulted as a scope override.
    expect(main).toContain('if (currentWorkspace()?.root !== undefined) return null;');
    expect(main).toContain("currentWorkspace()?.root ?? toolScopeFallback()");
    // Every former no-folder site now goes through it.
    const sites = main.split("currentWorkspace()?.root ?? toolScopeFallback()").length - 1;
    expect(sites).toBeGreaterThanOrEqual(4);
    // No bare null scope left on a file-tool path.
    expect(main).not.toContain('currentWorkspace()?.root ?? null;\n      if (human === null) throw');
  });

  it("keeps the no-folder blocker for when the mode is off", () => {
    expect(main).toContain("taskWorkspaceUnavailableReason = NO_FOLDER_BLOCKER;");
    // The blocker still exists in both resolve paths, so the off case is unchanged.
    const occurrences = main.split("taskWorkspaceUnavailableReason = NO_FOLDER_BLOCKER;").length - 1;
    expect(occurrences).toBe(2);
  });

  it("refuses review mode without a folder instead of staging the home folder", () => {
    expect(main).toContain("Review every change needs an open project folder");
    // Guard precedes staging: reviewWorkspace is only reachable with a project folder.
    const guardAt = main.indexOf("Review every change needs an open project folder");
    const stageAt = main.indexOf("return reviewWorkspace(human);");
    expect(guardAt).toBeGreaterThan(-1);
    expect(stageAt).toBeGreaterThan(guardAt);
  });

  it("tells the chat the system scope instead of asking for a folder", () => {
    expect(main).toContain("aiWorkspaceContext(scopeRoot, blocker, thread.editorContext, configuredEditPolicy() === \"review\" ? \"review\" : \"direct\", noFolder && scopeRoot !== null)");
    // The default system prompt defers to the workspace context's scope.
    expect(agent).not.toContain("If no folder is open, ask the user to open one in ADCode, not to paste a path.");
    expect(agent).toContain("follow it instead of asking the user to open a folder or paste a path.");
    // The schema describes the mode honestly, home folder included.
    expect(settingsSchema).toContain('"adcode.ai.systemFileTools"');
    expect(settingsSchema).toContain("your home folder");
  });

  it("extends unsaved-draft protection to the scope root", () => {
    expect(main).toContain("if (workspaceHasUnsavedDraft(scopeRoot, drafts))");
    expect(main).toContain("summarizeUnsavedDrafts(scopeRoot, drafts)");
  });
});