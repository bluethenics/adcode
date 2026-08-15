/**
 * Local implementation of the serving contract (brief §10).
 *
 * Imports nothing from `packages/` - see `contract.ts` for why, and
 * `.dependency-cruiser.cjs` for the rule that enforces it.
 *
 * Node 24 runs this directly with no build step, so it avoids enums, namespaces, and
 * parameter properties, which type stripping cannot erase.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  BalanceResponseBody,
  CadenceName,
  ConfigResponseBody,
  ReceiptsResponseBody,
  ServeResponseBody,
  ServedCreative,
  SubmittedReceipt,
} from "./contract.ts";

/** Micros credited per valid impression. The server owns this; the client never computes it. */
const MICROS_PER_IMPRESSION = 1_500n;
const MICROS_PER_CLICK = 25_000n;

/** A 1x1 transparent PNG - enough for the asset cache to have real bytes to store. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const THEMES = new Set(["light", "dark"]);
const OUTCOMES = new Set(["impression", "click", "dismissed"]);

/**
 * The hostname creatives advertise their assets on.
 *
 * Brief §1 requires creative assets to be `https` only from an allowlisted host, and
 * the client's validator enforces exactly that. A mock listening on plain
 * `http://127.0.0.1` therefore cannot advertise its own address - every creative would
 * be rejected before a test could assert anything, and the https rule would be
 * untestable rather than tested.
 *
 * So the mock *advertises* https URLs on this host and *serves* bytes on localhost. The
 * injected `HttpTransport` bridges the two, which is precisely what having it as a port
 * is for. Nothing weakens: the validator still sees https, still checks the hostname by
 * exact equality, and still rejects everything else.
 */
export const PUBLIC_ASSET_HOST = "cdn.adcode.test";

export interface MockServer {
  readonly url: string;
  /** Where assets are really served: `http://127.0.0.1:<port>/assets`. */
  readonly assetOrigin: string;
  /** Where creatives *say* their assets live: `https://cdn.adcode.test/assets`. */
  readonly publicAssetOrigin: string;
  /** The bare hostname, for the client's allowlist. */
  readonly assetHost: string;
  close(): Promise<void>;
  /** Replace the inventory with an exact list, so a test is not at the mercy of rotation. */
  seed(creatives: ServedCreative[]): void;
  setKillSwitch(on: boolean): void;
  receiptCount(): number;
  /** Fail the next `count` requests with `status`, for backoff tests. */
  failNext(count: number, status: number): void;
  /** Return unparseable bytes for the next `count` requests. */
  corruptNext(count: number): void;
  /** Delay the next `count` requests by `ms`, for timeout tests. */
  hangNext(count: number, ms: number): void;
}

interface State {
  receipts: Map<string, SubmittedReceipt>;
  availableMicros: bigint;
  lifetimeMicros: bigint;
  killSwitch: boolean;
  seeded: ServedCreative[] | null;
  failures: { remaining: number; status: number };
  corruptions: number;
  hangs: { remaining: number; ms: number };
}

function freshState(): State {
  return {
    receipts: new Map(),
    availableMicros: 0n,
    lifetimeMicros: 0n,
    killSwitch: false,
    seeded: null,
    failures: { remaining: 0, status: 500 },
    corruptions: 0,
    hangs: { remaining: 0, ms: 0 },
  };
}

function defaultInventory(assetOrigin: string): ServedCreative[] {
  const advertisers = [
    ["sentry", "Sentry", "catch errors before your users do"],
    ["linear", "Linear", "issue tracking built for speed"],
    ["fly", "Fly.io", "run your app close to your users"],
    ["neon", "Neon", "serverless Postgres with branching"],
    ["resend", "Resend", "email for developers"],
  ];

  return advertisers.map(([slug, advertiser, headline], index) => ({
    creativeId: `cr-${slug}-${index}`,
    advertiser: advertiser!,
    headline: headline!,
    body: null,
    clickUrl: `https://${slug}.example/`,
    logoLight: `${assetOrigin}/${slug}-light.png`,
    logoDark: `${assetOrigin}/${slug}-dark.png`,
    ttlMs: 600_000,
  }));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

function hasBearer(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  if (!header.startsWith("Bearer ")) return false;
  return header.slice("Bearer ".length).trim().length > 0;
}

function validReceipt(value: unknown): value is SubmittedReceipt {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r["receiptId"] === "string" &&
    r["receiptId"].length > 0 &&
    typeof r["creativeId"] === "string" &&
    typeof r["shownAt"] === "number" &&
    typeof r["dwellMs"] === "number" &&
    typeof r["themeKind"] === "string" &&
    THEMES.has(r["themeKind"]) &&
    typeof r["outcome"] === "string" &&
    OUTCOMES.has(r["outcome"])
  );
}

export async function createMockServer(options: { port?: number } = {}): Promise<MockServer> {
  const state = freshState();

  const server = createHttpServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: "internal" });
    });
  });

  let assetOrigin = "";
  const publicAssetOrigin = `https://${PUBLIC_ASSET_HOST}/assets`;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://127.0.0.1`);
    const path = url.pathname;

    if (path === "/__test__/reset" && req.method === "POST") {
      Object.assign(state, freshState());
      send(res, 200, { ok: true });
      return;
    }

    if (path.startsWith("/assets/")) {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=600" });
      res.end(PNG_1X1);
      return;
    }

    if (!path.startsWith("/v1/")) {
      send(res, 404, { error: "not found" });
      return;
    }

    if (!hasBearer(req)) {
      send(res, 401, { error: "missing bearer token" });
      return;
    }

    // Fault injection, applied before any real work so it models a server that is down
    // rather than one that answered incorrectly.
    if (state.hangs.remaining > 0) {
      state.hangs.remaining -= 1;
      await new Promise((resolve) => setTimeout(resolve, state.hangs.ms));
    }

    if (state.failures.remaining > 0) {
      state.failures.remaining -= 1;
      send(res, state.failures.status, { error: "injected failure" });
      return;
    }

    if (state.corruptions > 0) {
      state.corruptions -= 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"availableMicros": NOT VALID JSON');
      return;
    }

    if (path === "/v1/serve" && req.method === "POST") {
      const parsed: unknown = JSON.parse((await readBody(req)) || "{}");
      const body = parsed as Record<string, unknown>;

      if (
        !Array.isArray(body["tags"]) ||
        typeof body["themeKind"] !== "string" ||
        !THEMES.has(body["themeKind"]) ||
        typeof body["count"] !== "number"
      ) {
        send(res, 400, { error: "malformed serve request" });
        return;
      }

      const inventory = state.seeded ?? defaultInventory(publicAssetOrigin);
      const count = Math.max(0, Math.min(Math.floor(body["count"]), inventory.length));
      const payload: ServeResponseBody = { creatives: inventory.slice(0, count) };
      send(res, 200, payload);
      return;
    }

    if (path === "/v1/receipts" && req.method === "POST") {
      const parsed: unknown = JSON.parse((await readBody(req)) || "{}");
      const list = (parsed as Record<string, unknown>)["receipts"];

      if (!Array.isArray(list) || !list.every(validReceipt)) {
        send(res, 400, { error: "malformed receipts" });
        return;
      }

      const acked: string[] = [];
      for (const receipt of list) {
        // Idempotent by receipt ID: a client that retries after flaky wifi must not be
        // paid twice, and must not lose the earning either.
        if (!state.receipts.has(receipt.receiptId)) {
          state.receipts.set(receipt.receiptId, receipt);
          const credit =
            receipt.outcome === "impression"
              ? MICROS_PER_IMPRESSION
              : receipt.outcome === "click"
                ? MICROS_PER_CLICK
                : 0n;
          state.availableMicros += credit;
          state.lifetimeMicros += credit;
        }
        acked.push(receipt.receiptId);
      }

      const payload: ReceiptsResponseBody = { acked };
      send(res, 200, payload);
      return;
    }

    if (path === "/v1/balance" && req.method === "GET") {
      const payload: BalanceResponseBody = {
        availableMicros: state.availableMicros.toString(),
        lifetimeMicros: state.lifetimeMicros.toString(),
      };
      send(res, 200, payload);
      return;
    }

    if (path === "/v1/config" && req.method === "GET") {
      // Deviation D1: the server computes projected micros-per-hour per preset, so the
      // client can show the earnings/interruption trade-off without doing arithmetic
      // on money.
      const perHour = (perDay: number, capPerDay: number): string =>
        (MICROS_PER_IMPRESSION * BigInt(Math.min(perDay, capPerDay))).toString();

      const projections: Record<CadenceName, string> = {
        off: "0",
        light: perHour(1, 4),
        standard: perHour(2, 8),
        max: perHour(4, 20),
      };

      const payload: ConfigResponseBody = {
        killSwitch: state.killSwitch,
        caps: { minIntervalMs: 1_800_000, dailyCap: 8 },
        projections,
      };
      send(res, 200, payload);
      return;
    }

    send(res, 404, { error: "not found" });
  }

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  assetOrigin = `${url}/assets`;

  return {
    url,
    assetOrigin,
    publicAssetOrigin,
    assetHost: PUBLIC_ASSET_HOST,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    seed: (creatives) => {
      state.seeded = creatives;
    },
    setKillSwitch: (on) => {
      state.killSwitch = on;
    },
    receiptCount: () => state.receipts.size,
    failNext: (count, status) => {
      state.failures = { remaining: count, status };
    },
    corruptNext: (count) => {
      state.corruptions = count;
    },
    hangNext: (count, ms) => {
      state.hangs = { remaining: count, ms };
    },
  };
}
