import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../src/shared/api.ts";
import type { Notification, NotificationCentre } from "../src/renderer/notifications/notifications.ts";
import { createUpdatePrompt } from "../src/renderer/updates/updatePrompt.ts";

const VERSION = "2.5.0";
const downloading: UpdateStatus = { state: "downloading", version: VERSION, percent: 5 };
const ready: UpdateStatus = { state: "ready", version: VERSION, restartable: true };
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

/** Only browser events are faked: the real controller handles each updater transition. */
function harness(initial: UpdateStatus) {
  let current = initial;
  let changed: (status: UpdateStatus) => void = () => undefined;
  let unsaved = 0;
  let prepare: (id: string) => void = () => undefined;
  let cancelPreparation: (id: string) => void = () => undefined;
  let editorChanged: () => void = () => undefined;
  const cards: Notification[] = [];
  const button = Object.assign(new EventTarget(), { hidden: true, textContent: "", title: "", disabled: true, dataset: {} });
  const page = Object.assign(new EventTarget(), { hasFocus: () => true });
  const updates = {
    status: vi.fn(async () => current),
    check: vi.fn(async () => current),
    install: vi.fn(async () => current),
    claimNotice: vi.fn(async (_version: string, _phase?: "available" | "ready") => true),
    onChanged: (listener: typeof changed) => { changed = listener; return () => undefined; },
    onPrepare: (listener: typeof prepare) => { prepare = listener; return () => undefined; },
    onPrepareCancel: (listener: typeof cancelPreparation) => { cancelPreparation = listener; return () => undefined; },
    prepared: vi.fn(async (_id: string, _result: unknown) => true),
  };
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { adcode: { updates }, setTimeout, clearTimeout }));
  const flushDrafts = vi.fn();
  const notifications: NotificationCentre = {
    show: card => { cards.push(card); }, showSponsored: () => undefined, dismissAll: () => undefined,
    toggleInbox: () => undefined, onUnreadChanged: () => () => undefined,
  };
  const recoveryDrafts = vi.fn(() => [{ path: "C:/project/a.ts", text: "latest edit" }]);
  const setPreparing = vi.fn();
  const prompt = createUpdatePrompt({ statusItem: button as unknown as HTMLButtonElement, notifications, flushDrafts, unsavedWithoutRecovery: () => unsaved, recoveryDrafts, setPreparing, onEditorChanged: listener => { editorChanged = listener; } });
  return {
    prompt, updates, cards, button, flushDrafts,
    emit(next: UpdateStatus) { current = next; changed(next); },
    setUnsaved(count: number) { unsaved = count; },
    prepare, cancelPreparation, editorChanged, recoveryDrafts, setPreparing,
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-25T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("the in-app update action", () => {
  it("protects the latest buffers when another window requests the update, and unlocks on cancellation", async () => {
    const h = harness(ready); await settle();
    h.prepare("request"); await settle();
    expect(h.setPreparing).toHaveBeenCalledWith(true);
    expect(h.updates.prepared).toHaveBeenCalledWith("request", { ready: true, drafts: [{ path: "C:/project/a.ts", text: "latest edit" }] });
    h.editorChanged(); await settle();
    expect(h.updates.prepared).toHaveBeenLastCalledWith("request", { ready: false, drafts: [] });
    h.cancelPreparation("request");
    expect(h.setPreparing).toHaveBeenLastCalledWith(false);
  });

  it("refuses another window's update request when this window has unprotected edits", async () => {
    const h = harness(ready); await settle(); h.setUnsaved(1);
    h.prepare("request"); await settle();
    expect(h.recoveryDrafts).not.toHaveBeenCalled();
    expect(h.updates.prepared).toHaveBeenCalledWith("request", { ready: false, drafts: [] });
    expect(h.cards.at(-1)?.title).toBe("Save before updating");
    h.cancelPreparation("request");
  });
  it("queues one install on the existing download, preserves progress, and protects drafts first", async () => {
    const h = harness(downloading);
    await settle();
    expect(h.cards[0]?.title).toBe(`ADCode ${VERSION} is available`);
    h.cards[0]?.actions?.find(action => action.label === "Update now")?.run();
    await settle();
    await h.prompt.update(); // A repeat click must not queue another installation.
    expect(h.updates.check).not.toHaveBeenCalled();
    expect(h.updates.install).not.toHaveBeenCalled();
    h.emit({ ...downloading, percent: 65 });
    await settle();
    expect(h.button.textContent).toBe("Updating 65%");
    expect(h.cards.filter(card => card.title === "Updating ADCode")).toHaveLength(1);
    h.emit(ready);
    await settle();
    h.emit(ready);
    await settle();
    expect(h.flushDrafts).toHaveBeenCalledOnce();
    expect(h.updates.install).toHaveBeenCalledOnce();
    expect(h.flushDrafts.mock.invocationCallOrder[0]).toBeLessThan(h.updates.install.mock.invocationCallOrder[0]!);
  });

  it("offers a separate ready card after Later on the available notice", async () => {
    const h = harness(downloading);
    await settle();
    h.cards[0]?.actions?.find(action => action.label === "Later")?.run();
    h.emit(ready);
    await settle();
    expect(h.cards.map(card => card.title)).toEqual([`ADCode ${VERSION} is available`, `ADCode ${VERSION} is ready`]);
    expect(h.updates.claimNotice.mock.calls).toEqual([[VERSION, "available"], [VERSION, "ready"]]);
    expect(h.updates.install).not.toHaveBeenCalled();
  });

  it("blocks queued installation when recovery is off, leaving a usable ready action", async () => {
    const h = harness(downloading);
    await settle();
    await h.prompt.update();
    h.setUnsaved(1);
    h.emit(ready);
    await settle();
    expect(h.updates.install).not.toHaveBeenCalled();
    expect(h.cards.some(card => card.title === "Save before restarting")).toBe(true);
    expect(h.cards.some(card => card.title === `ADCode ${VERSION} is ready`)).toBe(true);
    expect(h.button.disabled).toBe(false);
    h.setUnsaved(0);
    expect(await h.prompt.update()).toBe(true);
    expect(h.updates.install).toHaveBeenCalledOnce();
  });

  it("leaves a failed installation available for an explicit retry", async () => {
    const h = harness(ready);
    await settle();
    h.updates.install.mockRejectedValueOnce(new Error("Installer unavailable"));
    expect(await h.prompt.update()).toBe(false);
    expect(h.cards.at(-1)?.title).toBe("Could not install the update");
    expect(h.button.disabled).toBe(false);
    expect(await h.prompt.update()).toBe(true);
    expect(h.updates.install).toHaveBeenCalledTimes(2);
  });

  it("offers retry when a download fails after Update now", async () => {
    const h = harness(downloading);
    await settle();
    await h.prompt.update();
    h.emit({ state: "failed" });
    await settle();
    expect(h.cards.at(-1)?.title).toBe("The update download stopped");
    h.updates.check.mockResolvedValueOnce(downloading);
    h.cards.at(-1)?.actions?.[0]?.run();
    await settle();
    expect(h.updates.check).toHaveBeenCalledOnce();
    expect(h.button.textContent).toBe("Updating 5%");
    expect(h.updates.install).not.toHaveBeenCalled();
  });

  it("opens the Store update action without trying to close or self-update", async () => {
    const h = harness({ state: "available", version: VERSION, source: "store" });
    await settle();
    expect(h.cards[0]?.actions?.[0]?.label).toBe("Update in Microsoft Store");
    h.cards[0]?.actions?.[0]?.run();
    await settle();
    expect(h.updates.install).toHaveBeenCalledOnce();
    expect(h.updates.check).not.toHaveBeenCalled();
    expect(h.flushDrafts).not.toHaveBeenCalled();
  });

  it("does not announce ready after that status failed during window arbitration", async () => {
    const h = harness({ state: "idle" });
    await settle();
    let resolveClaim: (claimed: boolean) => void = () => undefined;
    h.updates.claimNotice.mockImplementationOnce(() => new Promise(resolve => { resolveClaim = resolve; }));
    h.emit(ready);
    h.emit({ state: "failed" });
    resolveClaim(true);
    await settle();
    expect(h.cards).toEqual([]);
  });
});
