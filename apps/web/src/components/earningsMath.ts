/**
 * What the earnings screen folds out of the ledger rows it has loaded.
 *
 * Exact where a figure is shown (BigInt micros, formatted by `money.ts`), and floats only
 * where a value decides a pixel. Every function here is told what part of the ledger it can
 * see - `coveredFrom` - because the API pages the ledger and a busy account's month is more
 * rows than one page: a total computed from part of a period is reported as "at least", never
 * as the whole.
 */
import type { LedgerRowView } from "@/lib/api";

/** What counts as earning: exactly the kinds `lifetimeMicros` folds. */
export const EARNING_KINDS: ReadonlySet<string> = new Set(["impression", "click", "reversal", "referral", "contribution"]);
/** Sponsored cards: what they paid, and what was taken back. */
const CARD_KINDS: ReadonlySet<string> = new Set(["impression", "click", "reversal"]);

const DAY_MS = 86_400_000;

/** The last `count` UTC days, oldest first, as `YYYY-MM-DD`. */
export function calendar(count: number, now = Date.now()): string[] {
  return Array.from({ length: count }, (_, index) => new Date(now - (count - 1 - index) * DAY_MS).toISOString().slice(0, 10));
}

const micros = (row: LedgerRowView): bigint => {
  try {
    return BigInt(row.micros || "0");
  } catch {
    return 0n;
  }
};

/**
 * Per-day dollars for the chart, split into sponsored cards and everything else earned, and
 * each day's exact total in micros for the figures printed beside it.
 */
export function earningsByDay(rows: readonly LedgerRowView[], days: readonly string[]): { cards: number[]; extras: number[]; totals: bigint[] } {
  const cards = new Map<string, bigint>();
  const extras = new Map<string, bigint>();
  for (const row of rows) {
    if (!EARNING_KINDS.has(row.kind)) continue;
    const day = new Date(row.createdAt).toISOString().slice(0, 10);
    const into = CARD_KINDS.has(row.kind) ? cards : extras;
    into.set(day, (into.get(day) ?? 0n) + micros(row));
  }
  // A day whose corrections outweigh its credits draws as nothing, not as a bar below the axis;
  // the reversal itself is a row in the ledger.
  const dollars = (value: bigint | undefined): number => Math.max(0, Number(value ?? 0n) / 1_000_000);
  return {
    cards: days.map((day) => dollars(cards.get(day))),
    extras: days.map((day) => dollars(extras.get(day))),
    totals: days.map((day) => (cards.get(day) ?? 0n) + (extras.get(day) ?? 0n)),
  };
}

export interface PeriodTotal {
  /** Exact micros earned in the period, from the rows loaded. */
  readonly micros: bigint;
  /** False when the loaded rows start after the period does, so the total is a lower bound. */
  readonly complete: boolean;
}

/**
 * Earnings since `since` (a timestamp), from the rows loaded. `coveredFrom` is the oldest
 * moment the loaded rows are known to reach back to: null when nothing older exists.
 */
export function periodTotal(rows: readonly LedgerRowView[], since: number, coveredFrom: number | null): PeriodTotal {
  let total = 0n;
  for (const row of rows) {
    if (row.createdAt >= since && EARNING_KINDS.has(row.kind)) total += micros(row);
  }
  return { micros: total, complete: coveredFrom === null || coveredFrom <= since };
}

/** Local midnight today: "Today" means the reader's day, not UTC's. */
export function startOfToday(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** How many sponsored cards were paid for since `since`. */
export function cardsSeen(rows: readonly LedgerRowView[], since: number): number {
  return rows.filter((row) => row.kind === "impression" && row.createdAt >= since).length;
}

/**
 * Progress toward the withdrawal minimum, as the server set it. A percentage for the bar
 * (0-100, rounded down so the bar never claims more than is there) and the exact shortfall.
 */
export function withdrawProgress(availableMicros: string, minMicros: string): { percent: number; shortMicros: bigint; reached: boolean } {
  let available = 0n;
  let minimum = 0n;
  try {
    available = BigInt(availableMicros || "0");
    minimum = BigInt(minMicros || "0");
  } catch {
    return { percent: 0, shortMicros: 0n, reached: false };
  }
  if (minimum <= 0n) return { percent: 100, shortMicros: 0n, reached: true };
  if (available >= minimum) return { percent: 100, shortMicros: 0n, reached: true };
  const percent = available <= 0n ? 0 : Number((available * 100n) / minimum);
  return { percent, shortMicros: minimum - available, reached: false };
}

/** One line of the ledger as the reader sees it: a single entry, or a day's sponsored cards. */
export type LedgerLine =
  | { readonly type: "entry"; readonly row: LedgerRowView }
  | { readonly type: "cards"; readonly day: string; readonly rows: readonly LedgerRowView[]; readonly micros: bigint; readonly newest: number };

/**
 * Sponsored cards folded into one line per day, everything else left as it is.
 *
 * A card pays a fraction of a cent, so an active day is hundreds of identical rows - and a
 * withdrawal, a conversion or a correction between them is lost in the scroll. Folding the
 * cards keeps every other entry on its own line, in order, and the day's cards stay one click
 * away. Rows arrive newest first and keep that order.
 */
export function groupLedger(rows: readonly LedgerRowView[]): LedgerLine[] {
  type Slot = { type: "entry"; row: LedgerRowView } | { type: "cards"; day: string; rows: LedgerRowView[]; micros: bigint; newest: number };
  const slots: Slot[] = [];
  const open = new Map<string, Extract<Slot, { type: "cards" }>>();
  for (const row of rows) {
    if (row.kind !== "impression") {
      slots.push({ type: "entry", row });
      continue;
    }
    const day = new Date(row.createdAt).toISOString().slice(0, 10);
    const group = open.get(day);
    if (group !== undefined) {
      group.rows.push(row);
      group.micros += micros(row);
      continue;
    }
    const created = { type: "cards" as const, day, rows: [row], micros: micros(row), newest: row.createdAt };
    open.set(day, created);
    slots.push(created);
  }
  return slots;
}
