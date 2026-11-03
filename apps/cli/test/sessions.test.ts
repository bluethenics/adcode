import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  deleteSession,
  exportSession,
  isSessionId,
  latestSession,
  listSessions,
  parseSession,
  readSession,
  renameSession,
  saveSession,
  withMessage,
} from "../src/ai/sessions.ts";
import { removeDir, tempDir } from "./helpers.ts";

let dataDir = "";
let previous: string | undefined;

beforeEach(() => {
  previous = process.env["ADCODE_CLI_DATA_DIR"];
  dataDir = tempDir();
  process.env["ADCODE_CLI_DATA_DIR"] = dataDir;
});

afterEach(() => {
  if (previous === undefined) delete process.env["ADCODE_CLI_DATA_DIR"];
  else process.env["ADCODE_CLI_DATA_DIR"] = previous;
  removeDir(dataDir);
});

describe("session ids", () => {
  it("accepts the generated shape and rejects traversal or arbitrary names", () => {
    const session = createSession("tagflow", "test-default");
    expect(isSessionId(session.id)).toBe(true);
    expect(isSessionId("../identity")).toBe(false);
    expect(isSessionId("s-short")).toBe(false);
    expect(isSessionId("s-abc/def-123456")).toBe(false);
  });
});

describe("saving a conversation", () => {
  it("writes one file, reads it back, and titles it from the first question", () => {
    const created = createSession("tagflow", "test-default");
    const first = withMessage(created, { role: "user", text: "How do I add a health check?", at: 1_000 });
    const saved = saveSession(first);

    expect(saved.title).toBe("How do I add a health check?");
    const loaded = readSession(saved.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.provider).toBe("tagflow");
    expect(loaded?.model).toBe("test-default");

    const second = withMessage(saved, {
      role: "assistant",
      text: "Add the route and a test.",
      at: 2_000,
      provider: "tagflow",
      model: "test-default",
      thinking: "The route belongs beside the existing handlers.",
      thinkingMs: 2_400,
    });
    saveSession(second);
    expect(readSession(saved.id)?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(readSession(saved.id)?.messages[1]?.thinking).toBe("The route belongs beside the existing handlers.");
    expect(readSession(saved.id)?.messages[1]?.thinkingMs).toBe(2_400);
  });

  it("lists newest first and picks the latest", () => {
    const older = saveSession({
      ...withMessage(createSession(), { role: "user", text: "older", at: 1_000 }),
      updatedAt: 1_000,
    });
    const newer = saveSession({
      ...withMessage(createSession(), { role: "user", text: "newer", at: 2_000 }),
      updatedAt: 2_000,
    });
    expect(listSessions().map((session) => session.id)).toEqual([newer.id, older.id]);
    expect(latestSession()?.id).toBe(newer.id);
  });

  it("renames without losing the transcript, and deletes exactly one file", () => {
    const session = saveSession(withMessage(createSession(), { role: "user", text: "hello", at: 1_000 }));
    const renamed = renameSession(session.id, "  A better title  ");
    expect(renamed?.title).toBe("A better title");
    expect(renamed?.messages).toHaveLength(1);

    expect(deleteSession(session.id)).toBe(true);
    expect(readSession(session.id)).toBeNull();
    expect(deleteSession(session.id)).toBe(false);
    expect(deleteSession("../identity")).toBe(false);
  });

  it("exports a Markdown transcript", () => {
    const session = saveSession(
      withMessage(
        withMessage(createSession(), { role: "user", text: "Question", at: 1_000 }),
        { role: "assistant", text: "Answer", at: 2_000 },
      ),
    );
    const markdown = exportSession(session.id);
    expect(markdown).toContain("# Question");
    expect(markdown).toContain("## You");
    expect(markdown).toContain("## ADCode");
    expect(markdown).toContain("Answer");
    expect(exportSession("s-not-a-real-session")).toBeNull();
  });
});

describe("parsing an untrusted session file", () => {
  it("rejects a file whose id is not a session id", () => {
    expect(parseSession({ id: "../identity", messages: [] })).toBeNull();
  });

  it("drops malformed messages and supplies safe defaults", () => {
    const parsed = parseSession({
      id: "s-abc123-def456",
      messages: [
        { role: "user", text: "kept", at: 5 },
        { role: "system", text: "dropped", at: 5 },
        { role: "assistant", text: 42, at: 5 },
        { role: "assistant", text: "no timestamp" },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.messages).toEqual([{ role: "user", text: "kept", at: 5 }]);
    expect(parsed?.title).toBe("New conversation");
    expect(parsed?.provider).toBeNull();
    expect(parsed?.model).toBeNull();
  });
});
