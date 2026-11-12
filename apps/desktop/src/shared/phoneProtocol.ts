/**
 * Phone link: what a phone and the person's own computer say to each other.
 *
 * The computer is the host. The phone page (`src/phone/`) is a remote for its chat: it lists
 * the conversations, opens one, sends a message, stops a turn, and arms "sleep when done". It
 * never sees a file, a terminal or a setting beyond that - the relay in between forwards these
 * messages and nothing else, and the computer checks every request it is sent, because the
 * relay and the network are not trusted with more than "this came from the same account".
 *
 * Kept small and pure: no DOM, no Node, no Electron. The desktop's main process and the phone
 * page both import it, and `test/phoneProtocol.test.ts` checks both directions.
 */

export const PHONE_PROTOCOL = "adcode.phone.v1";

/** A message from the phone longer than this is refused, not cut: half a request is worse. */
export const MAX_PHONE_TEXT = 8_000;
/** The most of one conversation a phone is sent when it opens it. */
export const MAX_SENT_MESSAGES = 60;
export const MAX_MESSAGE_CHARS = 6_000;
export const MAX_CHATS = 40;

export type PowerActionName = "nothing" | "sleep" | "hibernate" | "shutdown" | "lock";
const POWER_NAMES: readonly PowerActionName[] = ["nothing", "sleep", "hibernate", "shutdown", "lock"];

/* ── Phone → computer ───────────────────────────────────────────────────── */

export type PhoneRequest =
  | { readonly t: "hello" }
  | { readonly t: "chats" }
  | { readonly t: "open"; readonly sessionId: string }
  /** `sessionId` null starts a new conversation. `nonce` pairs the answer with the request. */
  | { readonly t: "send"; readonly text: string; readonly sessionId: string | null; readonly nonce: string }
  | { readonly t: "stop"; readonly sessionId: string }
  | { readonly t: "power"; readonly action: PowerActionName; readonly repeat: "once" | "always" }
  | { readonly t: "power-cancel" };

const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/;
const NONCE = /^[A-Za-z0-9_-]{1,40}$/;

/** The computer's check on everything a phone sends. Anything unexpected is null. */
export function parsePhoneRequest(raw: unknown): PhoneRequest | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > MAX_PHONE_TEXT * 2) return null;
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  switch (r["t"]) {
    case "hello":
    case "chats":
    case "power-cancel":
      return { t: r["t"] };
    case "open":
    case "stop": {
      const sessionId = r["sessionId"];
      if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return null;
      return { t: r["t"], sessionId };
    }
    case "send": {
      const text = r["text"];
      const sessionId = r["sessionId"];
      const nonce = r["nonce"];
      if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_PHONE_TEXT) return null;
      if (sessionId !== null && (typeof sessionId !== "string" || !SESSION_ID.test(sessionId))) return null;
      if (typeof nonce !== "string" || !NONCE.test(nonce)) return null;
      return { t: "send", text: text.trim(), sessionId, nonce };
    }
    case "power": {
      const action = r["action"];
      const repeat = r["repeat"] === "always" ? "always" : "once";
      if (typeof action !== "string" || !(POWER_NAMES as readonly string[]).includes(action)) return null;
      return { t: "power", action: action as PowerActionName, repeat };
    }
    default:
      return null;
  }
}

/* ── Computer → phone ───────────────────────────────────────────────────── */

export interface PhoneChatSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly running: boolean;
}

export interface PhoneMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: number;
}

export interface PhonePowerState {
  readonly supported: boolean;
  readonly action: PowerActionName;
  readonly repeat: "once" | "always";
  readonly actions: readonly PowerActionName[];
  readonly countdown: { readonly action: PowerActionName; readonly deadline: number } | null;
}

export interface PhoneDevice {
  readonly name: string;
  readonly platform: string;
  readonly project: string | null;
  readonly model: string | null;
}

/** One thing the assistant did, reduced to what a phone screen can show. */
export type PhoneEvent =
  | { readonly k: "text"; readonly text: string }
  | { readonly k: "thinking" }
  | { readonly k: "tool"; readonly label: string }
  | { readonly k: "status"; readonly text: string }
  | { readonly k: "error"; readonly detail: string }
  | { readonly k: "question" }
  | { readonly k: "ended"; readonly ended: "finished" | "stopped" | "failed" };

export type HostMessage =
  | { readonly t: "hello"; readonly device: PhoneDevice; readonly chats: readonly PhoneChatSummary[]; readonly power: PhonePowerState }
  | { readonly t: "chats"; readonly chats: readonly PhoneChatSummary[] }
  | { readonly t: "chat"; readonly sessionId: string; readonly title: string; readonly messages: readonly PhoneMessage[]; readonly running: boolean; readonly live: readonly PhoneEvent[] }
  | { readonly t: "event"; readonly sessionId: string; readonly event: PhoneEvent }
  | { readonly t: "sent"; readonly nonce: string; readonly sessionId: string }
  | { readonly t: "power"; readonly power: PhonePowerState }
  | { readonly t: "error"; readonly message: string; readonly nonce?: string };

/** The last `MAX_SENT_MESSAGES` messages, each cut to a size a phone can draw. */
export function phoneMessages(messages: readonly { readonly role: string; readonly text: string; readonly at: number }[]): PhoneMessage[] {
  return messages
    .filter((message): message is { role: "user" | "assistant"; text: string; at: number } => message.role === "user" || message.role === "assistant")
    .slice(-MAX_SENT_MESSAGES)
    .map((message) => ({
      role: message.role,
      text: message.text.length > MAX_MESSAGE_CHARS ? `${message.text.slice(0, MAX_MESSAGE_CHARS)}…` : message.text,
      at: message.at,
    }));
}

/** What a tool call looks like on a phone: "Editing app.ts", "Running npm test". */
export function toolLabel(name: string, input: Readonly<Record<string, unknown>>): string {
  const path = typeof input["path"] === "string" ? input["path"] : typeof input["file"] === "string" ? input["file"] : null;
  const base = path === null ? null : path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const command = typeof input["command"] === "string" ? input["command"] : null;
  const short = (value: string): string => (value.length > 60 ? `${value.slice(0, 57)}…` : value);
  if (/write|edit|create|replace|patch/i.test(name) && base !== null) return `Editing ${short(base)}`;
  if (/read|view|open/i.test(name) && base !== null) return `Reading ${short(base)}`;
  if (/command|terminal|shell|bash|run/i.test(name) && command !== null) return `Running ${short(command)}`;
  if (/search|grep|find|glob/i.test(name)) return "Searching the project";
  if (/browser|page|navigate|screenshot/i.test(name)) return "Using the browser";
  if (/list/i.test(name)) return "Looking around the project";
  return `Using ${short(name.replace(/[_-]+/g, " "))}`;
}

/**
 * An agent event, as the computer forwards it to a phone - or null for the many that a phone
 * has no use for (drafts of code, token counts, context readings).
 */
export function phoneEventFor(event: { readonly kind: string; readonly [key: string]: unknown }): PhoneEvent | null {
  switch (event.kind) {
    case "text":
      return typeof event["text"] === "string" && event["text"].length > 0 ? { k: "text", text: event["text"] } : null;
    case "thinking":
      return { k: "thinking" };
    case "tool-call": {
      const call = event["call"] as { name?: unknown; input?: unknown } | undefined;
      if (call === undefined || typeof call.name !== "string") return null;
      if (call.name === "ask_user") return { k: "question" };
      return { k: "tool", label: toolLabel(call.name, typeof call.input === "object" && call.input !== null ? call.input as Record<string, unknown> : {}) };
    }
    case "status":
      return typeof event["text"] === "string" ? { k: "status", text: event["text"].slice(0, 200) } : null;
    case "error":
    case "refusal":
      return { k: "error", detail: typeof event["detail"] === "string" ? event["detail"].slice(0, 500) : "Something went wrong." };
    case "run-ended": {
      const ended = event["ended"];
      return { k: "ended", ended: ended === "finished" || ended === "stopped" ? ended : "failed" };
    }
    default:
      return null;
  }
}

/* ── The phone's own view of a conversation ─────────────────────────────── */

export interface PhoneTimelineItem {
  readonly kind: "user" | "assistant" | "tool" | "error" | "notice";
  readonly text: string;
  /** Still being written: the phone shows a caret and keeps the item open for more text. */
  readonly open?: boolean;
}

export interface PhoneTimeline {
  readonly items: readonly PhoneTimelineItem[];
  readonly running: boolean;
  /** What it is doing right now, for the status line. Empty when idle. */
  readonly activity: string;
}

export function timelineFromChat(messages: readonly PhoneMessage[], running: boolean, live: readonly PhoneEvent[]): PhoneTimeline {
  let timeline: PhoneTimeline = {
    items: messages.map((message) => ({ kind: message.role, text: message.text })),
    running,
    activity: running ? "Working…" : "",
  };
  for (const event of live) timeline = applyPhoneEvent(timeline, event);
  return timeline;
}

/** The phone's message, shown at once while the computer starts on it. */
export function withUserMessage(timeline: PhoneTimeline, text: string): PhoneTimeline {
  return { items: [...closeOpen(timeline.items), { kind: "user", text }], running: true, activity: "Sending to your computer…" };
}

function closeOpen(items: readonly PhoneTimelineItem[]): PhoneTimelineItem[] {
  return items.map((item) => (item.open === true ? { kind: item.kind, text: item.text } : item));
}

/** Folds one event into the timeline: streamed text joins the reply it belongs to. */
export function applyPhoneEvent(timeline: PhoneTimeline, event: PhoneEvent): PhoneTimeline {
  const items = [...timeline.items];
  const last = items[items.length - 1];
  switch (event.k) {
    case "text":
      if (last !== undefined && last.kind === "assistant" && last.open === true) items[items.length - 1] = { ...last, text: last.text + event.text };
      else items.push({ kind: "assistant", text: event.text, open: true });
      return { items, running: true, activity: "Writing…" };
    case "thinking":
      return { ...timeline, running: true, activity: "Thinking…" };
    case "tool": {
      const closed = closeOpen(items);
      // A run of the same step ("Reading a.ts", "Reading a.ts") shows once.
      const previous = closed[closed.length - 1];
      if (!(previous?.kind === "tool" && previous.text === event.label)) closed.push({ kind: "tool", text: event.label });
      return { items: closed, running: true, activity: `${event.label}…` };
    }
    case "status":
      return { ...timeline, activity: event.text };
    case "question":
      return { items: [...closeOpen(items), { kind: "notice", text: "The assistant asked you something. Answer it on your computer to carry on." }], running: true, activity: "Waiting for your answer" };
    case "error":
      return { items: [...closeOpen(items), { kind: "error", text: event.detail }], running: timeline.running, activity: timeline.activity };
    case "ended":
      return {
        items: [...closeOpen(items), ...(event.ended === "stopped" ? [{ kind: "notice" as const, text: "Stopped." }] : [])],
        running: false,
        activity: "",
      };
  }
}

/** "iPhone · Safari" from a user agent: what the computer shows as the connected phone. */
/*
 * The QR code carries the computer's id (?pc=), so a phone that scans it goes straight to this
 * computer's chats after signing in instead of a list to pick from. The id is not a secret:
 * the relay only lets the same signed-in account reach it.
 */
const COMPUTER_ID = /^[a-f0-9-]{36}$/;

/** The page to open on the phone, pointing at one computer when its id is known. */
export function phonePairUrl(page: string, deviceId: string | null): string {
  if (deviceId === null || !COMPUTER_ID.test(deviceId)) return page;
  const url = new URL(page);
  url.searchParams.set("pc", deviceId);
  return url.toString();
}

/** The computer a scanned link points at, or null. */
export function pairedComputerFrom(search: string): string | null {
  const id = new URLSearchParams(search).get("pc");
  return id !== null && COMPUTER_ID.test(id) ? id : null;
}

export function describeUserAgent(agent: string): string {
  const device = /iPhone/.test(agent) ? "iPhone" : /iPad/.test(agent) ? "iPad" : /Android/.test(agent) ? "Android phone" : /Macintosh/.test(agent) ? "Mac" : /Windows/.test(agent) ? "Windows PC" : /Linux/.test(agent) ? "Linux" : "Browser";
  const browser = /EdgA?\//.test(agent) ? "Edge" : /SamsungBrowser/.test(agent) ? "Samsung Internet" : /Firefox|FxiOS/.test(agent) ? "Firefox" : /CriOS|Chrome/.test(agent) ? "Chrome" : /Safari/.test(agent) ? "Safari" : "";
  return browser === "" ? device : `${device} · ${browser}`;
}
