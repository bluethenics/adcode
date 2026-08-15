/**
 * A real `HttpTransport` over `fetch`, with one rewrite rule for tests.
 *
 * The client validator requires `https` on an allowlisted host (§1), and a local mock
 * necessarily listens on `http://127.0.0.1`. This bridges the two: creatives advertise
 * `https://cdn.adcode.test/assets/...`, and this transport rewrites that origin to the
 * mock's real address when actually fetching bytes.
 *
 * This is exactly what having the transport as an injected port buys. Nothing about the
 * validation is relaxed - it still sees, and still enforces, https.
 */
import type { HttpRequest, HttpResponse, HttpTransport } from "../src/types.ts";

export class BridgingHttpTransport implements HttpTransport {
  readonly calls: HttpRequest[] = [];
  #rewrites: ReadonlyArray<readonly [string, string]>;

  constructor(rewrites: ReadonlyArray<readonly [string, string]>) {
    this.#rewrites = rewrites;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.calls.push(req);

    let url = req.url;
    for (const [from, to] of this.#rewrites) {
      if (url.startsWith(from)) {
        url = to + url.slice(from.length);
        break;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const response = await fetch(url, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        ...(req.body === undefined ? {} : { body: req.body }),
        signal: controller.signal,
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        headers,
        body: new Uint8Array(await response.arrayBuffer()),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
