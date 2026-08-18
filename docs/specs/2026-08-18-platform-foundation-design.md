# Platform foundation design — the real backend

**Date:** 2026-08-18
**Status:** approved for implementation (design approved in chat; spec awaiting review)
**Source brief:** `2026-08-15-scratch-ide-build-prompt.md` §8, and the serving contract in
`docs/specs/2026-08-16-ad-core-design.md` §7
**Scope:** `services/api` — auth, the four contract endpoints implemented for real, the
campaign/creative data model, and the money ledger. No UI of any kind.

---

## 1. Why this slice

`packages/ads` is finished and has 194 passing tests. `mock-server` implements the serving
contract and has 21 more. What does not exist is a server that is real: the README is blunt
about it — *"Nothing on the advertiser side exists yet: no backend, portal, landing page, or
payments."*

Everything else the product needs — the advertiser portal, the user dashboard, the admin
panel, bug intake, blog storage — is a **UI over this API and this data model**. Six
sub-projects were identified during brainstorming; five of them are blocked on this one.
Building it first means building it once.

This slice is also unusually low-risk to specify, because the client already dictates the
answer. The contract is written (§7 of the ad-core design), the wire types are pinned by
`mock-server/src/contract.ts`, and the acceptance criteria exist as executable tests. This
spec mostly has to avoid contradicting things that are already proven.

**Non-goals for this slice:** every UI, Stripe/Dodo/Wise integration, KYC and tax handling,
payout execution, the marketing site, the bug report button, and the admin panel's front end.
This slice builds what those consume.

---

## 2. Decisions taken during brainstorming

| # | Question | Decision |
|---|---|---|
| 1 | Which sub-project first | Platform foundation — it unblocks four of the other five |
| 2 | Runtime | Cloud Run, one Node 24 service, no build step. Not Cloud Functions: cold starts land on the serve path, which is an IDE overlay |
| 3 | Pricing model | Flat CPM with a fixed revenue share, both in server config |
| 4 | Scope line vs. the portal | Campaigns, creatives and budgets are in; self-serve signup and payments are out. Campaigns are created by admin/CLI in v1 |
| 5 | Role storage | Firebase custom claims, not a Firestore document — authorising a request costs zero reads |
| 6 | Ban storage | Firestore `users/{uid}.status` — must bite immediately, not on next token refresh |
| 7 | Money history | The ledger is a user-facing product surface, not an internal audit trail. Visible to both the owning user and to admins |
| 8 | Corrections | Reversals, never edits. History is append-only and permanent |
| 9 | Payment providers | Dodo Payments for money in, Wise for money out. Recorded now, integrated later; withdrawal entries are shaped to fit |

---

## 3. Deviations and things deliberately inherited

**D1 — The real service does not import client types.** Spec §10 of the ad-core design
forbids `mock-server` from importing `packages/ads`, because a mock sharing the client's
definitions cannot catch a contract mismatch. The same argument applies with more force to
production: if the server imports the client's types, a contract change propagates silently
and no test fails. `services/api/src/contract.ts` is therefore a third hand-written copy of
the wire shapes, and a new dependency-cruiser rule `api-must-not-import-client` enforces it.

**D2 — Firestore lives behind a port.** Following ad-core decision #3, which put Firebase
auth behind an injected `HttpTransport` so it could be built and tested with no Firebase
project in existence, all persistence goes through a `Store` interface. An in-memory
implementation backs the unit and conformance suites; the Firestore adapter is a thin,
separately-tested translation layer. This is what makes the slice buildable before a GCP
account exists, and it keeps CI free of cloud credentials permanently.

**D3 — The conformance suite is lifted out of `mock-server`.** Its 21 contract tests become
a suite parameterised by base URL, run against both the mock and the real service. Drift
between the two implementations becomes a test failure. This is the highest-value item in
the slice and it is nearly free, because the tests already exist.

**D4 — Money is BigInt in the service, int64 in Firestore, decimal string on the wire.**
Never a JS number at any point. The contract already mandates the string form because JSON
has no bigint; this keeps the internal path equally honest. `validation.ts` bounds values to
int64, so the service must too.

---

## 4. Architecture

```
services/api/
  src/
    contract.ts     hand-written wire types; imports nothing from packages/
    money.ts        BigInt micros arithmetic, pure
    ledger.ts       entry construction and balance folding, pure
    targeting.ts    tag intersection and campaign ranking, pure
    plausibility.ts receipt trust checks, pure
    store.ts        the Store port — every persistence operation
    auth.ts         token verification, role and ban gate
    serve.ts        POST /v1/serve
    receipts.ts     POST /v1/receipts
    balance.ts      GET /v1/balance, GET /v1/ledger
    config.ts       GET /v1/config
    admin.ts        admin-only routes, each one audited
    server.ts       routing and error mapping
  adapters/
    firestoreStore.ts   the Store port against Firestore
    firebaseAuth.ts     the TokenVerifier port against Firebase Admin
  Dockerfile
test/
  conformance/    lifted from mock-server, runs against any base URL
```

The pure modules carry the logic worth getting right, exactly as `packages/ads` does. A bug
in `money.ts` or `plausibility.ts` is expensive; a bug in `server.ts` routing is obvious. The
split follows the existing house style rather than inventing a new one.

### 4.1 Ports

| Port | Purpose | Test double |
|---|---|---|
| `Store` | All persistence | In-memory map-backed store |
| `TokenVerifier` | Firebase ID token to `{ uid, claims }` | Stub returning fixed identities |
| `Clock` | Time, for TTLs and rate windows | Fixed clock |
| `IdGen` | Ledger and serve record ids | Deterministic counter |

Every one of these mirrors a port that already exists in `packages/ads/src/types.ts`, so the
testing idiom is one the repo already uses.

---

## 5. Data model

| Collection | Key fields | Notes |
|---|---|---|
| `users/{uid}` | `status`, `createdAt`, `linkedAt` | `status: active` or `banned`, checked every request |
| `advertisers/{id}` | `name`, `ownerUids[]`, `status` | |
| `campaigns/{id}` | `advertiserId`, `cpmMicros`, `budgetMicros`, `spentMicros`, `targetTags[]`, `status` | `targetTags` constrained to the closed 45-tag vocabulary |
| `campaigns/{id}/spendShards/{n}` | `micros` | Sharded counter; see §5.2 |
| `creatives/{id}` | `campaignId`, `advertiser`, `headline`, `body`, `clickUrl`, `logoLight`, `logoDark`, `status` | Validated at write time against client limits; see §5.1 |
| `serves/{id}` | `uid`, `creativeId`, `servedAt`, `expiresAt` | TTL-deleted. Exists so receipts can be verified |
| `receipts/{receiptId}` | `uid`, `creativeId`, `outcome`, `creditedMicros` | **Doc id is the `receiptId`** — idempotency by create-if-absent |
| `ledger/{id}` | `uid`, `kind`, `micros`, `refId`, `createdAt`, `description` | Append-only, never updated or deleted |
| `balances/{uid}` | `availableMicros`, `lifetimeMicros`, `pendingWithdrawalMicros` | Derived cache; §6.2 |
| `adminAudit/{id}` | `adminUid`, `action`, `subjectUid`, `at` | Written on every admin read or write of user data |
| `config/serving` | `killSwitch`, `caps`, `defaultCpmMicros`, `revSharePercent`, `spendShardCount` | Rate changes ship without a client release |

### 5.1 Creatives are authored against the client's limits

`packages/ads/src/validation.ts` hard-rejects a creative whose advertiser exceeds 40
characters, headline 80, body 160, `creativeId` falls outside `[A-Za-z0-9_-]{1,64}`, or URL
exceeds 2048 — and rejects a response carrying more than 50 creatives. Creative writes
validate against those same constants at authoring time, so an over-long headline fails when
it is typed rather than being silently dropped by every client in the field.

The service's copy of these limits is deliberate duplication under D1, and the conformance
suite asserts the two agree.

### 5.2 Budget contention

A popular campaign takes one write per serve against a single document, and Firestore
sustains roughly one write per second per document. v1 uses sharded counters:
`spendShardCount` sub-documents written round-robin, summed on read. The count lives in
config so it can be raised without a deploy. This is called out because it degrades under
load rather than in testing, which is the failure mode that reaches production.

---

## 6. The money ledger

### 6.1 Entry kinds

| `kind` | Effect | Raised by |
|---|---|---|
| `impression` | credit | Verified receipt, outcome `impression` |
| `click` | credit | Verified receipt, outcome `click` |
| `reversal` | debit | Fraud clawback. `refId` points at the reversed entry |
| `adjustment` | either | Admin correction. Requires `reason` and the acting `adminUid` |
| `withdrawal_requested` | available to pending | User cash-out request |
| `withdrawal_paid` | clears pending | Payout confirmed by provider |
| `withdrawal_failed` | pending to available | Payout rejected |

Withdrawal entries carry `providerRef` and `currency` from the outset, shaped for Wise, so
that adding payout execution later is additive and touches no historical rows.

### 6.2 Corrections are never edits

Nothing in `ledger` is ever updated or deleted. A clawback appends a `reversal` referencing
the original entry, which remains visible forever. A user who sees a deduction can see
exactly what it reversed and when.

This is a structural choice, not a stylistic one. An admin who can edit history is an admin
who can steal, and an auditable system has to make that impossible rather than merely
discouraged.

`balances/{uid}` is a derived cache written in the same transaction as the append. The
invariant — **a user's balance equals the sum of their ledger entries** — is asserted inside
that transaction and re-verified by a nightly reconciliation job that alerts on drift. Where
the cache and the ledger disagree, the ledger wins and the cache is rebuilt.

---

## 7. Endpoints

The four contract endpoints are unchanged, so every existing client and mock test stays
valid. Two are added; additive changes cannot break a client that does not call them.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /v1/serve` | user | Unchanged from §7 of the ad-core design |
| `POST /v1/receipts` | user | Unchanged; idempotent by `receiptId` |
| `GET /v1/balance` | user | Unchanged |
| `GET /v1/config` | user | Unchanged; may only tighten |
| `GET /v1/ledger?cursor=&limit=` | user | **New.** The caller's own history, newest first, cursor-paginated |
| `GET /v1/admin/users/{uid}/ledger` | admin claim | **New.** Any user's history. Writes an `adminAudit` row |

Ledger rows carry a server-resolved human-readable `description` ("Ad from Vercel, 4.2s"),
because a UI should not have to reverse-engineer meaning from an enum, and because the same
string must appear identically in the user's dashboard and the admin's view.

Identity always comes from the token, never a path or body parameter — a user's history is
selected by the verified UID, so there is no request a client can craft to read another
user's money.

---

## 8. Request flows

**`POST /v1/serve`** — verify token, reject `banned`, reject if `killSwitch`, select
campaigns whose `targetTags` intersect the request tags with status active and budget
remaining, rank by CPM, write one `serves` record per returned creative with a short TTL,
return at most `count` capped at 50.

**`POST /v1/receipts`** — verify token, then per receipt: create `receipts/{receiptId}`
create-if-absent so a replay is a no-op that still acks; require a matching unexpired
`serves` record for **this uid and this creative**; require `dwellMs` within plausible
bounds; compute the credit per §8.1; then in one transaction
append the ledger entry, update the balance cache, and increment the campaign spend shard;
then ack.

A receipt with no matching serve record earns nothing and is recorded as a fraud signal.
This is the entire reason `serves` exists: without it, `POST /v1/receipts` is an endpoint
where anyone holding a token mints money.

**`GET /v1/config`** — kill switch, caps, and `projections` computed from live inventory CPM
against each cadence preset. The service never emits caps looser than the shipped defaults.

### 8.1 What one impression is worth

CPM is cost per mille, and `revSharePercent` is a percentage, so both divisions are explicit:

```
advertiserCostMicros = cpmMicros / 1000n
userCreditMicros     = advertiserCostMicros * revSharePercent / 100n
```

Both are BigInt divisions and therefore **truncate**. Truncation is the specified behaviour,
not an accident of the type: it rounds in the house's favour by at most one micro
(one millionth of a currency unit) per impression, and it is deterministic, which matters
more than the rounding direction because the reconciliation job in §6.2 recomputes these
values and compares them exactly. A rounding rule that depends on floating point would make
that comparison unreliable.

The advertiser is charged `advertiserCostMicros` and the user is credited
`userCreditMicros`; the difference is the platform's margin and is not a ledger entry
against any user.

A click carries the same credit as an impression in v1. Differential click pricing is a
pricing decision, not an architectural one, and can be added by extending the config without
touching the ledger.

---

## 9. Abuse and trust

Anonymous UIDs are free and unlimited to create, so identity is not a defence and is not
treated as one. The defence is that **money is only ever created by a receipt matching a
serve the server itself issued**, which caps an attacker at the same ad rate limit an honest
user has.

Layered on that: per-UID rate ceilings on every endpoint, dwell-time bounds, and immediate
ban enforcement via `users/{uid}.status` rather than waiting on a token refresh.

Admin power is itself audited. Every admin read or write of another user's data writes an
`adminAudit` row naming the admin, the action, the subject, and the time.

---

## 10. Testing

- **Conformance (D3)** — the lifted suite runs against the in-memory-backed real service and
  against `mock-server`. Both must agree.
- **Property tests** on `money.ts` and `ledger.ts` using the repo's existing `fast-check`:
  the balance invariant survives arbitrary sequences of credits, reversals and withdrawal
  holds; micros arithmetic never overflows int64 undetected.
- **Unit tests** on the pure modules — `targeting.ts`, `plausibility.ts` — with fakes.
- **Adapter tests** for `firestoreStore.ts` against the Firestore emulator, the only tests
  needing external tooling, and excluded from the default `npm test` run.
- **Firewall** — `api-must-not-import-client` added to `.dependency-cruiser.cjs`.

CI requires no cloud project, no service account and no billing, by construction.

---

## 11. Verification

`npm run verify` (typecheck + firewall + tests) must pass with the new service included.
The conformance suite must pass against both implementations. `npm run smoke` is unaffected;
this slice ships no UI.

---

## 12. Carried forward

Not in this slice, in dependency order: the bug report button and its intake; the advertiser
portal and user dashboard over these endpoints; the admin panel over the admin routes; the
marketing site with the blog; distribution and autoupdate. Dodo Payments (money in) and Wise
(money out) integrate at the portal and cash-out stages respectively, against ledger entry
kinds this slice already defines.
