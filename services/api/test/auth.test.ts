import { describe, it, expect, beforeEach } from "vitest";
import { authenticate, bearerFrom, type TokenVerifier } from "../src/auth.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;

const verifier: TokenVerifier = {
  async verify(idToken) {
    if (idToken === "good") return { uid: "u-1", claims: {} };
    if (idToken === "admin") {
      return { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } };
    }
    // The same address, but the provider never verified it. Email/Password sign-up would
    // let anybody create this account, so it must not be an admin.
    if (idToken === "unverified") {
      return { uid: "imposter", claims: { email: "admin@adcode.test", email_verified: false } };
    }
    return null;
  },
};

const clock = { now: () => 1_000 };

beforeEach(async () => {
  store = createMemoryStore();
  await store.putUser({ uid: "u-1", status: "active", createdAt: 0 });
  await store.putUser({ uid: "admin-1", status: "active", createdAt: 0 });
  await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
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

/*
 * Capturing who somebody is.
 *
 * The admin panel could only ever show a uid, because a uid was all this service stored -
 * identity lives in Firebase and `firebase-admin` cannot run on workerd. The verified
 * token has carried the address and name all along; these cover it being taken from there
 * without being taken from anywhere it should not be.
 */
describe("identity from the token", () => {
  const withClaims = (claims: Record<string, unknown>): TokenVerifier => ({
    async verify() {
      return { uid: "u-1", claims };
    },
  });

  const run = async (claims: Record<string, unknown>) => {
    const store = createMemoryStore();
    const deps = { store, verifier: withClaims(claims), clock: { now: () => 1000 } };
    await authenticate(deps, "Bearer x");
    return store.getUser("u-1");
  };

  it("records the address, name and picture a provider supplied", async () => {
    const user = await run({
      email: "Someone@Example.com",
      name: "Someone",
      picture: "https://example.com/a.png",
    });

    // Lowercased, because the admin lookup compares addresses and "A@b.com" and "a@b.com"
    // are the same person.
    expect(user?.email).toBe("someone@example.com");
    expect(user?.displayName).toBe("Someone");
    expect(user?.photoUrl).toBe("https://example.com/a.png");
  });

  it("stores nothing at all for an anonymous sign-in", async () => {
    // The normal case, not an edge one: first launch signs in anonymously with no UI.
    const user = await run({});

    expect(user).not.toBeNull();
    expect("email" in (user ?? {})).toBe(false);
    expect("displayName" in (user ?? {})).toBe(false);
  });

  it("ignores claims that are not usable text", async () => {
    const user = await run({ email: "   ", name: 42, picture: null });

    expect("email" in (user ?? {})).toBe(false);
    expect("displayName" in (user ?? {})).toBe(false);
    expect("photoUrl" in (user ?? {})).toBe(false);
  });

  it("refuses an absurdly long display name", async () => {
    // A verified token is trustworthy about who signed in, not about how long they made
    // their name - and this string is rendered in the admin panel.
    const user = await run({ name: "x".repeat(500) });
    expect("displayName" in (user ?? {})).toBe(false);
  });

  it("follows a change of name on the next request", async () => {
    const store = createMemoryStore();
    const clock = { now: () => 1000 };

    await authenticate({ store, verifier: withClaims({ name: "Before" }), clock }, "Bearer x");
    await authenticate({ store, verifier: withClaims({ name: "After" }), clock }, "Bearer x");

    expect((await store.getUser("u-1"))?.displayName).toBe("After");
  });

  it("does not write when nothing changed", async () => {
    // Every authenticated request passes through here. An unconditional write would turn
    // every read in the API into a read plus a write, on the busiest path there is.
    const store = createMemoryStore();
    let writes = 0;
    const counting = {
      ...store,
      putUser: async (user: Parameters<typeof store.putUser>[0]) => {
        writes += 1;
        return store.putUser(user);
      },
    };
    const deps = { store: counting, verifier: withClaims({ email: "a@b.com" }), clock: { now: () => 1 } };

    await authenticate(deps, "Bearer x");
    const afterFirst = writes;
    await authenticate(deps, "Bearer x");

    expect(afterFirst).toBe(1);
    expect(writes).toBe(1);
  });

  it("never lets a claim resurrect a banned account", async () => {
    const store = createMemoryStore();
    await store.putUser({ uid: "u-1", status: "banned", createdAt: 0 });

    const result = await authenticate(
      { store, verifier: withClaims({ email: "a@b.com" }), clock: { now: () => 1 } },
      "Bearer x",
    );

    expect(result).toEqual({ ok: false, failure: "banned" });
  });
});
