import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createApiServer, type ApiServer } from "../src/server.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { TokenVerifier } from "../src/auth.ts";

/**
 * The HTTP surface of cash-out and feedback triage.
 *
 * `withdrawals.test.ts` covers the rules; this covers the wiring - which token reaches
 * which route, and what a refusal looks like on the wire. The two most valuable cases
 * here are the ones asserting that an ordinary account is refused the admin decisions:
 * those routes move money out, and the gate on them is a path prefix rather than a check
 * anybody remembered to write.
 */
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "good") {
      return { uid: "u-1", claims: { email: "ada@example.com", email_verified: true } };
    }
    if (token === "anon") return { uid: "u-anon", claims: {} };
    if (token === "admin") {
      return { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } };
    }
    return null;
  },
};

let server: ApiServer;
let store: ReturnType<typeof createMemoryStore>;

const user = { authorization: "Bearer good", "content-type": "application/json" };
const anon = { authorization: "Bearer anon", "content-type": "application/json" };
const admin = { authorization: "Bearer admin", "content-type": "application/json" };

const OLD = Date.now() - 30 * 86_400_000;

const get = (path: string, headers: Record<string, string> = user) =>
  fetch(`${server.url}${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = user) =>
  fetch(`${server.url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

/**
 * `Response.json()` is `unknown`, and every assertion below reads named fields.
 *
 * Generic rather than a fixed shape: each caller says what it expects, which keeps the
 * cast next to the assertion that depends on it instead of hidden in a helper.
 */
const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

interface RuleView {
  id: string;
  ok: boolean;
}

interface PayoutsBody {
  eligible: boolean;
  profile: { legalName: string } | null;
  rules: RuleView[];
  availableMicros: string;
  minMicros: string;
}

interface WithdrawalBody {
  withdrawalId: string;
  status: string;
}

interface ErrorBody {
  error: string;
}

interface ReportsBody {
  rows: { reportId: string; status: string }[];
}

const profile = {
  method: "bank",
  legalName: "Ada Lovelace",
  country: "GB",
  currency: "GBP",
  email: null,
  bankDetails: null,
  fields: { accountNumber: "12345678", sortCode: "20-00-00", bankName: "Example Bank" },
};

/** Age the account past the cooling-off window and give it something to withdraw. */
async function fundedAccount(): Promise<void> {
  await store.putPayoutCorridor({
    country: "GB",
    currency: "GBP",
    enabled: true,
    requiredFields: ["accountNumber", "sortCode", "bankName"],
    sourceNote: "verified test route",
    verifiedAt: OLD,
    updatedAt: OLD,
    updatedBy: "admin-1",
  });
  // `authenticate` created the row on the first request; only its age needs backdating.
  const existing = await store.getUser("u-1");
  await store.putUser({
    uid: "u-1",
    status: "active",
    createdAt: OLD,
    email: "ada@example.com",
    emailVerified: true,
    ...(existing === null ? {} : {}),
  });
  await store.appendEntryAndUpdateBalance({
    entryId: `seed-${Math.random()}`,
    uid: "u-1",
    kind: "impression",
    micros: 75_000_000n,
    refId: null,
    createdAt: OLD,
    description: "seed",
  });
}

beforeAll(async () => {
  store = createMemoryStore();
  server = await createApiServer({ store, verifier });
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  store.reset();
  await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
});

describe("GET /v1/payouts", () => {
  it("refuses without a token", async () => {
    expect((await get("/v1/payouts", {})).status).toBe(401);
  });

  it("tells a fresh anonymous account exactly what it is missing", async () => {
    const body = await json<PayoutsBody>(await get("/v1/payouts", anon));
    expect(body.eligible).toBe(false);
    expect(body.profile).toBeNull();
    expect(body.rules.map((r: { id: string }) => r.id)).toEqual([
      "minimum",
      "verified-email",
      "account-age",
      "payout-details",
      "no-pending",
    ]);
  });

  it("sends money as decimal strings, never as JSON numbers", async () => {
    await get("/v1/payouts");
    await fundedAccount();
    const body = await json<PayoutsBody>(await get("/v1/payouts"));
    expect(body.availableMicros).toBe("75000000");
    expect(body.minMicros).toBe("50000000");
  });
});

describe("POST /v1/payouts/profile", () => {
  it("saves details and returns the whole screen, now eligible", async () => {
    await get("/v1/payouts");
    await fundedAccount();

    const response = await post("/v1/payouts/profile", profile);
    expect(response.status).toBe(200);

    const body = await json<PayoutsBody>(response);
    expect(body.profile?.legalName).toBe("Ada Lovelace");
    expect(body.eligible).toBe(true);
  });

  it("400s on details it cannot use", async () => {
    expect((await post("/v1/payouts/profile", { ...profile, currency: "XYZ" })).status).toBe(400);
  });
});

describe("POST /v1/withdrawals", () => {
  it("400s on an amount under the minimum before it looks at anything else", async () => {
    const response = await post("/v1/withdrawals", { amountMicros: "49000000" });
    expect(response.status).toBe(400);
    expect((await json<ErrorBody>(response)).error).toBe("invalid-amount");
  });

  it("409s an account that is not eligible, naming the reason as a code", async () => {
    const response = await post("/v1/withdrawals", { amountMicros: "50000000" });
    expect(response.status).toBe(409);
    expect((await json<ErrorBody>(response)).error).toBe("not-eligible");
  });

  it("402s a request for more than is available", async () => {
    await get("/v1/payouts");
    await fundedAccount();
    await post("/v1/payouts/profile", profile);

    const response = await post("/v1/withdrawals", { amountMicros: "100000000" });
    expect(response.status).toBe(402);
  });

  it("takes the request and holds the money", async () => {
    await get("/v1/payouts");
    await fundedAccount();
    await post("/v1/payouts/profile", profile);

    const response = await post("/v1/withdrawals", { amountMicros: "50000000" });
    expect(response.status).toBe(200);
    expect((await json<WithdrawalBody>(response)).status).toBe("requested");
    expect((await store.getBalance("u-1")).pendingWithdrawalMicros).toBe(50_000_000n);
  });
});

describe("the admin decisions", () => {
  const request = async (): Promise<string> => {
    await get("/v1/payouts");
    await fundedAccount();
    await post("/v1/payouts/profile", profile);
    const body = await json<WithdrawalBody>(await post("/v1/withdrawals", { amountMicros: "50000000" }));
    return body.withdrawalId;
  };

  it("refuses an ordinary account at every admin route", async () => {
    const id = await request();
    expect((await get("/v1/admin/withdrawals")).status).toBe(403);
    expect((await post(`/v1/admin/withdrawals/${id}/approve`, {})).status).toBe(403);
    expect((await post(`/v1/admin/withdrawals/${id}/paid`, { providerRef: "x" })).status).toBe(403);
    expect((await post(`/v1/admin/withdrawals/${id}/reject`, { note: "x" })).status).toBe(403);
    expect((await store.getWithdrawal(id))?.status).toBe("requested");
  });

  it("lists what needs review", async () => {
    await request();
    const body = await json<{ rows: { destination: { email: string } }[] }>(
      await get("/v1/admin/withdrawals?status=requested", admin),
    );
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.destination.email).toBeNull();
  });

  it("refuses to record a payment with no transfer reference", async () => {
    const id = await request();
    expect((await post(`/v1/admin/withdrawals/${id}/paid`, {}, admin)).status).toBe(400);
    expect((await store.getWithdrawal(id))?.status).toBe("requested");
  });

  it("records the payment", async () => {
    const id = await request();
    expect((await post(`/v1/admin/withdrawals/${id}/approve`, {}, admin)).status).toBe(200);
    const response = await post(
      `/v1/admin/withdrawals/${id}/paid`,
      { providerRef: "TRANSFER-1" },
      admin,
    );
    expect(response.status).toBe(200);
    expect((await json<WithdrawalBody>(response)).status).toBe("paid");
  });

  it("refuses a rejection with no reason, since the reason is what gets shown", async () => {
    const id = await request();
    expect((await post(`/v1/admin/withdrawals/${id}/reject`, {}, admin)).status).toBe(400);
  });

  it("409s a decision on a request already decided", async () => {
    const id = await request();
    await post(`/v1/admin/withdrawals/${id}/approve`, {}, admin);
    await post(`/v1/admin/withdrawals/${id}/paid`, { providerRef: "TRANSFER-1" }, admin);
    const again = await post(`/v1/admin/withdrawals/${id}/reject`, { note: "no" }, admin);
    expect(again.status).toBe(409);
  });

  it("lets the person who asked cancel it", async () => {
    const id = await request();
    expect((await post(`/v1/withdrawals/${id}/cancel`, {})).status).toBe(200);
    expect((await store.getBalance("u-1")).availableMicros).toBe(75_000_000n);
  });
});

describe("admin payout countries", () => {
  it("lets only an admin verify and enable a structured bank route", async () => {
    const path = "/v1/admin/payout-corridors/IN/INR";
    const body = {
      enabled: true,
      requiredFields: ["accountNumber", "ifsc", "bankName"],
      sourceNote: "Verified in the Wise recipient flow on 2026-08-26.",
    };
    expect((await post(path, body)).status).toBe(403);
    expect((await post(path, body, admin)).status).toBe(200);

    const listed = await json<{ corridors: { country: string; currency: string; enabled: boolean }[] }>(
      await get("/v1/admin/payout-corridors", admin),
    );
    expect(listed.corridors).toContainEqual(expect.objectContaining({ country: "IN", currency: "INR", enabled: true }));

    const publicRoutes = await json<{ corridors: { country: string; currency: string }[] }>(
      await get("/v1/payout-corridors"),
    );
    expect(publicRoutes.corridors).toContainEqual(expect.objectContaining({ country: "IN", currency: "INR" }));
  });
});

describe("feedback triage", () => {
  const filed = async (): Promise<string> => {
    const body = await json<{ reportId: string }>(
      await post("/v1/reports", {
        kind: "bug",
        title: "Terminal freezes",
        body: "Splitting a third time stops accepting input.",
        appVersion: "0.1.0",
        platform: "win32",
      }),
    );
    return body.reportId;
  };

  it("marks a report triaged, then closed", async () => {
    const id = await filed();

    expect((await post(`/v1/admin/reports/${id}/status`, { status: "triaged" }, admin)).status).toBe(
      200,
    );
    let listed = await json<ReportsBody>(await get("/v1/admin/reports", admin));
    expect(listed.rows[0]?.status).toBe("triaged");

    await post(`/v1/admin/reports/${id}/status`, { status: "closed" }, admin);
    listed = await json<ReportsBody>(await get("/v1/admin/reports", admin));
    expect(listed.rows[0]?.status).toBe("closed");
  });

  it("400s a status nobody defined", async () => {
    const id = await filed();
    expect((await post(`/v1/admin/reports/${id}/status`, { status: "wat" }, admin)).status).toBe(400);
  });

  it("404s a report that is not there", async () => {
    expect((await post("/v1/admin/reports/rep-nope/status", { status: "closed" }, admin)).status).toBe(
      404,
    );
    expect((await post("/v1/admin/reports/rep-nope/delete", {}, admin)).status).toBe(404);
  });

  it("deletes a report, and leaves the audit row behind", async () => {
    const id = await filed();
    expect((await post(`/v1/admin/reports/${id}/delete`, {}, admin)).status).toBe(200);

    const listed = await json<ReportsBody>(await get("/v1/admin/reports", admin));
    expect(listed.rows).toHaveLength(0);

    const audit = await store.listAudit();
    expect(audit.some((a) => a.action === `report:deleted:${id}`)).toBe(true);
  });

  it("refuses an ordinary account both of them", async () => {
    const id = await filed();
    expect((await post(`/v1/admin/reports/${id}/status`, { status: "closed" })).status).toBe(403);
    expect((await post(`/v1/admin/reports/${id}/delete`, {})).status).toBe(403);
  });
});

describe("GET /v1/admin/overview", () => {
  it("counts what is waiting, and totals what is held", async () => {
    await get("/v1/payouts");
    await fundedAccount();
    await post("/v1/payouts/profile", profile);
    await post("/v1/withdrawals", { amountMicros: "50000000" });
    await post("/v1/reports", {
      kind: "bug",
      title: "A bug",
      body: "It broke",
      appVersion: "0.1.0",
      platform: "win32",
    });

    const body = await json<{
      withdrawalsPending: number;
      reportsOpen: number;
      creativesWaiting: number;
      pendingWithdrawalMicros: string;
    }>(await get("/v1/admin/overview", admin));
    expect(body.withdrawalsPending).toBe(1);
    expect(body.reportsOpen).toBe(1);
    expect(body.creativesWaiting).toBe(0);
    expect(body.pendingWithdrawalMicros).toBe("50000000");
  });

  it("is not readable by an ordinary account", async () => {
    expect((await get("/v1/admin/overview")).status).toBe(403);
  });
});
