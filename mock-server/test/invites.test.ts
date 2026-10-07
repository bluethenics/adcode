import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockServer, type MockServer } from "../src/server.ts";

let server: MockServer;
const auth = { authorization: "Bearer fake-id-token", "content-type": "application/json" };

beforeAll(async () => {
  server = await createMockServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await fetch(`${server.url}/__test__/reset`, { method: "POST" });
});

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = auth) => {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

describe("invites on the mock", () => {
  it("knows the smoke run's invite code without an account, like the real lookup", async () => {
    expect(await call("GET", "/v1/invite/smoke-invite", undefined, {})).toEqual({
      status: 200,
      body: { valid: true, inviterName: "Sam", kind: "user" },
    });
    expect((await call("GET", "/v1/invite/nope123", undefined, {})).body).toEqual({ valid: false, inviterName: null, kind: null });
  });

  it("starts unclaimed, with its own code and link", async () => {
    const { status, body } = await call("GET", "/v1/referrals");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      code: "mylocal",
      link: "https://adcode.bluethenics.com/i/mylocal",
      claimed: false,
      invitedBy: null,
      canClaim: true,
      people: { claimed: 0, seen: 0, cameBack: 0 },
      earnedMicros: "0",
      rates: { userPercent: 10, advertiserPercent: 5, windowDays: 365 },
    });
  });

  it("records a claim once and remembers who invited", async () => {
    expect(await call("POST", "/v1/referrals/claim", { code: "ADCode invite: SMOKE-INVITE", how: "clipboard" }))
      .toEqual({ status: 200, body: { ok: true, inviterName: "Sam" } });
    expect(server.claims()).toEqual([{ code: "smoke-invite", how: "clipboard" }]);
    expect((await call("GET", "/v1/referrals")).body).toMatchObject({ claimed: true, invitedBy: "Sam", canClaim: false });
    expect(await call("POST", "/v1/referrals/claim", { code: "smoke-invite", how: "paste" })).toEqual({ status: 409, body: { error: "already-claimed" } });
  });

  it("refuses an unknown code and a malformed claim", async () => {
    expect(await call("POST", "/v1/referrals/claim", { code: "nope123", how: "paste" })).toEqual({ status: 409, body: { error: "unknown-code" } });
    expect((await call("POST", "/v1/referrals/claim", { code: "nope123", how: "portal" })).status).toBe(400);
  });

  it("changes whether the name shows", async () => {
    expect((await call("PATCH", "/v1/referrals", { showName: false })).body).toMatchObject({ showName: false });
  });

  it("lets a test seed another inviter", async () => {
    server.seedInvite("kimcode", "Kim");
    expect((await call("GET", "/v1/invite/kimcode", undefined, {})).body).toEqual({ valid: true, inviterName: "Kim", kind: "user" });
  });
});
