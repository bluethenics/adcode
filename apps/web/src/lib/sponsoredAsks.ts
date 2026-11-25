/**
 * What the sponsored page will pass on to a partner (2026-11-25).
 *
 * Zeekend suspended ADCode's account for questions no user wrote and for the same question
 * resent every 30 seconds with a rising turn. Versions 2.6.1 to 2.6.5 of the app and the web
 * version did exactly that, and they stay installed for weeks, so the rule is kept here, in the
 * page every one of them asks: a partner is asked about a message a person sent, once, and the
 * turn it is told is the conversation's own count of different exchanges, whatever the app says.
 *
 * Each card is a new page, so what has been asked is kept in the browser's storage for this
 * origin. When storage is refused the page can no longer tell a repeat from a first ask, and it
 * asks nothing: a partner is never asked on a guess.
 */

/** Sentences ADCode's own code wrote in a person's name. Nobody typed them; nothing is asked with them. */
const CANNED: readonly RegExp[] = [
  /^I'm a software developer working in my code editor all day\./,
  /^I spend long days building a .{1,200} project at my desk\. What gear would make the work more comfortable\?$/,
  /^I'm a developer working on a .{1,200} project\. What would help me focus and stay productive through the day\?$/,
  /^What's worth buying for a programmer who works on .{1,200} code for hours at a time\?$/,
];

export function isCannedQuestion(request: string): boolean {
  const text = request.trim();
  return CANNED.some((pattern) => pattern.test(text));
}

const STORAGE_KEY = "adcode.sponsored.asked.v1";
const MAX_CONVERSATIONS = 50;
const MAX_EXCHANGES = 500;

type Stored = Record<string, string[]>;

export interface AskStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A short fingerprint of an exchange; only whether it was seen before matters. */
function fingerprint(request: string, response: string): string {
  let a = 2166136261;
  let b = 5381;
  const text = `${request}\u0000${response}`;
  for (let index = 0; index < text.length; index += 1) {
    a = Math.imul(a ^ text.charCodeAt(index), 16777619) >>> 0;
    b = (Math.imul(b, 33) + text.charCodeAt(index)) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}${text.length.toString(36)}`;
}

function browserStorage(): AskStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The conversation's user turn for this exchange - 1 for its first, 2 for its second - or null
 * when nothing may be asked: a canned sentence, an exchange already asked about, or no storage
 * to know by. Counted here, from the exchanges a conversation has really had.
 */
export function admitExchange(sessionId: string, request: string, response: string, storage: AskStorage | null = browserStorage()): number | null {
  if (storage === null || isCannedQuestion(request) || request.trim() === "" || response.trim() === "") return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    const stored: Stored = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Stored) : {};
    const seen = Array.isArray(stored[sessionId]) ? stored[sessionId]!.filter((item): item is string => typeof item === "string") : [];
    const key = fingerprint(request, response);
    if (seen.includes(key)) return null;
    seen.push(key);
    // Most recently used last, so the oldest conversation is the one forgotten.
    delete stored[sessionId];
    stored[sessionId] = seen.slice(-MAX_EXCHANGES);
    const ids = Object.keys(stored);
    for (const old of ids.slice(0, Math.max(0, ids.length - MAX_CONVERSATIONS))) delete stored[old];
    storage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return Math.min(10_000, seen.length);
  } catch {
    return null;
  }
}
