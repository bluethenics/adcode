import { describe, expect, it } from "vitest";
import { acpPermission, cliArgs, cliLiveArgs, codexThreadParams, forkChatSession, latestPictures, sideChatNote, validateSession, type ChatSession } from "../src/index.ts";

const parent: ChatSession = {
  id: "main-1",
  title: "Build the login page",
  renamed: true,
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { role: "user", text: "Build the login page", at: 1 },
    { role: "assistant", text: "Working on it - editing src/login.tsx", at: 2 },
  ],
};

describe("a /btw side chat", () => {
  it("is a fork marked as a side chat, and stays one after saving and loading", () => {
    const side = forkChatSession({ parent, id: "side-1", title: "Side: why SQLite?", at: 10, side: true });
    expect(side).toMatchObject({ side: true, parentId: "main-1", messages: parent.messages });
    expect(forkChatSession({ parent, id: "fork-1", title: "Docs", at: 10 })).not.toHaveProperty("side");
    expect(validateSession(JSON.parse(JSON.stringify(side)))?.side).toBe(true);
    // A conversation that is not a copy of another cannot be a side chat.
    expect(validateSession({ ...parent, side: true })).not.toHaveProperty("side");
  });

  it("is told to answer, not to carry on the main chat's work, and that its tools are read-only", () => {
    const note = sideChatNote({ parentTitle: "Build the login page" });
    expect(note).toContain('a copy of "Build the login page", which is still doing that work in its own chat');
    expect(note).toContain("do not continue, redo or take over the main chat's task");
    expect(note).toContain("do not edit files");
    expect(note).toContain("Your tools here are read-only");
    expect(note).not.toMatch(/picture/);
    expect(note).not.toMatch(/report/i);
    expect(sideChatNote({ parentTitle: "x", pictures: 1 })).toContain("The latest picture from the main chat is attached");
    expect(sideChatNote({ parentTitle: "x", pictures: 3 })).toContain("The latest 3 pictures from the main chat are attached");
  });

  it("takes the main chat's newest pictures, in order, only from the person's messages", () => {
    const picture = (data: string) => ({ type: "image", mediaType: "image/png", data });
    const text = (words: string) => ({ type: "text", text: words });
    const history = [
      { role: "user", content: [text("first"), picture("a")] },
      { role: "assistant", content: [text("ok")] },
      { role: "user", content: [picture("b"), picture("c"), text("two more")] },
      { role: "tool", content: [picture("from-a-tool")] },
      { role: "user", content: [picture("d")] },
    ];
    expect(latestPictures(history, 3).map((block) => (block as { data: string }).data)).toEqual(["b", "c", "d"]);
    expect(latestPictures(history, 10).map((block) => (block as { data: string }).data)).toEqual(["a", "b", "c", "d"]);
    expect(latestPictures([{ role: "user", content: [text("no pictures")] }], 4)).toEqual([]);
  });
});

describe("coding CLIs in a side chat", () => {
  it("runs Claude Code in plan mode, even with Full access on, and still routes its questions to ADCode", () => {
    expect(cliArgs("claude", { model: "default", readOnly: true })).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "plan"]);
    expect(cliArgs("claude", { model: "default", readOnly: true, bypassPermissions: true })).not.toContain("--dangerously-skip-permissions");
    expect(cliLiveArgs("claude", { model: "default", readOnly: true, bypassPermissions: true })).toContain("--permission-prompt-tool");
    expect(cliArgs("claude", { model: "default" })).toContain("acceptEdits");
  });

  it("gives Codex a read-only sandbox", () => {
    expect(cliArgs("codex", { model: "default", readOnly: true })).toEqual(expect.arrayContaining(["--sandbox", "read-only"]));
    expect(cliArgs("codex", { model: "default", readOnly: true, bypassPermissions: true })).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(codexThreadParams({ cwd: "/p", model: "default", bypass: true, readOnly: true })).toMatchObject({ sandbox: "read-only", approvalPolicy: "on-request" });
    expect(codexThreadParams({ cwd: "/p", model: "default", bypass: false })).toMatchObject({ sandbox: "workspace-write" });
  });

  it("lets an ACP agent such as OpenCode read and search, and refuses edits and commands, Full access or not", () => {
    const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }];
    expect(acpPermission({ toolCall: { kind: "read", title: "src/a.ts" }, options }, false, true)).toEqual({ optionId: "yes", denied: null });
    expect(acpPermission({ toolCall: { kind: "search", title: "login" }, options }, true, true)).toEqual({ optionId: "yes", denied: null });
    expect(acpPermission({ toolCall: { kind: "edit", title: "src/a.ts" }, options }, true, true)).toEqual({ optionId: "no", denied: { tool: "edit", detail: "src/a.ts" } });
    expect(acpPermission({ toolCall: { kind: "execute", title: "npm test" }, options }, false, true)).toEqual({ optionId: "no", denied: { tool: "execute", detail: "npm test" } });
    // Outside a side chat nothing changes: edits are still allowed.
    expect(acpPermission({ toolCall: { kind: "edit", title: "src/a.ts" }, options }, false)).toEqual({ optionId: "yes", denied: null });
  });
});
