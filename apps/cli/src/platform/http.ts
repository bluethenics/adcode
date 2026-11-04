import type { HttpRequest, HttpResponse, HttpTransport } from "../../../../packages/ads/src/types.ts";

/**
 * `fetch` with an abort-based timeout, implementing the ad client's transport port.
 *
 * `rewrites` exists for development only: the mock server advertises assets on the
 * allowlisted https host while serving bytes from localhost, so the validator can still
 * enforce the https-and-exact-host rule against a real response.
 */
export class FetchHttpTransport implements HttpTransport {
  readonly #rewrites: ReadonlyArray<readonly [string, string]>;
  readonly #stopped = new AbortController();

  constructor(rewrites: ReadonlyArray<readonly [string, string]> = []) {
    this.#rewrites = rewrites;
  }

  /**
   * Stop every request, including ones already in flight.
   *
   * Quitting a screen must not wait for a sponsor server, and a pending `fetch` keeps the
   * event loop alive for its full timeout. The ad queue is on disk, so a receipt that did
   * not go out is sent on the next launch rather than holding the terminal hostage.
   */
  abort(): void {
    this.#stopped.abort();
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    if (request.timeoutMs <= 0) throw new Error("timed out");
    if (this.#stopped.signal.aborted) throw new Error("aborted");
    let url = request.url;
    for (const [from, to] of this.#rewrites) {
      if (url.startsWith(from)) {
        url = `${to}${url.slice(from.length)}`;
        break;
      }
    }
    const response = await fetch(url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: AbortSignal.any([AbortSignal.timeout(request.timeoutMs), this.#stopped.signal]),
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      headers,
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }
}

/** Plain JSON `fetch` for the parts of the CLI that are not the ad client. */
export async function fetchJson(
  url: string,
  options: { readonly headers?: Readonly<Record<string, string>>; readonly timeoutMs?: number; readonly method?: "GET" | "POST"; readonly body?: string } = {},
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.body === undefined ? {} : { body: options.body }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}
