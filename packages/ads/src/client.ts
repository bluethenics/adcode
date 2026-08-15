/**
 * The four serving-contract calls (brief §10).
 *
 * Every response body passes through `validation.ts` before it is returned, and every
 * failure comes back as a `Result` rather than a throw. §9's governing rule is that the
 * ad client may fail in any way, and the worst permitted outcome is that the user sees
 * no ad - which is only true if failures cannot escape into a caller the editor shares.
 */
import {
  FETCH_TIMEOUT_MS,
  err,
  ok,
  type Balance,
  type Clock,
  type ClientError,
  type Creative,
  type HttpResponse,
  type HttpTransport,
  type Receipt,
  type RemoteConfig,
  type Result,
  type ServeRequest,
  type TokenProvider,
} from "./types.ts";
import {
  parseBalanceResponse,
  parseConfigResponse,
  parseReceiptsResponse,
  parseServeResponse,
} from "./validation.ts";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 200;

const decoder = new TextDecoder();

const clientError = (
  kind: ClientError["kind"],
  detail: string,
  status?: number,
): Result<never, ClientError> =>
  err(status === undefined ? { kind, detail } : { kind, detail, status });

export interface AdClientDeps {
  readonly http: HttpTransport;
  readonly tokens: TokenProvider;
  readonly clock: Clock;
  /** Base URL including the `/v1` prefix. */
  readonly baseUrl: string;
  /** The one host creative assets may be served from (§1). */
  readonly assetHost: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly backoffBaseMs?: number;
}

export interface AdClient {
  serve(request: ServeRequest): Promise<Result<Creative[], ClientError>>;
  postReceipts(receipts: readonly Receipt[]): Promise<Result<string[], ClientError>>;
  balance(): Promise<Result<Balance, ClientError>>;
  config(): Promise<Result<RemoteConfig, ClientError>>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError" || /abort|timeout/i.test(error.message))
  );
}

export function createAdClient(deps: AdClientDeps): AdClient {
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffBaseMs = deps.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;

  /**
   * One authenticated call, with bounded exponential backoff plus jitter.
   *
   * 5xx and transport failures are retried; 4xx is not, because a request the server
   * has rejected on its merits will be rejected again, and retrying only spends the
   * user's battery. A 401 additionally invalidates the cached token so the next attempt
   * re-authenticates rather than replaying a dead credential.
   */
  async function call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Result<string, ClientError>> {
    const token = await deps.tokens.getToken();
    if (!token.ok) return clientError("auth", token.error.detail);

    let last: Result<string, ClientError> = clientError("network", "no attempt made");

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const backoff = backoffBaseMs * 2 ** (attempt - 1);
        await sleep(backoff + Math.floor(Math.random() * backoffBaseMs));
      }

      let response: HttpResponse;
      try {
        response = await deps.http.request({
          method,
          url: `${deps.baseUrl}${path}`,
          headers: {
            authorization: `Bearer ${token.value}`,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          timeoutMs,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "transport failure";
        last = clientError(isAbort(error) ? "timeout" : "network", detail);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        deps.tokens.invalidate();
        return clientError("auth", `HTTP ${response.status}`, response.status);
      }

      if (response.status >= 400 && response.status < 500) {
        return clientError("http", `HTTP ${response.status}`, response.status);
      }

      if (response.status >= 500) {
        last = clientError("http", `HTTP ${response.status}`, response.status);
        continue;
      }

      return ok(decoder.decode(response.body));
    }

    return last;
  }

  return {
    async serve(request: ServeRequest): Promise<Result<Creative[], ClientError>> {
      const raw = await call("POST", "/serve", {
        tags: request.tags,
        themeKind: request.themeKind,
        count: request.count,
      });
      if (!raw.ok) return raw;

      const parsed = parseServeResponse(raw.value, deps.assetHost);
      return parsed.ok ? ok(parsed.value) : clientError("validation", parsed.error.detail);
    },

    async postReceipts(receipts: readonly Receipt[]): Promise<Result<string[], ClientError>> {
      const raw = await call("POST", "/receipts", { receipts });
      if (!raw.ok) return raw;

      const parsed = parseReceiptsResponse(raw.value);
      return parsed.ok ? ok(parsed.value) : clientError("validation", parsed.error.detail);
    },

    async balance(): Promise<Result<Balance, ClientError>> {
      const raw = await call("GET", "/balance");
      if (!raw.ok) return raw;

      const parsed = parseBalanceResponse(raw.value);
      return parsed.ok ? ok(parsed.value) : clientError("validation", parsed.error.detail);
    },

    async config(): Promise<Result<RemoteConfig, ClientError>> {
      const raw = await call("GET", "/config");
      if (!raw.ok) return raw;

      const parsed = parseConfigResponse(raw.value);
      return parsed.ok ? ok(parsed.value) : clientError("validation", parsed.error.detail);
    },
  };
}
