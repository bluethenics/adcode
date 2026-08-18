/**
 * GET /v1/balance and GET /v1/ledger.
 *
 * Spec §7: a user's history is selected by the verified UID, never by a parameter the
 * caller supplies, so there is no request a client can craft to read someone else's
 * money. The `uid` argument here always comes from `authenticate`.
 *
 * The response deliberately drops `uid` from each row. The caller already knows whose
 * history they asked for, and a field that is never needed is a field that cannot leak.
 */
import { formatMicros } from "./money.ts";
import type { BalanceResponseBody, LedgerResponseBody } from "./contract.ts";
import type { Page, Store } from "./store.ts";

export async function handleBalance(store: Store, uid: string): Promise<BalanceResponseBody> {
  const balance = await store.getBalance(uid);
  return {
    availableMicros: formatMicros(balance.availableMicros),
    lifetimeMicros: formatMicros(balance.lifetimeMicros),
  };
}

export async function handleLedger(
  store: Store,
  uid: string,
  page: Page,
): Promise<LedgerResponseBody> {
  const { rows, nextCursor } = await store.listEntries(uid, page);
  return {
    rows: rows.map((e) => ({
      entryId: e.entryId,
      kind: e.kind,
      micros: formatMicros(e.micros),
      description: e.description,
      createdAt: e.createdAt,
      refId: e.refId,
    })),
    nextCursor,
  };
}
