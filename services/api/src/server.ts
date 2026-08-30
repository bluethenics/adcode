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
import {
  handleAdminLedger,
  handleListPosts,
  handleListUsers,
  handleQueueTestServe,
  handleRehostAssets,
  handleReviewQueue,
  handleSavePost,
  handleSetCreativeStatus,
  handleSetUserStatus,
  handleListAdvertisers,
  handleSetAdvertiserStatus,
  handlePublishNotice,
  handleRetractNotice,
  handleAddAdmin,
  handleListAdmins,
  handleRemoveAdmin,
  handleListNotices,
  parseAdminEmail,
  parseNotice,
  parsePost,
  parseRelease,
  handleDraftRelease,
  handleListReleases,
  handleOverview,
  handleSaveRelease,
} from "./admin.ts";
import { parseReceiptsRequest, parseReportRequest, parseServeRequest } from "./contract.ts";
import {
  parseDecisionNote,
  parsePayoutProfile,
  parseProviderRef,
  parseWithdrawalAmount,
} from "./contract.ts";
import {
  handleAdminListReports,
  handleDeleteReport,
  handleSetReportStatus,
  handleSubmitReport,
} from "./reports.ts";
import {
  adjustBalance,
  cancelWithdrawal,
  approveWithdrawal,
  listWithdrawals,
  markWithdrawalPaid,
  markWithdrawalFailed,
  readPayouts,
  readWithdrawalDestination,
  rejectWithdrawal,
  requestWithdrawal,
  returnWithdrawal,
  savePayoutProfile,
  type Outcome as PayoutOutcome,
  type PayoutError,
} from "./withdrawals.ts";
import { checkRate } from "./rateLimit.ts";
import { corsHeaders } from "./cors.ts";
import {
  campaignSeries,
  createAdvertiser,
  createCampaign,
  createCreative,
  getMyAdvertiser,
  listCampaigns,
  listCreatives,
  setCampaignStatus,
  PORTAL_LIMITS,
  type AdvertiserError,
  type Outcome,
} from "./advertisers.ts";
import { ACTIVITY_LIMITS, readActivity, recordActivity } from "./activity.ts";
import {
  parseActivity,
  parseAdjustment,
  parseCampaign,
  parseCreateAdvertiser,
  parseCreative,
} from "./contract.ts";
import { handleFundingWebhook } from "./funding.ts";
import type { PaymentProvider } from "./payments.ts";
import { createCreditCheckout } from "./creditOrders.ts";
import { readDemand } from "./demand.ts";
import { PAYOUT_FIELD_KINDS } from "./payoutCorridors.ts";
import { createMemoryStore } from "./memoryStore.ts";
import { isSafeAssetKey } from "./assets.ts";
import type { Clock, IdGen, Store } from "./store.ts";

export interface ApiServer {
  url: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json", ...extra });
  res.end(JSON.stringify(body));
}

/**
 * Advertiser refusals to status codes.
 *
 * `not-found` covers both "no such campaign" and "not yours" on purpose - distinguishing
 * them tells a competitor whether an id exists.
 */
const ADVERTISER_STATUS: Record<AdvertiserError, number> = {
  "no-advertiser": 404,
  "already-advertiser": 409,
  suspended: 403,
  "not-found": 404,
  "insufficient-funds": 402,
  "no-approved-creative": 409,
  "invalid-state": 409,
};

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

/**
 * `?days=` for the two reporting endpoints.
 *
 * A missing, non-numeric, or out-of-range value falls back to the default rather than
 * failing: a chart that refuses to render because a query string was fat-fingered is
 * worse than a chart showing the usual window. The handlers clamp again on their own -
 * this is the transport's answer, not the rule.
 */
function daysFrom(url: URL, fallback: number): number {
  const raw = Number(url.searchParams.get("days") ?? "");
  if (!Number.isInteger(raw) || raw < 1) return fallback;
  return Math.min(raw, 365);
}

/**
 * Payout refusals to status codes.
 *
 * `not-eligible` is a 409 rather than a 403: nothing about the caller is forbidden, the
 * account simply is not in a state that allows the request yet, and `GET /v1/payouts`
 * says exactly which rule it failed.
 */
const PAYOUT_STATUS: Record<PayoutError, number> = {
  "not-eligible": 409,
  "insufficient-funds": 402,
  "invalid-amount": 400,
  "not-found": 404,
  "invalid-state": 409,
};

const ADMIN_LEDGER = /^\/v1\/admin\/users\/([^/]+)\/ledger$/;
const ADMIN_ADJUST = /^\/v1\/admin\/users\/([^/]+)\/adjust$/;
const REPORT_STATUSES: ReadonlySet<string> = new Set(["open", "triaged", "closed"]);
const WITHDRAWAL_STATUSES: ReadonlySet<string> = new Set([
  "requested",
  "approved",
  "paid",
  "rejected",
  "failed",
  "cancelled",
  "returned",
]);

/** Node gives a repeated header as an array; a signature header must be one value. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export interface ApiOptions {
  port?: number;
  store?: Store;
  verifier?: TokenVerifier;
  clock?: Clock;
  ids?: IdGen;
  payments?: PaymentProvider;
  webhookSecret?: string;
  siteOrigin?: string;
}

/** What both transports below are: a request in, a response written. */
export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * Every route, wired to its dependencies, with no opinion about how it is reached.
 *
 * Split from `createApiServer` so the service can also run somewhere that has no sockets
 * to listen on. On Cloudflare there is no `server.listen` - there is a `fetch` handler
 * receiving a Web `Request` - and `adapters/fetchHandler.ts` bridges to exactly this
 * function. Keeping the routing here rather than duplicating it for each transport is
 * what stops the deployed API and the tested API from drifting apart.
 */
export function createRequestHandler(options: ApiOptions = {}): RequestHandler {
  const verifier = options.verifier;
  if (verifier === undefined) throw new Error("a TokenVerifier is required");

  const store = options.store ?? createMemoryStore();
  const clock = options.clock ?? { now: () => Date.now() };

  let counter = 0;
  const ids = options.ids ?? { next: (prefix: string) => `${prefix}-${++counter}-${Date.now()}` };

  const payments = options.payments;
  const webhookSecret = options.webhookSecret ?? process.env["DODO_WEBHOOK_SECRET"];
  const siteOrigin = options.siteOrigin ?? "https://adcode.bluethenics.com";

  /**
   * The origin a caller actually reached us on.
   *
   * Creative artwork is addressed by absolute URL, and that URL has to be one the editor
   * can fetch - so it is taken from the request rather than configured. Cloudflare sets
   * `x-forwarded-proto`; a loopback host with no such header is a local run over http, and
   * guessing https there would produce asset URLs that resolve to nothing.
   */
  const requestOrigin = (req: IncomingMessage): string => {
    const host = req.headers.host;
    if (typeof host !== "string" || host === "") return siteOrigin;

    const forwarded = req.headers["x-forwarded-proto"];
    const proto =
      typeof forwarded === "string" && forwarded !== ""
        ? (forwarded.split(",")[0] ?? "https").trim()
        : /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host)
          ? "http"
          : "https";

    return `${proto}://${host}`;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const cors = corsHeaders(req.headers.origin);

    // Preflight is answered before authentication: a browser sends OPTIONS without the
    // Authorization header, so requiring a token here would fail every cross-origin call.
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    /*
     * GET /assets/:key - creative artwork.
     *
     * Unauthenticated, and it has to be: the editor fetches these through its asset cache,
     * which is a plain image fetch with no bearer token. Nothing here is secret - it is the
     * picture an advertiser is paying to show people - and the key is unguessable enough to
     * not be an enumeration surface worth defending.
     *
     * Not under `/v1`: the version prefix is the serving *contract*, and this is a file.
     */
    if (path.startsWith("/assets/") && (req.method === "GET" || req.method === "HEAD")) {
      const key = decodeURIComponent(path.slice("/assets/".length));

      // Keys are generated by `assetKey`, but this one arrived over the network. A key is a
      // filename; anything else never reaches the storage layer.
      if (!isSafeAssetKey(key)) {
        send(res, 404, { error: "not found" }, cors);
        return;
      }

      const asset = await store.getAsset(key);
      if (asset === null) {
        send(res, 404, { error: "not found" }, cors);
        return;
      }

      res.writeHead(200, {
        ...cors,
        "content-type": asset.contentType,
        "content-length": String(asset.bytes.byteLength),
        // Keyed by creative id and content, so a given key's bytes never change meaning.
        // The editor caches these on disk too; this is for everything in between.
        "cache-control": "public, max-age=31536000, immutable",
      });
      res.end(req.method === "HEAD" ? undefined : Buffer.from(asset.bytes));
      return;
    }

    if (!path.startsWith("/v1/")) {
      send(res, 404, { error: "not found" }, cors);
      return;
    }

    /*
     * GET /v1/health - is the service and its database answering?
     *
     * Before authentication, and deliberately so. It exists because a Supabase project on
     * the free plan pauses after a week without activity, and a paused database means the
     * ad path returns 500s until somebody notices. A scheduled request keeps it awake - but
     * only if the request actually reaches the database, and every authenticated endpoint
     * answers 401 without touching it. So this one reads a row.
     *
     * It reads the config row, which is a single-row primary-key lookup, and reports
     * nothing about it. A boolean and a status code: an unauthenticated endpoint on a money
     * API says as little as it possibly can.
     */
    if (path === "/v1/health" && req.method === "GET") {
      try {
        await store.getConfig();
        send(res, 200, { ok: true }, cors);
      } catch {
        // 503 rather than 500: the service is up, its dependency is not, and the difference
        // is what an uptime check needs in order to page the right person.
        send(res, 503, { ok: false }, cors);
      }
      return;
    }

    if (path === "/v1/demand" && req.method === "GET") {
      const demand = await readDemand(store, clock.now());
      send(res, 200, demand, {
        ...cors,
        "cache-control": "public, max-age=60, stale-while-revalidate=30",
      });
      return;
    }

    /*
     * The payment webhook, before authentication and before the rate limiter.
     *
     * Dodo sends no bearer token - the HMAC signature over the raw body is the
     * authentication - and there is no UID to rate limit against. It is also the one
     * route that needs the body bytes exactly as sent, so it reads them itself rather
     * than going through a JSON parse first.
     */
    if (path === "/v1/webhooks/dodo" && req.method === "POST") {
      if (webhookSecret === undefined) {
        send(res, 503, { error: "webhooks not configured" }, cors);
        return;
      }

      let raw: string;
      try {
        raw = await readBody(req);
      } catch {
        send(res, 400, { error: "body too large" }, cors);
        return;
      }

      const result = await handleFundingWebhook(
        { store, clock, webhookSecret },
        {
          id: firstHeader(req.headers["webhook-id"]),
          timestamp: firstHeader(req.headers["webhook-timestamp"]),
          signature: firstHeader(req.headers["webhook-signature"]),
        },
        raw,
      );

      if (result.ok) send(res, 200, { received: true, outcome: result.reason }, cors);
      else send(res, result.status, { error: result.reason }, cors);
      return;
    }

    /*
     * Published blog posts, before authentication.
     *
     * These are public by definition - they are what the marketing site renders for
     * search engines. Requiring a token would mean the site needed a service account to
     * read its own blog. Drafts are never included; that filter is in the store query,
     * not in a caller-supplied flag.
     */
    /*
     * Published releases, before authentication.
     *
     * Public for the same reason the blog is: the marketing site renders a changelog from
     * this, and the desktop client reads it to decide whether anything is worth telling
     * somebody about. Drafts are excluded in the store query rather than by a flag the
     * caller could set - an unpublished note must not be reachable by asking nicely.
     */
    if (path === "/v1/releases" && req.method === "GET") {
      const releases = await store.listReleases({ publishedOnly: true });
      send(res, 200, { releases }, cors);
      return;
    }

    if (path === "/v1/posts" && req.method === "GET") {
      const posts = await store.listPosts({ publishedOnly: true });
      send(res, 200, { posts }, cors);
      return;
    }

    const publicPost = /^\/v1\/posts\/([^/]+)$/.exec(path);
    if (publicPost !== null && req.method === "GET") {
      const post = await store.getPost(decodeURIComponent(publicPost[1] ?? ""));
      if (post === null || post.status !== "published") {
        send(res, 404, { error: "not found" }, cors);
        return;
      }
      send(res, 200, post, cors);
      return;
    }

    const jsonBodyOr400 = async (): Promise<unknown | undefined> => {
      try {
        return JSON.parse(await readBody(req)) as unknown;
      } catch {
        send(res, 400, { error: "malformed body" }, cors);
        return undefined;
      }
    };

    /*
     * A release note drafted by a tool.
     *
     * Guarded by a shared secret rather than a user account, because the caller is a script
     * in a release pipeline. It can only ever create a draft - `handleDraftRelease` forces
     * that regardless of what is posted - so the worst a leaked token buys is an unpublished
     * note in the admin panel that a person then reads and deletes.
     */
    if (path === "/v1/releases/draft" && req.method === "POST") {
      const secret = process.env["ADCODE_AGENT_TOKEN"];
      const offered = (req.headers["authorization"] ?? "").toString().replace(/^Bearer /i, "");

      if (secret === undefined || secret.length === 0 || offered !== secret) {
        send(res, 401, { error: "unauthorized" }, cors);
        return;
      }

      const raw = await jsonBodyOr400();
      if (raw === undefined) return;

      const input = parseRelease(raw);
      if (input === null) {
        send(res, 400, { error: "malformed release" }, cors);
        return;
      }

      send(res, 200, await handleDraftRelease({ store, clock }, input), cors);
      return;
    }

    const auth = await authenticate({ store, verifier, clock }, req.headers.authorization);
    if (!auth.ok) {
      // A ban is 403 rather than 401: the credentials are fine, the answer is still no,
      // and a client that retries auth on a 401 would loop forever.
      send(res, auth.failure === "banned" ? 403 : 401, { error: auth.failure }, cors);
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
        ...cors,
      });
      res.end(JSON.stringify({ error: "rate-limited" }));
      return;
    }

    /** Reads and parses a JSON body, answering 400 itself if it cannot. */

    /*
     * Who the caller is, as this service sees them.
     *
     * The browser cannot work out `isAdmin` for itself. It used to try: the web app read
     * a Firebase custom claim called `admin`, which was correct until administrators
     * moved into a table (see `auth.ts`) and nothing has written that claim since. The
     * result was an admin who could reach every admin endpoint and never saw the link to
     * them, because the client had quietly decided they were not one.
     *
     * So the server says. It already computes this on every single request; this endpoint
     * only returns what `authenticate` worked out a few lines above, and the admin gate
     * below still re-checks it. A client that lies to itself about this reaches endpoints
     * that refuse it anyway.
     */
    if (path === "/v1/me" && req.method === "GET") {
      send(res, 200, { uid: auth.uid, isAdmin: auth.isAdmin }, cors);
      return;
    }

    /*
     * One gate for the whole admin surface, ahead of every admin route.
     *
     * A per-route check is a check someone forgets when adding the next route. Matching
     * on the path prefix means a new /v1/admin/* endpoint is guarded before it is
     * written, not after somebody notices.
     */
    if (path.startsWith("/v1/admin/") && !auth.isAdmin) {
      send(res, 403, { error: "not-admin" }, cors);
      return;
    }

    const payoutDeps = { store, clock, ids };

    /** Unwraps a payout Outcome onto the wire. Same shape as `settle`, different map. */
    const settlePayout = <T,>(result: PayoutOutcome<T>): void => {
      if (result.ok) send(res, 200, result.value, cors);
      else send(res, PAYOUT_STATUS[result.error], { error: result.error }, cors);
    };

    if (path === "/v1/admin/overview" && req.method === "GET") {
      send(res, 200, await handleOverview({ store, clock }, auth.uid), cors);
      return;
    }

    if (path === "/v1/admin/reports" && req.method === "GET") {
      send(res, 200, await handleAdminListReports({ store, clock, ids }, auth.uid, pageFrom(url)), cors);
      return;
    }

    const reportStatus = /^\/v1\/admin\/reports\/([^/]+)\/status$/.exec(path);
    if (reportStatus !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const next = (raw as Record<string, unknown>)["status"];
      if (typeof next !== "string" || !REPORT_STATUSES.has(next)) {
        send(res, 400, { error: "malformed status" }, cors);
        return;
      }
      const changed = await handleSetReportStatus(
        payoutDeps,
        auth.uid,
        decodeURIComponent(reportStatus[1] ?? ""),
        next as "open" | "triaged" | "closed",
      );
      send(res, changed ? 200 : 404, changed ? { ok: true, status: next } : { error: "not-found" }, cors);
      return;
    }

    const reportDelete = /^\/v1\/admin\/reports\/([^/]+)\/delete$/.exec(path);
    if (reportDelete !== null && req.method === "POST") {
      const removed = await handleDeleteReport(
        payoutDeps,
        auth.uid,
        decodeURIComponent(reportDelete[1] ?? ""),
      );
      send(res, removed ? 200 : 404, removed ? { ok: true } : { error: "not-found" }, cors);
      return;
    }

    if (path === "/v1/admin/withdrawals" && req.method === "GET") {
      const asked = url.searchParams.get("status");
      // An unknown status reads as "no filter" rather than as an error: the alternative is
      // an admin screen that shows a 400 because a query string was mistyped.
      const status = asked !== null && WITHDRAWAL_STATUSES.has(asked) ? asked : null;
      send(
        res,
        200,
        await listWithdrawals(
          payoutDeps,
          auth.uid,
          status as import("./store.ts").WithdrawalStatus | null,
          pageFrom(url),
        ),
        cors,
      );
      return;
    }

    if (path === "/v1/admin/payout-corridors" && req.method === "GET") {
      await store.writeAudit({
        adminUid: auth.uid,
        action: "read-payout-corridors",
        subjectUid: "*",
        at: clock.now(),
      });
      send(res, 200, { corridors: await store.listPayoutCorridors(false) }, cors);
      return;
    }

    const payoutCorridor = /^\/v1\/admin\/payout-corridors\/([A-Z]{2})\/([A-Z]{3})$/.exec(path);
    if (payoutCorridor !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const body = raw as Record<string, unknown>;
      const enabled = body["enabled"];
      const requiredFields = body["requiredFields"];
      const sourceNote = body["sourceNote"];
      const supported = new Set<string>(PAYOUT_FIELD_KINDS);
      if (
        typeof enabled !== "boolean" ||
        !Array.isArray(requiredFields) ||
        requiredFields.length === 0 ||
        requiredFields.some((field) => typeof field !== "string" || !supported.has(field)) ||
        typeof sourceNote !== "string" ||
        sourceNote.trim().length < 10 ||
        sourceNote.trim().length > 500
      ) {
        send(res, 400, { error: "malformed payout corridor" }, cors);
        return;
      }
      const now = clock.now();
      const country = payoutCorridor[1] ?? "";
      const currency = payoutCorridor[2] ?? "";
      const record = {
        country,
        currency,
        enabled,
        requiredFields: requiredFields as import("./store.ts").PayoutFieldKind[],
        sourceNote: sourceNote.trim(),
        verifiedAt: enabled ? now : null,
        updatedAt: now,
        updatedBy: auth.uid,
      };
      await store.putPayoutCorridor(record);
      await store.writeAudit({
        adminUid: auth.uid,
        action: `payout-corridor:${country}:${currency}:${enabled ? "enabled" : "disabled"}`,
        subjectUid: "*",
        at: now,
      });
      send(res, 200, record, cors);
      return;
    }

    const withdrawalApprove = /^\/v1\/admin\/withdrawals\/([^/]+)\/approve$/.exec(path);
    if (withdrawalApprove !== null && req.method === "POST") {
      settlePayout(
        await approveWithdrawal(
          payoutDeps,
          auth.uid,
          decodeURIComponent(withdrawalApprove[1] ?? ""),
        ),
      );
      return;
    }

    const withdrawalPaid = /^\/v1\/admin\/withdrawals\/([^/]+)\/paid$/.exec(path);
    if (withdrawalPaid !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const providerRef = parseProviderRef(raw);
      if (providerRef === null) {
        // Refused rather than defaulted: the reference is the only link from this record
        // to the transfer that actually moved the money.
        send(res, 400, { error: "malformed providerRef" }, cors);
        return;
      }
      settlePayout(
        await markWithdrawalPaid(
          payoutDeps,
          auth.uid,
          decodeURIComponent(withdrawalPaid[1] ?? ""),
          providerRef,
        ),
      );
      return;
    }

    /*
     * The bank details for one request, read at the moment somebody makes the transfer.
     *
     * Deliberately not part of the queue. The list hands out masked summaries, so opening
     * the admin screen no longer decrypts every account on the page - and this route's
     * audit line names the withdrawal, which the list's never could.
     */
    const withdrawalDestination = /^\/v1\/admin\/withdrawals\/([^/]+)\/destination$/.exec(path);
    if (withdrawalDestination !== null && req.method === "GET") {
      settlePayout(
        await readWithdrawalDestination(
          payoutDeps,
          auth.uid,
          decodeURIComponent(withdrawalDestination[1] ?? ""),
        ),
      );
      return;
    }

    /* The transfer bounced after it had been recorded as sent. */
    const withdrawalReturned = /^\/v1\/admin\/withdrawals\/([^/]+)\/returned$/.exec(path);
    if (withdrawalReturned !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const note = parseDecisionNote(raw);
      if (note === null) {
        send(res, 400, { error: "malformed note" }, cors);
        return;
      }
      settlePayout(
        await returnWithdrawal(
          payoutDeps,
          auth.uid,
          decodeURIComponent(withdrawalReturned[1] ?? ""),
          note,
        ),
      );
      return;
    }

    const withdrawalReject = /^\/v1\/admin\/withdrawals\/([^/]+)\/reject$/.exec(path);
    if (withdrawalReject !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const note = parseDecisionNote(raw);
      if (note === null) {
        send(res, 400, { error: "malformed note" }, cors);
        return;
      }
      settlePayout(
        await rejectWithdrawal(
          payoutDeps,
          auth.uid,
          decodeURIComponent(withdrawalReject[1] ?? ""),
          note,
        ),
      );
      return;
    }

    if (path === "/v1/admin/users" && req.method === "GET") {
      send(res, 200, await handleListUsers({ store, clock }, auth.uid, pageFrom(url)), cors);
      return;
    }

    const userStatus = /^\/v1\/admin\/users\/([^/]+)\/status$/.exec(path);
    if (userStatus !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const next = (raw as Record<string, unknown>)["status"];
      if (next !== "active" && next !== "banned") {
        send(res, 400, { error: "malformed status" }, cors);
        return;
      }
      try {
        await handleSetUserStatus(
          { store, clock },
          auth.uid,
          decodeURIComponent(userStatus[1] ?? ""),
          next,
        );
      } catch {
        send(res, 404, { error: "not-found" }, cors);
        return;
      }
      send(res, 200, { ok: true }, cors);
      return;
    }

    if (path === "/v1/admin/advertisers" && req.method === "GET") {
      const advertisers = await handleListAdvertisers({ store, clock }, auth.uid);
      // Money is bigint in the store and a decimal string on the wire, as everywhere.
      send(
        res,
        200,
        {
          advertisers: advertisers.map((a) => ({
            ...a,
            fundedMicros: a.fundedMicros.toString(),
            reservedMicros: a.reservedMicros.toString(),
          })),
        },
        cors,
      );
      return;
    }

    const advertiserStatus = /^\/v1\/admin\/advertisers\/([^/]+)\/status$/.exec(path);
    if (advertiserStatus !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const next = (raw as Record<string, unknown>)["status"];
      if (next !== "active" && next !== "suspended") {
        send(res, 400, { error: "malformed status" }, cors);
        return;
      }
      const updated = await handleSetAdvertiserStatus(
        { store, clock },
        auth.uid,
        decodeURIComponent(advertiserStatus[1] ?? ""),
        next,
      );
      if (updated === null) {
        send(res, 404, { error: "not-found" }, cors);
        return;
      }
      send(res, 200, { ok: true, status: updated.status }, cors);
      return;
    }

    if (path === "/v1/admin/notices" && req.method === "GET") {
      send(res, 200, { notices: await handleListNotices({ store, clock }, auth.uid) }, cors);
      return;
    }

    if (path === "/v1/admin/notices" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const input = parseNotice(raw);
      if (input === null) {
        send(res, 400, { error: "malformed notice" }, cors);
        return;
      }
      send(res, 200, await handlePublishNotice({ store, clock, ids }, auth.uid, input), cors);
      return;
    }

    const retractNotice = /^\/v1\/admin\/notices\/([^/]+)\/retract$/.exec(path);
    if (retractNotice !== null && req.method === "POST") {
      const updated = await handleRetractNotice(
        { store, clock },
        auth.uid,
        decodeURIComponent(retractNotice[1] ?? ""),
      );
      if (updated === null) {
        send(res, 404, { error: "not-found" }, cors);
        return;
      }
      send(res, 200, updated, cors);
      return;
    }

    if (path === "/v1/admin/admins" && req.method === "GET") {
      send(res, 200, { admins: await handleListAdmins({ store, clock }, auth.uid) }, cors);
      return;
    }

    if (path === "/v1/admin/admins" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const email = parseAdminEmail(raw);
      if (email === null) {
        send(res, 400, { error: "malformed email" }, cors);
        return;
      }
      const result = await handleAddAdmin({ store, clock }, auth.uid, email);
      if (!result.ok) {
        send(res, 409, { error: result.reason }, cors);
        return;
      }
      send(res, 200, { admins: result.admins }, cors);
      return;
    }

    if (path === "/v1/admin/admins/remove" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const email = parseAdminEmail(raw);
      if (email === null) {
        send(res, 400, { error: "malformed email" }, cors);
        return;
      }
      const result = await handleRemoveAdmin({ store, clock }, auth.uid, email);
      if (!result.ok) {
        // 409 for both: the request was well formed and the server refused it. A 404 for
        // "not an admin" would leak whether an address is one to anybody who can reach
        // this route - which is only ever another admin, but the distinction costs nothing.
        send(res, 409, { error: result.reason }, cors);
        return;
      }
      send(res, 200, { admins: result.admins }, cors);
      return;
    }

    if (path === "/v1/admin/creatives" && req.method === "GET") {
      // Defaults to the review queue; ?status= lets the test-ad screen reach approved
      // ones too. An unknown value falls back to pending rather than erroring.
      const wanted = url.searchParams.get("status");
      const creatives =
        wanted === "approved" || wanted === "rejected"
          ? await store.creativesByStatus(wanted)
          : await handleReviewQueue({ store, clock }, auth.uid);

      send(res, 200, { creatives }, cors);
      return;
    }

    const creativeStatus = /^\/v1\/admin\/creatives\/([^/]+)\/status$/.exec(path);
    if (creativeStatus !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const next = (raw as Record<string, unknown>)["status"];
      if (next !== "approved" && next !== "rejected" && next !== "pending") {
        send(res, 400, { error: "malformed status" }, cors);
        return;
      }
      const updated = await handleSetCreativeStatus(
        { store, clock },
        auth.uid,
        decodeURIComponent(creativeStatus[1] ?? ""),
        next,
      );
      if (updated === null) {
        send(res, 404, { error: "not-found" }, cors);
        return;
      }
      send(res, 200, updated, cors);
      return;
    }

    /*
     * POST /v1/admin/rehost-assets - repair creatives whose artwork is still inline.
     *
     * One-shot and idempotent. Needed once, for rows written before creatives learned to
     * store their artwork separately; those rows cannot be served at all, so this is the
     * difference between an ad system that works and one that silently has no inventory.
     */
    if (path === "/v1/admin/rehost-assets" && req.method === "POST") {
      const result = await handleRehostAssets({ store, clock }, auth.uid, requestOrigin(req));
      send(res, 200, result, cors);
      return;
    }

    if (path === "/v1/admin/test-serve" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const fields = raw as Record<string, unknown>;
      const targetUid = typeof fields["uid"] === "string" ? fields["uid"] : "";
      const creativeId = typeof fields["creativeId"] === "string" ? fields["creativeId"] : "";

      if (targetUid.length === 0 || creativeId.length === 0) {
        send(res, 400, { error: "malformed test serve" }, cors);
        return;
      }

      const queued = await handleQueueTestServe({ store, clock }, auth.uid, targetUid, creativeId);
      if (!queued.ok) {
        send(res, 404, { error: queued.error }, cors);
        return;
      }
      send(res, 200, { ok: true }, cors);
      return;
    }

    if (path === "/v1/admin/releases" && req.method === "GET") {
      send(res, 200, { releases: await handleListReleases({ store, clock }, auth.uid) }, cors);
      return;
    }

    if (path === "/v1/admin/releases" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;

      const input = parseRelease(raw);
      if (input === null) {
        send(res, 400, { error: "malformed release" }, cors);
        return;
      }

      send(res, 200, await handleSaveRelease({ store, clock }, auth.uid, input), cors);
      return;
    }

    if (path === "/v1/admin/posts" && req.method === "GET") {
      send(res, 200, { posts: await handleListPosts({ store, clock }, auth.uid) }, cors);
      return;
    }

    if (path === "/v1/admin/posts" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const input = parsePost(raw);
      if (input === null) {
        send(res, 400, { error: "malformed post" }, cors);
        return;
      }
      send(res, 200, await handleSavePost({ store, clock }, auth.uid, input), cors);
      return;
    }

    /*
     * Move a balance by hand, with a reason.
     *
     * The `adjustment` ledger kind existed from the first migration and nothing wrote one,
     * so every correction that was not a withdrawal outcome meant editing the database
     * directly - which is precisely what an append-only ledger exists to make unnecessary.
     */
    const adjust = ADMIN_ADJUST.exec(path);
    if (adjust !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const body = parseAdjustment(raw);
      if (body === null) {
        send(res, 400, { error: "malformed adjustment" }, cors);
        return;
      }
      settlePayout(
        await adjustBalance(
          payoutDeps,
          auth.uid,
          decodeURIComponent(adjust[1] ?? ""),
          body.micros,
          body.reason,
        ),
      );
      return;
    }

    const admin = ADMIN_LEDGER.exec(path);
    if (admin !== null && req.method === "GET") {
      const subject = decodeURIComponent(admin[1] ?? "");
      send(res, 200, await handleAdminLedger({ store, clock }, auth.uid, subject, pageFrom(url)), cors);
      return;
    }

    if (path === "/v1/serve" && req.method === "POST") {
      let raw: unknown;
      try {
        raw = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "malformed body" }, cors);
        return;
      }
      const body = parseServeRequest(raw);
      if (body === null) {
        send(res, 400, { error: "malformed serve request" }, cors);
        return;
      }
      send(res, 200, await handleServe({ store, clock, ids }, auth.uid, body), cors);
      return;
    }

    if (path === "/v1/receipts" && req.method === "POST") {
      let raw: unknown;
      try {
        raw = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "malformed body" }, cors);
        return;
      }
      const body = parseReceiptsRequest(raw);
      if (body === null) {
        send(res, 400, { error: "malformed receipts request" }, cors);
        return;
      }
      send(res, 200, await handleReceipts({ store, clock, ids }, auth.uid, body), cors);
      return;
    }

    if (path === "/v1/reports" && req.method === "POST") {
      let raw: unknown;
      try {
        raw = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "malformed body" }, cors);
        return;
      }
      const body = parseReportRequest(raw);
      if (body === null) {
        send(res, 400, { error: "malformed report" }, cors);
        return;
      }
      send(res, 200, await handleSubmitReport({ store, clock, ids }, auth.uid, body), cors);
      return;
    }

    /* ── Editor activity ────────────────────────────────────────────── */

    if (path === "/v1/activity" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const body = parseActivity(raw);
      if (body === null) {
        send(res, 400, { error: "malformed activity" }, cors);
        return;
      }
      await recordActivity({ store, clock }, auth.uid, body);
      // No body worth returning: the client is reporting, not asking. `{ ok: true }`
      // rather than 204 so the response parses the same way every other one does.
      send(res, 200, { ok: true }, cors);
      return;
    }

    if (path === "/v1/activity" && req.method === "GET") {
      send(
        res,
        200,
        await readActivity({ store, clock }, auth.uid, daysFrom(url, ACTIVITY_LIMITS.defaultDays)),
        cors,
      );
      return;
    }

    /* ── Advertiser portal ──────────────────────────────────────────── */

    const advertiserDeps = { store, clock, ids };

    /** Unwraps an Outcome onto the wire, mapping refusals to status codes. */
    const settle = <T>(result: Outcome<T>): void => {
      if (result.ok) send(res, 200, result.value, cors);
      else send(res, ADVERTISER_STATUS[result.error], { error: result.error }, cors);
    };

    if (path === "/v1/portal/limits" && req.method === "GET") {
      send(res, 200, PORTAL_LIMITS, cors);
      return;
    }

    if (path === "/v1/portal/advertiser" && req.method === "GET") {
      settle(await getMyAdvertiser(advertiserDeps, auth.uid));
      return;
    }

    if (path === "/v1/portal/advertiser" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const body = parseCreateAdvertiser(raw);
      if (body === null) {
        send(res, 400, { error: "malformed advertiser" }, cors);
        return;
      }
      settle(await createAdvertiser(advertiserDeps, auth.uid, body));
      return;
    }

    if (path === "/v1/portal/campaigns" && req.method === "GET") {
      settle(await listCampaigns(advertiserDeps, auth.uid));
      return;
    }

    if (path === "/v1/portal/series" && req.method === "GET") {
      settle(await campaignSeries(advertiserDeps, auth.uid, daysFrom(url, 30)));
      return;
    }

    if (path === "/v1/portal/campaigns" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const body = parseCampaign(raw);
      if (body === null) {
        send(res, 400, { error: "malformed campaign" }, cors);
        return;
      }
      settle(await createCampaign(advertiserDeps, auth.uid, body));
      return;
    }

    const campaignStatus = /^\/v1\/portal\/campaigns\/([^/]+)\/status$/.exec(path);
    if (campaignStatus !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;

      const next = (raw as Record<string, unknown>)["status"];
      if (next !== "active" && next !== "paused" && next !== "ended") {
        send(res, 400, { error: "malformed status" }, cors);
        return;
      }

      settle(
        await setCampaignStatus(
          advertiserDeps,
          auth.uid,
          decodeURIComponent(campaignStatus[1] ?? ""),
          next,
        ),
      );
      return;
    }

    const campaignCreatives = /^\/v1\/portal\/campaigns\/([^/]+)\/creatives$/.exec(path);
    if (campaignCreatives !== null && req.method === "GET") {
      settle(
        await listCreatives(advertiserDeps, auth.uid, decodeURIComponent(campaignCreatives[1] ?? "")),
      );
      return;
    }

    if (path === "/v1/portal/checkout" && req.method === "POST") {
      if (payments === undefined) {
        send(res, 503, { error: "payments not configured" }, cors);
        return;
      }

      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const fields = raw as Record<string, unknown>;
      const outcome = await createCreditCheckout({ store, payments, clock, ids, siteOrigin }, auth.uid, {
        amountMicros: fields["amountMicros"],
        billingCountry: fields["billingCountry"],
        email: fields["email"],
      });
      if (!outcome.ok) {
        send(res, outcome.status, { error: outcome.error }, cors);
        return;
      }
      send(res, 200, outcome.value, cors);
      return;
    }

    if (path === "/v1/portal/creatives" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const body = parseCreative(raw);
      if (body === null) {
        send(res, 400, { error: "malformed creative" }, cors);
        return;
      }
      settle(await createCreative(advertiserDeps, auth.uid, body, requestOrigin(req)));
      return;
    }

    if (path === "/v1/notices" && req.method === "GET") {
      const notices = await store.listNotices({ activeOnly: true });
      send(res, 200, { notices }, cors);
      return;
    }

    if (path === "/v1/balance" && req.method === "GET") {
      send(res, 200, await handleBalance(store, auth.uid), cors);
      return;
    }

    /*
     * Cash out.
     *
     * One GET returns the whole screen - the rules, whether they pass, the details on
     * file and every past request - because they are read together and a page that
     * fetches them separately renders in four stages, each of which briefly says
     * something untrue about whether you can be paid.
     */
    if (path === "/v1/payouts" && req.method === "GET") {
      send(res, 200, await readPayouts(payoutDeps, auth.uid), cors);
      return;
    }

    if (path === "/v1/payouts/profile" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const body = parsePayoutProfile(raw);
      if (body === null) {
        send(res, 400, { error: "malformed payout details" }, cors);
        return;
      }
      const saved = await savePayoutProfile(payoutDeps, auth.uid, body);
      if (saved === null) {
        send(res, 400, { error: "payout corridor unavailable or details invalid" }, cors);
        return;
      }
      send(res, 200, saved, cors);
      return;
    }

    const withdrawalFailed = /^\/v1\/admin\/withdrawals\/([^/]+)\/failed$/.exec(path);
    if (withdrawalFailed !== null && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const note = parseDecisionNote(raw);
      if (note === null) {
        send(res, 400, { error: "malformed note" }, cors);
        return;
      }
      settlePayout(
        await markWithdrawalFailed(
          payoutDeps,
          auth.uid,
          decodeURIComponent(withdrawalFailed[1] ?? ""),
          note,
        ),
      );
      return;
    }

    if (path === "/v1/payout-corridors" && req.method === "GET") {
      const corridors = await store.listPayoutCorridors(true);
      send(
        res,
        200,
        {
          corridors: corridors.map(({ country, currency, requiredFields }) => ({
            country,
            currency,
            requiredFields,
          })),
        },
        cors,
      );
      return;
    }

    if (path === "/v1/withdrawals" && req.method === "POST") {
      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const amountMicros = parseWithdrawalAmount(raw);
      if (amountMicros === null) {
        send(res, 400, { error: "invalid-amount" }, cors);
        return;
      }
      settlePayout(await requestWithdrawal(payoutDeps, auth.uid, amountMicros));
      return;
    }

    const cancelRequest = /^\/v1\/withdrawals\/([^/]+)\/cancel$/.exec(path);
    if (cancelRequest !== null && req.method === "POST") {
      settlePayout(
        await cancelWithdrawal(payoutDeps, auth.uid, decodeURIComponent(cancelRequest[1] ?? "")),
      );
      return;
    }

    if (path === "/v1/ledger" && req.method === "GET") {
      send(res, 200, await handleLedger(store, auth.uid, pageFrom(url)), cors);
      return;
    }

    if (path === "/v1/config" && req.method === "GET") {
      send(res, 200, await handleConfig(store), cors);
      return;
    }

    send(res, 404, { error: "not found" }, cors);
  };

  return handle;
}

/**
 * The routing above, listening on a loopback socket.
 *
 * This is what the test suite and `cli.ts` use. It is a thin wrapper by design: anything
 * that lives here rather than in `createRequestHandler` is behaviour the deployed service
 * would not have.
 */
export async function createApiServer(options: ApiOptions = {}): Promise<ApiServer> {
  const handle = createRequestHandler(options);

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
