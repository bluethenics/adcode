import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../src/shared/api.ts";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  remotes: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler) },
  shell: { openExternal: mocks.openExternal },
}));
vi.mock("../src/main/sourceControl.ts", () => ({
  gitForWorkspace: () => ({ remotes: mocks.remotes }),
  invalidateFileCache: vi.fn(), quickOpen: vi.fn(), searchForWorkspace: vi.fn(),
}));
import { registerGitIpc } from "../src/main/gitIpc.ts";

beforeEach(() => {
  mocks.handlers.clear();
  mocks.openExternal.mockReset().mockResolvedValue(undefined);
  mocks.remotes.mockReset().mockResolvedValue([{ name: "origin", url: "git@github.com:owner/repo.git" }]);
  registerGitIpc();
});

describe("GitHub browser IPC", () => {
  const open = (remote: unknown, destination: unknown) => mocks.handlers.get(CHANNELS.gitOpenGitHub)!(null, remote, destination);
  it("resolves the named remote in main before opening a fixed destination", async () => {
    await expect(open("origin", "issues")).resolves.toMatchObject({ ok: true });
    expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/owner/repo/issues");
  });
  it("rejects renderer URLs, unknown destinations, and non-GitHub remotes", async () => {
    await expect(open("https://github.com/other/repo", "code")).resolves.toMatchObject({ ok: false });
    await expect(open("origin", "__proto__")).resolves.toMatchObject({ ok: false });
    await expect(open(null, "code")).resolves.toMatchObject({ ok: false });
    mocks.remotes.mockResolvedValue([{ name: "origin", url: "https://example.com/repo" }]);
    await expect(open("origin", "code")).resolves.toMatchObject({ ok: false });
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
  it("reports browser failures without leaving an unhandled rejection", async () => {
    mocks.openExternal.mockRejectedValue(new Error("Browser unavailable"));
    await expect(open("origin", "code")).resolves.toEqual({ ok: false, message: "Browser unavailable" });
  });
});
