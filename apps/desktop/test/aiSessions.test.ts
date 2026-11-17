import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const userData = join(".tmp", "ai-sessions-test");
vi.mock("electron", () => ({ app: { getPath: () => userData } }));
vi.mock("../src/main/debugLog.ts", () => ({ recordDebug: vi.fn() }));
const { legacyKeys, readSessions, workspaceKey, writeSession, clearSessions } = await import("../src/main/aiSessions.ts");

const session = (id: string, updatedAt: number, text = "hi") => ({ id, title: text, renamed: false, createdAt: 1, updatedAt, messages: [{ role: "user" as const, text, at: 1 }] });
const folder = (key: string) => join(userData, "ai-sessions", createHash("sha256").update(key).digest("hex").slice(0, 16));

beforeEach(async () => { await rm(userData, { recursive: true, force: true }); });
afterEach(async () => { await rm(userData, { recursive: true, force: true }); });

it("files one Windows folder under one key, whatever spelling opened it", () => {
  const keys = ["E:\\proj", "e:\\proj", "E:\\proj\\", "E:/proj", "e:/PROJ/"].map((one) => workspaceKey(one, "win32"));
  expect(new Set(keys).size).toBe(1);
  expect(workspaceKey("C:\\", "win32")).toBe("c:\\");
  expect(workspaceKey("/home/a/proj/", "linux")).toBe("/home/a/proj");
  expect(workspaceKey("/home/a/Proj", "linux")).not.toBe(workspaceKey("/home/a/proj", "linux"));
  expect(workspaceKey(null)).toBe("no-workspace");
});

it("looks in the folders older raw spellings were filed under", () => {
  const keys = legacyKeys("e:\\mirocfish/MiroFish", "win32");
  expect(keys).toEqual(expect.arrayContaining(["e:\\mirocfish/MiroFish", "E:\\mirocfish\\MiroFish", "E:\\mirocfish\\MiroFish\\"]));
  expect(keys).not.toContain(workspaceKey("e:\\mirocfish/MiroFish", "win32"));
});

it("reads chats saved under the raw path, moves them on save, and never leaves a partial file", async () => {
  const workspace = process.platform === "win32" ? "E:\\Proj" : "/tmp/Proj/";
  const raw = folder(workspace);
  await mkdir(raw, { recursive: true });
  await writeFile(join(raw, "old.json"), JSON.stringify(session("old", 5)));
  await writeFile(join(raw, "broken.json"), "");
  expect((await readSessions(workspace)).map((one) => one.id)).toEqual(["old"]);

  await writeSession(workspace, session("old", 9, "updated"));
  expect(await readdir(raw)).toEqual(["broken.json"]);
  const current = await readdir(folder(workspaceKey(workspace)));
  expect(current).toEqual(["old.json"]);
  expect((await readSessions(workspace))[0]?.title).toBe("updated");

  await clearSessions(workspace);
  expect(await readSessions(workspace)).toEqual([]);
});
