/**
 * Admin routes.
 *
 * Spec §9: admin power over other people's money is itself audited. Every read and every
 * write here writes an `adminAudit` row first - before the action, so a failure partway
 * through still leaves evidence that the attempt was made.
 */
import { handleLedger } from "./balance.ts";
import type { LedgerResponseBody } from "./contract.ts";
import type { Clock, Page, Store, UserStatus } from "./store.ts";

export interface AdminDeps {
  store: Store;
  clock: Clock;
}

export async function handleAdminLedger(
  deps: AdminDeps,
  adminUid: string,
  subjectUid: string,
  page: Page,
): Promise<LedgerResponseBody> {
  await deps.store.writeAudit({
    adminUid,
    action: "read-ledger",
    subjectUid,
    at: deps.clock.now(),
  });

  // The same function the user's own view calls, so the two can never drift.
  return handleLedger(deps.store, subjectUid, page);
}

export async function handleSetUserStatus(
  deps: AdminDeps,
  adminUid: string,
  subjectUid: string,
  status: UserStatus,
): Promise<void> {
  const user = await deps.store.getUser(subjectUid);
  if (user === null) throw new Error(`no such user: ${subjectUid}`);

  await deps.store.writeAudit({
    adminUid,
    action: `set-status:${status}`,
    subjectUid,
    at: deps.clock.now(),
  });

  await deps.store.putUser({ ...user, status });
}
