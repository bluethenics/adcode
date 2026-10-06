/**
 * Follow-ups typed while the assistant works, waiting their turn.
 *
 * Enter used to stop the running turn whenever anything was typed, so a follow-up written
 * mid-build - "and make it dark" - cancelled the build it was about. Claude Code and Cursor
 * queue it instead, and so does ADCode: the chat sends each queued message, in order, when
 * the turn before it finishes. Send now takes one out of turn; × drops it.
 *
 * Pure: no DOM, so the rules are tested as they are written.
 */

export interface QueuedMessage<T> {
  readonly id: number;
  readonly text: string;
  readonly attachments: readonly T[];
}

export interface ChatQueue<T> {
  /** Queue a message; null when there is nothing to send, or the queue is full. */
  add(text: string, attachments: readonly T[]): QueuedMessage<T> | null;
  /** The next message to send, removed from the queue. */
  next(): QueuedMessage<T> | undefined;
  /** One message, removed out of turn - for Send now. */
  take(id: number): QueuedMessage<T> | undefined;
  remove(id: number): void;
  clear(): void;
  items(): readonly QueuedMessage<T>[];
  onChange(listener: (items: readonly QueuedMessage<T>[]) => void): () => void;
}

/** More than this waiting is a backlog, not a queue. */
const MAX_QUEUED = 10;

export function createChatQueue<T>(): ChatQueue<T> {
  let items: QueuedMessage<T>[] = [];
  let nextId = 1;
  const listeners = new Set<(items: readonly QueuedMessage<T>[]) => void>();
  const changed = (): void => {
    for (const listener of listeners) listener(items);
  };

  return {
    add(text, attachments) {
      if (text.trim().length === 0 && attachments.length === 0) return null;
      if (items.length >= MAX_QUEUED) return null;
      const message: QueuedMessage<T> = { id: nextId++, text, attachments: [...attachments] };
      items = [...items, message];
      changed();
      return message;
    },
    next() {
      const [first, ...rest] = items;
      if (first === undefined) return undefined;
      items = rest;
      changed();
      return first;
    },
    take(id) {
      const found = items.find((item) => item.id === id);
      if (found === undefined) return undefined;
      items = items.filter((item) => item.id !== id);
      changed();
      return found;
    },
    remove(id) {
      const before = items.length;
      items = items.filter((item) => item.id !== id);
      if (items.length !== before) changed();
    },
    clear() {
      items = [];
      changed();
    },
    items: () => items,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
