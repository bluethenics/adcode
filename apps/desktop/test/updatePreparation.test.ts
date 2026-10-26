import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpdatePreparation } from "../src/main/updatePreparation.ts";
import { CHANNELS, type UpdatePreparation } from "../src/shared/api.ts";

class EditorWindow extends EventEmitter {
  destroyed = false;
  messages: { channel: string; id: string }[] = [];
  isDestroyed() { return this.destroyed; }
  send(channel: string, id: string) { this.messages.push({ channel, id }); }
  requestId() { return this.messages.find(message => message.channel === CHANNELS.updatePrepare)!.id; }
}
const safe: UpdatePreparation = { ready: true, drafts: [] };
afterEach(() => vi.useRealTimers());

describe("preparing every editor window for an update", () => {
  it("waits for the other window's newest recovery draft to reach disk", async () => {
    const vibe = new EditorWindow(); const code = new EditorWindow();
    let finishWrite: () => void = () => undefined;
    const written = new Promise<void>(resolve => { finishWrite = resolve; });
    const save = vi.fn(async (drafts: UpdatePreparation["drafts"]) => { if (drafts.length > 0) await written; });
    const preparation = createUpdatePreparation({ windows: () => [vibe, code], save });
    let finished = false;
    const pending = preparation.prepare().then(() => { finished = true; });
    const id = vibe.requestId();
    await preparation.answer(vibe, id, safe);
    const answer = preparation.answer(code, id, { ready: true, drafts: [{ path: "C:/project/new.ts", text: "just typed" }] });
    await Promise.resolve();
    expect(finished).toBe(false); expect(preparation.ready()).toBe(false);
    finishWrite(); await answer; await pending;
    expect(save).toHaveBeenLastCalledWith([{ path: "C:/project/new.ts", text: "just typed" }]);
    expect(preparation.ready()).toBe(true);
    preparation.commit(); preparation.cancel();
  });

  it("blocks when the other window has unsaved work with recovery off, then unlocks both windows", async () => {
    const vibe = new EditorWindow(); const code = new EditorWindow();
    const preparation = createUpdatePreparation({ windows: () => [vibe, code], save: async () => undefined });
    const pending = expect(preparation.prepare()).rejects.toThrow("Save changes in every ADCode window");
    const id = vibe.requestId();
    await preparation.answer(vibe, id, safe);
    expect(await preparation.answer(code, id, { ready: false, drafts: [] })).toBe(false);
    await pending;
    expect(preparation.ready()).toBe(false);
    for (const window of [vibe, code]) expect(window.messages.at(-1)).toEqual({ channel: CHANNELS.updatePrepareCancel, id });
  });

  it("rejects a failed draft write instead of treating it as protected", async () => {
    const window = new EditorWindow();
    const preparation = createUpdatePreparation({ windows: () => [window], save: async () => { throw new Error("disk full"); } });
    const pending = expect(preparation.prepare()).rejects.toThrow();
    expect(await preparation.answer(window, window.requestId(), safe)).toBe(false);
    await pending; expect(preparation.ready()).toBe(false);
  });

  it("refuses conflicting unsaved copies of the same file in two windows", async () => {
    const first = new EditorWindow(); const second = new EditorWindow();
    const preparation = createUpdatePreparation({ windows: () => [first, second], save: async () => undefined });
    const pending = expect(preparation.prepare()).rejects.toThrow(); const id = first.requestId();
    await preparation.answer(first, id, { ready: true, drafts: [{ path: "C:/same.ts", text: "first window" }] });
    expect(await preparation.answer(second, id, { ready: true, drafts: [{ path: "C:/same.ts", text: "other window" }] })).toBe(false);
    await pending; expect(preparation.ready()).toBe(false);
  });

  it("writes identical copies of the same buffer only once, preventing an atomic-file race", async () => {
    const first = new EditorWindow(); const second = new EditorWindow();
    const save = vi.fn(async (_drafts: UpdatePreparation["drafts"]) => undefined);
    const preparation = createUpdatePreparation({ windows: () => [first, second], save });
    const pending = preparation.prepare(); const id = first.requestId();
    const draft = { path: "C:/same.ts", text: "same unsaved content" };
    await Promise.all([preparation.answer(first, id, { ready: true, drafts: [draft] }), preparation.answer(second, id, { ready: true, drafts: [draft] })]);
    await pending;
    expect(save.mock.calls.flatMap(([drafts]) => drafts)).toEqual([draft]);
    preparation.commit(); preparation.cancel();
  });

  it("does not accept another WebContents or a stale request ID", async () => {
    const window = new EditorWindow(); const impostor = new EditorWindow(); const save = vi.fn(async () => undefined);
    const preparation = createUpdatePreparation({ windows: () => [window], save });
    const pending = preparation.prepare(); const id = window.requestId();
    expect(await preparation.answer(impostor, id, safe)).toBe(false);
    expect(await preparation.answer(window, "old-request", safe)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    await preparation.answer(window, id, safe); await pending;
    preparation.commit(); preparation.cancel();
  });

  it.each(["destroyed", "did-start-loading", "render-process-gone"])("refuses to install when a window emits %s", async event => {
    const window = new EditorWindow();
    const preparation = createUpdatePreparation({ windows: () => [window], save: async () => undefined });
    const pending = expect(preparation.prepare()).rejects.toThrow();
    window.emit(event); await pending;
    expect(preparation.ready()).toBe(false);
  });

  it("times out an unresponsive window and cancels its preparation", async () => {
    vi.useFakeTimers(); const window = new EditorWindow();
    const preparation = createUpdatePreparation({ windows: () => [window], save: async () => undefined });
    const pending = expect(preparation.prepare()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5_000); await pending;
    expect(window.messages.at(-1)?.channel).toBe(CHANNELS.updatePrepareCancel);
  });

  it("refuses a newly opened window and any edit after an earlier window acknowledged", async () => {
    const first = new EditorWindow(); const second = new EditorWindow(); let windows = [first];
    const preparation = createUpdatePreparation({ windows: () => windows, save: async () => undefined });
    const firstAttempt = expect(preparation.prepare()).rejects.toThrow();
    windows = [first, second];
    await preparation.answer(first, first.requestId(), safe); await firstAttempt;
    const secondAttempt = expect(preparation.prepare()).rejects.toThrow();
    const id = first.messages.filter(message => message.channel === CHANNELS.updatePrepare).at(-1)!.id;
    await preparation.answer(first, id, safe);
    await preparation.answer(first, id, { ready: false, drafts: [] });
    await secondAttempt; expect(preparation.ready()).toBe(false);
  });
});
