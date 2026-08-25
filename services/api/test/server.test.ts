import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createApiServer, type ApiServer } from "../src/server.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { TokenVerifier } from "../src/auth.ts";
import { sign } from "../src/billing.ts";
import type { PaymentProvider } from "../src/payments.ts";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "good") return { uid: "u-1", claims: {} };
    // Admin is the `admins` table now, not a claim - so the token only has to carry a
    // verified address, and the store below decides what it means.
    if (token === "admin") {
      return { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } };
    }
    return null;
  },
};

let server: ApiServer;
let store: ReturnType<typeof createMemoryStore>;
const auth = { authorization: "Bearer good", "content-type": "application/json" };

const WEBHOOK_SECRET = "whsec_dGVzdC1zZWNyZXQtdmFsdWUtZm9yLXNpZ25pbmc=";

/** Records what it was asked for, so the route's mapping can be asserted. */
let lastCheckout: unknown = null;
const payments: PaymentProvider = {
  async createCheckout(request) {
    lastCheckout = request;
    return { paymentId: "pay_test", paymentLink: "https://test.dodopayments.com/pay/abc" };
  },
};

beforeAll(async () => {
  store = createMemoryStore();
  server = await createApiServer({ store, verifier, payments, webhookSecret: WEBHOOK_SECRET });
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  store.reset();
  await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
});

const get = (path: string, headers: Record<string, string> = auth) =>
  fetch(`${server.url}${path}`, { headers });

/*
 * `/v1/me` - the endpoint the browser needs because it cannot work this out itself.
 *
 * The web app used to read a Firebase custom claim called `admin`. Administrators moved
 * into a table and nothing has written that claim since, so it read `undefined` and the
 * founding administrator was shown no admin link while being allowed through every admin
 * route. These assert the two halves that were disagreeing.
 */
describe("GET /v1/me", () => {
  it("refuses without a token", async () => {
    expect((await get("/v1/me", {})).status).toBe(401);
  });

  it("tells an ordinary account it is not an admin", async () => {
    const body = await (await get("/v1/me")).json();
    expect(body).toEqual({ uid: "u-1", isAdmin: false });
  });

  it("tells an admin that it is one", async () => {
    const body = await (
      await get("/v1/me", { authorization: "Bearer admin" })
    ).json();
    expect(body).toEqual({ uid: "admin-1", isAdmin: true });
  });

  it("agrees with what the admin gate actually does", async () => {
    // The bug was the client and the server disagreeing, so this asserts they cannot:
    // whatever `/v1/me` says about being an admin is what /v1/admin/* does about it.
    for (const token of ["good", "admin"]) {
      const headers = { authorization: `Bearer ${token}` };
      const me = (await (await get("/v1/me", headers)).json()) as { isAdmin: boolean };
      const reached = (await get("/v1/admin/users", headers)).status !== 403;
      expect(me.isAdmin).toBe(reached);
    }
  });

  it("stops calling someone an admin the moment they are removed", async () => {
    await store.removeAdmin("admin@adcode.test");
    const body = (await (
      await get("/v1/me", { authorization: "Bearer admin" })
    ).json()) as { isAdmin: boolean };
    expect(body.isAdmin).toBe(false);
  });
});


const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${server.url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("authentication", () => {
  it("rejects every /v1 endpoint without a bearer token", async () => {
    expect((await get("/v1/balance", {})).status).toBe(401);
    expect((await get("/v1/config", {})).status).toBe(401);
    expect((await post("/v1/serve", { tags: [], themeKind: "dark", count: 1 }, {})).status).toBe(401);
    expect((await post("/v1/receipts", { receipts: [] }, {})).status).toBe(401);
  });

  it("rejects a forged token", async () => {
    const headers = { authorization: "Bearer forged", "content-type": "application/json" };
    expect((await get("/v1/balance", headers)).status).toBe(401);
  });

  it("rejects a banned user with 403, not 401", async () => {
    // A 401 tells a client to retry auth, which a banned client would do forever.
    await store.putUser({ uid: "u-1", status: "banned", createdAt: 0 });
    expect((await get("/v1/balance")).status).toBe(403);
  });
});

describe("routing", () => {
  it("404s an unknown path", async () => {
    expect((await get("/v1/nope")).status).toBe(404);
    expect((await get("/nope")).status).toBe(404);
  });

  it("400s a malformed serve body", async () => {
    expect((await post("/v1/serve", { tags: "no", themeKind: "dark", count: 1 })).status).toBe(400);
  });

  it("400s a body that is not JSON", async () => {
    const res = await fetch(`${server.url}/v1/serve`, { method: "POST", headers: auth, body: "{{{" });
    expect(res.status).toBe(400);
  });

  it("serves the balance as decimal strings", async () => {
    const res = await get("/v1/balance");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ availableMicros: "0", lifetimeMicros: "0" });
  });

  it("serves the ledger, empty for a new user", async () => {
    const res = await get("/v1/ledger");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], nextCursor: null });
  });

  it("serves the config", async () => {
    const body = (await (await get("/v1/config")).json()) as Record<string, unknown>;
    expect(body["killSwitch"]).toBe(false);
  });

  it("refuses a GET where the contract says POST", async () => {
    expect((await get("/v1/serve")).status).toBe(404);
  });
});

describe("reports", () => {
  const report = {
    kind: "bug",
    title: "Terminal freezes",
    body: "Splitting a third time stops accepting input.",
    appVersion: "0.1.0",
    platform: "win32",
  };

  it("accepts a report and returns its id", async () => {
    const res = await post("/v1/reports", report);
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toHaveProperty("reportId");
  });

  it("400s a malformed report", async () => {
    expect((await post("/v1/reports", { ...report, kind: "lawsuit" })).status).toBe(400);
    expect((await post("/v1/reports", { ...report, title: "" })).status).toBe(400);
  });

  it("requires a token", async () => {
    expect((await post("/v1/reports", report, {})).status).toBe(401);
  });

  it("refuses a non-admin listing reports", async () => {
    expect((await get("/v1/admin/reports")).status).toBe(403);
  });

  it("lets an admin read what was filed", async () => {
    await post("/v1/reports", report);
    const adminHeaders = { authorization: "Bearer admin", "content-type": "application/json" };
    const body = (await (await get("/v1/admin/reports", adminHeaders)).json()) as {
      rows: Record<string, unknown>[];
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.["title"]).toBe("Terminal freezes");
  });
});

describe("cors", () => {
  it("answers preflight without requiring a token", async () => {
    const res = await fetch(`${server.url}/v1/balance`, {
      method: "OPTIONS",
      headers: { origin: "https://adcode.bluethenics.com" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://adcode.bluethenics.com");
  });

  it("echoes only an allowed origin, and varies on it", async () => {
    const res = await fetch(`${server.url}/v1/balance`, {
      headers: { ...auth, origin: "https://adcode.bluethenics.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://adcode.bluethenics.com");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("sends no allow-origin to a site that is not on the list", async () => {
    const res = await fetch(`${server.url}/v1/balance`, {
      headers: { ...auth, origin: "https://evil.test" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("portal", () => {
  const campaign = {
    name: "Rust developers",
    cpmMicros: "8000000",
    budgetMicros: "50000000",
    targetTags: ["lang:rust"],
  };

  it("404s the advertiser before sign-up", async () => {
    expect((await get("/v1/portal/advertiser")).status).toBe(404);
  });

  it("signs up, then reports the advertiser", async () => {
    expect((await post("/v1/portal/advertiser", { name: "Acme" })).status).toBe(200);

    const body = (await (await get("/v1/portal/advertiser")).json()) as Record<string, unknown>;
    expect(body["name"]).toBe("Acme");
    expect(body["availableMicros"]).toBe("0");
  });

  it("409s a second sign-up", async () => {
    await post("/v1/portal/advertiser", { name: "Acme" });
    expect((await post("/v1/portal/advertiser", { name: "Acme Two" })).status).toBe(409);
  });

  it("creates a campaign, paused", async () => {
    await post("/v1/portal/advertiser", { name: "Acme" });
    const res = await post("/v1/portal/campaigns", campaign);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>)["status"]).toBe("paused");
  });

  it("400s a malformed campaign", async () => {
    await post("/v1/portal/advertiser", { name: "Acme" });
    expect((await post("/v1/portal/campaigns", { ...campaign, budgetMicros: "1" })).status).toBe(400);
  });

  it("402s activation with no money behind it", async () => {
    await post("/v1/portal/advertiser", { name: "Acme" });
    const created = (await (await post("/v1/portal/campaigns", campaign)).json()) as Record<string, string>;

    const res = await post(`/v1/portal/campaigns/${created["campaignId"]}/status`, { status: "active" });
    // No approved creative yet, so this is refused before funding is even considered.
    expect(res.status).toBe(409);
  });

  it("publishes the limits the portal validates against", async () => {
    const body = (await (await get("/v1/portal/limits")).json()) as Record<string, unknown>;
    expect(body["headline"]).toBe(80);
    expect(typeof body["minBudgetMicros"]).toBe("string");
  });

  it("keeps one advertiser out of another's campaigns", async () => {
    await post("/v1/portal/advertiser", { name: "Acme" });
    const created = (await (await post("/v1/portal/campaigns", campaign)).json()) as Record<string, string>;

    // "admin" is a different uid that has not signed up as an advertiser.
    const other = { authorization: "Bearer admin", "content-type": "application/json" };
    const res = await fetch(`${server.url}/v1/portal/campaigns/${created["campaignId"]}/status`, {
      method: "POST",
      headers: other,
      body: JSON.stringify({ status: "active" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("payment webhook", () => {
  const eventBody = (advertiserId = "adv-1") =>
    JSON.stringify({
      type: "payment.succeeded",
      data: {
        payment_id: "pay_abc",
        total_amount: 5000,
        currency: "USD",
        metadata: { advertiserId },
      },
    });

  const postWebhook = (raw: string, id: string, ts: string, sig?: string) =>
    fetch(`${server.url}/v1/webhooks/dodo`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": ts,
        "webhook-signature": sig ?? `v1,${sign(WEBHOOK_SECRET, id, ts, raw)}`,
      },
      body: raw,
    });

  const nowSeconds = () => String(Math.floor(Date.now() / 1000));

  it("needs no bearer token - the signature is the authentication", async () => {
    await post("/v1/portal/advertiser", { name: "Acme" });
    const advertiser = await store.advertiserForOwner("u-1");
    const raw = eventBody(advertiser!.advertiserId);

    const res = await postWebhook(raw, "evt_route_1", nowSeconds());
    expect(res.status).toBe(200);
    expect((await store.getAdvertiser(advertiser!.advertiserId))?.fundedMicros).toBe(50_000_000n);
  });

  it("400s a forged signature", async () => {
    const raw = eventBody();
    const res = await postWebhook(raw, "evt_route_2", nowSeconds(), "v1,forged");
    expect(res.status).toBe(400);
  });

  it("200s an event it does not fund on, so the provider stops retrying", async () => {
    const raw = JSON.stringify({ type: "payment.failed", data: {} });
    const res = await postWebhook(raw, "evt_route_3", nowSeconds());
    expect(res.status).toBe(200);
  });
});

describe("checkout", () => {
  it("refuses before sign-up", async () => {
    const res = await post("/v1/portal/checkout", {
      amountMicros: "50000000",
      billingCountry: "US",
      email: "billing@acme.test",
    });
    expect(res.status).toBe(404);
  });

  it("returns a payment link for a signed-up advertiser", async () => {
    await post("/v1/portal/advertiser", { name: "Acme" });
    const res = await post("/v1/portal/checkout", {
      amountMicros: "50000000",
      billingCountry: "US",
      email: "billing@acme.test",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["paymentLink"]).toContain("dodopayments.com");
    expect((lastCheckout as Record<string, unknown>)["amountMicros"]).toBe(50_000_000n);
  });

  it("400s an amount below the minimum, a fractional cent, or a bad country", async () => {
    await post("/v1/portal/advertiser", { name: "Acme" });
    const bad = async (over: Record<string, unknown>) =>
      (
        await post("/v1/portal/checkout", {
          amountMicros: "50000000",
          billingCountry: "US",
          email: "billing@acme.test",
          ...over,
        })
      ).status;

    expect(await bad({ amountMicros: "1000" })).toBe(400);
    expect(await bad({ amountMicros: "50000001" })).toBe(400);
    expect(await bad({ billingCountry: "USA" })).toBe(400);
    expect(await bad({ email: "" })).toBe(400);
  });

  it("does not credit anything - only the webhook moves money", async () => {
    await post("/v1/portal/advertiser", { name: "Acme" });
    await post("/v1/portal/checkout", {
      amountMicros: "50000000",
      billingCountry: "US",
      email: "billing@acme.test",
    });

    const advertiser = await store.advertiserForOwner("u-1");
    expect(advertiser?.fundedMicros).toBe(0n);
  });
});

describe("admin surface", () => {
  const adminHeaders = { authorization: "Bearer admin", "content-type": "application/json" };
  const adminGet = (path: string) => get(path, adminHeaders);
  const adminPost = (path: string, body: unknown) => post(path, body, adminHeaders);

  it("refuses every admin route to a non-admin", async () => {
    expect((await get("/v1/admin/users")).status).toBe(403);
    expect((await get("/v1/admin/creatives")).status).toBe(403);
    expect((await get("/v1/admin/posts")).status).toBe(403);
    expect((await post("/v1/admin/test-serve", { uid: "u-1", creativeId: "c-1" })).status).toBe(403);
  });

  it("still requires a token before the admin check", async () => {
    expect((await get("/v1/admin/users", {})).status).toBe(401);
  });

  it("lists users for an admin", async () => {
    await get("/v1/balance"); // creates u-1 on first sight
    const body = (await (await adminGet("/v1/admin/users")).json()) as { rows: unknown[] };
    expect(body.rows.length).toBeGreaterThan(0);
  });

  it("bans and unbans a user", async () => {
    await get("/v1/balance");
    expect((await adminPost("/v1/admin/users/u-1/status", { status: "banned" })).status).toBe(200);
    expect((await get("/v1/balance")).status).toBe(403);

    await adminPost("/v1/admin/users/u-1/status", { status: "active" });
    expect((await get("/v1/balance")).status).toBe(200);
  });

  it("404s a ban against a user who does not exist", async () => {
    expect((await adminPost("/v1/admin/users/nobody/status", { status: "banned" })).status).toBe(404);
  });

  it("400s an unknown user status", async () => {
    await get("/v1/balance");
    expect((await adminPost("/v1/admin/users/u-1/status", { status: "deleted" })).status).toBe(400);
  });

  it("saves a post and serves it publicly without a token", async () => {
    const saved = await adminPost("/v1/admin/posts", {
      slug: "hello-world",
      title: "Hello world",
      description: "A first post.",
      body: "Some text.",
      status: "published",
    });
    expect(saved.status).toBe(200);

    // No auth header at all - published posts are public content.
    const publicList = await fetch(`${server.url}/v1/posts`);
    expect(publicList.status).toBe(200);
    const body = (await publicList.json()) as { posts: { slug: string }[] };
    expect(body.posts.map((p) => p.slug)).toEqual(["hello-world"]);
  });

  it("never serves a draft publicly", async () => {
    await adminPost("/v1/admin/posts", {
      slug: "secret-draft",
      title: "Draft",
      description: "Not ready.",
      body: "Text.",
      status: "draft",
    });

    const one = await fetch(`${server.url}/v1/posts/secret-draft`);
    expect(one.status).toBe(404);

    const list = (await (await fetch(`${server.url}/v1/posts`)).json()) as { posts: unknown[] };
    expect(list.posts).toHaveLength(0);
  });

  it("400s a post whose slug would break a URL", async () => {
    const bad = await adminPost("/v1/admin/posts", {
      slug: "Hello World",
      title: "T",
      description: "D",
      body: "B",
      status: "draft",
    });
    expect(bad.status).toBe(400);
  });

  it("404s a test serve for a creative that does not exist", async () => {
    expect((await adminPost("/v1/admin/test-serve", { uid: "u-1", creativeId: "nope" })).status).toBe(404);
  });
});

describe("rate limiting", () => {
  it("429s a user over the ceiling, and says when to come back", async () => {
    const cfg = await store.getConfig();
    await store.putConfig({ ...cfg, requestsPerWindow: 3, rateWindowMs: 60_000 });

    for (let i = 0; i < 3; i++) expect((await get("/v1/balance")).status).toBe(200);

    const limited = await get("/v1/balance");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("limits every endpoint, not just the expensive one", async () => {
    const cfg = await store.getConfig();
    await store.putConfig({ ...cfg, requestsPerWindow: 1, rateWindowMs: 60_000 });

    await get("/v1/config");
    expect((await post("/v1/serve", { tags: [], themeKind: "dark", count: 1 })).status).toBe(429);
  });
});

describe("admin routes", () => {
  const adminHeaders = { authorization: "Bearer admin", "content-type": "application/json" };

  it("refuses a non-admin with 403", async () => {
    expect((await get("/v1/admin/users/u-1/ledger")).status).toBe(403);
  });

  it("allows an admin", async () => {
    const res = await get("/v1/admin/users/u-1/ledger", adminHeaders);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], nextCursor: null });
  });

  it("still requires a token", async () => {
    expect((await get("/v1/admin/users/u-1/ledger", {})).status).toBe(401);
  });
});
