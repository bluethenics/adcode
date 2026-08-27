/**
 * In-memory implementations of the six ports.
 *
 * These are why the whole ad client is testable before a window exists (brief §2):
 * every capability the package needs crosses one of these seams.
 */
import type {
  Clock,
  FileStore,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  IdeSignals,
  NotificationHandle,
  NotificationSink,
  SponsoredNotification,
  ThemeKind,
  TokenProvider,
  Result,
  AuthError,
} from "../src/types.ts";

/* ── Clock ──────────────────────────────────────────────────────────────── */

export class FakeClock implements Clock {
  #now: number;

  constructor(start = 1_700_000_000_000) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  advance(ms: number): void {
    this.#now += ms;
  }

  set(ms: number): void {
    this.#now = ms;
  }
}

/* ── HttpTransport ──────────────────────────────────────────────────────── */

export interface StubResponse {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  bytes?: Uint8Array;
  /** Throw instead of responding, to model a network failure or timeout. */
  throws?: Error;
}

const encoder = new TextEncoder();

export function bodyOf(stub: StubResponse): Uint8Array {
  if (stub.bytes) return stub.bytes;
  if (stub.text !== undefined) return encoder.encode(stub.text);
  if (stub.json !== undefined) return encoder.encode(JSON.stringify(stub.json));
  return new Uint8Array(0);
}

export class FakeHttpTransport implements HttpTransport {
  readonly calls: HttpRequest[] = [];
  #queue: StubResponse[];
  #fallback: StubResponse | null;

  constructor(queue: StubResponse[] = [], fallback: StubResponse | null = null) {
    this.#queue = [...queue];
    this.#fallback = fallback;
  }

  push(...responses: StubResponse[]): void {
    this.#queue.push(...responses);
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.calls.push(req);
    const stub = this.#queue.shift() ?? this.#fallback;
    if (!stub) throw new Error(`FakeHttpTransport: no stubbed response for ${req.method} ${req.url}`);
    if (stub.throws) throw stub.throws;
    return {
      status: stub.status ?? 200,
      headers: stub.headers ?? { "content-type": "application/json" },
      body: bodyOf(stub),
    };
  }
}

/* ── FileStore ──────────────────────────────────────────────────────────── */

export class FakeFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();

  async read(key: string): Promise<Uint8Array | null> {
    return this.files.get(key) ?? null;
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    this.files.set(key, data);
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

/* ── TokenProvider ──────────────────────────────────────────────────────── */

export class FakeTokenProvider implements TokenProvider {
  invalidated = 0;
  private token: string | AuthError;

  constructor(token: string | AuthError = "test-token") {
    this.token = token;
  }

  async getToken(): Promise<Result<string, AuthError>> {
    return typeof this.token === "string"
      ? { ok: true, value: this.token }
      : { ok: false, error: this.token };
  }

  invalidate(): void {
    this.invalidated += 1;
  }

  setToken(next: string | AuthError): void {
    this.token = next;
  }
}

/* ── NotificationSink ───────────────────────────────────────────────────── */

export interface ShownNotification {
  notification: SponsoredNotification;
  dismissed: boolean;
}

export class FakeNotificationSink implements NotificationSink {
  readonly shown: ShownNotification[] = [];

  show(notification: SponsoredNotification): NotificationHandle {
    const entry: ShownNotification = { notification, dismissed: false };
    this.shown.push(entry);
    return {
      update: (next) => {
        entry.notification = next;
      },
      dismiss: () => {
        entry.dismissed = true;
      },
    };
  }

  last(): SponsoredNotification {
    const entry = this.shown.at(-1);
    if (!entry) throw new Error("FakeNotificationSink: nothing has been shown");
    return entry.notification;
  }
}

/* ── IdeSignals ─────────────────────────────────────────────────────────── */

export class FakeIdeSignals implements IdeSignals {
  focused = true;
  debugging = false;
  dnd = false;
  theme: ThemeKind = "dark";
  languages: string[] = ["typescript"];
  files: string[] = ["package.json", "tsconfig.json"];

  windowFocused(): boolean {
    return this.focused;
  }

  debugActive(): boolean {
    return this.debugging;
  }

  doNotDisturb(): boolean {
    return this.dnd;
  }

  themeKind(): ThemeKind {
    return this.theme;
  }

  languageIds(): readonly string[] {
    return this.languages;
  }

  filenames(): readonly string[] {
    return this.files;
  }
}
