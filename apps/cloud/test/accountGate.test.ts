/*
 * A banned account on the web version's own routes.
 *
 * The API refuses a banned account on every /v1 call, and the web version forwards /v1 there
 * unchanged - header included, which is how the tab's main process learns of the ban. Its own
 * /api/* (chat history, GitHub projects, the old sandbox's download) never reach the API, so the
 * Worker asks the API once per account and refuses them itself.
 */
import { describe, expect, it, vi } from "vitest";
import { route, type RouterDeps } from "../src/router.ts";
import { forwardAccountApi } from "../src/accountApi.ts";
import { createAccountGate, standingFromApi } from "../src/accountGate.ts";
import type { Env } from "../src/env.ts";
import { ACCOUNT_HEADER, bannedResponse } from "../../../services/api/src/accountBan.ts";

const deps = (standing: "active" | "banned" | "unknown"): RouterDeps => ({
  verify: async (token) => (token === "good-token" ? { uid: "user-123", email: null, exp: 0 } : null),
  refuseSocket: (code, reason) => new Response(`refused ${code} ${reason}`, { status: 299 }),
  standing: async () => standing,
});

function env(): { env: Env; browserFetch: ReturnType<typeof vi.fn>; userFetch: ReturnType<typeof vi.fn> } {
  const browserFetch = vi.fn(async () => Response.json({ chats: [] }));
  const userFetch = vi.fn(async () => Response.json({ ok: true }));
  return {
    browserFetch, userFetch,
    env: { BROWSER: { getByName: () => ({ fetch: browserFetch }) }, USER: { getByName: () => ({ fetch: userFetch }) }, ADMIN_UIDS: "", APP_HOST: "web.bluethenics.com", PREVIEW_SUFFIX: ".web.bluethenics.com" } as unknown as Env,
  };
}

describe("the web version's own routes", () => {
  it("refuse a banned account before reaching its storage", async () => {
    const { env: bindings, browserFetch, userFetch } = env();
    for (const path of ["/api/chats", "/api/chats/chat_1", "/api/github/status", "/api/session", "/api/download"]) {
      const response = await route(new Request(`https://web.bluethenics.com${path}`, { headers: { authorization: "Bearer good-token" } }), bindings, deps("banned"));
      expect(response.status, path).toBe(403);
      expect(response.headers.get(ACCOUNT_HEADER), path).toBe("banned");
      expect((await response.json() as { error: string }).error).toBe("account-banned");
    }
    expect(browserFetch).not.toHaveBeenCalled();
    expect(userFetch).not.toHaveBeenCalled();
  });

  it("let an active account through, and an unknown answer too", async () => {
    for (const standing of ["active", "unknown"] as const) {
      const { env: bindings, browserFetch } = env();
      expect((await route(new Request("https://web.bluethenics.com/api/chats", { headers: { authorization: "Bearer good-token" } }), bindings, deps(standing))).status).toBe(200);
      expect(browserFetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe("the account gate", () => {
  it("asks the API's /v1/me with the person's own token, and reads the ban header", async () => {
    const seen: string[] = [];
    const api = { fetch: async (request: Request) => { seen.push(`${new URL(request.url).pathname} ${request.headers.get("authorization")}`); return request.headers.get("authorization") === "Bearer bad" ? bannedResponse() : Response.json({ uid: "u" }); } };
    const lookup = standingFromApi(api);
    expect(await lookup("u", "bad")).toBe("banned");
    expect(await lookup("u", "fine")).toBe("active");
    expect(seen).toEqual(["/v1/me Bearer bad", "/v1/me Bearer fine"]);
    // Anything else is not an answer: a 403 without the header, a 500.
    await expect(standingFromApi({ fetch: async () => new Response("no", { status: 403 }) })("u", "t")).rejects.toThrow();
    await expect(standingFromApi({ fetch: async () => new Response("no", { status: 500 }) })("u", "t")).rejects.toThrow();
  });

  it("keeps an answer for a few seconds either way, and never keeps 'unknown'", async () => {
    let now = 0, standing: "active" | "banned" = "active", calls = 0, broken = false;
    const gate = createAccountGate(async () => { calls++; if (broken) throw new Error("down"); return standing; }, { ttlMs: 5_000, now: () => now });
    expect(await gate.standing("u", "t")).toBe("active");
    standing = "banned";
    now = 4_000;
    expect(await gate.standing("u", "t")).toBe("active");
    now = 5_000;
    expect(await gate.standing("u", "t")).toBe("banned");
    standing = "active";
    now = 10_001;
    expect(await gate.standing("u", "t")).toBe("active");
    broken = true;
    now = 20_000;
    expect(await gate.standing("u", "t")).toBe("unknown");
    expect(await gate.standing("u", "t")).toBe("unknown");
    expect(calls).toBe(5);
  });
});

describe("the /v1 forward", () => {
  it("passes the ban header through, so the tab learns the account is banned", async () => {
    const bindings = { ACCOUNT_API: { fetch: async () => bannedResponse() } } as unknown as Env;
    const response = await forwardAccountApi(new Request("https://web.bluethenics.com/v1/sponsored/earn", { method: "POST", headers: { authorization: "Bearer t" }, body: "{}" }), bindings);
    expect(response.status).toBe(403);
    expect(response.headers.get(ACCOUNT_HEADER)).toBe("banned");
  });
});
