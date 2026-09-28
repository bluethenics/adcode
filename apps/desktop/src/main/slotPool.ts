/**
 * The parallel-agents limit, shared by every board run and Team role in this process.
 *
 * A node takes a slot before it calls a model and gives it back however it ends - done,
 * failed or cancelled. Waiters are served strictly first-in, first-out: a free slot goes to
 * the head of the queue, never to whoever asks next, so a run started later cannot overtake
 * one that has been queued for a minute. The limit is read on every decision, so raising it in
 * Settings drains the queue immediately.
 */
export interface SlotPool {
  /** Take a slot now if one is free and nobody is queued ahead. */
  tryAcquire(): boolean;
  /** Wait for a slot in turn. Rejects, without holding a slot, if the signal aborts first. */
  acquire(signal?: AbortSignal): Promise<void>;
  release(): void;
  active(): number;
  waiting(): number;
}

interface Waiter {
  readonly grant: () => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
}

export function createSlotPool(limit: () => number): SlotPool {
  let active = 0;
  const queue: Waiter[] = [];
  const cap = (): number => Math.max(1, Math.floor(limit()) || 1);

  function drain(): void {
    while (queue.length > 0 && active < cap()) {
      const waiter = queue.shift()!;
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      active += 1;
      waiter.grant();
    }
  }

  return {
    tryAcquire(): boolean {
      if (queue.length > 0 || active >= cap()) return false;
      active += 1;
      return true;
    },
    acquire(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) return Promise.reject(new DOMException("Queued agent cancelled", "AbortError"));
      return new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          grant: resolve,
          signal,
          onAbort: () => {
            const index = queue.indexOf(waiter);
            if (index >= 0) queue.splice(index, 1);
            reject(new DOMException("Queued agent cancelled", "AbortError"));
          },
        };
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
        queue.push(waiter);
        drain();
      });
    },
    release(): void {
      active = Math.max(0, active - 1);
      drain();
    },
    active: () => active,
    waiting: () => queue.length,
  };
}
