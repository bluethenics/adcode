/**
 * The browser tab's one connection to its sandbox.
 *
 * Everything the renderer asks of the main process travels here, as the frames in `wire.ts`.
 * The hard part is what happens when the network drops, which on the web it will:
 *
 * - The sandbox keeps working. An agent's turn does not stop because a laptop changed Wi-Fi.
 * - A call that only reads (status, lists, settings) is asked again after the reconnect.
 * - A call that changes something is rejected with a plain message and **never re-sent**:
 *   re-sending `ai.send` would start a second agent turn, a commit could land twice. The person
 *   sees the message and decides.
 * - A call made while disconnected never left the tab, so it is simply sent once the host is
 *   back.
 * - Fire-and-forget sends are dropped while disconnected, except the few that save state
 *   (session, drafts, activity), which keep their latest value and go out on reconnect.
 * - Close code 4401 means the sign-in was refused. Reconnecting cannot fix that, so the loop
 *   stops and the tab says so.
 */
import { CHANNELS } from "../shared/api.ts";
import { decodeFrame, encodeFrame, type AskKind, type ClientFrame, type CloudStatus, type HostHello } from "./wire.ts";

export interface WebSocketLike {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
}

export type ConnectionState = "connecting" | "open" | "reconnecting" | "paused" | "auth-failed" | "closed";

export interface HostSocket {
  invoke(channel: string, args: readonly unknown[]): Promise<unknown>;
  send(channel: string, args: readonly unknown[]): void;
  subscribe(channel: string, listener: (...args: unknown[]) => void): () => void;
  /** A frame of the protocol's own (auth, focus, input). Dropped while disconnected, except auth. */
  raw(frame: ClientFrame): void;
  /** A web-only host operation, such as listing projects or writing an uploaded file. */
  op(name: string, args: readonly unknown[]): Promise<unknown>;
  /** Ask the cloud for the public address of a sandbox-local preview URL. */
  previewUrl(url: string): Promise<string>;
  onStatus(listener: (state: ConnectionState) => void): () => void;
  onCloud(listener: (status: CloudStatus) => void): () => void;
  onAsk(handler: (kind: AskKind, payload: unknown) => Promise<unknown>): void;
  /** Resolves with the host's greeting the first time the connection is ready. */
  ready(): Promise<HostHello>;
  state(): ConnectionState;
  /** Connect again after the cloud paused the sandbox (asleep, no time left, full). */
  resume(): void;
  /** Test hook: drop the connection as a network failure would. */
  dropForTest(): void;
  close(): void;
}

/** Close code the cloud uses for a refused or expired sign-in. */
export const AUTH_FAILED_CODE = 4401;

/*
 * Close codes after which reconnecting on its own would be wrong: the sandbox went to sleep
 * (4408), this session's time is spent (4429), or the month is full (4402). Reconnecting would wake
 * it again and spend time nobody asked to spend, so the tab waits for the person to resume.
 */
export const PAUSE_CODES: ReadonlySet<number> = new Set([4408, 4429, 4402]);

/** Every sandbox is in use; this one waits its turn and tries again. */
export const BUSY_CODE = 4503;

const DEFAULT_BACKOFF_MS = [250, 500, 1000, 2000, 4000, 8000];
const BUSY_BACKOFF_MS = [5_000, 10_000, 15_000];
const PREVIEW_URL_TIMEOUT_MS = 5_000;

/*
 * Channels that only read, safe to ask again after a reconnect. Matched by the name the
 * desktop gives them in `CHANNELS`, so a new read channel joins by being named like one.
 */
const READ_NAME = /(Read|Status|List|Current|Get|Log|Diff|Versions|Sessions|Recents|Info|State|States|Changes|Traces|Controls|Allowance|Branches|Remotes|Identity|Detect|History|Profiles|Drafts|Connection|Checkpoints|Summary|Addresses|Restore|Breakpoints|Scopes|Properties|ContextUsage|Blame|ShowFile|CommitDetail|CommitFileDiff|FileHistory|LineChanges)$/;
export const READ_CHANNELS: ReadonlySet<string> = new Set([
  ...Object.entries(CHANNELS)
    // `aiClearSessions`, `gitSetIdentity` and `workspaceClearRecents` end like reads and are not.
    .filter(([name]) => READ_NAME.test(name) && !/(Clear|Set)[A-Z]/.test(name))
    .map(([, channel]) => channel),
  CHANNELS.searchRun,
  CHANNELS.quickOpen,
]);

/** Sends that save state: the latest one is kept while disconnected and sent on reconnect. */
const KEEP_LATEST: ReadonlySet<string> = new Set([CHANNELS.sessionSave, CHANNELS.historyDraft, CHANNELS.activityReport]);

const LOST = "Connection lost before this finished. Try again.";

interface Pending {
  readonly channel: string;
  readonly args: readonly unknown[];
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  sent: boolean;
}

export function createHostSocket(open: () => WebSocketLike, options: { backoffMs?: readonly number[]; busyRetryMs?: number } = {}): HostSocket {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const busyRetryMs = options.busyRetryMs;
  const pending = new Map<number, Pending>();
  const previewWaits = new Map<number, (url: string) => void>();
  const opWaits = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const subscribers = new Map<string, Set<(...args: unknown[]) => void>>();
  const statusListeners = new Set<(state: ConnectionState) => void>();
  const cloudListeners = new Set<(status: CloudStatus) => void>();
  const latestSends = new Map<string, readonly unknown[]>();
  const readyWaiters: ((hello: HostHello) => void)[] = [];
  let askHandler: (kind: AskKind, payload: unknown) => Promise<unknown> = async () => null;
  let latestAuth: ClientFrame | null = null;
  let hello: HostHello | null = null;
  let socket: WebSocketLike | null = null;
  let state: ConnectionState = "connecting";
  let attempt = 0;
  let busyAttempt = 0;
  let nextId = 1;
  let stopped = false;

  const setState = (next: ConnectionState): void => {
    if (state === next) return;
    state = next;
    for (const listener of statusListeners) listener(next);
  };

  const transmit = (frame: ClientFrame): boolean => {
    if (socket === null || state !== "open") return false;
    try {
      socket.send(encodeFrame(frame));
      return true;
    } catch {
      return false;
    }
  };

  const sendCall = (id: number, entry: Pending): void => {
    entry.sent = transmit({ t: "call", id, ch: entry.channel, args: entry.args });
  };

  const onReady = (greeting: HostHello): void => {
    hello = greeting;
    attempt = 0;
    busyAttempt = 0;
    setState("open");
    if (latestAuth !== null) transmit(latestAuth);
    for (const [id, entry] of pending) if (!entry.sent) sendCall(id, entry);
    for (const [channel, args] of latestSends) transmit({ t: "send", ch: channel, args });
    latestSends.clear();
    for (const wake of readyWaiters.splice(0)) wake(greeting);
  };

  const onMessage = (data: unknown): void => {
    const frame = decodeFrame(typeof data === "string" ? data : String(data));
    if (frame === null) return;
    switch (frame.t) {
      case "ready":
        onReady(frame.host);
        return;
      case "ret": {
        const entry = pending.get(frame.id);
        if (entry === undefined) return;
        pending.delete(frame.id);
        if (frame.ok) entry.resolve(frame.value);
        else entry.reject(new Error(`Error invoking remote method '${entry.channel}': Error: ${frame.error}`));
        return;
      }
      case "evt": {
        const set = subscribers.get(frame.ch);
        if (set === undefined) return;
        for (const listener of [...set]) {
          try {
            listener(...frame.args);
          } catch (error) {
            console.error(`[adcode] listener for ${frame.ch} failed`, error);
          }
        }
        return;
      }
      case "ask":
        void askHandler(frame.kind, frame.payload)
          .then((value) => transmit({ t: "answer", id: frame.id, ok: true, value }))
          .catch((error: unknown) => transmit({ t: "answer", id: frame.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
        return;
      case "cloud":
        for (const listener of cloudListeners) listener(frame.status);
        return;
      case "opRet": {
        const wait = opWaits.get(frame.id);
        opWaits.delete(frame.id);
        if (wait === undefined) return;
        if (frame.ok) wait.resolve(frame.value);
        else wait.reject(new Error(frame.error ?? "Something went wrong"));
        return;
      }
      case "previewUrl": {
        const wake = previewWaits.get(frame.id);
        previewWaits.delete(frame.id);
        wake?.(frame.url);
        return;
      }
      default:
        return;
    }
  };

  const onClose = (code: number): void => {
    socket = null;
    if (stopped) return;
    const error = new Error(code === AUTH_FAILED_CODE ? "Signed out. Sign in again to continue." : LOST);
    for (const wait of opWaits.values()) wait.reject(error);
    opWaits.clear();
    if (code === AUTH_FAILED_CODE) {
      stopped = true;
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      setState("auth-failed");
      return;
    }
    for (const [id, entry] of pending) {
      if (!entry.sent) continue;
      if (READ_CHANNELS.has(entry.channel)) {
        entry.sent = false;
      } else {
        pending.delete(id);
        entry.reject(new Error(LOST));
      }
    }
    if (PAUSE_CODES.has(code)) {
      setState("paused");
      return;
    }
    setState("reconnecting");
    // Retry newly available capacity promptly, without making every waiting tab retry together.
    const busyDelay = BUSY_BACKOFF_MS[Math.min(busyAttempt, BUSY_BACKOFF_MS.length - 1)]!;
    const delay = code === BUSY_CODE
      ? busyRetryMs ?? Math.round(busyDelay * (0.8 + Math.random() * 0.2))
      : backoff[Math.min(attempt, backoff.length - 1)] ?? 1000;
    busyAttempt = code === BUSY_CODE ? busyAttempt + 1 : 0;
    attempt += 1;
    setTimeout(connect, delay);
  };

  function connect(): void {
    if (stopped) return;
    const next = open();
    socket = next;
    next.onopen = () => undefined;
    next.onmessage = (event) => {
      if (socket === next) onMessage(event.data);
    };
    next.onclose = (event) => {
      if (socket === next) onClose(event.code);
    };
  }

  connect();

  return {
    invoke(channel, args) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const entry: Pending = { channel, args, resolve, reject, sent: false };
        pending.set(id, entry);
        if (stopped) {
          pending.delete(id);
          reject(new Error("Signed out. Sign in again to continue."));
          return;
        }
        sendCall(id, entry);
      });
    },
    send(channel, args) {
      if (transmit({ t: "send", ch: channel, args })) return;
      if (KEEP_LATEST.has(channel)) latestSends.set(channel, args);
    },
    subscribe(channel, listener) {
      let set = subscribers.get(channel);
      if (set === undefined) {
        set = new Set();
        subscribers.set(channel, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    raw(frame) {
      if (frame.t === "auth") latestAuth = frame;
      transmit(frame);
    },
    op(name, args) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        opWaits.set(id, { resolve, reject });
        if (!transmit({ t: "op", id, op: name, args })) {
          opWaits.delete(id);
          reject(new Error("Not connected. Try again in a moment."));
        }
      });
    },
    previewUrl(url) {
      return new Promise((resolve) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          previewWaits.delete(id);
          resolve(url);
        }, PREVIEW_URL_TIMEOUT_MS);
        previewWaits.set(id, (answer) => {
          clearTimeout(timer);
          resolve(answer);
        });
        if (!transmit({ t: "previewUrl", id, url })) {
          clearTimeout(timer);
          previewWaits.delete(id);
          resolve(url);
        }
      });
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onCloud(listener) {
      cloudListeners.add(listener);
      return () => cloudListeners.delete(listener);
    },
    onAsk(handler) {
      askHandler = handler;
    },
    ready() {
      return hello !== null && state === "open" ? Promise.resolve(hello) : new Promise((resolve) => readyWaiters.push(resolve));
    },
    state: () => state,
    resume() {
      if (state !== "paused") return;
      attempt = 0;
      setState("connecting");
      connect();
    },
    dropForTest() {
      socket?.close(4000, "test drop");
    },
    close() {
      stopped = true;
      setState("closed");
      socket?.close(1000, "closed");
    },
  };
}
