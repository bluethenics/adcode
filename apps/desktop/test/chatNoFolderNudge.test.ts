/*
 * No folder open: file tools stop with one exact message, and the chat turns that
 * message into a way forward instead of a bare failure line. Issue bluethenics/adcode#11.
 *
 * The text lives in one shared constant so the main process and the chat cannot
 * paraphrase each other - these checks fail if either side rewords it, or if either
 * of the two routes the block arrives by stops offering the card.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NO_FOLDER_BLOCKER } from "../src/shared/workspaceBlockers.ts";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const chat = read("../src/renderer/ai/chatWidget.ts");
const main = read("../src/main/ai.ts");
const tools = read("../src/main/aiTools.ts");
const shell = read("../src/renderer/main.ts");
const styles = read("../src/renderer/styles/ai.css");

const card = chat.slice(
  chat.indexOf("function noFolderNudge"),
  chat.indexOf("function paintWorkingStatus"),
);

describe("a file tool blocked by no open folder", () => {
  it("keeps one exact message in one shared constant both processes import", () => {
    expect(NO_FOLDER_BLOCKER).toBe("Open a folder before using AI file tools.");
    expect(main).toContain('import { NO_FOLDER_BLOCKER } from "../shared/workspaceBlockers.ts";');
    expect(tools).toContain('import { NO_FOLDER_BLOCKER } from "../shared/workspaceBlockers.ts";');
    // The old paraphrases are gone, so nobody can reword one side and leave the chat blind.
    expect(main).not.toContain('?? "No folder is open, so there is nothing to work on yet."');
    expect(main).not.toContain('throw new Error("No folder is open');
    expect(tools).not.toContain('?? "No folder is open, so there is nothing to work on yet."');
  });

  it("offers the way out on both routes the block arrives by", () => {
    // The failed tool result arrives before any error event...
    expect(chat).toContain('event["content"].includes(NO_FOLDER_BLOCKER)');
    // ...and the turn's own error, when nothing else could run.
    expect(chat).toContain("detail.includes(NO_FOLDER_BLOCKER)");
    expect(chat).toContain("noFolderNudge();");
    // One card rather than one per route: deduped like every other nudge.
    expect(card).toContain('last.dataset["nudge"] === "folder"');
  });

  it("offers opening a folder, making one, and keeping the turn going without file tools", () => {
    expect(card).toContain('choice("Open a folder..."');
    expect(card).toContain("deps.switchFolder?.()");
    expect(card).toContain('choice("New project"');
    expect(card).toContain('choice("Answer anyway"');
    // The choices reuse the nudge row and buttons every other card already wears.
    expect(card).toContain('row.className = "chat-nudge-row"');
    expect(card).toContain('"chat-send chat-nudge-action"');
    expect(styles).toContain(".chat-nudge-action");
  });

  it("sends the held message itself once a folder opens, and never when the picker is cancelled", () => {
    expect(chat).toContain("pendingFolderPrompt = lastUserPrompt");
    const autoSendAt = chat.indexOf("pendingFolderPrompt !== null");
    expect(autoSendAt).toBeGreaterThan(-1);
    const autoSend = chat.slice(autoSendAt - 400, autoSendAt + 400);
    // Only a folder actually opening reaches this branch: it sits in setWorkspace's
    // root !== null arm, never in the null arm the cancelled picker leaves behind.
    expect(autoSend).toContain("void refreshTeam();");
    expect(autoSend).toContain("void resend(waiting)");
    // ...and only if nobody has typed or sent something else since.
    expect(autoSend).toContain("input.value.trim().length === 0");
    expect(autoSend).toContain("lastUserPrompt.trim() === waiting");
    // Cancelling the folder picker never sends: setWorkspace is not called for a cancel.
    expect(shell).toContain("switchFolder: () => { void openFolder(); }");
  });
});