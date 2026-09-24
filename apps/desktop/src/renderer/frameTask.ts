/** Coalesce visual work while retaining a timer fallback for occluded Electron windows. */
export interface FrameClock {
  request(callback: () => void): number;
  cancel(id: number): void;
  later(callback: () => void, delay: number): number;
  clear(id: number): void;
}

export function createFrameTask(work: () => void, clock: FrameClock = {
  request: callback => window.requestAnimationFrame(callback),
  cancel: id => window.cancelAnimationFrame(id),
  later: (callback, delay) => window.setTimeout(callback, delay),
  clear: id => window.clearTimeout(id),
}) {
  let frame: number | null = null;
  let timer: number | null = null;
  let pending = false;
  function cancel(): void {
    if (frame !== null) clock.cancel(frame);
    if (timer !== null) clock.clear(timer);
    frame = timer = null;
    pending = false;
  }
  function flush(): void {
    if (!pending) return;
    cancel();
    work();
  }
  return {
    schedule(): void {
      if (pending) return;
      pending = true;
      frame = clock.request(flush);
      timer = clock.later(flush, 100);
    },
    flush,
    cancel,
  };
}
