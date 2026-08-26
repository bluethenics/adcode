# Advertising Credits, Auction, and Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Dodo-funded USD advertising credits, second-price auction settlement, public live demand, and encrypted manual developer payouts with complete admin operations.

**Architecture:** ADCode remains the source of truth for two append-only ledgers: advertiser credits and developer earnings. Dodo Checkout Sessions and signed provider events feed the credit ledger; auction clearing prices are captured on serve records and atomically settled with developer earnings; manual payouts use encrypted corridor-specific bank destinations and explicit admin state transitions.

**Tech Stack:** TypeScript 5.9, Node.js 24, Vitest 4, fast-check, Next.js 16/React 19, Supabase/PostgreSQL, Firebase Admin/Firestore, Cloudflare Workers/OpenNext, Dodo Payments REST API.

**Spec:** `docs/superpowers/specs/2026-08-26-advertising-credits-auction-payouts-design.md`

## Global Constraints

- One advertising credit equals $1 USD of campaign spending power.
- Auction floor: `3_000_000` micros CPM ($3.00); increment: `10_000` micros CPM ($0.01).
- Developer revenue share: 50% of captured impression cost.
- Minimum payout: `50_000_000` micros ($50.00); minimum account age remains seven days.
- Dodo browser redirects never create credits; only verified, matched provider events do.
- Payout execution remains manual and provider-neutral; no Wise or bank API is introduced.
- Transfer fees are platform expenses and never reduce the user's requested payout amount.
- Full payout destinations are AES-256-GCM encrypted and masked by default.
- The revoked Dodo credential is never used; tests use fixtures and deployment uses interactive secrets.
- Preserve all unrelated and pre-existing uncommitted work. Before each commit, inspect the exact staged diff. If an overlapping file contains inseparable pre-existing work, do not commit that task's implementation file.
- Read `apps/web/AGENTS.md` and the relevant local Next.js 16 documentation under `apps/web/node_modules/next/dist/docs/` before editing Next.js routes or components.

---

### Task 1: Second-price auction and captured serve prices

**Files:**
- Modify: `services/api/src/targeting.ts`
- Modify: `services/api/src/money.ts`
- Modify: `services/api/src/store.ts` (`ServeRecord`, `ServingConfig`)
- Modify: `services/api/src/memoryStore.ts`
- Modify: `services/api/src/serve.ts`
- Modify: `services/api/src/receipts.ts`
- Modify: `services/api/test/targeting.test.ts`
- Modify: `services/api/test/serve.test.ts`
- Modify: `services/api/test/receipts.test.ts`
- Create: `services/api/test/auction.property.test.ts`

**Interfaces:**
- Consumes: `CampaignRecord`, campaign spend, request tags, requested count, and `ServingConfig.floorCpmMicros`.
- Produces: `runAuction(input: AuctionInput): AuctionWinner[]`, where each winner contains `campaign`, `maxBidCpmMicros`, `clearingCpmMicros`, and `costMicros`.
- Produces: `ServeRecord.maxBidCpmMicros`, `ServeRecord.clearingCpmMicros`, and `ServeRecord.costMicros`.

- [ ] **Step 1: Write failing auction examples and properties**

Add focused examples to `targeting.test.ts` and properties to `auction.property.test.ts`:

```ts
expect(runAuction({ candidates: [bid("a", 9n), bid("b", 5n)], tags: [], count: 1, floorCpmMicros: 3n, incrementCpmMicros: 1n, tieSeed: "x" }))
  .toMatchObject([{ campaign: { campaignId: "a" }, clearingCpmMicros: 6n }]);

fc.assert(fc.property(validBids, (bids) => {
  const winners = runAuction(input(bids));
  return winners.every((winner) =>
    winner.clearingCpmMicros >= FLOOR &&
    winner.clearingCpmMicros <= winner.maxBidCpmMicros
  );
}));
```

Cover one bidder at the floor, bids below the floor, equal bids, targeting, exhausted budgets, batched generalized second price, deterministic tie rotation, and a losing bid raising the clearing price without changing the winner.

- [ ] **Step 2: Run the auction tests and verify the intended failure**

Run: `npx vitest run services/api/test/targeting.test.ts services/api/test/auction.property.test.ts`

Expected: FAIL because `runAuction`, floor filtering, and `AuctionWinner` do not exist.

- [ ] **Step 3: Implement the pure auction and money helpers**

Use these exact public types in `targeting.ts`:

```ts
export interface AuctionInput {
  candidates: readonly Candidate[];
  tags: readonly string[];
  count: number;
  floorCpmMicros: bigint;
  incrementCpmMicros: bigint;
  tieSeed: string;
}

export interface AuctionWinner {
  campaign: CampaignRecord;
  maxBidCpmMicros: bigint;
  clearingCpmMicros: bigint;
  costMicros: bigint;
}

export function runAuction(input: AuctionInput): AuctionWinner[];
```

Keep `advertiserCostMicros(cpm)` as the only CPM-to-impression conversion. Use a stable string hash of `tieSeed + campaignId` for equal bids; do not use `Math.random()`.

- [ ] **Step 4: Write failing serve/receipt snapshot tests**

Assert that a 9 CPM winner facing 5 CPM stores 5.01 CPM and 5,010 micros on its serve, and that changing campaign/config CPM after serving does not change the receipt charge or 50% credit.

```ts
const serve = await store.findServe("u-1", "c-1", now);
expect(serve?.clearingCpmMicros).toBe(5_010_000n);
expect(serve?.costMicros).toBe(5_010n);
```

- [ ] **Step 5: Run snapshot tests and verify they fail**

Run: `npx vitest run services/api/test/serve.test.ts services/api/test/receipts.test.ts`

Expected: FAIL because serve records do not contain captured price and receipts still read `defaultCpmMicros`.

- [ ] **Step 6: Capture the auction result in serving and consume it in receipts**

Add `floorCpmMicros` and `auctionIncrementCpmMicros` to `ServingConfig`, defaulting to `3_000_000n` and `10_000n`. `handleServe` calls `runAuction` and writes all captured fields. `handleReceipts` reads `serve.costMicros`; test serves always use zero.

- [ ] **Step 7: Run the focused tests and full API unit suite**

Run: `npx vitest run services/api/test/targeting.test.ts services/api/test/auction.property.test.ts services/api/test/serve.test.ts services/api/test/receipts.test.ts`

Then: `npx vitest run services/api/test`

Expected: PASS.

- [ ] **Step 8: Commit the isolated auction change if the staged diff is clean**

```bash
git add services/api/src/targeting.ts services/api/src/money.ts services/api/src/store.ts services/api/src/memoryStore.ts services/api/src/serve.ts services/api/src/receipts.ts services/api/test/targeting.test.ts services/api/test/auction.property.test.ts services/api/test/serve.test.ts services/api/test/receipts.test.ts
git diff --cached --check
git commit -m "feat(ads): settle a second-price auction"
```

---

### Task 2: Atomic receipt settlement and persisted serve pricing

**Files:**
- Create: `supabase/migrations/20260826100000_auction_settlement.sql`
- Modify: `services/api/src/store.ts`
- Modify: `services/api/src/memoryStore.ts`
- Modify: `services/api/adapters/supabaseRows.ts`
- Modify: `services/api/adapters/supabaseStore.ts`
- Modify: `services/api/adapters/firestoreStore.ts`
- Modify: `services/api/src/receipts.ts`
- Modify: `services/api/test/receipts.test.ts`
- Modify: `services/api/test/supabaseRows.test.ts`
- Modify: `services/api/test/emulator/firestoreStore.emulator.test.ts`

**Interfaces:**
- Consumes: a validated `ReceiptSettlement` containing receipt, ledger entry, and campaign charge.
- Produces: `Store.settleReceipt(settlement): Promise<boolean>`; `true` means newly settled, `false` means duplicate.

- [ ] **Step 1: Write failing store-contract tests for all-or-nothing settlement**

Define the desired interface in test code:

```ts
export interface ReceiptSettlement {
  receipt: ReceiptRecord;
  earning: LedgerEntry;
}

const created = await store.settleReceipt({ receipt, earning });
expect(created).toBe(true);
expect(await store.getSpend(receipt.campaignId)).toBe(receipt.costMicros);
expect((await store.getBalance(receipt.uid)).availableMicros).toBe(earning.micros);
expect(await store.settleReceipt({ receipt, earning })).toBe(false);
```

Include an injected-failure memory test proving no receipt, spend, earning, or balance survives a failed settlement.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run services/api/test/receipts.test.ts services/api/test/memoryStore.test.ts`

Expected: FAIL because `Store.settleReceipt` does not exist.

- [ ] **Step 3: Add the SQL migration and row mappings**

The migration must:

- add `max_bid_cpm_micros`, `clearing_cpm_micros`, and `cost_micros` to `serves`
- add `floor_cpm_micros` and `auction_increment_cpm_micros` to `serving_config`
- backfill old serves with the prior `default_cpm_micros` and derived impression cost
- define `settle_receipt(...) returns boolean` that inserts the receipt idempotently, inserts the earnings ledger row, updates developer balance, and increments campaign spend in one transaction
- revoke the function from `anon` and `authenticated`

Use `ON CONFLICT (receipt_id) DO NOTHING`; return `false` before any other write when the receipt already exists.

- [ ] **Step 4: Implement the three adapters**

Memory applies changes only after duplicate detection. Supabase calls `settle_receipt`. Firestore uses `runTransaction()` across receipt, ledger, balance, and campaign spend documents. Update serve serialization for all captured price fields.

- [ ] **Step 5: Refactor `handleReceipts` onto `settleReceipt`**

Remove the sequence `createReceiptIfAbsent -> appendEntryAndUpdateBalance -> addSpend` from the receipt path. Keep old store methods only for compatibility callers that still need them; no receipt handler may call them separately.

- [ ] **Step 6: Run adapter and receipt tests**

Run: `npx vitest run services/api/test/receipts.test.ts services/api/test/supabaseRows.test.ts services/api/test/emulator/firestoreStore.emulator.test.ts`

Expected: PASS (the emulator test may be skipped when the documented emulator/JDK prerequisite is absent).

- [ ] **Step 7: Commit the storage boundary when safe**

```bash
git add supabase/migrations/20260826100000_auction_settlement.sql services/api/src/store.ts services/api/src/memoryStore.ts services/api/adapters/supabaseRows.ts services/api/adapters/supabaseStore.ts services/api/adapters/firestoreStore.ts services/api/src/receipts.ts services/api/test/receipts.test.ts services/api/test/supabaseRows.test.ts services/api/test/emulator/firestoreStore.emulator.test.ts
git diff --cached --check
git commit -m "feat(money): settle receipts atomically"
```

---

### Task 3: Credit orders and Dodo Checkout Sessions

**Files:**
- Create: `supabase/migrations/20260826110000_advertiser_credits.sql`
- Create: `services/api/src/creditOrders.ts`
- Modify: `services/api/src/payments.ts`
- Modify: `services/api/adapters/dodoPayments.ts`
- Modify: `services/api/src/store.ts`
- Modify: `services/api/src/memoryStore.ts`
- Modify: `services/api/adapters/supabaseRows.ts`
- Modify: `services/api/adapters/supabaseStore.ts`
- Modify: `services/api/adapters/firestoreStore.ts`
- Create: `services/api/test/creditOrders.test.ts`
- Modify: `services/api/test/server.test.ts`
- Create: `services/api/test/dodoPayments.test.ts`

**Interfaces:**
- Produces: `CreditOrderRecord` and order store methods.
- Produces: `PaymentProvider.createCheckout(request): Promise<{ sessionId: string; checkoutUrl: string } | null>`.
- Produces: `createCreditCheckout(deps, uid, request): Promise<Outcome<CheckoutView>>`.

- [ ] **Step 1: Write failing order lifecycle tests**

Cover whole-cent validation, $10/$10,000 bounds, owner/advertiser binding, pending order creation before provider call, saved session ID before returning URL, and provider failure leaving a failed order with no credit.

```ts
expect(await createCreditCheckout(deps, "u-1", body)).toEqual({
  ok: true,
  value: { orderId: expect.stringMatching(/^ord-/), sessionId: "chk_1", checkoutUrl: "https://checkout.test/1" },
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx vitest run services/api/test/creditOrders.test.ts services/api/test/dodoPayments.test.ts`

Expected: FAIL because order records and Checkout Session mapping do not exist.

- [ ] **Step 3: Define checkout/order types**

Use:

```ts
export interface CheckoutRequest {
  orderId: string;
  advertiserId: string;
  advertiserName: string;
  advertiserEmail: string;
  billingCountry: string;
  amountMicros: bigint;
  returnUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  sessionId: string;
  checkoutUrl: string;
}
```

`CreditOrderRecord.status` begins as `pending` and can become `checkout_created`, `paid`, `partially_reversed`, `reversed`, `disputed`, `cancelled`, `failed`, or `review_required`.

- [ ] **Step 4: Migrate the Dodo adapter to `POST /checkouts`**

Send `product_cart: [{ product_id, quantity: 1, amount: microsToMinorUnits(amountMicros) }]`, `customer`, `billing_address: { country }`, `metadata: { orderId }`, `return_url`, and `cancel_url`. Parse only `session_id` and non-null `checkout_url`. Preserve explicit test-mode default.

- [ ] **Step 5: Route checkout creation through `creditOrders.ts`**

Replace direct provider invocation in `/v1/portal/checkout`. The route returns order/session/URL, never a payment-derived balance. Add checkout-create rate limiting using the existing rate-limit pattern.

- [ ] **Step 6: Persist credit orders in every production adapter**

Create the `advertiser_credit_orders`, `advertiser_credit_entries`, and `provider_events`
tables and their unique provider-object indexes in `20260826110000_advertiser_credits.sql`.
Task 3 uses the order table; Task 4 adds the event-application SQL function. Implement order
create/get/update/list in memory, Supabase, and Firestore so this task typechecks independently.

- [ ] **Step 7: Run focused and server tests**

Run: `npx vitest run services/api/test/creditOrders.test.ts services/api/test/dodoPayments.test.ts services/api/test/server.test.ts`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit if the overlapping server/payment files can be isolated safely**

```bash
git add supabase/migrations/20260826110000_advertiser_credits.sql services/api/src/creditOrders.ts services/api/src/payments.ts services/api/adapters/dodoPayments.ts services/api/src/store.ts services/api/src/memoryStore.ts services/api/adapters/supabaseRows.ts services/api/adapters/supabaseStore.ts services/api/adapters/firestoreStore.ts services/api/src/server.ts services/api/test/creditOrders.test.ts services/api/test/dodoPayments.test.ts services/api/test/server.test.ts
git diff --cached --check
git commit -m "feat(billing): create Dodo checkout sessions"
```

---

### Task 4: Idempotent purchases, refunds, and disputes

**Files:**
- Modify: `supabase/migrations/20260826110000_advertiser_credits.sql`
- Create: `services/api/src/providerEvents.ts`
- Create: `services/api/src/advertiserCredits.ts`
- Modify: `services/api/src/billing.ts`
- Modify: `services/api/src/funding.ts`
- Modify: `services/api/src/store.ts`
- Modify: `services/api/src/memoryStore.ts`
- Modify: `services/api/adapters/supabaseRows.ts`
- Modify: `services/api/adapters/supabaseStore.ts`
- Modify: `services/api/adapters/firestoreStore.ts`
- Modify: `services/api/src/server.ts`
- Create: `services/api/test/providerEvents.test.ts`
- Create: `services/api/test/advertiserCredits.test.ts`
- Modify: `services/api/test/billing.test.ts`
- Modify: `services/api/test/funding.test.ts`
- Modify: `services/api/test/server.test.ts`

**Interfaces:**
- Produces: `parseProviderEvent(raw): NormalizedProviderEvent | null`.
- Produces: `Store.applyCreditEvent(event): Promise<CreditEventResult>` as the atomic idempotency boundary.
- Produces: `Store.transitionCampaignCommitment(input): Promise<Outcome<CampaignRecord>>` as the atomic activation/reservation boundary.
- Consumes: stored credit order and verified webhook headers/raw body.

- [ ] **Step 1: Write failing normalized-event and state-machine tests**

Use a discriminated union:

```ts
type NormalizedProviderEvent =
  | { type: "purchase"; webhookId: string; paymentId: string; sessionId: string; orderId: string; amountMicros: bigint; currency: "USD" }
  | { type: "refund"; webhookId: string; refundId: string; paymentId: string; amountMicros: bigint }
  | { type: "dispute-opened" | "dispute-final" | "dispute-release"; webhookId: string; disputeId: string; paymentId: string; amountMicros: bigint };
```

Cover duplicate webhook IDs, duplicate provider object IDs under a new webhook ID, partial refund, full refund, dispute open/win/loss, reordered terminal events, refund plus dispute cap, unknown/mismatched order quarantine, negative advertiser suspension, and two concurrent campaign activations attempting to reserve the same available credits.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run services/api/test/providerEvents.test.ts services/api/test/advertiserCredits.test.ts services/api/test/funding.test.ts`

Expected: FAIL because normalized events, credit entries, and atomic application do not exist.

- [ ] **Step 3: Create the advertiser-credit schema**

The migration creates:

- `advertiser_credit_orders`
- `advertiser_credit_entries`
- `provider_events`
- unique keys for webhook ID, payment purchase, refund ID, and dispute transition identity
- signed `amount_micros` and original-payment references
- `apply_advertiser_credit_event(...)` transactional function

Alter advertiser funded balance constraints to allow a negative net balance after external reversals. The transaction updates the order state, inserts one signed credit entry, updates the advertiser projection, and suspends/pauses campaigns when disputed or negative.

Add `transition_campaign_commitment(...)` using advertiser and campaign row locks. It reserves
or releases exactly one campaign's remaining budget and refuses a concurrent activation when
the first activation consumed the available credits.

- [ ] **Step 4: Implement normalized parsing and amount correlation**

Keep signature verification in `billing.ts`. Move event-specific parsing to `providerEvents.ts`. Payment success must match stored order metadata/session/amount/currency. When required fields are absent, call a new `PaymentProvider.getPayment(paymentId)` method and compare authoritative detail before applying.

- [ ] **Step 5: Implement atomic application in every adapter**

Memory and Firestore enforce the same cap: cumulative `refund + dispute_hold - dispute_release` for one payment cannot exceed the original purchase. Supabase enforces it inside SQL under row locks. Unknown valid events store only sanitized identifiers/outcome as `review_required`. Move campaign activation/pause/end reservation updates onto `transitionCampaignCommitment` in all three adapters.

- [ ] **Step 6: Wire all subscribed events through the webhook route**

The webhook route accepts the seven approved events. Invalid signatures return 400. Valid irrelevant events return 200 ignored. Valid matched events return 200 with `credited`, `reversed`, `released`, `duplicate`, or `review-required` outcome.

Add authenticated advertiser credit-order/entry history and admin provider-event review APIs.
Admin review may keep an event quarantined, associate it with a verified order, or suspend the
advertiser; every action writes an audit record. It may not directly fabricate a Dodo event.

- [ ] **Step 7: Run webhook, adapter, and server tests**

Run: `npx vitest run services/api/test/billing.test.ts services/api/test/providerEvents.test.ts services/api/test/advertiserCredits.test.ts services/api/test/funding.test.ts services/api/test/server.test.ts services/api/test/supabaseRows.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit when the financial diff is isolated and reviewed**

```bash
git add supabase/migrations/20260826110000_advertiser_credits.sql services/api/src/providerEvents.ts services/api/src/advertiserCredits.ts services/api/src/billing.ts services/api/src/funding.ts services/api/src/advertisers.ts services/api/src/store.ts services/api/src/memoryStore.ts services/api/adapters/supabaseRows.ts services/api/adapters/supabaseStore.ts services/api/adapters/firestoreStore.ts services/api/src/server.ts services/api/test/providerEvents.test.ts services/api/test/advertiserCredits.test.ts services/api/test/advertisers.test.ts services/api/test/billing.test.ts services/api/test/funding.test.ts services/api/test/server.test.ts services/api/test/supabaseRows.test.ts
git diff --cached --check
git commit -m "feat(billing): reconcile Dodo credit events"
```

---

### Task 5: Public demand API and market configuration

**Files:**
- Create: `services/api/src/demand.ts`
- Modify: `services/api/src/config.ts`
- Modify: `services/api/src/admin.ts`
- Modify: `services/api/src/store.ts`
- Modify: `services/api/src/memoryStore.ts`
- Modify: `services/api/adapters/supabaseStore.ts`
- Modify: `services/api/adapters/firestoreStore.ts`
- Modify: `services/api/src/server.ts`
- Create: `services/api/test/demand.test.ts`
- Modify: `services/api/test/config.test.ts`
- Modify: `services/api/test/admin.test.ts`
- Modify: `services/api/test/server.test.ts`

**Interfaces:**
- Produces: `readDemand(store, now): Promise<DemandView>`.
- Produces: `GET /v1/demand` with `Cache-Control: public, max-age=60, stale-while-revalidate=30`.
- Produces: admin market read/update using existing admin audit infrastructure.

- [ ] **Step 1: Write failing aggregate/redaction tests**

```ts
expect(await readDemand(store, NOW)).toEqual({
  clearingCpmMicros: "5010000",
  activeCampaigns: 2,
  demandLevel: "medium",
  floorCpmMicros: "3000000",
  asOf: NOW,
});
```

Assert 0-1=`low`, 2-4=`medium`, 5+=`high`; exclude paused, unfunded, negative/disputed, and no-approved-creative campaigns. Assert the JSON contains no advertiser ID, campaign ID, bid list, budget, or tags.

- [ ] **Step 2: Run demand tests and verify failure**

Run: `npx vitest run services/api/test/demand.test.ts services/api/test/server.test.ts`

Expected: FAIL because demand APIs and aggregate store query do not exist.

- [ ] **Step 3: Implement the aggregate and public route**

Add a store query returning only eligible market candidates/counts. Reuse the auction clearing helper for the indicative price. Apply the existing public rate limiter and 60-second cache headers.

- [ ] **Step 4: Add audited admin market controls**

Admin may edit floor CPM and revenue share within server bounds. Floor and share updates write before/after audit values and affect future serve records only. The auction increment remains fixed at $0.01 in this release.

- [ ] **Step 5: Run demand/config/admin tests**

Run: `npx vitest run services/api/test/demand.test.ts services/api/test/config.test.ts services/api/test/admin.test.ts services/api/test/server.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit when safe**

```bash
git add services/api/src/demand.ts services/api/src/config.ts services/api/src/admin.ts services/api/src/store.ts services/api/src/memoryStore.ts services/api/adapters/supabaseStore.ts services/api/adapters/firestoreStore.ts services/api/src/server.ts services/api/test/demand.test.ts services/api/test/config.test.ts services/api/test/admin.test.ts services/api/test/server.test.ts
git diff --cached --check
git commit -m "feat(ads): publish live market demand"
```

---

### Task 6: Encrypted payout corridors and profiles

**Files:**
- Create: `supabase/migrations/20260826120000_payout_corridors_encryption.sql`
- Create: `services/api/src/payoutCorridors.ts`
- Create: `services/api/src/payoutCrypto.ts`
- Create: `scripts/migrate-payout-encryption.mjs`
- Modify: `services/api/src/contract.ts`
- Modify: `services/api/src/store.ts`
- Modify: `services/api/src/memoryStore.ts`
- Modify: `services/api/adapters/supabaseRows.ts`
- Modify: `services/api/adapters/supabaseStore.ts`
- Modify: `services/api/adapters/firestoreStore.ts`
- Modify: `services/api/src/withdrawals.ts`
- Create: `services/api/test/payoutCorridors.test.ts`
- Create: `services/api/test/payoutCrypto.test.ts`
- Create: `services/api/test/payoutMigration.test.ts`
- Modify: `services/api/test/withdrawals.test.ts`
- Modify: `services/api/test/payoutRoutes.test.ts`

**Interfaces:**
- Produces: `PayoutCorridorRecord`, `PayoutFieldKind`, `validateDestination(corridor, fields)`.
- Produces: `encryptDestination(key, destination): EncryptedDestination` and `decryptDestination(key, encrypted): PayoutDestination`.
- Consumes: `PAYOUT_ENCRYPTION_KEY`, a base64-encoded 32-byte key.

- [ ] **Step 1: Write failing corridor validation tests**

Cover enabled/disabled country-currency pairs and controlled validators for IBAN, BIC, account/routing, sort code, IFSC, BSB, bank/branch code, CLABE, bank name, address, email, phone, and bounded supplemental text. Reject arbitrary field names, missing required fields, executable regex configuration, and corridors not enabled.

- [ ] **Step 2: Write failing crypto tests**

```ts
const encrypted = encryptDestination(KEY, destination);
expect(JSON.stringify(encrypted)).not.toContain(destination.accountNumber);
expect(decryptDestination(KEY, encrypted)).toEqual(destination);
expect(() => decryptDestination(KEY, tamper(encrypted))).toThrow("payout destination authentication failed");
```

Also test random nonces, invalid key length, version mismatch, masking, and missing-key fail-closed behavior.

- [ ] **Step 3: Run tests and verify failure**

Run: `npx vitest run services/api/test/payoutCorridors.test.ts services/api/test/payoutCrypto.test.ts`

Expected: FAIL because the corridor and encryption modules do not exist.

- [ ] **Step 4: Implement pure corridor and AES-256-GCM modules**

Use Node `createCipheriv("aes-256-gcm", key, nonce)` with a fresh 12-byte nonce and authentication tag. Store a versioned JSON payload. Never log the destination or decrypted payload.

- [ ] **Step 5: Add schema and provider-neutral seed data**

Create `payout_corridors` with country, currency, enabled, required field kinds, help/source note, verified timestamp, and admin audit fields. Add ciphertext/nonce/tag/version plus masked summary fields beside the legacy plaintext columns. `scripts/migrate-payout-encryption.mjs` reads rows through the authenticated service adapter, encrypts each profile and withdrawal snapshot, verifies decryption and masking, then clears the legacy plaintext columns for only the verified row. The script refuses to run without `PAYOUT_ENCRYPTION_KEY` and supports a dry-run flag. Until a row is migrated, payout reads fail closed and admin health shows the migration requirement.

Seed the current documented India outbound corridors as disabled-by-default rows requiring operator review. Do not seed pay-by-email.

- [ ] **Step 6: Integrate profile save/read with encryption**

The server loads the selected corridor, validates exact structured fields, encrypts the destination, and returns only a masked profile view. Owner/admin detail endpoints decrypt after authorization and write an audit record.

Add admin corridor list/create/update routes. Only controlled field kinds are accepted; changes
store source note, verification timestamp, actor, and before/after audit values.

- [ ] **Step 7: Run corridor, crypto, withdrawal, and route tests**

Run: `npx vitest run services/api/test/payoutCorridors.test.ts services/api/test/payoutCrypto.test.ts services/api/test/payoutMigration.test.ts services/api/test/withdrawals.test.ts services/api/test/payoutRoutes.test.ts services/api/test/supabaseRows.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit when safe**

```bash
git add supabase/migrations/20260826120000_payout_corridors_encryption.sql services/api/src/payoutCorridors.ts services/api/src/payoutCrypto.ts scripts/migrate-payout-encryption.mjs services/api/src/contract.ts services/api/src/store.ts services/api/src/memoryStore.ts services/api/adapters/supabaseRows.ts services/api/adapters/supabaseStore.ts services/api/adapters/firestoreStore.ts services/api/src/withdrawals.ts services/api/test/payoutCorridors.test.ts services/api/test/payoutCrypto.test.ts services/api/test/payoutMigration.test.ts services/api/test/withdrawals.test.ts services/api/test/payoutRoutes.test.ts
git diff --cached --check
git commit -m "feat(payouts): encrypt corridor-specific bank details"
```

---

### Task 7: Atomic withdrawal approval and payment lifecycle

**Files:**
- Create: `supabase/migrations/20260826130000_withdrawal_lifecycle.sql`
- Modify: `services/api/src/ledger.ts`
- Modify: `services/api/src/store.ts`
- Modify: `services/api/src/memoryStore.ts`
- Modify: `services/api/adapters/supabaseRows.ts`
- Modify: `services/api/adapters/supabaseStore.ts`
- Modify: `services/api/adapters/firestoreStore.ts`
- Modify: `services/api/src/withdrawals.ts`
- Modify: `services/api/src/server.ts`
- Modify: `services/api/test/ledger.test.ts`
- Modify: `services/api/test/withdrawals.test.ts`
- Modify: `services/api/test/payoutRoutes.test.ts`

**Interfaces:**
- Produces: statuses `requested | approved | paid | rejected | failed | cancelled`.
- Produces: atomic store methods `requestWithdrawal`, `transitionWithdrawal`.
- Produces routes `/approve`, `/paid`, `/reject`, and `/failed`.

- [ ] **Step 1: Update failing eligibility/state tests for the approved rules**

Change the minimum to `50_000_000n`; require a current enabled corridor and complete encrypted profile. Test exact transition graph, user cancellation only from requested, no second requested/approved payout, and whole-cent amounts.

For paid transitions require:

```ts
interface PaidEvidence {
  provider: string;
  providerRef: string;
  sourceAmount: string;
  sourceCurrency: string;
  recipientAmount: string;
  recipientCurrency: string;
  exchangeRate: string | null;
  providerCalculatedRate: boolean;
  feeAmount: string;
  feeCurrency: string;
}
```

- [ ] **Step 2: Run withdrawal tests and verify failure**

Run: `npx vitest run services/api/test/ledger.test.ts services/api/test/withdrawals.test.ts services/api/test/payoutRoutes.test.ts`

Expected: FAIL because the old minimum/status/action shapes are still present.

- [ ] **Step 3: Add transactional lifecycle persistence**

The SQL migration maps `pending` to `requested`, expands the status constraint, adds payment-evidence fields, and creates transactional request/transition functions. Firestore uses transactions. Memory applies row and ledger/balance mutations as one operation.

Approval changes status only. Paid consumes the pending hold. Rejected/failed/cancelled append the existing compensating failure ledger kind and return the amount to available. A failed transition is allowed only after approval.

- [ ] **Step 4: Implement handlers and routes**

Expose admin approve, paid, reject, and failed actions with strict body parsers and audit records. Keep temporary backward compatibility for the old `/paid` and `/reject` callers only where request shapes remain safe; update all web callers in Task 9.

- [ ] **Step 5: Run lifecycle and server tests**

Run: `npx vitest run services/api/test/ledger.test.ts services/api/test/withdrawals.test.ts services/api/test/payoutRoutes.test.ts services/api/test/server.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit when safe**

```bash
git add supabase/migrations/20260826130000_withdrawal_lifecycle.sql services/api/src/ledger.ts services/api/src/store.ts services/api/src/memoryStore.ts services/api/adapters/supabaseRows.ts services/api/adapters/supabaseStore.ts services/api/adapters/firestoreStore.ts services/api/src/withdrawals.ts services/api/src/server.ts services/api/test/ledger.test.ts services/api/test/withdrawals.test.ts services/api/test/payoutRoutes.test.ts
git diff --cached --check
git commit -m "feat(payouts): add manual approval lifecycle"
```

---

### Task 8: Public market and advertiser credit UI

**Files:**
- Read first: relevant Next.js docs under `apps/web/node_modules/next/dist/docs/`
- Create: `apps/web/src/components/MarketDemand.tsx`
- Create: `apps/web/src/lib/demand.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/advertise/page.tsx`
- Modify: `apps/web/src/app/portal/billing/page.tsx`
- Modify: `apps/web/src/app/portal/campaigns/new/page.tsx`
- Modify: `apps/web/src/app/portal/campaigns/[id]/page.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/site.ts`
- Modify: `apps/web/src/lib/schema.ts`
- Modify: `apps/web/src/app/llms-full.txt/route.ts`
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/test/demand.test.tsx`
- Create: `apps/web/test/credits.test.tsx`

**Interfaces:**
- Consumes: public `DemandView`, advertiser credit/order history, campaign max/average clearing CPM.
- Produces: fixed-size accessible market panel and auction-aware advertiser copy.

- [ ] **Step 1: Read the local Next.js guidance relevant to server/client data fetching and route caching**

Locate the exact Next.js 16 docs with `rg -n "fetch.*cache|client component|useEffect" apps/web/node_modules/next/dist/docs` and read the matched guides before choosing the component boundary.

- [ ] **Step 2: Write failing market-panel tests**

Test current snapshot rendering, 60-second refresh timer, snapshot age, low/medium/high label, CTA, and fallback `$3.00 CPM / Live market unavailable` without layout-dependent assertions.

- [ ] **Step 3: Run the web tests and verify failure**

Run: `npx vitest run apps/web/test/demand.test.tsx apps/web/test/credits.test.tsx`

Expected: FAIL because the market/credit components and API types do not exist.

- [ ] **Step 4: Implement demand fetching and the landing panel**

Reserve stable height, use `aria-live="polite"` only for refreshed values, respect reduced motion, and do not expose individual bids. Replace fixed $8 CPM and fixed per-view marketing claims across page, advertise page, FAQ/schema, and LLM text with $3 floor/50% auction-aware wording.

- [ ] **Step 5: Update advertiser billing and campaign screens**

Billing labels balances as advertising credits and displays purchased, available, committed, spent, refunded, disputed, and order history. Campaign fields say “Maximum CPM bid”, default to at least $3, show indicative clearing CPM, and explain the final charge may be lower.

- [ ] **Step 6: Run web tests, typecheck, and build**

Run: `npx vitest run apps/web/test/demand.test.tsx apps/web/test/credits.test.tsx apps/web/test/money.test.ts`

Run: `npm --prefix apps/web run typecheck`

Run: `npm --prefix apps/web run build`

Expected: PASS.

- [ ] **Step 7: Commit if pre-existing web redesign changes can be separated**

Stage only reviewed hunks/files; skip the commit if doing so would claim unrelated redesign work.

---

### Task 9: Developer payout and admin operations UI

**Files:**
- Modify: `apps/web/src/components/PayoutPanel.tsx`
- Modify: `apps/web/src/lib/payoutOptions.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/app/admin/money/page.tsx`
- Modify: `apps/web/src/app/admin/_sections/Withdrawals.tsx`
- Create: `apps/web/src/app/admin/_sections/CreditEvents.tsx`
- Create: `apps/web/src/app/admin/_sections/PayoutCorridors.tsx`
- Create: `apps/web/src/app/admin/_sections/Market.tsx`
- Create: `apps/web/src/app/admin/market/page.tsx`
- Modify: `apps/web/src/components/AdminShell.tsx`
- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/test/payouts.test.tsx`
- Create: `apps/web/test/adminMoney.test.tsx`

**Interfaces:**
- Consumes: masked payout view, corridor list/schema, decrypted admin detail endpoint, withdrawal actions, credit reviews, demand/market config.
- Produces: dynamic bank form, requested/approved/payment evidence flow, masked-by-default admin review, and admin navigation badges.

- [ ] **Step 1: Write failing payout/admin interaction tests**

Cover country then currency selection, dynamic required fields, disabled corridor explanation, masked saved profile, $50 checklist, requested/approved/paid status labels, approve button, paid evidence requirements, reject/fail reasons, and admin detail expansion before decryption.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run apps/web/test/payouts.test.tsx apps/web/test/adminMoney.test.tsx`

Expected: FAIL against the existing wise-email/free-text/pending-only UI.

- [ ] **Step 3: Implement the developer payout form**

Remove the wise-email path. Fetch enabled corridors, render controlled structured fields, save encrypted profile through the server, display only masked summaries, and keep every eligibility rule visible. Disable cancellation after approval.

- [ ] **Step 4: Implement the admin Money and Market areas**

Money tabs: Payouts, Credit Purchases, Refunds & Disputes, Corridors, Audit. Payout details remain masked until expanded; expanded data has copy controls and no “send money” claim. Record approve and paid evidence as distinct actions.

Market shows floor, 50% share, current clearing CPM, active campaigns, demand level, and audited future-only settings. Update navigation grouping and badges without removing existing Content/People/Tools functionality.

- [ ] **Step 5: Run web tests, accessibility-relevant assertions, typecheck, and build**

Run: `npx vitest run apps/web/test/payouts.test.tsx apps/web/test/adminMoney.test.tsx`

Run: `npm --prefix apps/web run typecheck`

Run: `npm --prefix apps/web run build`

Expected: PASS with no missing accessible labels or unmasked sensitive summaries.

- [ ] **Step 6: Commit if the staged UI diff contains only this feature**

Inspect `git diff --cached` before committing. Skip the commit for files whose existing admin redesign changes cannot be separated safely.

---

### Task 10: Setup guide, privacy copy, migrations, and release verification

**Files:**
- Modify: `SETUP.md`
- Modify: `README.md`
- Modify: `docs/DEPLOYING.md`
- Modify: `apps/web/.env.example`
- Modify: `apps/web/wrangler.jsonc`
- Modify: `apps/web/src/app/privacy/page.tsx`
- Modify: `apps/web/src/app/terms/page.tsx`
- Modify: `scripts/smoke.mjs`
- Modify: `scripts/smoke-ads.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: final environment names, migrations, routes, and UI flows.
- Produces: a complete operator runbook and repeatable verification commands.

- [ ] **Step 1: Write documentation assertions into smoke tests first**

Extend smoke coverage to assert `/v1/demand`, Dodo checkout response shape, duplicate webhook safety, refund/dispute freeze behavior, $50 payout eligibility, approval then paid, corridor disable behavior, and absence of full bank details from list responses.

- [ ] **Step 2: Run smoke tests and verify the new assertions fail before docs/config changes are treated as complete**

Run: `npm run smoke:all`

Expected: FAIL on at least the new demand/credit/payout assertions until all prior tasks are integrated.

- [ ] **Step 3: Rewrite the Dodo setup section to the current flow**

Document, in order:

- revoke the credential exposed during design
- create a test-mode dynamically priced one-time USD credit product
- create the webhook endpoint with all seven approved event types
- set `DODO_API_KEY`, `DODO_PRODUCT_ID`, and `DODO_WEBHOOK_SECRET` using interactive `wrangler secret put`
- generate a 32-byte key and set `PAYOUT_ENCRYPTION_KEY` interactively
- apply each new migration in timestamp order
- send signed dashboard examples
- perform a test checkout, refund, dispute, and manual payout lifecycle
- create separate live resources and secrets only after test verification

Do not include any real credential value. Keep unset Dodo mode equal to test mode.

- [ ] **Step 4: Correct privacy/terms/provider language**

State that Dodo processes advertiser checkout data, ADCode stores encrypted payout-bank data, and an operator manually supplies required details to the chosen transfer provider. Retain the explicit India personal-Wise restriction and legal review gate; do not label it compliant.

- [ ] **Step 5: Run the complete verification suite**

Run, in order:

```bash
npm run typecheck
npm run firewall
npm run test
npm run smoke:all
npm run web:build
npm run desktop:build
```

Expected: every command exits 0. If the Firestore emulator remains unavailable because the machine lacks its documented JDK prerequisite, report that test separately rather than claiming it ran.

- [ ] **Step 6: Perform secret and sensitive-data scans**

Run:

```bash
rg -n --hidden -S "DODO_API_KEY=|whsec_|PAYOUT_ENCRYPTION_KEY=|account_number\"\s*:|bank_details\"\s*:" . --glob '!node_modules/**' --glob '!.git/**' --glob '!docs/superpowers/**'
git diff --check
```

Expected: no credential values, no fixture accidentally containing real bank details, and no whitespace errors.

- [ ] **Step 7: Commit documentation-only files if they are separable**

```bash
git add SETUP.md README.md docs/DEPLOYING.md apps/web/.env.example apps/web/wrangler.jsonc apps/web/src/app/privacy/page.tsx apps/web/src/app/terms/page.tsx scripts/smoke.mjs scripts/smoke-ads.mjs package.json
git diff --cached --check
git commit -m "docs(setup): configure credits and manual payouts"
```

- [ ] **Step 8: Final review against the specification**

Map every confirmed decision in spec section 2 to a passing test, route, UI, or documented operator step. Confirm the app contains no automatic payout call, no fixed $8 marketing promise, no receipt calculation from mutable CPM config, no pay-by-email path for INR funding, and no plaintext bank destination persistence.
