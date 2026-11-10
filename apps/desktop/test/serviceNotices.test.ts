import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), opened: [] as string[] }));
vi.mock("electron", () => ({
  app: { getPath: () => ".tmp/service-notices-test" },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler) },
  shell: { openExternal: async (url: string) => { mocks.opened.push(url); } },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock("../src/main/backend.ts", () => ({ apiBaseUrl: () => "http://127.0.0.1", createBackendTokens: () => ({ getToken: async () => ({ ok: false }) }) }));
vi.mock("../src/main/adPorts.ts", () => ({ DiskFileStore: class {}, FetchHttpTransport: class {}, SystemClock: class {} }));
import { httpsOnly, startNoticePolling, validate } from "../src/main/notices.ts";
import { CHANNELS } from "../src/shared/api.ts";

const base = { noticeId: "note-1", severity: "info", title: "New in 2.6", body: "Notices can carry a picture and links." };

it("passes an https image through and gives the window button labels only", () => {
  const valid = validate({ ...base, imageUrl: "https://adcode.bluethenics.com/i/post-1.webp", imageAlt: "The picker", buttons: [{ label: "Read more", url: "https://adcode.bluethenics.com/docs" }] });
  expect(valid?.notice).toEqual({ ...base, imageUrl: "https://adcode.bluethenics.com/i/post-1.webp", imageAlt: "The picker", buttons: ["Read more"] });
  expect(valid?.links).toEqual(["https://adcode.bluethenics.com/docs"]);
  expect(JSON.stringify(valid?.notice)).not.toContain("/docs");
});

it("drops a bad image or button but keeps the notice", () => {
  const valid = validate({ ...base, imageUrl: "javascript:alert(1)", buttons: [{ label: "Run", url: "file:///C:/Windows/system32/calc.exe" }, { label: "", url: "https://adcode.bluethenics.com" }, { label: "Ok", url: "https://adcode.bluethenics.com/ok" }, { label: "Third", url: "https://adcode.bluethenics.com/3" }] });
  expect(valid?.notice).toEqual(base);
  expect(validate({ ...base, title: "" })).toBeNull();
  expect(httpsOnly("http://adcode.bluethenics.com")).toBeNull();
  expect(httpsOnly("https://user:pass@adcode.bluethenics.com")).toBeNull();
});

it("opens only a link this process holds, never one the window names", async () => {
  startNoticePolling();
  const open = mocks.handlers.get(CHANNELS.noticeOpen)!;
  await open({}, "unknown", 0);
  await open({}, "note-1", "https://evil.example");
  expect(mocks.opened).toEqual([]);
});
