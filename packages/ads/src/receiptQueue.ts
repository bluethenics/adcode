/**
 * Disk-backed, capped, deduped receipt queue.
 *
 * Brief §9: "Queue to disk, capped at 500, oldest dropped. Flush on reconnect. Deduped
 * server-side by receipt ID so users do not lose earnings to flaky wifi."
 *
 * A `Map` keyed by receipt ID gives both properties at once: JavaScript maps preserve
 * insertion order, so the first key is always the oldest entry, and dedupe is a lookup.
 */
import { RECEIPT_QUEUE_CAP, type FileStore, type Receipt, type ThemeKind } from "./types.ts";

const STORE_KEY = "ads/receipts.json";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const THEMES: readonly ThemeKind[] = ["light", "dark"];
const OUTCOMES: readonly Receipt["outcome"][] = ["impression", "click", "dismissed"];

/**
 * Anything read back off disk is untrusted - it may have been hand-edited, truncated by
 * a crash, or written by an older build.
 */
function isReceipt(value: unknown): value is Receipt {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r["receiptId"] === "string" &&
    r["receiptId"].length > 0 &&
    typeof r["creativeId"] === "string" &&
    typeof r["shownAt"] === "number" &&
    typeof r["dwellMs"] === "number" &&
    THEMES.includes(r["themeKind"] as ThemeKind) &&
    OUTCOMES.includes(r["outcome"] as Receipt["outcome"])
  );
}

export interface ReceiptQueue {
  enqueue(receipt: Receipt): Promise<void>;
  all(): Promise<Receipt[]>;
  ack(receiptIds: readonly string[]): Promise<void>;
  size(): Promise<number>;
  load(): Promise<void>;
}

export function createReceiptQueue(deps: { store: FileStore }): ReceiptQueue {
  const entries = new Map<string, Receipt>();
  let loaded = false;

  async function flush(): Promise<void> {
    await deps.store.write(STORE_KEY, encoder.encode(JSON.stringify([...entries.values()])));
  }

  async function load(): Promise<void> {
    loaded = true;
    entries.clear();

    const bytes = await deps.store.read(STORE_KEY);
    if (bytes === null) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(bytes));
    } catch {
      // A corrupt queue costs a few unreported receipts. Throwing here would put an ad
      // concern on the startup path, which §9 forbids outright.
      return;
    }

    if (!Array.isArray(parsed)) return;
    for (const candidate of parsed) {
      if (isReceipt(candidate)) entries.set(candidate.receiptId, candidate);
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (!loaded) await load();
  }

  return {
    load,

    async enqueue(receipt: Receipt): Promise<void> {
      await ensureLoaded();

      if (entries.has(receipt.receiptId)) return;
      entries.set(receipt.receiptId, receipt);

      // Map iteration is insertion-ordered, so the first key is the oldest entry.
      while (entries.size > RECEIPT_QUEUE_CAP) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }

      await flush();
    },

    async all(): Promise<Receipt[]> {
      await ensureLoaded();
      return [...entries.values()];
    },

    async ack(receiptIds: readonly string[]): Promise<void> {
      await ensureLoaded();

      let changed = false;
      for (const id of receiptIds) {
        if (entries.delete(id)) changed = true;
      }
      if (changed) await flush();
    },

    async size(): Promise<number> {
      await ensureLoaded();
      return entries.size;
    },
  };
}
