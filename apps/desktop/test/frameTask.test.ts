import { describe, expect, it, vi } from "vitest";
import { createFrameTask, type FrameClock } from "../src/renderer/frameTask.ts";

function setup() {
  let sequence = 0;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const clock: FrameClock = {
    request: work => { const id = ++sequence; frames.set(id, work); return id; },
    cancel: id => { frames.delete(id); },
    later: work => { const id = ++sequence; timers.set(id, work); return id; },
    clear: id => { timers.delete(id); },
  };
  const work = vi.fn();
  return { frames, timers, work, task: createFrameTask(work, clock) };
}

describe("visual work scheduling", () => {
  it("collapses 100 queued updates into one render and cancels its fallback", () => {
    const { frames, timers, work, task } = setup();
    for (let index = 0; index < 100; index++) task.schedule();
    expect(frames.size).toBe(1);
    expect(timers.size).toBe(1);
    [...frames.values()][0]!();
    expect(work).toHaveBeenCalledTimes(1);
    expect(frames.size + timers.size).toBe(0);
  });
  it("runs in an occluded window whose animation frame never arrives", () => {
    const { timers, frames, work, task } = setup();
    task.schedule(); [...timers.values()][0]!();
    expect(work).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
  it("flushes the final pending update synchronously and discards reset work", () => {
    const { work, frames, timers, task } = setup();
    task.schedule(); task.flush(); task.flush();
    expect(work).toHaveBeenCalledTimes(1);
    task.schedule(); task.cancel(); task.flush();
    expect(work).toHaveBeenCalledTimes(1);
    expect(frames.size + timers.size).toBe(0);
  });
});
