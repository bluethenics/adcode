/**
 * POST /v1/receipts - the only place in the system where money is created.
 *
 * Two properties matter more than anything else here.
 *
 * Idempotency: the receipt id is the key, and creation is create-if-absent, so a client
 * replaying its queue after a dropped response is paid exactly once.
 *
 * Every receipt is acked, whether or not it earned. The client must be able to clear its
 * queue - a receipt it keeps retrying forever is a client that never stops sending - and
 * telling an attacker precisely which forgeries were detected helps only the attacker.
 */
import type { ReceiptsRequestBody, ReceiptsResponseBody, SubmittedReceipt } from "./contract.ts";
import type { Clock, IdGen, Store } from "./store.ts";
import { checkReceipt } from "./plausibility.ts";
import { userCreditMicros } from "./money.ts";
import type { LedgerEntry } from "./ledger.ts";

export interface ReceiptDeps {
  store: Store;
  clock: Clock;
  ids: IdGen;
}

/** "Ad from Acme, 4.2s" - resolved server-side so user and admin views cannot diverge. */
function describeEntry(advertiser: string, receipt: SubmittedReceipt): string {
  const seconds = (receipt.dwellMs / 1000).toFixed(1);
  return `Ad from ${advertiser}, ${seconds}s`;
}

export async function handleReceipts(
  deps: ReceiptDeps,
  uid: string,
  body: ReceiptsRequestBody,
): Promise<ReceiptsResponseBody> {
  const acked: string[] = [];
  const now = deps.clock.now();
  const config = await deps.store.getConfig();

  for (const receipt of body.receipts) {
    const serve = await deps.store.findServe(uid, receipt.creativeId, now);
    const verdict = checkReceipt(receipt, serve, now);

    // `checkReceipt` returns `no-serve` when there is none, so passing implies one
    // exists - but that is a guarantee of its logic, not of its type. Narrowed here
    // rather than asserted, so a future change to that contract fails compilation.
    if (!verdict.ok || serve === null) {
      acked.push(receipt.receiptId);
      continue;
    }

    const creative = await deps.store.getCreative(receipt.creativeId);
    if (creative === null) {
      acked.push(receipt.receiptId);
      continue;
    }

    /*
     * A test serve is acknowledged and recorded, but worth nothing.
     *
     * Zeroing the amounts rather than skipping the receipt keeps the idempotency record,
     * so a replayed test receipt still cannot become a real one later.
     */
    const isTest = serve.test === true;
    const cost = isTest ? 0n : serve.costMicros;
    const credit = isTest ? 0n : userCreditMicros(cost, config.revSharePercent);

    const receiptRecord = {
      receiptId: receipt.receiptId,
      uid,
      creativeId: receipt.creativeId,
      campaignId: creative.campaignId,
      outcome: receipt.outcome,
      creditedMicros: credit,
      costMicros: cost,
      // Verification time, not the client's claimed view time. The client controls the
      // latter, and a receipt that could date itself could move spend into a day the
      // advertiser has already been billed for.
      createdAt: now,
    };

    const entry: LedgerEntry = {
      entryId: deps.ids.next("e"),
      uid,
      kind: receipt.outcome === "click" ? "click" : "impression",
      micros: credit,
      refId: receipt.receiptId,
      createdAt: now,
      description: describeEntry(creative.advertiser, receipt),
    };

    if (isTest) await deps.store.createReceiptIfAbsent(receiptRecord);
    else await deps.store.settleReceipt({ receipt: receiptRecord, earning: entry });

    acked.push(receipt.receiptId);
  }

  return { acked };
}
