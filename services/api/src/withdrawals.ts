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
import { PAYOUT_LIMITS, type PayoutProfileBody } from "./contract.ts";
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
import { validateDestination } from "./payoutCorridors.ts";

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

/** The admin's row: the same request, plus who made it and where the money must go. */
export interface AdminWithdrawalView extends WithdrawalView {
  uid: string;
  email: string | null;
  displayName: string | null;
  destination: PayoutDestination;
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
            ? `${profile.country}/${profile.currency} is not currently enabled for manual payouts.`
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

  const corridor =
    profile === null ? null : await deps.store.getPayoutCorridor(profile.country, profile.currency);
  const corridorEligible =
    profile !== null &&
    corridor !== null &&
    validateDestination(corridor, profile.fields ?? {}).ok;
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
  const corridor = await deps.store.getPayoutCorridor(body.country, body.currency);
  if (corridor === null || !validateDestination(corridor, body.fields).ok) return null;
  await deps.store.putPayoutProfile({
    uid,
    method: body.method,
    legalName: body.legalName,
    country: body.country,
    currency: body.currency,
    email: body.email,
    bankDetails: body.bankDetails,
    fields: body.fields,
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

  const corridor =
    profile === null ? null : await deps.store.getPayoutCorridor(profile.country, profile.currency);
  const corridorEligible =
    profile !== null && corridor !== null && validateDestination(corridor, profile.fields ?? {}).ok;
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
        destination: record.destination,
        availableMicros: formatMicros(balance.availableMicros),
        lifetimeMicros: formatMicros(balance.lifetimeMicros),
      };
    }),
  );

  return { rows, nextCursor: found.nextCursor };
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
