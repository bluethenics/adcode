import { describe, it, expect, beforeEach } from "vitest";
import {
  adjustBalance,
  cancelWithdrawal,
  approveWithdrawal,
  evaluateEligibility,
  listWithdrawals,
  markWithdrawalFailed,
  markWithdrawalPaid,
  readPayouts,
  readWithdrawalDestination,
  rejectWithdrawal,
  requestWithdrawal,
  returnWithdrawal,
  savePayoutProfile,
} from "../src/withdrawals.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { EMPTY_BALANCE } from "../src/ledger.ts";
import {
  PAYOUT_LIMITS,
  parseAdjustment,
  parsePayoutProfile,
  parseWithdrawalAmount,
} from "../src/contract.ts";
import type { PayoutProfileBody } from "../src/contract.ts";
import type { UserRecord } from "../src/store.ts";

const NOW = 1_800_000_000_000;
const LONG_AGO = NOW - 30 * 86_400_000;

let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
let now = NOW;

const deps = () => ({
  store,
  clock: { now: () => now },
  ids: { next: (p: string) => `${p}-${++counter}` },
});

const profile: PayoutProfileBody = {
  method: "bank",
  legalName: "Ada Lovelace",
  country: "GB",
  currency: "GBP",
  email: null,
  bankDetails: null,
  fields: { accountNumber: "12345678", sortCode: "20-00-00", bankName: "Example Bank" },
  adultConfirmed: true,
};

/** An account that passes every rule except the ones a test deliberately breaks. */
async function readyUser(overrides: Partial<UserRecord> = {}): Promise<void> {
  await store.putPayoutCorridor({
    country: "GB",
    currency: "GBP",
    enabled: true,
    requiredFields: ["accountNumber", "sortCode", "bankName"],
    sourceNote: "test",
    verifiedAt: NOW,
    updatedAt: NOW,
    updatedBy: "admin-1",
  });
  await store.putUser({
    uid: "u1",
    status: "active",
    createdAt: LONG_AGO,
    email: "ada@example.com",
    emailVerified: true,
    ...overrides,
  });
  await savePayoutProfile(deps(), "u1", profile);
}

/** Credit an account without going through the serving path. */
async function earn(uid: string, micros: bigint, id = `e-${++counter}`): Promise<void> {
  await store.appendEntryAndUpdateBalance({
    entryId: id,
    uid,
    kind: "impression",
    micros,
    refId: null,
    createdAt: LONG_AGO,
    description: "test earnings",
  });
}

beforeEach(() => {
  counter = 0;
  now = NOW;
  store = createMemoryStore();
});

describe("parsePayoutProfile", () => {
  it("accepts structured bank fields and drops legacy payout values", () => {
    const parsed = parsePayoutProfile({ ...profile, email: "ignored@example.com", bankDetails: "ignored" });
    expect(parsed).toEqual(profile);
  });

  it("trims every controlled bank field", () => {
    const parsed = parsePayoutProfile({ ...profile, fields: { ...profile.fields, bankName: " Example Bank " } });
    expect(parsed?.fields["bankName"]).toBe("Example Bank");
  });

  it("never accepts pay-by-email", () => {
    expect(parsePayoutProfile({ ...profile, method: "wise-email" })).toBeNull();
  });

  it("refuses missing or empty structured fields", () => {
    expect(parsePayoutProfile({ ...profile, fields: undefined })).toBeNull();
    expect(parsePayoutProfile({ ...profile, fields: {} })).toBeNull();
  });

  it("refuses a country that is not two uppercase letters", () => {
    expect(parsePayoutProfile({ ...profile, country: "gb" })).toBeNull();
    expect(parsePayoutProfile({ ...profile, country: "GBR" })).toBeNull();
  });

  it("refuses a currency Wise has never heard of", () => {
    // Typed once and then read by a human making a transfer: a currency that does not
    // exist is discovered at the bank, after the request was approved.
    expect(parsePayoutProfile({ ...profile, currency: "XYZ" })).toBeNull();
    expect(parsePayoutProfile({ ...profile, currency: "usd" })).toBeNull();
  });

  it("refuses an unknown method rather than guessing one", () => {
    expect(parsePayoutProfile({ ...profile, method: "paypal" })).toBeNull();
  });
});

describe("parseWithdrawalAmount", () => {
  it("accepts the minimum and above", () => {
    expect(parseWithdrawalAmount({ amountMicros: "50000000" })).toBe(50_000_000n);
    expect(parseWithdrawalAmount({ amountMicros: "62340000" })).toBe(62_340_000n);
  });

  it("refuses anything under the minimum", () => {
    expect(parseWithdrawalAmount({ amountMicros: "49990000" })).toBeNull();
  });

  it("refuses a fraction of a cent, which a bank cannot move", () => {
    expect(parseWithdrawalAmount({ amountMicros: "50000001" })).toBeNull();
  });

  it("refuses a number, a negative, and anything that is not digits", () => {
    expect(parseWithdrawalAmount({ amountMicros: 50_000_000 })).toBeNull();
    expect(parseWithdrawalAmount({ amountMicros: "-50000000" })).toBeNull();
    expect(parseWithdrawalAmount({ amountMicros: "5e7" })).toBeNull();
  });
});

/*
 * The age rule.
 *
 * The terms say you must be 18 or older to earn or withdraw. Until this existed that was a
 * sentence on a web page and nothing else - there is no date of birth anywhere in this
 * service, and the only "age" in these rules is how long the account has existed. A
 * condition nobody is ever asked to affirm is not evidence of anything.
 *
 * A timestamp rather than a boolean, because the question that would actually be asked is
 * "when did they confirm it", and a boolean cannot answer that.
 */
describe("the 18-or-older rule", () => {
  const user: UserRecord = {
    uid: "u1",
    status: "active",
    createdAt: LONG_AGO,
    email: "ada@example.com",
    emailVerified: true,
  };

  const base = {
    user,
    balance: { ...EMPTY_BALANCE, availableMicros: 75_000_000n },
    profile: { uid: "u1", ...profile, adultConfirmedAt: LONG_AGO, updatedAt: LONG_AGO },
    pending: null,
    now: NOW,
  };

  it("passes once the account has confirmed it, and records when", () => {
    const rule = evaluateEligibility(base).rules.find((r) => r.id === "adult");

    expect(rule?.ok).toBe(true);
    expect(rule?.label).toBe("Confirmed you are 18 or older");
  });

  it("blocks a payout from a profile that never confirmed it", () => {
    const { eligible, rules } = evaluateEligibility({
      ...base,
      profile: { uid: "u1", ...profile, adultConfirmedAt: null, updatedAt: LONG_AGO },
    });

    expect(eligible).toBe(false);
    expect(rules.find((r) => r.id === "adult")?.ok).toBe(false);
  });

  it("asks for the confirmation even before payout details exist", () => {
    // Two separate failures, not one. Somebody with no profile at all should see both
    // lines rather than discover the second after fixing the first.
    const { rules } = evaluateEligibility({ ...base, profile: null });

    expect(rules.find((r) => r.id === "adult")?.ok).toBe(false);
    expect(rules.find((r) => r.id === "payout-details")?.ok).toBe(false);
  });

  it("says plainly why it is being asked", () => {
    const rule = evaluateEligibility({
      ...base,
      profile: null,
    }).rules.find((r) => r.id === "adult");

    expect(rule?.detail).toContain("18");
  });
});

describe("evaluateEligibility", () => {
  const user: UserRecord = {
    uid: "u1",
    status: "active",
    createdAt: LONG_AGO,
    email: "ada@example.com",
    emailVerified: true,
  };

  const base = {
    user,
    balance: { ...EMPTY_BALANCE, availableMicros: 75_000_000n },
    profile: {
      uid: "u1",
      ...profile,
      adultConfirmedAt: LONG_AGO,
      updatedAt: LONG_AGO,
    },
    pending: null,
    now: NOW,
  };

  it("passes when every rule is met", () => {
    const { eligible, rules } = evaluateEligibility(base);
    expect(eligible).toBe(true);
    expect(rules.every((r) => r.ok)).toBe(true);
  });

  it("reports every rule, passed or failed, rather than the first failure", () => {
    // The point of the box: somebody who cannot withdraw should see which line is the one
    // stopping them, not discover the next one each time they fix the last.
    const { rules } = evaluateEligibility({
      ...base,
      user: { ...user, emailVerified: false, createdAt: NOW },
      balance: EMPTY_BALANCE,
      profile: null,
    });

    expect(rules).toHaveLength(6);
    expect(rules.filter((r) => !r.ok).map((r) => r.id)).toEqual([
      "minimum",
      "verified-email",
      "account-age",
      "adult",
      "payout-details",
    ]);
  });

  it("says how far off the minimum is, not just that it was not met", () => {
    const { rules } = evaluateEligibility({
      ...base,
      balance: { ...EMPTY_BALANCE, availableMicros: 3_500_000n },
    });
    const rule = rules.find((r) => r.id === "minimum");
    expect(rule?.ok).toBe(false);
    expect(rule?.detail).toContain("$46.50 to go");
  });

  it("refuses an address the provider never checked", () => {
    const { eligible, rules } = evaluateEligibility({
      ...base,
      user: { ...user, emailVerified: false },
    });
    expect(eligible).toBe(false);
    expect(rules.find((r) => r.id === "verified-email")?.ok).toBe(false);
  });

  it("treats a missing emailVerified as unverified", () => {
    const { uid, status, createdAt } = user;
    const { rules } = evaluateEligibility({ ...base, user: { uid, status, createdAt } });
    expect(rules.find((r) => r.id === "verified-email")?.ok).toBe(false);
  });

  it("holds a brand new account back for the cooling-off window", () => {
    const { eligible } = evaluateEligibility({
      ...base,
      user: { ...user, createdAt: NOW - 6 * 86_400_000 },
    });
    expect(eligible).toBe(false);
  });

  it("lets an account through the moment the window has passed", () => {
    const { eligible } = evaluateEligibility({
      ...base,
      user: { ...user, createdAt: NOW - PAYOUT_LIMITS.minAccountAgeMs },
    });
    expect(eligible).toBe(true);
  });

  it("blocks a second request while one is still waiting", () => {
    const { eligible, rules } = evaluateEligibility({
      ...base,
      pending: {
        withdrawalId: "wd-1",
        uid: "u1",
        amountMicros: 10_000_000n,
        status: "requested",
        destination: { ...profile },
        createdAt: NOW,
        decidedAt: null,
        decidedBy: null,
        providerRef: null,
        note: null,
      },
    });
    expect(eligible).toBe(false);
    expect(rules.find((r) => r.id === "no-pending")?.detail).toContain("$10.00");
  });
});

describe("requesting a withdrawal", () => {
  it("allows only one concurrent request to reserve the same balance", async () => {
    await readyUser();
    await earn("u1", 75_000_000n);

    const results = await Promise.all([
      requestWithdrawal(deps(), "u1", 50_000_000n),
      requestWithdrawal(deps(), "u1", 50_000_000n),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect((await store.getBalance("u1")).pendingWithdrawalMicros).toBe(50_000_000n);
    expect((await store.withdrawalsForUser("u1")).filter((row) => row.status === "requested")).toHaveLength(1);
  });

  it("holds the money: available falls, pending rises, lifetime is untouched", async () => {
    await readyUser();
    await earn("u1", 75_000_000n);

    const result = await requestWithdrawal(deps(), "u1", 50_000_000n);
    expect(result.ok).toBe(true);

    const balance = await store.getBalance("u1");
    expect(balance.availableMicros).toBe(25_000_000n);
    expect(balance.pendingWithdrawalMicros).toBe(50_000_000n);
    // What was earned is a fact about the past; asking to be paid does not change it.
    expect(balance.lifetimeMicros).toBe(75_000_000n);
  });

  it("writes one withdrawal_requested entry, referring back to the request", async () => {
    await readyUser();
    await earn("u1", 75_000_000n);
    const result = await requestWithdrawal(deps(), "u1", 50_000_000n);
    if (!result.ok) throw new Error("expected a request");

    const { rows } = await store.listEntries("u1", { limit: 10, cursor: null });
    const entry = rows.find((r) => r.kind === "withdrawal_requested");
    expect(entry?.micros).toBe(-50_000_000n);
    expect(entry?.refId).toBe(result.value.withdrawalId);
    expect(entry?.currency).toBe("GBP");
  });

  it("snapshots the destination, so editing details cannot redirect it", async () => {
    await readyUser();
    await earn("u1", 75_000_000n);
    const result = await requestWithdrawal(deps(), "u1", 50_000_000n);
    if (!result.ok) throw new Error("expected a request");

    await savePayoutProfile(deps(), "u1", {
      ...profile,
      fields: { ...profile.fields, accountNumber: "87654321" },
    });

    const stored = await store.getWithdrawal(result.value.withdrawalId);
    expect(stored?.destination.fields?.accountNumber).toBe("12345678");
  });

  it("refuses an account that fails any rule", async () => {
    await readyUser({ emailVerified: false });
    await earn("u1", 75_000_000n);

    const result = await requestWithdrawal(deps(), "u1", 50_000_000n);
    expect(result).toEqual({ ok: false, error: "not-eligible" });
    expect((await store.getBalance("u1")).availableMicros).toBe(75_000_000n);
  });

  it("refuses an account with no payout details, even with money and age", async () => {
    await store.putUser({
      uid: "u1",
      status: "active",
      createdAt: LONG_AGO,
      email: "ada@example.com",
      emailVerified: true,
    });
    await earn("u1", 75_000_000n);

    expect(await requestWithdrawal(deps(), "u1", 50_000_000n)).toEqual({
      ok: false,
      error: "not-eligible",
    });
  });

  it("refuses more than is available, and holds nothing", async () => {
    await readyUser();
    await earn("u1", 60_000_000n);

    expect(await requestWithdrawal(deps(), "u1", 70_000_000n)).toEqual({
      ok: false,
      error: "insufficient-funds",
    });
    expect((await store.getBalance("u1")).pendingWithdrawalMicros).toBe(0n);
  });

  it("refuses a second request while the first is pending", async () => {
    await readyUser();
    await earn("u1", 120_000_000n);

    expect((await requestWithdrawal(deps(), "u1", 50_000_000n)).ok).toBe(true);
    expect(await requestWithdrawal(deps(), "u1", 50_000_000n)).toEqual({
      ok: false,
      error: "not-eligible",
    });

    // One hold, not two: this is the rule that bounds what a partial failure can cost.
    expect((await store.getBalance("u1")).pendingWithdrawalMicros).toBe(50_000_000n);
  });

  it("refuses an amount under the minimum even if the rules all pass", async () => {
    await readyUser();
    await earn("u1", 75_000_000n);

    expect(await requestWithdrawal(deps(), "u1", 49_000_000n)).toEqual({
      ok: false,
      error: "invalid-amount",
    });
  });
});

describe("paying it", () => {
  const ready = async (): Promise<string> => {
    await readyUser();
    await earn("u1", 75_000_000n);
    const result = await requestWithdrawal(deps(), "u1", 50_000_000n);
    if (!result.ok) throw new Error("expected a request");
    await approveWithdrawal(deps(), "admin-1", result.value.withdrawalId);
    return result.value.withdrawalId;
  };

  it("clears the hold without giving the money back", async () => {
    const id = await ready();
    now = NOW + 1000;

    const paid = await markWithdrawalPaid(deps(), "admin-1", id, "TRANSFER-9001");
    expect(paid.ok).toBe(true);

    const balance = await store.getBalance("u1");
    expect(balance.pendingWithdrawalMicros).toBe(0n);
    // The money left. Available fell when it was requested and must not come back.
    expect(balance.availableMicros).toBe(25_000_000n);
  });

  it("records the transfer reference on the record and on the ledger", async () => {
    const id = await ready();
    await markWithdrawalPaid(deps(), "admin-1", id, "TRANSFER-9001");

    const stored = await store.getWithdrawal(id);
    expect(stored?.status).toBe("paid");
    expect(stored?.providerRef).toBe("TRANSFER-9001");
    expect(stored?.decidedBy).toBe("admin-1");

    const { rows } = await store.listEntries("u1", { limit: 10, cursor: null });
    const entry = rows.find((r) => r.kind === "withdrawal_paid");
    expect(entry?.providerRef).toBe("TRANSFER-9001");
    expect(entry?.micros).toBe(-50_000_000n);
  });

  it("audits the decision against the person it was about", async () => {
    const id = await ready();
    await markWithdrawalPaid(deps(), "admin-1", id, "TRANSFER-9001");

    const audit = await store.listAudit();
    expect(audit.some((a) => a.action === `withdrawal:paid:${id}` && a.subjectUid === "u1")).toBe(
      true,
    );
  });

  it("refuses to pay the same request twice", async () => {
    const id = await ready();
    await markWithdrawalPaid(deps(), "admin-1", id, "TRANSFER-9001");

    expect(await markWithdrawalPaid(deps(), "admin-1", id, "TRANSFER-9002")).toEqual({
      ok: false,
      error: "invalid-state",
    });
    expect((await store.getBalance("u1")).pendingWithdrawalMicros).toBe(0n);
  });

  it("allows only one concurrent terminal decision", async () => {
    const id = await ready();
    const outcomes = await Promise.all([
      markWithdrawalPaid(deps(), "admin-1", id, "TRANSFER-9001"),
      rejectWithdrawal(deps(), "admin-2", id, "Recipient verification failed"),
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const balance = await store.getBalance("u1");
    expect(balance.pendingWithdrawalMicros).toBe(0n);
    expect([25_000_000n, 75_000_000n]).toContain(balance.availableMicros);
  });

  it("404s on a request that does not exist", async () => {
    expect(await markWithdrawalPaid(deps(), "admin-1", "wd-nope", "ref")).toEqual({
      ok: false,
      error: "not-found",
    });
  });
});

describe("refusing it", () => {
  const ready = async (): Promise<string> => {
    await readyUser();
    await earn("u1", 75_000_000n);
    const result = await requestWithdrawal(deps(), "u1", 50_000_000n);
    if (!result.ok) throw new Error("expected a request");
    return result.value.withdrawalId;
  };

  it("gives the money back and releases the hold", async () => {
    const id = await ready();
    const rejected = await rejectWithdrawal(deps(), "admin-1", id, "Name doesn't match the account");
    expect(rejected.ok).toBe(true);

    const balance = await store.getBalance("u1");
    expect(balance.availableMicros).toBe(75_000_000n);
    expect(balance.pendingWithdrawalMicros).toBe(0n);
  });

  it("keeps the reason where the person who asked will read it", async () => {
    const id = await ready();
    await rejectWithdrawal(deps(), "admin-1", id, "Name doesn't match the account");

    const stored = await store.getWithdrawal(id);
    expect(stored?.status).toBe("rejected");
    expect(stored?.note).toBe("Name doesn't match the account");

    const view = await readPayouts(deps(), "u1");
    expect(view.withdrawals[0]?.note).toBe("Name doesn't match the account");
  });

  it("lets the person who asked cancel it themselves", async () => {
    const id = await ready();
    const cancelled = await cancelWithdrawal(deps(), "u1", id);
    expect(cancelled.ok).toBe(true);

    const stored = await store.getWithdrawal(id);
    expect(stored?.status).toBe("cancelled");
    // Nobody decided it, so nobody is recorded as having done so.
    expect(stored?.decidedBy).toBeNull();
    expect((await store.getBalance("u1")).availableMicros).toBe(75_000_000n);
  });

  it("frees the account to ask again", async () => {
    const id = await ready();
    await cancelWithdrawal(deps(), "u1", id);
    expect((await requestWithdrawal(deps(), "u1", 50_000_000n)).ok).toBe(true);
  });

  it("will not let one person cancel another's request", async () => {
    const id = await ready();
    expect(await cancelWithdrawal(deps(), "u2", id)).toEqual({ ok: false, error: "not-found" });
    expect((await store.getWithdrawal(id))?.status).toBe("requested");
  });

  it("will not cancel a request that has already been paid", async () => {
    const id = await ready();
    await approveWithdrawal(deps(), "admin-1", id);
    await markWithdrawalPaid(deps(), "admin-1", id, "TRANSFER-9001");
    expect(await cancelWithdrawal(deps(), "u1", id)).toEqual({ ok: false, error: "invalid-state" });
  });
});

describe("the payouts screen", () => {
  it("answers everything the box needs in one read", async () => {
    await readyUser();
    await earn("u1", 75_000_000n);

    const view = await readPayouts(deps(), "u1");
    expect(view.eligible).toBe(true);
    expect(view.minMicros).toBe("50000000");
    expect(view.availableMicros).toBe("75000000");
    expect(view.profile?.fields?.accountNumber).toBe("12345678");
    expect(view.rules).toHaveLength(6);
    expect(view.withdrawals).toEqual([]);
  });

  it("never sends the details back to anyone but their owner", async () => {
    await readyUser();
    const view = await readPayouts(deps(), "u2");
    expect(view.profile).toBeNull();
  });

  it("shows a brand new account why it cannot withdraw yet", async () => {
    await store.putUser({ uid: "u1", status: "active", createdAt: now });
    const view = await readPayouts(deps(), "u1");

    expect(view.eligible).toBe(false);
    expect(view.rules.filter((r) => !r.ok).map((r) => r.id)).toEqual([
      "minimum",
      "verified-email",
      "account-age",
      "adult",
      "payout-details",
    ]);
  });

  it("survives a user record that is not there", async () => {
    // `authenticate` creates it before any handler runs, so this means the row was deleted
    // underneath a live session. Every rule should fail honestly rather than 500.
    const view = await readPayouts(deps(), "ghost");
    expect(view.eligible).toBe(false);
  });
});

describe("the admin queue", () => {
  it("shows who asked, where the money goes, and what they have left", async () => {
    await readyUser();
    await earn("u1", 75_000_000n);
    await requestWithdrawal(deps(), "u1", 50_000_000n);

    const { rows } = await listWithdrawals(deps(), "admin-1", "requested", {
      limit: 50,
      cursor: null,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.uid).toBe("u1");
    expect(rows[0]?.email).toBe("ada@example.com");
    // The queue carries a masked summary, never the account itself - see F-05.
    expect(rows[0]?.destination.accountHint).toBe("••••5678");
    expect(rows[0]?.destination).not.toHaveProperty("legalName");
    expect(rows[0]?.availableMicros).toBe("25000000");
    expect(rows[0]?.lifetimeMicros).toBe("75000000");
  });

  it("filters by status, and takes null to mean all of them", async () => {
    await readyUser();
    await earn("u1", 120_000_000n);
    const first = await requestWithdrawal(deps(), "u1", 50_000_000n);
    if (!first.ok) throw new Error("expected a request");
    await approveWithdrawal(deps(), "admin-1", first.value.withdrawalId);
    await markWithdrawalPaid(deps(), "admin-1", first.value.withdrawalId, "REF-1");
    await requestWithdrawal(deps(), "u1", 50_000_000n);

    const pending = await listWithdrawals(deps(), "admin-1", "requested", { limit: 50, cursor: null });
    const all = await listWithdrawals(deps(), "admin-1", null, { limit: 50, cursor: null });

    expect(pending.rows).toHaveLength(1);
    expect(all.rows).toHaveLength(2);
  });

  it("audits the read, because a queue read exposes bank details", async () => {
    await listWithdrawals(deps(), "admin-1", "requested", { limit: 50, cursor: null });
    const audit = await store.listAudit();
    expect(audit.some((a) => a.action === "read-withdrawals")).toBe(true);
  });
});

describe("paying to a Wise address", () => {
  const wise: PayoutProfileBody = {
    method: "wise-email",
    legalName: "Ada Lovelace",
    country: "GB",
    currency: "GBP",
    email: "ada@example.com",
    bankDetails: null,
    fields: {},
    adultConfirmed: true,
  };

  it("needs no corridor, because Wise resolves the recipient itself", async () => {
    await readyUser();
    await earn("u1", 120_000_000n);
    // Every bank corridor off, which used to make the account permanently ineligible.
    await store.putPayoutCorridor({
      country: "GB",
      currency: "GBP",
      enabled: false,
      requiredFields: ["accountNumber", "sortCode", "bankName"],
      sourceNote: "test",
      verifiedAt: null,
      updatedAt: NOW,
      updatedBy: "admin-1",
    });

    const view = await savePayoutProfile(deps(), "u1", wise);
    expect(view?.eligible).toBe(true);
    expect(view?.profile?.method).toBe("wise-email");
    expect(view?.rules.find((rule) => rule.id === "payout-details")?.detail).toContain(
      "ada@example.com",
    );
  });

  it("refuses a currency Wise cannot send", async () => {
    await readyUser();
    expect(await savePayoutProfile(deps(), "u1", { ...wise, currency: "XYZ" })).toBeNull();
  });

  it("refuses an address that is not one", async () => {
    expect(parsePayoutProfile({ ...wise, email: "not-an-address" })).toBeNull();
    expect(parsePayoutProfile({ ...wise, email: null })).toBeNull();
  });

  it("snapshots the address onto the request", async () => {
    await readyUser();
    await earn("u1", 120_000_000n);
    await savePayoutProfile(deps(), "u1", wise);
    const asked = await requestWithdrawal(deps(), "u1", 50_000_000n);
    if (!asked.ok) throw new Error("expected a request");

    await savePayoutProfile(deps(), "u1", { ...wise, email: "somebody-else@example.com" });
    const stored = await store.getWithdrawal(asked.value.withdrawalId);
    expect(stored?.destination.email).toBe("ada@example.com");
  });
});

describe("bank coordinates are normalised before they are checked", () => {
  it("accepts an IBAN typed the way a bank prints it", async () => {
    await readyUser();
    await store.putPayoutCorridor({
      country: "DE",
      currency: "EUR",
      enabled: true,
      requiredFields: ["iban", "bankName"],
      sourceNote: "test",
      verifiedAt: NOW,
      updatedAt: NOW,
      updatedBy: "admin-1",
    });

    const saved = await savePayoutProfile(deps(), "u1", {
      method: "bank",
      legalName: "Ada Lovelace",
      country: "DE",
      currency: "EUR",
      email: null,
      bankDetails: null,
      fields: { iban: "de89 3704 0044 0532 0130 00", bankName: "Example Bank" },
      adultConfirmed: true,
    });

    // The validator accepts no spaces and no lower case, so this used to be refused as
    // malformed while the person held the right answer in front of them.
    expect(saved).not.toBeNull();
    expect(saved?.profile?.fields?.iban).toBe("DE89370400440532013000");
  });
});

describe("a transfer that comes back", () => {
  async function paidWithdrawal(): Promise<string> {
    await readyUser();
    await earn("u1", 120_000_000n);
    await savePayoutProfile(deps(), "u1", profile);
    const asked = await requestWithdrawal(deps(), "u1", 50_000_000n);
    if (!asked.ok) throw new Error("expected a request");
    await approveWithdrawal(deps(), "admin-1", asked.value.withdrawalId);
    await markWithdrawalPaid(deps(), "admin-1", asked.value.withdrawalId, "wise-ref-1");
    return asked.value.withdrawalId;
  }

  it("gives the money back without leaving a negative hold", async () => {
    const id = await paidWithdrawal();
    const before = await store.getBalance("u1");
    expect(before.availableMicros).toBe(70_000_000n);
    expect(before.pendingWithdrawalMicros).toBe(0n);

    const returned = await returnWithdrawal(deps(), "admin-1", id, "Bounced: account closed");
    expect(returned.ok).toBe(true);

    const after = await store.getBalance("u1");
    expect(after.availableMicros).toBe(120_000_000n);
    // A `withdrawal_failed` entry would have driven this to -50_000_000: available already
    // fell at request time and the hold settled at `paid`, so only available may move.
    expect(after.pendingWithdrawalMicros).toBe(0n);
    // They did earn it. The payment failed; the earning did not.
    expect(after.lifetimeMicros).toBe(120_000_000n);
    expect((await store.getWithdrawal(id))?.status).toBe("returned");
  });

  it("is the only route out of paid, and only once", async () => {
    const id = await paidWithdrawal();
    expect(await markWithdrawalFailed(deps(), "admin-1", id, "no")).toMatchObject({
      ok: false,
      error: "invalid-state",
    });
    expect((await returnWithdrawal(deps(), "admin-1", id, "Bounced")).ok).toBe(true);
    expect(await returnWithdrawal(deps(), "admin-1", id, "Bounced")).toMatchObject({
      ok: false,
      error: "invalid-state",
    });
    expect((await store.getBalance("u1")).availableMicros).toBe(120_000_000n);
  });

  it("refuses to return a request that was never sent", async () => {
    await readyUser();
    await earn("u1", 120_000_000n);
    await savePayoutProfile(deps(), "u1", profile);
    const asked = await requestWithdrawal(deps(), "u1", 50_000_000n);
    if (!asked.ok) throw new Error("expected a request");
    expect(await returnWithdrawal(deps(), "admin-1", asked.value.withdrawalId, "x")).toMatchObject({
      ok: false,
      error: "invalid-state",
    });
  });
});

describe("admin balance corrections", () => {
  it("appends an adjustment rather than editing a balance", async () => {
    await readyUser();
    await earn("u1", 60_000_000n);

    const credited = await adjustBalance(deps(), "admin-1", "u1", 5_000_000n, "Reversal ran twice");
    expect(credited).toMatchObject({ ok: true });

    const balance = await store.getBalance("u1");
    expect(balance.availableMicros).toBe(65_000_000n);
    // An adjustment is a correction, not something they earned.
    expect(balance.lifetimeMicros).toBe(60_000_000n);

    const { rows } = await store.listEntries("u1", { limit: 10, cursor: null });
    const entry = rows.find((row) => row.kind === "adjustment");
    expect(entry?.reason).toBe("Reversal ran twice");
    expect(entry?.adminUid).toBe("admin-1");
  });

  it("claws back, but never below zero", async () => {
    await readyUser();
    await earn("u1", 60_000_000n);
    expect(await adjustBalance(deps(), "admin-1", "u1", -20_000_000n, "Fraudulent")).toMatchObject({
      ok: true,
    });
    expect((await store.getBalance("u1")).availableMicros).toBe(40_000_000n);

    // A debt is not a thing this system has a concept of, and a negative balance would
    // silently break every comparison in the eligibility rules.
    expect(await adjustBalance(deps(), "admin-1", "u1", -90_000_000n, "Too much")).toMatchObject({
      ok: false,
      error: "insufficient-funds",
    });
    expect((await store.getBalance("u1")).availableMicros).toBe(40_000_000n);
  });

  it("refuses a no-op, an unknown account, and a sub-cent figure", async () => {
    await readyUser();
    expect(await adjustBalance(deps(), "admin-1", "u1", 0n, "why")).toMatchObject({
      ok: false,
      error: "invalid-amount",
    });
    expect(await adjustBalance(deps(), "admin-1", "nobody", 10_000n, "why")).toMatchObject({
      ok: false,
      error: "not-found",
    });
    expect(parseAdjustment({ micros: "1234", reason: "why" })).toBeNull();
    expect(parseAdjustment({ micros: "-1000000", reason: "" })).toBeNull();
    expect(parseAdjustment({ micros: "-1000000", reason: "clawback" })).toEqual({
      micros: -1_000_000n,
      reason: "clawback",
    });
  });
});

describe("reading the bank details for one transfer", () => {
  it("decrypts one destination and names it in the audit log", async () => {
    await readyUser();
    await earn("u1", 120_000_000n);
    await savePayoutProfile(deps(), "u1", profile);
    const asked = await requestWithdrawal(deps(), "u1", 50_000_000n);
    if (!asked.ok) throw new Error("expected a request");

    const found = await readWithdrawalDestination(deps(), "admin-1", asked.value.withdrawalId);
    if (!found.ok) throw new Error("expected the destination");
    expect(found.value.fields?.accountNumber).toBe("12345678");

    const audit = await store.listAudit();
    expect(audit.map((row) => row.action)).toContain(
      "withdrawal:destination-read:" + asked.value.withdrawalId,
    );
  });

  it("refuses once the request is settled, and for an id that is not one", async () => {
    await readyUser();
    await earn("u1", 120_000_000n);
    await savePayoutProfile(deps(), "u1", profile);
    const asked = await requestWithdrawal(deps(), "u1", 50_000_000n);
    if (!asked.ok) throw new Error("expected a request");
    await cancelWithdrawal(deps(), "u1", asked.value.withdrawalId);

    expect(
      await readWithdrawalDestination(deps(), "admin-1", asked.value.withdrawalId),
    ).toMatchObject({ ok: false, error: "invalid-state" });
    expect(await readWithdrawalDestination(deps(), "admin-1", "wd-nope")).toMatchObject({
      ok: false,
      error: "not-found",
    });
  });
});
