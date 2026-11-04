import { beforeEach, expect, it, vi } from "vitest";
import { CHANNELS } from "../src/shared/api.ts";
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(), read: vi.fn(), write: vi.fn(), mkdir: vi.fn(), rename: vi.fn() }));
vi.mock("electron", () => ({ app: { getPath: () => "welcome-test" }, ipcMain: { handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(name, fn) } }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.read, writeFile: mocks.write, mkdir: mocks.mkdir, rename: mocks.rename }));
import { registerOnboardingIpc } from "../src/main/onboarding.ts";
beforeEach(() => { vi.resetAllMocks(); mocks.handlers.clear(); registerOnboardingIpc(); });
const completed = () => mocks.handlers.get(CHANNELS.onboardingState)!();
const complete = () => mocks.handlers.get(CHANNELS.onboardingComplete)!();
it("welcomes a fresh install and remembers a completed install", async () => {
  mocks.read.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
  await expect(completed()).resolves.toBe(false);
  mocks.read.mockResolvedValueOnce('{"completed":true}');
  await expect(completed()).resolves.toBe(true);
});
it("does not repeat setup when an existing record is unreadable or malformed", async () => {
  mocks.read.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EACCES" })).mockResolvedValueOnce("bad json").mockResolvedValueOnce('{}');
  for (let i = 0; i < 3; i++) await expect(completed()).resolves.toBe(true);
});
it("writes completion atomically and remembers it if a disk write fails", async () => {
  await complete();
  expect(mocks.write).toHaveBeenCalledWith(expect.stringContaining("onboarding.json.tmp"), expect.stringContaining('"completed":true'), "utf8");
  expect(mocks.rename).toHaveBeenCalledOnce();
  mocks.write.mockRejectedValueOnce(new Error("disk full"));
  await complete();
  await expect(completed()).resolves.toBe(true);
  expect(mocks.read).not.toHaveBeenCalled();
});
