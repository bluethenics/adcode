/**
 * The service, reached by a Web `Request` instead of a socket.
 *
 * `server.ts` is the `node:http` transport. This is the other one, and it exists because
 * the API now ships inside the Next app on Cloudflare, where there is nothing to listen
 * on - a request arrives as a `Request` and a `Response` goes back.
 *
 * **Why this is an adapter and not a second router.** Every route, every status code and
 * every piece of error mapping stays in `createRequestHandler`. Duplicating the routing
 * per transport is how a deployed API and a tested API quietly stop agreeing; the
 * conformance suite in `test/conformance/fetchHandler.test.ts` runs the entire wire
 * contract through this file for the same reason.
 *
 * The surface being shimmed is genuinely small - the handler touches six members of
 * Node's request and response objects and nothing else:
 *
 *   req.url, req.method, req.headers, and async iteration for the body;
 *   res.writeHead(status, headers), res.end(body), and res.headersSent.
 *
 * That is what makes a shim the right call here rather than a rewrite. If the handler
 * ever reaches for a seventh, TypeScript will not catch it - the cast below is the price
 * of the adapter - but the conformance run will.
 */
import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequestHandler, type ApiOptions } from "./server.ts";

/** Just enough of `IncomingMessage` for the handler, including the body iteration. */
class ShimRequest {
  readonly headers: Record<string, string> = {};
  readonly url: string;
  readonly method: string;
  // Fields are declared and assigned rather than using constructor parameter properties,
  // which `erasableSyntaxOnly` disallows: they emit code, and this repo's TypeScript must
  // be strippable to JavaScript without a transform.
  private readonly body: Uint8Array;

  constructor(url: string, method: string, headers: Headers, body: Uint8Array) {
    this.url = url;
    this.method = method;
    this.body = body;

    // Node lowercases incoming header names and the handler reads them that way
    // (`req.headers.origin`). `Headers` already iterates lowercased, so this is a copy
    // rather than a conversion - but relying on that implicitly would be a trap.
    headers.forEach((value, key) => {
      this.headers[key.toLowerCase()] = value;
    });
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body.byteLength > 0) yield Buffer.from(this.body);
  }
}

/**
 * Just enough of `ServerResponse`: collect what was written instead of sending it.
 *
 * The body is `string | Uint8Array`, not `string`. `/assets/:key` answers with image bytes,
 * and a `Buffer` narrowed to `string` here would have been a lie that happened to work -
 * `Response` accepts a `BufferSource`, so it would have shipped correct images with wrong
 * types until somebody trusted the type and called `.length` on it.
 */
class ShimResponse {
  status = 200;
  readonly headers: Record<string, string> = {};
  body: string | Uint8Array | null = null;
  headersSent = false;

  writeHead(status: number, headers: Record<string, string> = {}): this {
    this.status = status;
    for (const [key, value] of Object.entries(headers)) this.headers[key] = value;
    this.headersSent = true;
    return this;
  }

  end(body?: string | Uint8Array): void {
    if (body !== undefined) this.body = body;
  }
}

/**
 * What the shim collected, as something `Response` will take.
 *
 * The copy is not ceremony. `Buffer.from(...)` widens to `Uint8Array<ArrayBufferLike>`, and
 * a `Response` body does not accept that - such a buffer can be backed by a
 * `SharedArrayBuffer`, which a `Response` may not be. Copying into a fresh array yields a
 * plain `ArrayBuffer` and says so in the type, rather than casting the problem away.
 *
 * `BodyInit` is deliberately not named: this file also compiles under a config without the
 * DOM lib, where that type does not exist even though `Response` does.
 */
function toBodyInit(body: string | Uint8Array | null): string | ArrayBuffer | null {
  if (body === null || typeof body === "string") return body;

  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy.buffer;
}

/**
 * A `fetch`-shaped entry point to the whole API.
 *
 * The options are the same ones `createApiServer` takes, minus `port`, which means
 * nothing here.
 */
export function createFetchHandler(
  options: Omit<ApiOptions, "port"> = {},
): (request: Request) => Promise<Response> {
  const handle = createRequestHandler(options);

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    // The handler parses `req.url` against a dummy origin, exactly as Node hands it over:
    // a path with its query string, never an absolute URL.
    const path = `${url.pathname}${url.search}`;

    // GET and HEAD have no body to read, and asking for one throws on some runtimes.
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? new Uint8Array(0)
        : new Uint8Array(await request.arrayBuffer());

    const req = new ShimRequest(path, request.method, request.headers, body);
    const res = new ShimResponse();

    try {
      // The cast is the adapter's one unavoidable lie: these shims implement the members
      // the handler uses, not the full Node interfaces.
      await handle(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    } catch {
      // Mirrors what `createApiServer` does with a rejected handler. A thrown error must
      // not escape as an unhandled rejection that the platform turns into a blank 500
      // with no CORS headers.
      if (!res.headersSent) {
        return new Response(JSON.stringify({ error: "internal" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return new Response(toBodyInit(res.body), { status: res.status, headers: res.headers });
  };
}
