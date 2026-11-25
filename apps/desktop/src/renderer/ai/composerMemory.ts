/**
 * What the composer remembers for you: drafts that survive a reload, prompts stashed for later,
 * and pastes too big to type into.
 *
 * Brought over from T3 Code's composer, for people who live in the chat all day:
 *
 *  - **Drafts** are kept per conversation as you type. A reload, a crash or a switch to another
 *    chat no longer loses a long prompt; coming back with an empty composer puts it back.
 *  - **Stash**: Ctrl+S (Cmd+S) saves the prompt and its attachments for later and clears the
 *    composer. In an empty composer the same key brings back the only stash, or lists them.
 *  - **Big pastes** - a log, a stack trace, a file - become a text attachment instead of filling
 *    the box. Ctrl+Shift+V (Cmd+Shift+V) keeps one in the text.
 *
 * Plain functions over a key-value store (localStorage in the app, a map in tests). Storage can
 * be full or blocked; every write is best effort and nothing here throws.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage, with a blocked or full store treated as empty rather than as an error. */
export const browserStore: KeyValueStore = {
  getItem(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try { localStorage.setItem(key, value); } catch { /* full or blocked: this session only */ }
  },
};

function readJson(store: KeyValueStore, key: string): unknown {
  try {
    return JSON.parse(store.getItem(key) ?? "null") as unknown;
  } catch {
    return null;
  }
}

function writeJson(store: KeyValueStore, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Not serialisable or not storable: keep going without it.
  }
}

/* ── Drafts ──────────────────────────────────────────────────────────────────────────── */

export const DRAFTS_KEY = "adcode.chat.drafts";
export const MAX_DRAFTS = 50;
export const MAX_DRAFT_CHARS = 200_000;
export const DRAFT_DAYS = 14;

interface DraftRecord { readonly text: string; readonly at: number }

/** The key a conversation's draft is kept under; a chat not saved yet shares "new". */
export function draftKey(sessionId: string | null): string {
  return sessionId ?? "new";
}

function readDrafts(store: KeyValueStore): Record<string, DraftRecord> {
  const raw = readJson(store, DRAFTS_KEY);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, DraftRecord> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const record = value as Partial<DraftRecord> | null;
    if (record !== null && typeof record === "object" && typeof record.text === "string" && typeof record.at === "number") out[key] = { text: record.text, at: record.at };
  }
  return out;
}

export function readDraft(store: KeyValueStore, key: string, now = Date.now()): string | null {
  const record = readDrafts(store)[key];
  if (record === undefined || now - record.at > DRAFT_DAYS * 86_400_000 || record.text.trim().length === 0) return null;
  return record.text;
}

/** Keep `text` as the draft for `key`; empty text forgets it. Oldest drafts go past the cap. */
export function writeDraft(store: KeyValueStore, key: string, text: string, now = Date.now()): void {
  const drafts = readDrafts(store);
  if (text.trim().length === 0) {
    if (!(key in drafts)) return;
    delete drafts[key];
  } else {
    if (drafts[key]?.text === text) return;
    drafts[key] = { text: text.slice(0, MAX_DRAFT_CHARS), at: now };
  }
  const fresh = Object.entries(drafts)
    .filter(([, record]) => now - record.at <= DRAFT_DAYS * 86_400_000)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_DRAFTS);
  writeJson(store, DRAFTS_KEY, Object.fromEntries(fresh));
}

/** A message was sent: no conversation should offer it again as a draft. */
export function forgetSentDraft(store: KeyValueStore, sent: string): void {
  const drafts = readDrafts(store);
  const wanted = sent.trim();
  const kept = Object.entries(drafts).filter(([, record]) => record.text.trim() !== wanted);
  if (kept.length !== Object.keys(drafts).length) writeJson(store, DRAFTS_KEY, Object.fromEntries(kept));
}

/* ── Stash ───────────────────────────────────────────────────────────────────────────── */

export const STASH_KEY = "adcode.chat.promptStash";
export const MAX_STASHES = 20;
/** Attachments past this size are left out of a stash; the text is always kept. */
export const MAX_STASH_ATTACHMENT_CHARS = 1_500_000;

export interface StashedAttachment {
  readonly name: string;
  readonly kind: string;
  readonly mediaType: string;
  readonly data: string;
}

export interface StashedPrompt {
  readonly id: string;
  readonly text: string;
  readonly at: number;
  readonly attachments: readonly StashedAttachment[];
}

function isAttachment(value: unknown): value is StashedAttachment {
  const item = value as Partial<StashedAttachment> | null;
  return item !== null && typeof item === "object" && typeof item.name === "string" && typeof item.kind === "string" && typeof item.mediaType === "string" && typeof item.data === "string";
}

/** Newest first. */
export function readStash(store: KeyValueStore): StashedPrompt[] {
  const raw = readJson(store, STASH_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): StashedPrompt[] => {
    const item = value as Partial<StashedPrompt> | null;
    if (item === null || typeof item !== "object" || typeof item.id !== "string" || typeof item.text !== "string" || typeof item.at !== "number") return [];
    return [{ id: item.id, text: item.text, at: item.at, attachments: Array.isArray(item.attachments) ? item.attachments.filter(isAttachment) : [] }];
  }).sort((a, b) => b.at - a.at);
}

/**
 * Stash a prompt. Returns the stash and whether attachments were left out for size. Nothing
 * to stash (no text, no attachments) changes nothing.
 */
export function addToStash(
  store: KeyValueStore,
  prompt: { readonly text: string; readonly attachments: readonly StashedAttachment[] },
  now = Date.now(),
  id = `stash-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): { readonly stash: StashedPrompt[]; readonly droppedAttachments: boolean } {
  const stash = readStash(store);
  if (prompt.text.trim().length === 0 && prompt.attachments.length === 0) return { stash, droppedAttachments: false };
  const size = prompt.attachments.reduce((sum, item) => sum + item.data.length, 0);
  const droppedAttachments = size > MAX_STASH_ATTACHMENT_CHARS;
  const entry: StashedPrompt = {
    id,
    text: prompt.text.slice(0, MAX_DRAFT_CHARS),
    at: now,
    attachments: droppedAttachments ? [] : prompt.attachments.map(({ name, kind, mediaType, data }) => ({ name, kind, mediaType, data })),
  };
  const next = [entry, ...stash].slice(0, MAX_STASHES);
  writeJson(store, STASH_KEY, next);
  // A full store keeps the text: try again without attachments before giving up.
  if (readStash(store)[0]?.id !== id && entry.attachments.length > 0) {
    writeJson(store, STASH_KEY, [{ ...entry, attachments: [] }, ...stash].slice(0, MAX_STASHES));
    return { stash: readStash(store), droppedAttachments: true };
  }
  return { stash: readStash(store), droppedAttachments };
}

/** Remove a stash and return it, to put back in the composer. */
export function takeFromStash(store: KeyValueStore, id: string): StashedPrompt | null {
  const stash = readStash(store);
  const found = stash.find((item) => item.id === id) ?? null;
  if (found !== null) writeJson(store, STASH_KEY, stash.filter((item) => item.id !== id));
  return found;
}

/** "Fix the login redirect… · 5 min ago · 2 files" for the stash list. */
export function stashLabel(item: StashedPrompt, now = Date.now()): string {
  const first = item.text.trim().split(/\r?\n/)[0] ?? "";
  const words = first.length > 70 ? `${first.slice(0, 69)}…` : first.length > 0 ? first : "(attachments only)";
  const minutes = Math.max(0, Math.round((now - item.at) / 60_000));
  const age = minutes < 1 ? "just now" : minutes < 60 ? `${String(minutes)} min ago` : minutes < 2_880 ? `${String(Math.round(minutes / 60))} h ago` : `${String(Math.round(minutes / 1_440))} days ago`;
  const files = item.attachments.length === 0 ? "" : ` · ${String(item.attachments.length)} file${item.attachments.length === 1 ? "" : "s"}`;
  return `${words} · ${age}${files}`;
}

/* ── Big pastes ──────────────────────────────────────────────────────────────────────── */

/** T3 Code's threshold: 32 KiB of pasted text becomes an attachment. */
export const PASTE_ATTACH_BYTES = 32 * 1024;

/** Whether a paste should become an attachment rather than text in the box. */
export function pasteBecomesAttachment(text: string, keepInline: boolean): boolean {
  if (keepInline || text.length === 0) return false;
  // Characters are at least one UTF-8 byte: a short string cannot reach the threshold.
  if (text.length * 3 < PASTE_ATTACH_BYTES) return false;
  return new TextEncoder().encode(text).length >= PASTE_ATTACH_BYTES;
}

/** A name for a pasted attachment that says what it probably is. */
export function pasteName(text: string, index: number): string {
  const head = text.slice(0, 2_000);
  const kind = /^\s*[{[]/.test(head) ? "json"
    : /^\s*<(?:!doctype|html|\?xml|svg)/i.test(head) ? "html"
      : /(?:^|\n)\s*at .+\(.+:\d+:\d+\)|Traceback \(most recent call last\)|Exception in thread/.test(head) ? "log"
        : /(?:^|\n)(?:diff --git|@@ -\d)/.test(head) ? "diff"
          : "txt";
  return `pasted-${String(index)}.${kind}`;
}
