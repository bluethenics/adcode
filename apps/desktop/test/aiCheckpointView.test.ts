import { expect, it } from "vitest";
import { checkpointView, checkpointsForSession } from "../src/main/aiCheckpointView.ts";
import type { EditCheckpoint } from "../src/main/aiCheckpoints.ts";

it("restores only a chat's bound or uniquely matched legacy edits, including undone state", () => {
  const sessions = [{ id: "a", messages: [{ role: "user", at: 100 }, { role: "assistant", at: 200 }] }, { id: "b", messages: [{ role: "assistant", at: 10_000 }] }];
  const saved = (id: string, createdAt: number, sessionId?: string): EditCheckpoint => ({ id, createdAt, root: "project", files: [], undone: false, ...(sessionId === undefined ? {} : { sessionId }) });
  const checkpoints = [saved("legacy-a", 210), saved("legacy-b", 10_010), saved("too-old", 6_000), saved("bound-a", 20_000, "a"), saved("bound-b", 220, "b")];
  expect(checkpointsForSession(checkpoints, sessions, "a").map(cp => cp.id)).toEqual(["legacy-a", "bound-a"]);
  expect(checkpointsForSession(checkpoints, [...sessions, { id: "other", messages: [{ role: "assistant", at: 205 }] }], "a").map(cp => cp.id)).toEqual(["bound-a"]);
  expect(checkpointView({ ...saved("undone", 200, "a"), undone: true }).undone).toBe(true);
});
it("reviews recorded text changes, counts edits and never exposes binary bytes or the root", () => {
  const view = checkpointView({ id: "cp-test", root: "private-root", createdAt: 10, undone: false, files: [
    { path: "edited.ts", before: "same\nold\n", after: "same\nnew\nextra\n" },
    { path: "new.ts", before: null, after: "created\n" },
    { path: "deleted.ts", before: "removed\n", after: null },
    { path: "asset.png", before: null, after: "private-binary", encoding: "base64" },
  ] });
  expect(view.files[0]).toMatchObject({ added: 2, removed: 1, hunks: [{ original: ["old"], replacement: ["new", "extra"] }] });
  expect(view.files[1]).toMatchObject({ created: true, added: 1, removed: 0 });
  expect(view.files[2]).toMatchObject({ deleted: true, added: 0, removed: 1 });
  expect(view.files[3]).toEqual({ path: "asset.png", created: true, deleted: false });
  expect(JSON.stringify(view)).not.toMatch(/private-root|private-binary/);
  expect(view.files[0]).not.toHaveProperty("lineEndingsOnly");
});
it("says a change of line endings alone is that, not a count of zero lines", () => {
  const view = checkpointView({ id: "cp-eol", root: "project", createdAt: 10, undone: false, files: [
    { path: "src/app.js", before: "a\r\nb\r\n", after: "a\nb\n" },
    { path: "empty.txt", before: null, after: "" },
  ] });
  expect(view.files[0]).toMatchObject({ added: 0, removed: 0, lineEndingsOnly: true, hunks: [] });
  // A new empty file has no lines either, but that is not a line-ending change.
  expect(view.files[1]).not.toHaveProperty("lineEndingsOnly");
});
