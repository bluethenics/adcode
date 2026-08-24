/**
 * Appointing and removing administrators.
 *
 * The interesting cases here are not the happy ones. An admin flag keyed by email address
 * is only as trustworthy as the claim that the address belongs to whoever is holding the
 * token, and this system has Email/Password sign-up switched on - so the verified-email
 * check is the whole security of the feature, and it gets a test of its own.
 *
 * The other one worth having is the refusal to remove the last administrator. Nothing else
 * in the system can appoint one, so emptying the table locks everybody out permanently.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { authenticate, type TokenVerifier } from "../src/auth.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import {
  handleAddAdmin,
  handleListAdmins,
  handleRemoveAdmin,
  parseAdminEmail,
} from "../src/admin.ts";

let store: ReturnType<typeof createMemoryStore>;
const clock = { now: () => 5_000 };
const deps = (): { store: ReturnType<typeof createMemoryStore>; clock: typeof clock } => ({ store, clock });

const FOUNDER = "founder@adcode.test";

beforeEach(async () => {
  store = createMemoryStore();
  await store.addAdmin({ email: FOUNDER, addedBy: "setup", addedAt: 0 });
});

/** A verifier that hands back exactly the claims a test asks for. */
const verifierFor = (claims: Record<string, unknown>): TokenVerifier => ({
  async verify(token) {
    return token === "t" ? { uid: "u-1", claims } : null;
  },
});

describe("parseAdminEmail", () => {
  it("accepts an address and lowercases it", () => {
    expect(parseAdminEmail({ email: "  Someone@Example.COM " })).toBe("someone@example.com");
  });

  it("refuses anything that is not an address", () => {
    for (const bad of [null, {}, { email: "" }, { email: "nope" }, { email: "a@b" }, { email: 7 }]) {
      expect(parseAdminEmail(bad)).toBeNull();
    }
  });

  it("refuses an absurdly long address rather than storing it", () => {
    expect(parseAdminEmail({ email: `${"a".repeat(320)}@example.com` })).toBeNull();
  });
});

describe("who counts as an admin", () => {
  it("recognises a listed address the provider has verified", async () => {
    const verifier = verifierFor({ email: FOUNDER, email_verified: true });
    expect(await authenticate({ store, verifier, clock }, "Bearer t")).toMatchObject({
      ok: true,
      isAdmin: true,
    });
  });

  it("refuses the same address when the provider has not verified it", async () => {
    // The attack this exists for: sign up with Email/Password using the founder's address,
    // never confirm it, and ask for the admin panel.
    const verifier = verifierFor({ email: FOUNDER, email_verified: false });
    expect(await authenticate({ store, verifier, clock }, "Bearer t")).toMatchObject({
      ok: true,
      isAdmin: false,
    });
  });

  it("refuses a claim of the string \"true\" rather than the boolean", async () => {
    const verifier = verifierFor({ email: FOUNDER, email_verified: "true" });
    expect(await authenticate({ store, verifier, clock }, "Bearer t")).toMatchObject({
      isAdmin: false,
    });
  });

  it("matches regardless of the case the address was typed in", async () => {
    const verifier = verifierFor({ email: "FOUNDER@ADCODE.TEST", email_verified: true });
    expect(await authenticate({ store, verifier, clock }, "Bearer t")).toMatchObject({
      isAdmin: true,
    });
  });

  it("is not an admin with no email claim at all, which is every anonymous user", async () => {
    const verifier = verifierFor({});
    expect(await authenticate({ store, verifier, clock }, "Bearer t")).toMatchObject({
      isAdmin: false,
    });
  });

  it("stops being an admin as soon as the row is removed", async () => {
    await store.addAdmin({ email: "second@adcode.test", addedBy: "u", addedAt: 1 });
    const verifier = verifierFor({ email: FOUNDER, email_verified: true });

    await store.removeAdmin(FOUNDER);

    expect(await authenticate({ store, verifier, clock }, "Bearer t")).toMatchObject({
      isAdmin: false,
    });
  });
});

describe("managing administrators", () => {
  it("adds one and reports the new list", async () => {
    const result = await handleAddAdmin(deps(), "admin-1", "new@adcode.test");
    expect(result.ok).toBe(true);
    expect(await store.isAdmin("new@adcode.test")).toBe(true);
  });

  it("refuses to add the same address twice", async () => {
    expect(await handleAddAdmin(deps(), "admin-1", FOUNDER)).toEqual({
      ok: false,
      reason: "already-admin",
    });
  });

  it("removes one once somebody else remains", async () => {
    await handleAddAdmin(deps(), "admin-1", "second@adcode.test");
    expect((await handleRemoveAdmin(deps(), "admin-1", FOUNDER)).ok).toBe(true);
    expect(await store.isAdmin(FOUNDER)).toBe(false);
  });

  it("refuses to remove the last administrator", async () => {
    expect(await handleRemoveAdmin(deps(), "admin-1", FOUNDER)).toEqual({
      ok: false,
      reason: "last-admin",
    });
    expect(await store.isAdmin(FOUNDER)).toBe(true);
  });

  it("reports an address that was never an admin rather than pretending it removed it", async () => {
    await handleAddAdmin(deps(), "admin-1", "second@adcode.test");
    expect(await handleRemoveAdmin(deps(), "admin-1", "nobody@adcode.test")).toEqual({
      ok: false,
      reason: "not-admin",
    });
  });

  it("writes an audit record for every grant and revoke", async () => {
    await handleAddAdmin(deps(), "admin-1", "second@adcode.test");
    await handleRemoveAdmin(deps(), "admin-1", "second@adcode.test");

    expect((await store.listAudit()).map((a) => a.action)).toEqual([
      "admin:grant:second@adcode.test",
      "admin:revoke:second@adcode.test",
    ]);
  });

  it("records who did the appointing", async () => {
    await handleAddAdmin(deps(), "admin-1", "second@adcode.test");
    const added = (await handleListAdmins(deps(), "admin-1")).find((a) => a.email === "second@adcode.test");
    expect(added).toMatchObject({ addedBy: "admin-1", addedAt: 5_000 });
  });
});
