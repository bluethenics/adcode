/**
 * How the conversation list is ordered, and which chats are pinned to its top.
 *
 * The list used to have one order - last activity, grouped by day - which is right for "the
 * chat I had this morning" and wrong for every other way people look for one: by its name, the
 * oldest thing still open, the long one with the decisions in it. Asked for 17 November 2026.
 *
 * Pure: no DOM, no storage. The chat widget remembers the choice; this decides the order.
 */

export type ChatSortMode = "recent" | "created" | "oldest" | "name" | "longest";

export const CHAT_SORT_MODES: readonly { readonly id: ChatSortMode; readonly label: string }[] = [
  { id: "recent", label: "Recent activity" },
  { id: "created", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "name", label: "Name (A-Z)" },
  { id: "longest", label: "Most messages" },
];

/** Where the chosen order is remembered, per machine. */
export const CHAT_SORT_KEY = "adcode.chat.sort";
/** Where pinned conversation ids are remembered, per machine. */
export const CHAT_PINS_KEY = "adcode.chat.pins";
/** A pin list longer than this is a bug or a tampered file, not a person's choice. */
export const MAX_PINS = 50;

export function parseChatSort(value: string | null | undefined): ChatSortMode {
  return CHAT_SORT_MODES.some((mode) => mode.id === value) ? (value as ChatSortMode) : "recent";
}

export function parsePins(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === "") return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))].slice(0, MAX_PINS);
  } catch {
    return [];
  }
}

/** Pin or unpin `id`; a new pin goes first, so the latest pinned chat is the top one. */
export function togglePin(pins: readonly string[], id: string): string[] {
  return pins.includes(id) ? pins.filter((one) => one !== id) : [id, ...pins].slice(0, MAX_PINS);
}

export interface SortableChat {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messageCount: number;
}

/**
 * The chats in the chosen order. `activity` is when each chat's branch last moved (a working
 * fork keeps its parent near the top under Recent); ties fall back to newest activity, then to
 * the title, so the order never shuffles between two renders of the same list.
 */
export function sortChats<T extends SortableChat>(chats: readonly T[], mode: ChatSortMode, activity: ReadonlyMap<string, number> = new Map()): T[] {
  const moved = (chat: T): number => activity.get(chat.id) ?? chat.updatedAt;
  const tie = (a: T, b: T): number => moved(b) - moved(a) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  const order: Record<ChatSortMode, (a: T, b: T) => number> = {
    recent: (a, b) => moved(b) - moved(a) || tie(a, b),
    created: (a, b) => b.createdAt - a.createdAt || tie(a, b),
    oldest: (a, b) => a.createdAt - b.createdAt || tie(a, b),
    name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) || tie(a, b),
    longest: (a, b) => b.messageCount - a.messageCount || tie(a, b),
  };
  return [...chats].sort(order[mode]);
}

/** Pinned chats, in pin order, split from the rest; a pin whose chat is gone is skipped. */
export function splitPinned<T extends { readonly id: string }>(chats: readonly T[], pins: readonly string[]): { readonly pinned: T[]; readonly rest: T[] } {
  const byId = new Map(chats.map((chat) => [chat.id, chat] as const));
  const pinned = pins.map((id) => byId.get(id)).filter((chat): chat is T => chat !== undefined);
  const pinnedIds = new Set(pinned.map((chat) => chat.id));
  return { pinned, rest: chats.filter((chat) => !pinnedIds.has(chat.id)) };
}
