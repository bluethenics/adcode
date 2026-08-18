import { describe, it, expect, beforeEach } from "vitest";
import { handleAdminLedger, handleSetUserStatus } from "../src/admin.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;
const deps = () => ({ store, clock: { now: () => 7_000 } });

beforeEach(async () => {
  store = createMemoryStore();
  await store.putUser({ uid: "u-1", status: "active", createdAt: 0 });
  await store.appendEntryAndUpdateBalance({
    entryId: "e-1",
    uid: "u-1",
    kind: "impression",
    micros: 4_000n,
    refId: null,
    createdAt: 1,
    description: "Ad from Acme, 4.2s",
  });
});

describe("handleAdminLedger", () => {
  it("returns the subject's history, not the admin's", async () => {
    const res = await handleAdminLedger(deps(), "admin-1", "u-1", { limit: 10, cursor: null });
    expect(res.rows.map((r) => r.entryId)).toEqual(["e-1"]);
  });

  it("shows the admin exactly the description the user sees", async () => {
    const res = await handleAdminLedger(deps(), "admin-1", "u-1", { limit: 10, cursor: null });
    expect(res.rows[0]?.description).toBe("Ad from Acme, 4.2s");
  });

  it("writes an audit row naming who looked at whom", async () => {
    await handleAdminLedger(deps(), "admin-1", "u-1", { limit: 10, cursor: null });
    expect(await store.listAudit()).toEqual([
      { adminUid: "admin-1", action: "read-ledger", subjectUid: "u-1", at: 7_000 },
    ]);
  });

  it("audits a read even of a user with no history", async () => {
    await handleAdminLedger(deps(), "admin-1", "u-nobody", { limit: 10, cursor: null });
    expect(await store.listAudit()).toHaveLength(1);
  });
});

describe("handleSetUserStatus", () => {
  it("bans a user", async () => {
    await handleSetUserStatus(deps(), "admin-1", "u-1", "banned");
    expect((await store.getUser("u-1"))?.status).toBe("banned");
  });

  it("unbans a user", async () => {
    await handleSetUserStatus(deps(), "admin-1", "u-1", "banned");
    await handleSetUserStatus(deps(), "admin-1", "u-1", "active");
    expect((await store.getUser("u-1"))?.status).toBe("active");
  });

  it("audits the ban", async () => {
    await handleSetUserStatus(deps(), "admin-1", "u-1", "banned");
    const audit = await store.listAudit();
    expect(audit[0]).toEqual({
      adminUid: "admin-1",
      action: "set-status:banned",
      subjectUid: "u-1",
      at: 7_000,
    });
  });

  it("preserves the rest of the user record", async () => {
    await handleSetUserStatus(deps(), "admin-1", "u-1", "banned");
    expect((await store.getUser("u-1"))?.createdAt).toBe(0);
  });

  it("refuses to act on a user who does not exist", async () => {
    await expect(handleSetUserStatus(deps(), "admin-1", "nobody", "banned")).rejects.toThrow(
      /no such user/i,
    );
  });
});
