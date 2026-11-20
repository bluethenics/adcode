/**
 * The desktop half of retention tracking: what actually leaves the machine.
 *
 * The hard rule is the opt-out. With Help improve ADCode off, no retention event is sent and
 * any queued on disk are deleted; with it on, only fixed names and codes travel, beside the
 * first-session milestones in the same request.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  dir: "",
  settings: { "adcode.privacy.usageStats": true } as Record<string, unknown>,
  settingsListeners: [] as ((values: Record<string, unknown>) => void)[],
  appListeners: new Map<string, (...args: unknown[]) => void>(),
  ipc: new Map<string, (...args: unknown[]) => void>(),
  bodies: [] as Record<string, unknown>[],
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => mock.dir,
    getVersion: () => "2.6.3",
    on: (name: string, listener: (...args: unknown[]) => void) => mock.appListeners.set(name, listener),
  },
  ipcMain: { on: (name: string, listener: (...args: unknown[]) => void) => mock.ipc.set(name, listener), handle: () => undefined },
}));
vi.mock("../src/main/settings.ts", () => ({
  currentSettings: () => mock.settings,
  loadSettings: async () => mock.settings,
  onSettingsChanged: (listener: (values: Record<string, unknown>) => void) => mock.settingsListeners.push(listener),
}));
vi.mock("../src/main/workspace.ts", () => ({ onWorkspaceRootChanged: () => undefined }));
vi.mock("../src/main/referrals.ts", () => ({ noteBuildPreview: () => undefined }));
vi.mock("../src/main/adPorts.ts", () => ({ DiskFileStore: class {}, FetchHttpTransport: class {}, SystemClock: class {} }));
vi.mock("../src/main/backend.ts", () => ({
  apiBaseUrl: () => "https://api.test/v1",
  createBackendTokens: () => ({ getToken: async () => ({ ok: true, value: "token" }) }),
}));

const file = (): string => join(mock.dir, "milestones.json");
const onDisk = (): { events: { name: string; code?: string; at: number }[]; firstLaunchSent: boolean; session: { ended: boolean } | null } =>
  JSON.parse(readFileSync(file(), "utf8"));
const sentEvents = (): { name: string; code?: string; at: number; ms?: number }[] =>
  mock.bodies.flatMap((body) => (body["events"] as { name: string; code?: string; at: number }[] | undefined) ?? []);

async function start(): Promise<typeof import("../src/main/milestones.ts")> {
  vi.resetModules();
  const milestones = await import("../src/main/milestones.ts");
  milestones.registerMilestoneIpc();
  return milestones;
}

beforeEach(() => {
  mock.dir = mkdtempSync(join(tmpdir(), "adcode-retention-"));
  mock.settings = { "adcode.privacy.usageStats": true };
  mock.settingsListeners = [];
  mock.appListeners.clear();
  mock.ipc.clear();
  mock.bodies = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    mock.bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return new Response("{}", { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("retention events from the editor", () => {
  it("reports a new install's first launch, version and day, then friction with fixed codes only", async () => {
    const { recordRetention } = await start();
    recordRetention("turn_failed", { code: "auth" });
    recordRetention("turn_failed", { code: "C:\\Users\\ana\\secret.ts" });
    await vi.waitFor(() => expect(sentEvents().length).toBeGreaterThanOrEqual(4), { timeout: 8_000 });
    const names = sentEvents().map((event) => `${event.name}${event.code === undefined ? "" : `:${event.code}`}`);
    expect(names).toEqual(expect.arrayContaining(["first_launch", "session_start:2.6.3", "day_active", "turn_failed:auth"]));
    expect(JSON.stringify(mock.bodies)).not.toContain("secret");
    await vi.waitFor(() => expect(onDisk().events).toEqual([]), { timeout: 8_000 });
  }, 15_000);

  it("sends nothing while Help improve ADCode is off, and deletes what was queued", async () => {
    mock.settings = { "adcode.privacy.usageStats": false };
    writeFileSync(file(), JSON.stringify({
      firstLaunchAt: 1, firstValueAt: 1, pending: [{ name: "prompt_sent", at: Date.now() }],
      events: [{ name: "ai_message", at: Date.now() }], firstLaunchSent: true, session: null,
    }));
    const { recordRetention } = await start();
    recordRetention("turn_failed", { code: "auth" });
    mock.ipc.get("retention:record")?.({}, "limit_reached", "daily");
    // The milestone still goes, as it did before retention existed; no event goes with it.
    await vi.waitFor(() => expect(mock.bodies).toHaveLength(1), { timeout: 8_000 });
    expect(mock.bodies[0]).toEqual({ milestones: [expect.objectContaining({ name: "prompt_sent" })] });
    expect(onDisk().events).toEqual([]);
  }, 15_000);

  it("deletes queued events the moment the setting is switched off", async () => {
    writeFileSync(file(), JSON.stringify({ firstLaunchAt: 1, firstValueAt: 1, pending: [], events: [], firstLaunchSent: true, session: null }));
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }));
    const { recordRetention } = await start();
    recordRetention("turn_failed", { code: "network" });
    await vi.waitFor(() => expect(onDisk().events.some((event) => event.name === "turn_failed")).toBe(true), { timeout: 8_000 });
    mock.settings = { "adcode.privacy.usageStats": false };
    for (const listener of mock.settingsListeners) listener(mock.settings);
    await vi.waitFor(() => expect(onDisk().events).toEqual([]), { timeout: 8_000 });
  }, 15_000);

  it("learns at the next launch that the last session never quit, and is not a first launch for an upgrade", async () => {
    const beat = Date.now() - 3_600_000;
    writeFileSync(file(), JSON.stringify({ firstLaunchAt: 1, firstValueAt: 1, pending: [], session: { startedAt: beat - 600_000, beatAt: beat, ended: false } }));
    await start();
    await vi.waitFor(() => expect(sentEvents().some((event) => event.name === "session_end")).toBe(true), { timeout: 8_000 });
    expect(sentEvents().find((event) => event.name === "session_end")).toEqual({ name: "session_end", code: "unclean", at: beat, ms: 600_000 });
    expect(sentEvents().some((event) => event.name === "first_launch")).toBe(false);
  }, 15_000);

  it("ends a session cleanly on quit, written straight to disk", async () => {
    writeFileSync(file(), JSON.stringify({ firstLaunchAt: 1, firstValueAt: 1, pending: [], firstLaunchSent: true, session: null }));
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }));
    await start();
    await vi.waitFor(() => expect(onDisk().session?.ended).toBe(false), { timeout: 8_000 });
    mock.appListeners.get("will-quit")?.();
    expect(onDisk().session?.ended).toBe(true);
    expect(onDisk().events.find((event) => event.name === "session_end")).toMatchObject({ code: "quit" });
  }, 15_000);

  it("takes only the screens the window shows, by name", async () => {
    writeFileSync(file(), JSON.stringify({ firstLaunchAt: 1, firstValueAt: 1, pending: [], firstLaunchSent: true, session: null }));
    await start();
    mock.ipc.get("retention:record")?.({}, "limit_reached", "daily");
    mock.ipc.get("retention:record")?.({}, "crash", "main_exception");
    mock.ipc.get("retention:record")?.({}, "sign_in_needed");
    await vi.waitFor(() => expect(sentEvents().some((event) => event.name === "sign_in_needed")).toBe(true), { timeout: 8_000 });
    expect(sentEvents().some((event) => event.name === "limit_reached" && event.code === "daily")).toBe(true);
    expect(sentEvents().some((event) => event.name === "crash")).toBe(false);
  }, 15_000);
});
