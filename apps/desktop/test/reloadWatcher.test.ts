import { EventEmitter } from "node:events";
import type { FSWatcher, watch } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { watchForReload } from "../src/main/reloadWatcher.ts";

function watcher() {
  return Object.assign(new EventEmitter(), { close: vi.fn(), ref: vi.fn(), unref: vi.fn() }) as EventEmitter & FSWatcher;
}

describe("preview file watcher recovery", () => {
  it("falls back after an asynchronous recursive watcher error and closes the fallback", () => {
    const recursive = watcher();
    const shallow = watcher();
    const changed = vi.fn();
    const create = vi.fn().mockReturnValueOnce(recursive).mockReturnValueOnce(shallow);
    const handle = watchForReload("/project", changed, create as unknown as typeof watch);
    expect(() => recursive.emit("error", Object.assign(new Error("watch limit"), { code: "ENOSPC" }))).not.toThrow();
    expect(recursive.close).toHaveBeenCalledOnce();
    expect(create).toHaveBeenNthCalledWith(2, "/project", { recursive: false }, changed);
    handle.close();
    expect(shallow.close).toHaveBeenCalledOnce();
    recursive.emit("error", new Error("late event"));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("leaves the editor running when both watch modes fail", () => {
    const shallow = watcher();
    const create = vi.fn().mockImplementationOnce(() => { throw new Error("recursive unavailable"); }).mockReturnValueOnce(shallow);
    const handle = watchForReload("/project", vi.fn(), create as unknown as typeof watch);
    expect(() => shallow.emit("error", new Error("watch limit"))).not.toThrow();
    expect(create).toHaveBeenCalledTimes(2);
    expect(() => handle.close()).not.toThrow();
  });
});
