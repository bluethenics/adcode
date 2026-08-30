/**
 * Cashing out: payout details, eligibility, requests, and the admin decision.
 *
 * Money leaves this system by hand. An admin reads a request, makes a transfer from an
 * ordinary Wise account, and comes back to record what they did. Nothing here talks to a
 * payment provider, and that is the design rather than a stage of one - a payout API
 * needs business verification, KYC and a settlement account, and none of that should
 * stand between a developer earning $12 and being able to ask for it.
 *
 * What the code is responsible for, then, is everything around the transfer:
 *
 *   - refusing a request that should never reach a human (too small, too soon, no
 *     details, already one in flight),
 *   - holding the money the moment it is asked for, so a balance cannot be spent twice,
 *   - and recording the outcome as ledger entries, never as an edit.
 *
 * The ledger kinds this writes - `withdrawal_requested`, `withdrawal_paid`,
 * `withdrawal_failed` - and the balance fold over them existed before this file did, and
 * are unit-tested in `ledger.ts`. This is the flow that finally raises them.
 */
import { PAYOUT_CURRENCIES, PAYOUT_LIMITS, type PayoutProfileBody } from "./contract.ts";
import { formatMicros } from "./money.ts";
import type { Balance } from "./ledger.ts";
import type {
  Clock,
  IdGen,
  Page,
  PayoutDestination,
  PayoutProfileRecord,
  Store,
  UserRecord,
  WithdrawalRecord,
  WithdrawalStatus,
} from "./store.ts";
import { normalizeFields, validateDestination } from "./payoutCorridors.ts";
import { maskDestination } from "./payoutCrypto.ts";

/** Wise resolves an email recipient itself, so these need no corridor and no coordinates. */
const PAYOUT_CURRENCY_SET: ReadonlySet<string> = new Set(PAYOUT_CURRENCIES);

export interface PayoutDeps {
  store: Store;
  clock: Clock;
  ids: IdGen;
}

export type PayoutError =
  | "not-eligible"
  | "insufficient-funds"
  | "invalid-amount"
  | "not-found"
  | "invalid-state";

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: PayoutError };

const ok = <T,>(value: T): Outcome<T> => ({ ok: true, value });
const no = (error: PayoutError): Outcome<never> => ({ ok: false, error });

/* ── Views ──────────────────────────────────────────────────────────────── */

export interface PayoutProfileView {
  method: PayoutDestination["method"];
  legalName: string;
  country: string;
  currency: string;
  email: string | null;
  bankDetails: string | null;
  fields: PayoutDestination["fields"];
  updatedAt: number;
}

export interface WithdrawalView {
  withdrawalId: string;
  amountMicros: string;
  status: WithdrawalStatus;
  currency: string;
  createdAt: number;
  decidedAt: number | null;
  providerRef: string | null;
  note: string | null;
}

/**
 * Enough of a destination to recognise a row, and not enough to pay it.
 *
 * The queue used to carry a full decrypted destination for every row on the page - up to a
 * hundred at a time, every status including long-settled ones - reloaded on every filter
 * change, covered by a single audit line. The bank details are only needed at the moment
 * somebody is making one transfer, so that is when they are fetched, and that fetch names
 * the withdrawal in the audit log.
 */
export interface DestinationSummary {
  method: PayoutDestination["method"];
  country: string;
  currency: string;
  /** "••••7890", or "••••@example.com" for a Wise address. */
  accountHint: string;
}

/** The admin's row: the same request, plus who made it and roughly where it goes. */
export interface AdminWithdrawalView extends WithdrawalView {
  uid: string;
  email: string | null;
  displayName: string | null;
  destination: DestinationSummary;
  /** What is left on the account now, so a suspicious request is visible as one. */
  availableMicros: string;
  lifetimeMicros: string;
}

/**
 * One condition, and whether this account meets it.
 *
 * Sent as data rather than rendered as a sentence on the server because the screen shows
 * every rule at once, passed and failed alike. Somebody who cannot withdraw yet should be
 * able to see exactly which line is the one stopping them, and how far off it is - "not
 * eligible" on its own is the message that generates the support email.
 */
export type RuleId = "minimum" | "verified-email" | "account-age" | "payout-details" | "no-pending";

export interface EligibilityRule {
  id: RuleId;
  ok: boolean;
  label: string;
  detail: string;
}

export interface PayoutsView {
  minMicros: string;
  availableMicros: string;
  pendingMicros: string;
  lifetimeMicros: string;
  eligible: boolean;
  rules: EligibilityRule[];
  profile: PayoutProfileView | null;
  withdrawals: WithdrawalView[];
}

function profileView(record: PayoutProfileRecord): PayoutProfileView {
  return {
    method: record.method,
    legalName: record.legalName,
    country: record.country,
    currency: record.currency,
    email: record.email,
    bankDetails: record.bankDetails,
    fields: record.fields,
    updatedAt: record.updatedAt,
  };
}

export function withdrawalView(record: WithdrawalRecord): WithdrawalView {
  return {
    withdrawalId: record.withdrawalId,
    amountMicros: formatMicros(record.amountMicros),
    status: record.status,
    currency: record.destination.currency,
    createdAt: record.createdAt,
    decidedAt: record.decidedAt,
    providerRef: record.providerRef,
    note: record.note,
  };
}

/* ── Eligibility ────────────────────────────────────────────────────────── */

/** "$50.00", for a rule's explanation. Whole cents only, which every limit here is. */
function dollars(micros: bigint): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / 1_000_000n;
  const cents = (abs % 1_000_000n) / 10_000n;
  return `${negative ? "-" : ""}$${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

function days(ms: number): string {
  const whole = Math.floor(ms / 86_400_000);
  return whole === 1 ? "1 day" : `${whole} days`;
}

export interface EligibilityInput {
  user: UserRecord;
  balance: Balance;
  profile: PayoutProfileRecord | null;
  pending: WithdrawalRecord | null;
  corridorEligible?: boolean;
  now: number;
}

/**
 * The five rules, evaluated together.
 *
 * Every rule is reported whether it passed or not, and `eligible` is simply the
 * conjunction. Returning at the first failure would be cheaper and would make the screen
 * a game of whack-a-mole: fix one thing, discover the next.
 */
export function evaluateEligibility(input: EligibilityInput): {
  eligible: boolean;
  rules: EligibilityRule[];
} {
  const { user, balance, profile, pending, now, corridorEligible = profile !== null } = input;
  const min = PAYOUT_LIMITS.minWithdrawalMicros;
  const age = now - user.createdAt;

  const rules: EligibilityRule[] = [
    {
      id: "minimum",
      ok: balance.availableMicros >= min,
      label: `At least ${dollars(min)} available`,
      detail:
        balance.availableMicros >= min
          ? `You have ${dollars(balance.availableMicros)} available.`
          : `You have ${dollars(balance.availableMicros)}. ${dollars(min - balance.availableMicros)} to go.`,
    },
    {
      id: "verified-email",
      ok: user.emailVerified === true,
      label: "A confirmed email address",
      detail:
        user.emailVerified === true
          ? `Confirmed as ${user.email ?? "your address"}.`
          : "Sign in with Google or GitHub, or confirm the address on your account. We can't pay an address nobody has checked.",
    },
    {
      id: "account-age",
      ok: age >= PAYOUT_LIMITS.minAccountAgeMs,
      label: `Account at least ${days(PAYOUT_LIMITS.minAccountAgeMs)} old`,
      detail:
        age >= PAYOUT_LIMITS.minAccountAgeMs
          ? `Opened ${days(age)} ago.`
          : `Opened ${days(age)} ago. Ready in ${days(PAYOUT_LIMITS.minAccountAgeMs - age + 86_399_999)}.`,
    },
    {
      id: "payout-details",
      ok: profile !== null && corridorEligible,
      label: "Payout details on file",
      detail:
        profile === null
          ? "Tell us where the money goes and the name on the account."
          : !corridorEligible
            ? profile.method === "wise-email"
              ? `${profile.currency} is not a currency we can send to a Wise account.`
              : `${profile.country}/${profile.currency} is not currently enabled for bank payouts.`
            : profile.method === "wise-email"
              ? `Wise transfer to ${profile.email ?? profile.legalName}, in ${profile.currency}.`
              : `Bank transfer to ${profile.legalName}, in ${profile.currency}.`,
    },
    {
      id: "no-pending",
      ok: pending === null,
      label: "No request already in progress",
      detail:
        pending === null
          ? "Nothing waiting on us."
          : `${dollars(pending.amountMicros)} is already waiting for review.`,
    },
  ];

  return { eligible: rules.every((rule) => rule.ok), rules };
}

/**
 * Can this destination still be paid to?
 *
 * Two answers, because there are two kinds of destination. A bank transfer needs the
 * coordinates its country uses, so it is only usable while that corridor is enabled and
 * the stored fields still satisfy it - an admin who turns a corridor off must stop new
 * requests to it. A Wise address needs no coordinates at all: Wise resolves the recipient
 * itself, so the only question is whether we can send that currency.
 *
 * Re-checked on every read rather than stored, so disabling a corridor takes effect on the
 * next page load rather than on the next profile save.
 */
async function destinationUsable(
  deps: PayoutDeps,
  profile: PayoutProfileRecord | null,
): Promise<boolean> {
  if (profile === null) return false;
  if (profile.method === "wise-email") {
    return profile.email !== null && PAYOUT_CURRENCY_SET.has(profile.currency);
  }
  const corridor = await deps.store.getPayoutCorridor(profile.country, profile.currency);
  return corridor !== null && validateDestination(corridor, profile.fields ?? {}).ok;
}

/** The whole payouts screen in one read: nothing here is worth a second round trip. */
export async function readPayouts(deps: PayoutDeps, uid: string): Promise<PayoutsView> {
  const [user, balance, profile, history] = await Promise.all([
    deps.store.getUser(uid),
    deps.store.getBalance(uid),
    deps.store.getPayoutProfile(uid),
    deps.store.withdrawalsForUser(uid),
  ]);

  // `authenticate` creates the record before any handler runs, so a missing one here
  // means the row was deleted underneath a live session. Treat it as brand new rather
  // than throwing: every rule below then fails honestly instead of 500ing.
  const known: UserRecord = user ?? { uid, status: "active", createdAt: deps.clock.now() };
  const pending = history.find((row) => row.status === "requested" || row.status === "approved") ?? null;

  const corridorEligible = await destinationUsable(deps, profile);
  const { eligible, rules } = evaluateEligibility({
    user: known,
    balance,
    profile,
    pending,
    now: deps.clock.now(),
    corridorEligible,
  });

  return {
    minMicros: formatMicros(PAYOUT_LIMITS.minWithdrawalMicros),
    availableMicros: formatMicros(balance.availableMicros),
    pendingMicros: formatMicros(balance.pendingWithdrawalMicros),
    lifetimeMicros: formatMicros(balance.lifetimeMicros),
    eligible,
    rules,
    profile: profile === null ? null : profileView(profile),
    withdrawals: history.map(withdrawalView),
  };
}

export async function savePayoutProfile(
  deps: PayoutDeps,
  uid: string,
  body: PayoutProfileBody,
): Promise<PayoutsView | null> {
  // A Wise address is checked against the currencies Wise can send, and nothing else -
  // there are no bank coordinates to validate and no corridor to be enabled.
  if (body.method === "wise-email") {
    if (body.email === null || !PAYOUT_CURRENCY_SET.has(body.currency)) return null;
    await deps.store.putPayoutProfile({
      uid,
      method: "wise-email",
      legalName: body.legalName,
      country: body.country,
      currency: body.currency,
      email: body.email,
      bankDetails: null,
      fields: {},
      updatedAt: deps.clock.now(),
    });
    return readPayouts(deps, uid);
  }

  // Normalised before validation, not after: an IBAN is printed in groups of four and
  // typed that way, and the validator accepts no spaces. Storing what the bank prints and
  // refusing it as malformed is a form that looks broken to somebody holding the right
  // answer.
  const fields = normalizeFields(body.fields);
  const corridor = await deps.store.getPayoutCorridor(body.country, body.currency);
  if (corridor === null || !validateDestination(corridor, fields).ok) return null;
  await deps.store.putPayoutProfile({
    uid,
    method: body.method,
    legalName: body.legalName,
    country: body.country,
    currency: body.currency,
    email: null,
    bankDetails: null,
    fields,
    updatedAt: deps.clock.now(),
  });

  // The whole screen back, because saving details is the step that most often flips
  // eligibility - and a form that saves without the box above it changing looks broken.
  return readPayouts(deps, uid);
}

/* ── Requesting ─────────────────────────────────────────────────────────── */

/**
 * Ask to be paid.
 *
 * Order matters here and is not the obvious one. The request row is written *before* the
 * hold, because of what each half-finished state costs:
 *
 *   - Row without hold: the money was never deducted, but the "no request in progress"
 *     rule blocks any second request, so nothing can be taken twice. An admin sees a
 *     request whose pending balance is missing, and the compensating write below has
 *     usually already marked it failed.
 *   - Hold without row: the balance falls and nothing explains why. Nobody can cancel a
 *     request that does not exist, and the user is simply poorer until someone notices.
 *
 * The first is recoverable and visible; the second is invisible. So the row goes first.
 */
export async function requestWithdrawal(
  deps: PayoutDeps,
  uid: string,
  amountMicros: bigint,
): Promise<Outcome<WithdrawalView>> {
  const [user, balance, profile, history] = await Promise.all([
    deps.store.getUser(uid),
    deps.store.getBalance(uid),
    deps.store.getPayoutProfile(uid),
    deps.store.withdrawalsForUser(uid),
  ]);

  if (user === null) return no("not-eligible");
  const pending = history.find((row) => row.status === "requested" || row.status === "approved") ?? null;
  const now = deps.clock.now();

  const corridorEligible = await destinationUsable(deps, profile);
  const { eligible } = evaluateEligibility({
    user,
    balance,
    profile,
    pending,
    now,
    corridorEligible,
  });
  if (!eligible || profile === null) return no("not-eligible");

  if (amountMicros < PAYOUT_LIMITS.minWithdrawalMicros) return no("invalid-amount");
  if (amountMicros > balance.availableMicros) return no("insufficient-funds");

  const withdrawalId = deps.ids.next("wd");
  const record: WithdrawalRecord = {
    withdrawalId,
    uid,
    amountMicros,
    status: "requested",
    destination: {
      method: profile.method,
      legalName: profile.legalName,
      country: profile.country,
      currency: profile.currency,
      email: profile.email,
      bankDetails: profile.bankDetails,
      ...(profile.fields === undefined ? {} : { fields: profile.fields }),
    },
    createdAt: now,
    decidedAt: null,
    decidedBy: null,
    providerRef: null,
    note: null,
    evidence: null,
  };

  const reserved = await deps.store.reserveWithdrawal(record, {
    entryId: `${withdrawalId}:requested`,
    uid,
    kind: "withdrawal_requested",
    // Negative: available falls now, and the same magnitude becomes pending.
    micros: -amountMicros,
    refId: withdrawalId,
    createdAt: now,
    description: `Withdrawal requested (${dollars(amountMicros)})`,
    currency: profile.currency,
  });
  if (reserved === "in-flight") return no("not-eligible");
  if (reserved === "insufficient-funds") return no("insufficient-funds");

  return ok(withdrawalView(record));
}

/**
 * Withdraw the request, not the money.
 *
 * Ledger-first here, unlike the request: the entry id is derived from the withdrawal id,
 * so a retry after a partial failure appends nothing the second time and then finishes
 * the record update it did not reach.
 */
export async function cancelWithdrawal(
  deps: PayoutDeps,
  uid: string,
  withdrawalId: string,
): Promise<Outcome<WithdrawalView>> {
  const record = await deps.store.getWithdrawal(withdrawalId);
  // Not "not yours" - an id that exists on another account is an id this caller should
  // not learn the existence of.
  if (record === null || record.uid !== uid) return no("not-found");
  if (record.status !== "requested") return no("invalid-state");

  return release(deps, record, "cancelled", "Cancelled by you", null);
}

/* ── The admin decision ─────────────────────────────────────────────────── */

export async function approveWithdrawal(
  deps: PayoutDeps,
  adminUid: string,
  withdrawalId: string,
): Promise<Outcome<WithdrawalView>> {
  const record = await deps.store.getWithdrawal(withdrawalId);
  if (record === null) return no("not-found");
  if (record.status !== "requested") return no("invalid-state");
  const now = deps.clock.now();
  const updated: WithdrawalRecord = {
    ...record,
    status: "approved",
    decidedAt: now,
    decidedBy: adminUid,
  };
  const changed = await deps.store.transitionWithdrawal({
    withdrawalId,
    expectedStatuses: ["requested"],
    status: "approved",
    decidedAt: now,
    decidedBy: adminUid,
    providerRef: null,
    note: null,
  });
  if (!changed) return no("invalid-state");
  await deps.store.writeAudit({
    adminUid,
    action: `withdrawal:approved:${withdrawalId}`,
    subjectUid: record.uid,
    at: now,
  });
  return ok(withdrawalView(updated));
}

export async function listWithdrawals(
  deps: PayoutDeps,
  adminUid: string,
  status: WithdrawalStatus | null,
  page: Page,
): Promise<{ rows: AdminWithdrawalView[]; nextCursor: string | null }> {
  await deps.store.writeAudit({
    adminUid,
    action: "read-withdrawals",
    subjectUid: "*",
    at: deps.clock.now(),
  });

  const found = await deps.store.listWithdrawals(status, page);

  const rows = await Promise.all(
    found.rows.map(async (record) => {
      const [user, balance] = await Promise.all([
        deps.store.getUser(record.uid),
        deps.store.getBalance(record.uid),
      ]);

      return {
        ...withdrawalView(record),
        uid: record.uid,
        email: user?.email ?? null,
        displayName: user?.displayName ?? null,
        destination: { method: record.destination.method, ...maskDestination(record.destination) },
        availableMicros: formatMicros(balance.availableMicros),
        lifetimeMicros: formatMicros(balance.lifetimeMicros),
      };
    }),
  );

  return { rows, nextCursor: found.nextCursor };
}

/**
 * The bank details for one request, at the moment somebody is about to make the transfer.
 *
 * Separate from the queue on purpose. Reading a list should not decrypt every account on
 * the page, and the audit line for this names the withdrawal rather than saying somebody
 * opened a screen - so "who looked at this person's account, and when" has an answer.
 *
 * Refused once the request is settled: the details were needed to send the money, and a
 * paid or rejected row is history.
 */
export async function readWithdrawalDestination(
  deps: PayoutDeps,
  adminUid: string,
  withdrawalId: string,
): Promise<Outcome<PayoutDestination>> {
  const record = await deps.store.getWithdrawal(withdrawalId);
  if (record === null) return no("not-found");
  if (record.status !== "requested" && record.status !== "approved") return no("invalid-state");

  await deps.store.writeAudit({
    adminUid,
    action: `withdrawal:destination-read:${withdrawalId}`,
    subjectUid: record.uid,
    at: deps.clock.now(),
  });
  return ok(record.destination);
}

/**
 * Record that the transfer was made.
 *
 * Called after the money has already left a Wise account, which is why it takes a
 * provider reference and refuses without one: the reference is the only thread back to
 * the actual transfer when somebody asks about it in six months.
 */
export async function markWithdrawalPaid(
  deps: PayoutDeps,
  adminUid: string,
  withdrawalId: string,
  providerRef: string,
): Promise<Outcome<WithdrawalView>> {
  const record = await deps.store.getWithdrawal(withdrawalId);
  if (record === null) return no("not-found");
  if (record.status !== "approved") return no("invalid-state");

  const now = deps.clock.now();
  const entry: import("./ledger.ts").LedgerEntry = {
    entryId: `${withdrawalId}:paid`,
    uid: record.uid,
    kind: "withdrawal_paid",
    // Negative, so the hold falls away. Available already dropped at request time; a
    // positive figure here would hand the money back as well as sending it.
    micros: -record.amountMicros,
    refId: withdrawalId,
    createdAt: now,
    description: `Withdrawal paid (${dollars(record.amountMicros)})`,
    providerRef,
    currency: record.destination.currency,
    adminUid,
  } as const;

  const updated: WithdrawalRecord = {
    ...record,
    status: "paid",
    decidedAt: now,
    decidedBy: adminUid,
    providerRef,
    note: null,
  };
  const changed = await deps.store.transitionWithdrawal({
    withdrawalId,
    expectedStatuses: ["approved"],
    status: "paid",
    decidedAt: now,
    decidedBy: adminUid,
    providerRef,
    note: null,
    entry,
  });
  if (!changed) return no("invalid-state");
  await deps.store.writeAudit({
    adminUid,
    action: `withdrawal:paid:${withdrawalId}`,
    subjectUid: record.uid,
    at: now,
  });

  return ok(withdrawalView(updated));
}

/** Refuse it and give the money back, with a reason the person who asked will read. */
export async function rejectWithdrawal(
  deps: PayoutDeps,
  adminUid: string,
  withdrawalId: string,
  note: string,
): Promise<Outcome<WithdrawalView>> {
  const record = await deps.store.getWithdrawal(withdrawalId);
  if (record === null) return no("not-found");
  if (record.status !== "requested" && record.status !== "approved") return no("invalid-state");

  return release(deps, record, "rejected", note, adminUid);
}

/**
 * The half `cancelled` and `rejected` share: release the hold, close the record.
 *
 * `withdrawal_failed` is positive - the money comes back to available and leaves pending.
 */
async function release(
  deps: PayoutDeps,
  record: WithdrawalRecord,
  status: Extract<WithdrawalStatus, "rejected" | "failed" | "cancelled">,
  note: string,
  adminUid: string | null,
): Promise<Outcome<WithdrawalView>> {
  const now = deps.clock.now();

  const entry: import("./ledger.ts").LedgerEntry = {
    entryId: `${record.withdrawalId}:failed`,
    uid: record.uid,
    kind: "withdrawal_failed",
    micros: record.amountMicros,
    refId: record.withdrawalId,
    createdAt: now,
    description: `Withdrawal ${status} (${dollars(record.amountMicros)})`,
    reason: note,
    currency: record.destination.currency,
    ...(adminUid === null ? {} : { adminUid }),
  };

  const updated: WithdrawalRecord = {
    ...record,
    status,
    decidedAt: now,
    decidedBy: adminUid,
    note,
  };
  const changed = await deps.store.transitionWithdrawal({
    withdrawalId: record.withdrawalId,
    expectedStatuses: [record.status],
    status,
    decidedAt: now,
    decidedBy: adminUid,
    providerRef: record.providerRef,
    note,
    entry,
  });
  if (!changed) return no("invalid-state");
  if (adminUid !== null) {
    await deps.store.writeAudit({
      adminUid,
      action: `withdrawal:${status}:${record.withdrawalId}`,
      subjectUid: record.uid,
      at: now,
    });
  }

  return ok(withdrawalView(updated));
}

export async function markWithdrawalFailed(
  deps: PayoutDeps,
  adminUid: string,
  withdrawalId: string,
  note: string,
): Promise<Outcome<WithdrawalView>> {
  const record = await deps.store.getWithdrawal(withdrawalId);
  if (record === null) return no("not-found");
  if (record.status !== "approved") return no("invalid-state");
  return release(deps, record, "failed", note, adminUid);
}

/**
 * The transfer came back after it had been recorded as sent.
 *
 * `paid` used to be terminal, which meant a bounced, recalled or returned Wise transfer
 * had no route back into the product - and no endpoint wrote an `adjustment` entry either,
 * so the only correction was hand-written SQL against the money ledger. That is exactly
 * what an append-only ledger exists to make unnecessary.
 *
 * The entry is an `adjustment`, not a `withdrawal_failed`, and the arithmetic is why. At
 * `paid` the hold has already settled: available fell at request time and pending is back
 * to zero. `withdrawal_failed` adds to available *and* subtracts from pending, which would
 * leave the hold negative. An adjustment moves available alone, which is the only thing
 * that needs to move - and "a correction an admin made, with a reason" is what the kind
 * means. `lifetimeMicros` is untouched: they did earn it, and this is the payment failing,
 * not the earning being revoked.
 */
export async function returnWithdrawal(
  deps: PayoutDeps,
  adminUid: string,
  withdrawalId: string,
  note: string,
): Promise<Outcome<WithdrawalView>> {
  const record = await deps.store.getWithdrawal(withdrawalId);
  if (record === null) return no("not-found");
  if (record.status !== "paid") return no("invalid-state");

  const now = deps.clock.now();
  const entry: import("./ledger.ts").LedgerEntry = {
    entryId: `${withdrawalId}:returned`,
    uid: record.uid,
    kind: "adjustment",
    micros: record.amountMicros,
    refId: withdrawalId,
    createdAt: now,
    description: `Transfer returned (${dollars(record.amountMicros)})`,
    reason: note,
    adminUid,
    currency: record.destination.currency,
    ...(record.providerRef === null ? {} : { providerRef: record.providerRef }),
  };

  const changed = await deps.store.transitionWithdrawal({
    withdrawalId,
    expectedStatuses: ["paid"],
    status: "returned",
    decidedAt: now,
    decidedBy: adminUid,
    providerRef: record.providerRef,
    note,
    entry,
  });
  if (!changed) return no("invalid-state");

  await deps.store.writeAudit({
    adminUid,
    action: `withdrawal:returned:${withdrawalId}`,
    subjectUid: record.uid,
    at: now,
  });
  return ok({ ...withdrawalView(record), status: "returned", decidedAt: now, note });
}

/* ── Corrections ────────────────────────────────────────────────────────── */

/**
 * Move a balance by hand, with a reason attached.
 *
 * The `adjustment` kind has existed in `ledger.ts` since the first migration and nothing
 * ever wrote one, so every correction that was not a withdrawal outcome meant editing the
 * database directly. This is the endpoint that makes that unnecessary: it appends, like
 * everything else, and the entry carries who did it and why.
 *
 * It cannot push a balance negative. An admin who needs to claw back more than somebody
 * has is describing a debt, and this system has no concept of one - inventing a negative
 * balance here would silently break every `>=` in the eligibility rules.
 */
export async function adjustBalance(
  deps: PayoutDeps,
  adminUid: string,
  uid: string,
  micros: bigint,
  reason: string,
): Promise<Outcome<{ uid: string; micros: string; availableMicros: string }>> {
  if (micros === 0n) return no("invalid-amount");

  const [user, balance] = await Promise.all([deps.store.getUser(uid), deps.store.getBalance(uid)]);
  if (user === null) return no("not-found");
  if (balance.availableMicros + micros < 0n) return no("insufficient-funds");

  const now = deps.clock.now();
  await deps.store.appendEntryAndUpdateBalance({
    entryId: deps.ids.next("adj"),
    uid,
    kind: "adjustment",
    micros,
    refId: null,
    createdAt: now,
    description: `${micros > 0n ? "Credit" : "Debit"} by an administrator (${dollars(micros)})`,
    reason,
    adminUid,
  });
  await deps.store.writeAudit({
    adminUid,
    action: `balance:adjusted:${formatMicros(micros)}`,
    subjectUid: uid,
    at: now,
  });

  return ok({
    uid,
    micros: formatMicros(micros),
    availableMicros: formatMicros(balance.availableMicros + micros),
  });
}
