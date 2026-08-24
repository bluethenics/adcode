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
  handleSaveRelease,
} from "./admin.ts";
import { parseReceiptsRequest, parseReportRequest, parseServeRequest } from "./contract.ts";
import { handleAdminListReports, handleSubmitReport } from "./reports.ts";
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
import { parseActivity, parseCampaign, parseCreateAdvertiser, parseCreative } from "./contract.ts";
import { handleFundingWebhook } from "./funding.ts";
import { parseCountry, parseFundingAmount, type PaymentProvider } from "./payments.ts";
import { createMemoryStore } from "./memoryStore.ts";
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

const ADMIN_LEDGER = /^\/v1\/admin\/users\/([^/]+)\/ledger$/;

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

    if (path === "/v1/admin/reports" && req.method === "GET") {
      send(res, 200, await handleAdminListReports({ store, clock, ids }, auth.uid, pageFrom(url)), cors);
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

      const found = await getMyAdvertiser(advertiserDeps, auth.uid);
      if (!found.ok) {
        send(res, ADVERTISER_STATUS[found.error], { error: found.error }, cors);
        return;
      }

      const raw = await jsonBodyOr400();
      if (raw === undefined) return;
      const fields = raw as Record<string, unknown>;

      const amountMicros = parseFundingAmount(fields["amountMicros"]);
      const billingCountry = parseCountry(fields["billingCountry"]);
      const email = typeof fields["email"] === "string" ? fields["email"].trim() : "";

      if (amountMicros === null || billingCountry === null || email.length === 0) {
        send(res, 400, { error: "malformed checkout" }, cors);
        return;
      }

      const session = await payments.createCheckout({
        advertiserId: found.value.advertiserId,
        advertiserName: found.value.name,
        advertiserEmail: email,
        billingCountry,
        amountMicros,
        returnUrl: `${siteOrigin}/portal/billing`,
      });

      // 502, not 500: the failure is the provider's, and the distinction tells the portal
      // whether retrying is worth offering.
      if (session === null) {
        send(res, 502, { error: "payment provider unavailable" }, cors);
        return;
      }

      send(res, 200, session, cors);
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
      settle(await createCreative(advertiserDeps, auth.uid, body));
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
