/**
 * A banned account is refused by every authenticated route, with one code, one header and one
 * sentence - and not by the public ones, which answer anybody.
 *
 * The routes are read out of the router sources rather than listed by hand, so a route added
 * tomorrow is in this test tomorrow. Whatever does not refuse a banned account must be in
 * PUBLIC below: adding a route that answers a banned account means deciding so here, in review.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import type { TokenVerifier } from "../src/auth.ts";
import { ACCOUNT_BANNED, ACCOUNT_HEADER, BANNED_MESSAGE } from "../src/accountBan.ts";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const verifier: TokenVerifier = { async verify(token) { return token.startsWith("tok-") ? { uid: token.slice(4), claims: { email: `${token.slice(4)}@example.com`, email_verified: true } } : null; } };

const SOURCES = ["server.ts", "tagflow.ts", "adminConsole.ts", "adminInsights.ts", "accountVerification.ts"]
  .map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"));

/** Every `/v1` path the routers name: string literals, and regex routes with each parameter filled in. */
function routes(): string[] {
  const found = new Set<string>();
  for (const source of SOURCES) {
    for (const [, path] of source.matchAll(/["'`](\/v1\/[A-Za-z0-9/_.-]+)["'`]/g)) found.add(path!.replace(/\/$/, ""));
    for (const [, body] of source.matchAll(/\/\^\\\/v1\\\/(.+?)\$\//g)) {
      const path = "/v1/" + body!
        .replace(/\(\?:\\\/\((\w+)\|[^)]*\)\)\?/g, "") // optional "/(state|test)" tails: the bare route
        .replace(/\(\\\/email\)\?/g, "")
        .replace(/\(\[\^\/\]\+\??\)|\[\^\/\]\+/g, "x")
        .replace(/\\\//g, "/");
      if (/^[A-Za-z0-9/_.-]+$/.test(path)) found.add(path);
    }
  }
  for (const route of ["reset", "boost", "gift", "promo", "subscriptions", "end-renewals", "campaign", "offer", "model-promo", "verification-test"]) found.add(`/v1/admin/ai-plans/${route}`);
  return [...found].sort();
}

/**
 * Answers anybody, so a banned account too - each one decided, not inherited:
 * public pages and catalogues, the status page's email alerts, webhooks signed by providers,
 * the sponsored page's ad partners (no account involved), the invite page a stranger reads,
 * the site assistant Buck (no account), an email verification link opened from a mail app,
 * and the release-draft hook, which takes a CI token rather than a sign-in.
 */
const PUBLIC = new Set([
  "GET /v1/health", "GET /v1/impressions", "GET /v1/stats", "GET /v1/status", "GET /v1/models/overrides", "GET /v1/demand",
  "GET /v1/releases", "GET /v1/posts", "GET /v1/posts/x", "GET /v1/invite/x", "GET /v1/ai/tagflow/config",
  "POST /v1/status/subscribe", "POST /v1/status/confirm", "GET /v1/status/unsubscribe", "POST /v1/status/unsubscribe",
  "GET /v1/email/unsubscribe", "POST /v1/email/unsubscribe", "POST /v1/email/webhook", "POST /v1/webhooks/dodo",
  "GET /v1/sponsored/networks", "POST /v1/sponsored/impression", "POST /v1/website-events",
  "POST /v1/provider-applications", "POST /v1/provider-models", "POST /v1/releases/draft", "POST /v1/ai/buck",
  "GET /v1/ai/account/verify-email", "POST /v1/ai/account/verify-email",
]);

const isImprezia = (path: string): boolean => path.startsWith("/v1/imprezia/");

async function setup() {
  const store = createMemoryStore();
  await store.putUser({ uid: "banned", status: "banned", createdAt: NOW - 1, email: "banned@example.com", emailVerified: true });
  await store.putUser({ uid: "fine", status: "active", createdAt: NOW - 1, email: "fine@example.com", emailVerified: true });
  const api = createFetchHandler({
    store, clock: { now: () => NOW }, verifier,
    adminConsole: { console: {} as never },
    adminInsights: {} as never,
  });
  const call = (method: string, path: string, token: string) => api(new Request(`https://api.example.com${path}`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: "https://adcode.bluethenics.com" },
    ...(method === "GET" ? {} : { body: "{}" }),
  }));
  return { store, call };
}

async function refusedAsBanned(response: Response): Promise<boolean> {
  if (response.status !== 403 || response.headers.get(ACCOUNT_HEADER) !== "banned") return false;
  const body = await response.json() as { error: unknown; message?: unknown };
  const code = typeof body.error === "string" ? body.error : (body.error as { code?: unknown } | null)?.code;
  const message = typeof body.error === "string" ? body.message : (body.error as { message?: unknown } | null)?.message;
  return code === ACCOUNT_BANNED && message === BANNED_MESSAGE;
}

describe("a banned account", () => {
  it("finds every route the routers name", () => {
    const all = routes();
    // The ones the task named, so a broken extractor fails loudly instead of testing nothing.
    for (const path of ["/v1/me", "/v1/balance", "/v1/serve", "/v1/receipts", "/v1/sponsored/earn", "/v1/earnings/convert", "/v1/referrals", "/v1/referrals/claim",
      "/v1/ai/tagflow/chat/completions", "/v1/ai/wallet", "/v1/ai/wallet/checkout", "/v1/ai/promo/model", "/v1/ai/promo/redeem", "/v1/ai/invites", "/v1/ai/invites/redeem",
      "/v1/ai/account/verification", "/v1/admin/users/x/status", "/v1/admin/console/users"]) expect(all, path).toContain(path);
    expect(all.length).toBeGreaterThan(80);
  });

  it("is refused by every route that is not public, with one code, header and sentence", async () => {
    const { call } = await setup();
    const answered: string[] = [];
    for (const path of routes()) {
      if (isImprezia(path)) continue;
      for (const method of ["GET", "POST"]) {
        const response = await call(method, path, "tok-banned");
        if (!(await refusedAsBanned(response))) answered.push(`${method} ${path}`);
      }
    }
    const unexpected = answered.filter((route) => !PUBLIC.has(route));
    expect(unexpected, "these answered a banned account; refuse it, or add the route to PUBLIC with a reason").toEqual([]);
    // And PUBLIC stays honest: each entry really is a route that answers.
    expect(answered.filter((route) => PUBLIC.has(route)).sort()).toEqual([...PUBLIC].sort());
  });

  it("refuses withdrawals, payouts and reports by name, whatever their exact path", async () => {
    const { call } = await setup();
    for (const path of routes().filter((p) => /withdraw|payout|report|earn|credit|invite|promo|wallet|tokens|plans/.test(p) && !PUBLIC.has(`POST ${p}`) && !PUBLIC.has(`GET ${p}`))) {
      expect(await refusedAsBanned(await call("POST", path, "tok-banned")), path).toBe(true);
    }
  });

  it("is never told to sign in again: 403, never 401", async () => {
    const { call } = await setup();
    for (const path of ["/v1/me", "/v1/ai/account/verification", "/v1/ai/tagflow/usage", "/v1/admin/console/users"]) {
      expect((await call("GET", path, "tok-banned")).status, path).toBe(403);
    }
  });

  it("is let back in the moment it is unbanned, and an active account was never touched", async () => {
    const { store, call } = await setup();
    expect((await call("GET", "/v1/me", "tok-fine")).status).toBe(200);
    expect((await call("GET", "/v1/me", "tok-banned")).status).toBe(403);
    const user = (await store.getUser("banned"))!;
    await store.putUser({ ...user, status: "active" });
    expect((await call("GET", "/v1/me", "tok-banned")).status).toBe(200);
  });

  it("is refused with a token minted before the ban", async () => {
    const { store, call } = await setup();
    // Same token, before and after: the ban is read from the store on each request.
    expect((await call("GET", "/v1/me", "tok-fine")).status).toBe(200);
    await store.putUser({ ...(await store.getUser("fine"))!, status: "banned" });
    expect(await refusedAsBanned(await call("GET", "/v1/me", "tok-fine"))).toBe(true);
    expect(await refusedAsBanned(await call("POST", "/v1/sponsored/earn", "tok-fine"))).toBe(true);
  });

});

describe("the admin's ban", () => {
  it("bans and unbans with an audit row each, and refuses an administrator's own account", async () => {
    const { store } = await setup();
    await store.addAdmin({ email: "boss@example.com", addedBy: "seed", addedAt: NOW });
    const api = createFetchHandler({ store, clock: { now: () => NOW }, verifier: { async verify(token) { return token === "boss" ? { uid: "boss", claims: { email: "boss@example.com", email_verified: true } } : verifier.verify(token); } } });
    const post = (uid: string, status: string) => api(new Request(`https://api.example.com/v1/admin/users/${uid}/status`, { method: "POST", headers: { authorization: "Bearer boss", "content-type": "application/json" }, body: JSON.stringify({ status }) }));
    await api(new Request("https://api.example.com/v1/me", { headers: { authorization: "Bearer boss" } }));

    expect(await (await post("fine", "banned")).json()).toEqual({ ok: true, status: "banned" });
    expect((await store.getUser("fine"))?.status).toBe("banned");
    expect(await (await post("fine", "active")).json()).toEqual({ ok: true, status: "active" });
    expect((await store.getUser("fine"))?.status).toBe("active");

    const self = await post("boss", "banned");
    expect(self.status).toBe(409);
    expect((await store.getUser("boss"))?.status).toBe("active");

    const actions = (await store.listAudit()).filter((row) => row.action.startsWith("set-status")).map((row) => `${row.action} ${row.subjectUid}`);
    expect(actions).toEqual(["set-status:banned fine", "set-status:active fine"]);
  });
});
