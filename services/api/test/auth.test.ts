import { describe, it, expect, beforeEach } from "vitest";
import { authenticate, bearerFrom, type TokenVerifier } from "../src/auth.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;

const verifier: TokenVerifier = {
  async verify(idToken) {
    if (idToken === "good") return { uid: "u-1", claims: {} };
    if (idToken === "admin") return { uid: "admin-1", claims: { admin: true } };
    return null;
  },
};

const clock = { now: () => 1_000 };

beforeEach(async () => {
  store = createMemoryStore();
  await store.putUser({ uid: "u-1", status: "active", createdAt: 0 });
  await store.putUser({ uid: "admin-1", status: "active", createdAt: 0 });
});

describe("bearerFrom", () => {
  it("extracts a token from a well-formed header", () => {
    expect(bearerFrom("Bearer abc")).toBe("abc");
    expect(bearerFrom("bearer abc")).toBe("abc");
  });

  it("rejects a malformed header", () => {
    for (const bad of [undefined, "", "abc", "Basic abc", "Bearer", "Bearer  "]) {
      expect(bearerFrom(bad)).toBeNull();
    }
  });
});

describe("authenticate", () => {
  it("accepts a valid token for an active user", async () => {
    expect(await authenticate({ store, verifier, clock }, "Bearer good")).toEqual({
      ok: true,
      uid: "u-1",
      isAdmin: false,
    });
  });

  it("reports the admin claim", async () => {
    expect(await authenticate({ store, verifier, clock }, "Bearer admin")).toEqual({
      ok: true,
      uid: "admin-1",
      isAdmin: true,
    });
  });

  it("refuses a missing header", async () => {
    expect(await authenticate({ store, verifier, clock }, undefined)).toEqual({
      ok: false,
      failure: "missing-token",
    });
  });

  it("refuses a token the verifier rejects", async () => {
    expect(await authenticate({ store, verifier, clock }, "Bearer forged")).toEqual({
      ok: false,
      failure: "bad-token",
    });
  });

  it("refuses a banned user even though the token is valid", async () => {
    // Spec decision #6: a ban must bite now, not when the token next refreshes.
    await store.putUser({ uid: "u-1", status: "banned", createdAt: 0 });
    expect(await authenticate({ store, verifier, clock }, "Bearer good")).toEqual({
      ok: false,
      failure: "banned",
    });
  });

  it("creates a user record on first sight, so anonymous auth needs no signup call", async () => {
    const fresh = createMemoryStore();
    expect(await authenticate({ store: fresh, verifier, clock }, "Bearer good")).toEqual({
      ok: true,
      uid: "u-1",
      isAdmin: false,
    });
    expect(await fresh.getUser("u-1")).toEqual({ uid: "u-1", status: "active", createdAt: 1_000 });
  });

  it("does not treat a non-boolean admin claim as admin", async () => {
    const sneaky: TokenVerifier = {
      async verify() {
        return { uid: "u-2", claims: { admin: "true" } };
      },
    };
    const result = await authenticate({ store, verifier: sneaky, clock }, "Bearer whatever");
    expect(result).toEqual({ ok: true, uid: "u-2", isAdmin: false });
  });
});
