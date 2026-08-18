# services/api

The real serving backend. One Node 24 service, no build step, deployed to Cloud Run.

Design: `docs/specs/2026-08-18-platform-foundation-design.md`
Plan: `docs/plans/2026-08-18-platform-foundation.md`

## What it is

The four contract endpoints from the ad-core design implemented against real storage,
plus two additive ones for money history.

| Endpoint | Auth | |
|---|---|---|
| `POST /v1/serve` | user | Targets on tags, ranks by CPM, writes a serve record |
| `POST /v1/receipts` | user | Idempotent by `receiptId`; pays only what it believes |
| `GET /v1/balance` | user | Decimal strings, never numbers |
| `GET /v1/config` | user | Kill switch, caps, server-computed projections |
| `GET /v1/ledger` | user | The caller's own money history, cursor-paginated |
| `GET /v1/admin/users/{uid}/ledger` | admin | Any user's history. Writes an audit row |

## Two rules that are not style preferences

**Nothing here imports `packages/`.** The wire types are hand-written a third time, next
to the client's and the mock's. A server that shares the client's definitions cannot catch
a contract mismatch. `npm run firewall` fails on any import from `packages/`.

**Money never touches a JS `number`.** bigint in the service, int64 in Firestore, decimal
string on the wire. Above 2^53 a JS number has already lost precision.

## Running the tests

```
npm run verify          # typecheck + firewall + everything below
npm test                # unit + conformance, no cloud project needed
npm run test:emulator   # the Firestore adapter, needs firebase-tools AND Java
```

The conformance suite in `test/conformance/` runs the same assertions against this service
and against `mock-server`. If the two ever disagree about the contract, a test fails.

**`npm run test:emulator` requires a JDK on your PATH** — the Firestore emulator is a Java
process. Without it the adapter in `adapters/firestoreStore.ts` is typechecked but not
executed, so treat it as unverified until that suite has run at least once.

## Deploying

Not yet done, and it needs credentials rather than code:

1. Create the GCP project and enable Firestore in Native mode.
2. Create the Firebase project on top of it and enable Anonymous auth.
3. Seed `config/serving` with `defaultCpmMicros`, `revSharePercent`, `spendShardCount`,
   `serveTtlMs`, `caps`, `killSwitch`.
4. Grant an admin their claim: `getAuth().setCustomUserClaims(uid, { admin: true })`.
5. `gcloud run deploy` with `services/api/Dockerfile`.
6. Point the client at it — `baseUrl` is injected into the ads client, so this is config.

Set a TTL policy on `serves.expiresAt` so expired serve records are reaped automatically.
