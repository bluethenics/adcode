/**
 * Routing and error mapping.
 *
 * Deliberately the least clever file in the service: a bug in `money.ts` is expensive and
 * quiet, a bug here is obvious the first time anyone calls the endpoint. All the logic
 * worth testing hard lives in the modules this one wires together.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { authenticate, type TokenVerifier } from "./auth.ts";
import { handleServe } from "./serve.ts";
import { handleReceipts } from "./receipts.ts";
import { handleBalance, handleLedger } from "./balance.ts";
import { handleConfig } from "./config.ts";
import { handleAdminLedger } from "./admin.ts";
import { parseReceiptsRequest, parseReportRequest, parseServeRequest } from "./contract.ts";
import { handleAdminListReports, handleSubmitReport } from "./reports.ts";
import { checkRate } from "./rateLimit.ts";
import { createMemoryStore } from "./memoryStore.ts";
import type { Clock, IdGen, Store } from "./store.ts";

export interface ApiServer {
  url: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pageFrom(url: URL): { limit: number; cursor: string | null } {
  const raw = Number(url.searchParams.get("limit") ?? String(DEFAULT_PAGE_LIMIT));
  const limit = Number.isInteger(raw) ? Math.max(1, Math.min(raw, MAX_PAGE_LIMIT)) : DEFAULT_PAGE_LIMIT;
  return { limit, cursor: url.searchParams.get("cursor") };
}

const ADMIN_LEDGER = /^\/v1\/admin\/users\/([^/]+)\/ledger$/;

export async function createApiServer(
  options: {
    port?: number;
    store?: Store;
    verifier?: TokenVerifier;
    clock?: Clock;
    ids?: IdGen;
  } = {},
): Promise<ApiServer> {
  const verifier = options.verifier;
  if (verifier === undefined) throw new Error("a TokenVerifier is required");

  const store = options.store ?? createMemoryStore();
  const clock = options.clock ?? { now: () => Date.now() };

  let counter = 0;
  const ids = options.ids ?? { next: (prefix: string) => `${prefix}-${++counter}-${Date.now()}` };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    if (!path.startsWith("/v1/")) {
      send(res, 404, { error: "not found" });
      return;
    }

    const auth = await authenticate({ store, verifier, clock }, req.headers.authorization);
    if (!auth.ok) {
      // A ban is 403 rather than 401: the credentials are fine, the answer is still no,
      // and a client that retries auth on a 401 would loop forever.
      send(res, auth.failure === "banned" ? 403 : 401, { error: auth.failure });
      return;
    }

    // Spec §9. Applied after authentication so the counter is per verified UID rather
    // than per connection, and before any routing so no endpoint can be exempted by
    // accident.
    const config = await store.getConfig();
    if (!(await checkRate(store, config, auth.uid, clock.now()))) {
      res.writeHead(429, {
        "content-type": "application/json",
        "retry-after": String(Math.ceil(config.rateWindowMs / 1000)),
      });
      res.end(JSON.stringify({ error: "rate-limited" }));
      return;
    }

    if (path === "/v1/admin/reports" && req.method === "GET") {
      if (!auth.isAdmin) {
        send(res, 403, { error: "not-admin" });
        return;
      }
      send(res, 200, await handleAdminListReports({ store, clock, ids }, auth.uid, pageFrom(url)));
      return;
    }

    const admin = ADMIN_LEDGER.exec(path);
    if (admin !== null && req.method === "GET") {
      if (!auth.isAdmin) {
        send(res, 403, { error: "not-admin" });
        return;
      }
      const subject = decodeURIComponent(admin[1] ?? "");
      send(res, 200, await handleAdminLedger({ store, clock }, auth.uid, subject, pageFrom(url)));
      return;
    }

    if (path === "/v1/serve" && req.method === "POST") {
      let raw: unknown;
      try {
        raw = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "malformed body" });
        return;
      }
      const body = parseServeRequest(raw);
      if (body === null) {
        send(res, 400, { error: "malformed serve request" });
        return;
      }
      send(res, 200, await handleServe({ store, clock, ids }, auth.uid, body));
      return;
    }

    if (path === "/v1/receipts" && req.method === "POST") {
      let raw: unknown;
      try {
        raw = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "malformed body" });
        return;
      }
      const body = parseReceiptsRequest(raw);
      if (body === null) {
        send(res, 400, { error: "malformed receipts request" });
        return;
      }
      send(res, 200, await handleReceipts({ store, clock, ids }, auth.uid, body));
      return;
    }

    if (path === "/v1/reports" && req.method === "POST") {
      let raw: unknown;
      try {
        raw = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "malformed body" });
        return;
      }
      const body = parseReportRequest(raw);
      if (body === null) {
        send(res, 400, { error: "malformed report" });
        return;
      }
      send(res, 200, await handleSubmitReport({ store, clock, ids }, auth.uid, body));
      return;
    }

    if (path === "/v1/balance" && req.method === "GET") {
      send(res, 200, await handleBalance(store, auth.uid));
      return;
    }

    if (path === "/v1/ledger" && req.method === "GET") {
      send(res, 200, await handleLedger(store, auth.uid, pageFrom(url)));
      return;
    }

    if (path === "/v1/config" && req.method === "GET") {
      send(res, 200, await handleConfig(store));
      return;
    }

    send(res, 404, { error: "not found" });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: "internal" });
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
