# Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `services/api` — the real backend behind ADCode's ad serving contract, with auth, campaigns, receipts, and an append-only money ledger readable by both the owning user and an admin.

**Architecture:** One Node 24 service, no build step, deployed to Cloud Run. Pure logic modules (`money`, `ledger`, `targeting`, `plausibility`) carry the expensive-to-get-wrong behaviour and are tested in milliseconds with no I/O. All persistence goes through a `Store` port with an in-memory implementation for tests and a Firestore adapter for production, so the entire slice is buildable and verifiable before a GCP project exists.

**Tech Stack:** Node 24, TypeScript 5.9 (strict, `verbatimModuleSyntax`, `allowImportingTsExtensions`), Vitest 4, fast-check 4, dependency-cruiser 18. `firebase-admin` appears only in `services/api/adapters/`, never in `src/`.

**Spec:** `docs/specs/2026-08-18-platform-foundation-design.md`

## Global Constraints

These apply to every task. Copied from the spec and the repo's existing configuration.

- **Node >= 24, npm >= 11.** No build step for the service; Node runs the TypeScript directly, as `mock-server` does.
- **No imports from `packages/` anywhere under `services/api/`.** Spec D1. Enforced by the `api-must-not-import-client` dependency-cruiser rule added in Task 2. This is deliberate duplication, not an oversight to clean up later.
- **Relative imports carry the `.ts` extension** — `import { x } from "./money.ts"`. The repo sets `allowImportingTsExtensions` and `verbatimModuleSyntax`; extensionless relative imports will not typecheck.
- **Money is `bigint` in the service, `int64` in Firestore, decimal string on the wire.** Spec D4. A JS `number` must never hold a micros value at any point. `packages/ads/src/validation.ts` bounds wire values to int64: `-9223372036854775808` to `9223372036854775807`.
- **Type-only imports use `import type`.** Required by `verbatimModuleSyntax`.
- **`noUncheckedIndexedAccess` is on.** Every array index and record lookup yields `T | undefined` and must be narrowed. This is the single most common cause of a typecheck failure in this repo.
- **`exactOptionalPropertyTypes` is on.** `{ a?: string }` will not accept `{ a: undefined }`. Omit the key instead.
- **Creative field limits, matching `packages/ads/src/validation.ts` exactly:** advertiser <= 40 chars, headline <= 80, body <= 160, `creativeId` matches `/^[A-Za-z0-9_-]+$/` and <= 64 chars, URLs <= 2048 chars, <= 50 creatives per serve response.
- **The 45-tag vocabulary is closed.** Defined in `packages/ads/src/types.ts:92`; re-declared independently in `services/api/src/contract.ts` under D1.
- **Verification gate:** `npm run verify` (typecheck + firewall + tests) must pass at the end of every task.

---

## File Structure

| File | Responsibility |
|---|---|
| `services/api/package.json` | Package identity; no dependencies in `src/` |
| `services/api/src/contract.ts` | Hand-written wire types + the closed tag vocabulary |
| `services/api/src/money.ts` | BigInt micros arithmetic, parse/format, credit computation |
| `services/api/src/ledger.ts` | Entry construction, balance folding, reversal semantics |
| `services/api/src/targeting.ts` | Tag intersection, budget filter, CPM ranking |
| `services/api/src/plausibility.ts` | Receipt trust checks |
| `services/api/src/store.ts` | The `Store` port; every persistence operation |
| `services/api/src/memoryStore.ts` | In-memory `Store`, backs all tests |
| `services/api/src/auth.ts` | `TokenVerifier` port, role and ban gate |
| `services/api/src/serve.ts` | `POST /v1/serve` |
| `services/api/src/receipts.ts` | `POST /v1/receipts` |
| `services/api/src/balance.ts` | `GET /v1/balance`, `GET /v1/ledger` |
| `services/api/src/config.ts` | `GET /v1/config` |
| `services/api/src/admin.ts` | Admin routes, each audited |
| `services/api/src/server.ts` | Routing, error mapping, wiring |
| `services/api/adapters/firestoreStore.ts` | `Store` against Firestore |
| `services/api/adapters/firebaseAuth.ts` | `TokenVerifier` against Firebase Admin |
| `services/api/test/conformance/contractSuite.ts` | The lifted suite, parameterised by base URL |

---

### Task 1: Scaffold and `money.ts`

Sets up the service package and the module that everything financial depends on. Scaffolding is folded in here because this is the first task that needs it.

**Files:**
- Create: `services/api/package.json`
- Create: `services/api/src/money.ts`
- Create: `services/api/test/money.test.ts`
- Modify: `tsconfig.json` (the `include` array)
- Modify: `vitest.config.ts` (the `test.include` array)
- Modify: `package.json` (the `firewall` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `type Micros = bigint`; `parseMicros(raw: string): bigint | null`; `formatMicros(v: bigint): string`; `INT64_MAX`, `INT64_MIN`; `advertiserCostMicros(cpmMicros: bigint): bigint`; `userCreditMicros(cost: bigint, revSharePercent: bigint): bigint`.

- [x] **Step 1: Create the package manifest**

`services/api/package.json`:

```json
{
  "name": "@adcode/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "The real serving backend. Deliberately shares NO types with the client (spec D1).",
  "main": "./src/server.ts",
  "exports": {
    ".": "./src/server.ts"
  },
  "scripts": {
    "start": "node src/cli.ts"
  }
}
```

- [x] **Step 2: Wire the new directory into typecheck, tests, and the firewall**

In `tsconfig.json`, add `"services/**/*.ts"` to `include`:

```json
"include": ["packages/**/*.ts", "mock-server/**/*.ts", "services/**/*.ts", "vitest.config.ts"]
```

In `vitest.config.ts`, add the services glob to `test.include`:

```ts
include: [
  "packages/**/test/**/*.test.ts",
  "mock-server/test/**/*.test.ts",
  "services/**/test/**/*.test.ts",
  "apps/**/test/**/*.test.ts",
],
```

In the root `package.json`, add `services` to the `firewall` script:

```json
"firewall": "depcruise --config .dependency-cruiser.cjs packages mock-server apps services"
```

- [x] **Step 3: Write the failing test**

`services/api/test/money.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  parseMicros,
  formatMicros,
  advertiserCostMicros,
  userCreditMicros,
  INT64_MAX,
  INT64_MIN,
} from "../src/money.ts";

describe("parseMicros", () => {
  it("accepts a plain decimal integer string", () => {
    expect(parseMicros("1250")).toBe(1250n);
    expect(parseMicros("-1250")).toBe(-1250n);
    expect(parseMicros("0")).toBe(0n);
  });

  it("rejects anything that is not a decimal integer string", () => {
    for (const bad of ["", " 1", "1 ", "1.5", "1e3", "0x10", "+1", "--1", "abc", "1,000"]) {
      expect(parseMicros(bad)).toBeNull();
    }
  });

  it("rejects values outside int64, which the client would reject too", () => {
    expect(parseMicros((INT64_MAX + 1n).toString())).toBeNull();
    expect(parseMicros((INT64_MIN - 1n).toString())).toBeNull();
    expect(parseMicros(INT64_MAX.toString())).toBe(INT64_MAX);
    expect(parseMicros(INT64_MIN.toString())).toBe(INT64_MIN);
  });
});

describe("formatMicros round-trips", () => {
  it("survives any in-range value", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: INT64_MIN, max: INT64_MAX }), (v) => {
        expect(parseMicros(formatMicros(v))).toBe(v);
      }),
    );
  });
});

describe("credit computation", () => {
  // Spec §8.1: CPM is cost per mille; revSharePercent is a percentage.
  it("splits an $8 CPM at 50% into 4000 micros of cost and 2000 of credit", () => {
    const cost = advertiserCostMicros(8_000_000n);
    expect(cost).toBe(8000n);
    expect(userCreditMicros(cost, 50n)).toBe(4000n);
  });

  it("truncates rather than rounding, deterministically", () => {
    // 999 micros CPM / 1000 truncates to 0 - the house keeps the fraction.
    expect(advertiserCostMicros(999n)).toBe(0n);
    expect(userCreditMicros(3n, 50n)).toBe(1n);
  });

  it("never credits more than the advertiser was charged", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 100n }),
        (cpm, share) => {
          const cost = advertiserCostMicros(cpm);
          expect(userCreditMicros(cost, share) <= cost).toBe(true);
        },
      ),
    );
  });
});
```

- [x] **Step 4: Run the test to verify it fails**

Run: `npx vitest run services/api/test/money.test.ts`
Expected: FAIL — cannot resolve `../src/money.ts`.

- [x] **Step 5: Write the implementation**

`services/api/src/money.ts`:

```ts
/**
 * Micros arithmetic, in BigInt.
 *
 * Spec D4: money is bigint in the service, int64 in Firestore, and a decimal string on
 * the wire. A JS number never holds a micros value - above 2^53 it has already lost
 * precision, and the point of the string form on the wire is that JSON has no bigint.
 *
 * Pure: no imports, no I/O, no clock.
 */

/** int64 bounds. `packages/ads/src/validation.ts` rejects anything outside these. */
export const INT64_MAX = 9_223_372_036_854_775_807n;
export const INT64_MIN = -9_223_372_036_854_775_808n;

/**
 * Exactly the shape the client accepts: an optional minus, then 1-19 digits.
 *
 * Deliberately stricter than BigInt's own parser, which would take "0x10", " 1 " and
 * "1_000". A server that accepts more than the client does produces values the client
 * will later reject, which surfaces as a bug in the client.
 */
const DECIMAL_INT = /^-?[0-9]{1,19}$/;

export function parseMicros(raw: string): bigint | null {
  if (typeof raw !== "string" || !DECIMAL_INT.test(raw)) return null;
  const value = BigInt(raw);
  if (value > INT64_MAX || value < INT64_MIN) return null;
  return value;
}

export function formatMicros(value: bigint): string {
  return value.toString();
}

/**
 * What the advertiser pays for one impression.
 *
 * CPM is cost per mille, so one impression is a thousandth of the rate.
 */
export function advertiserCostMicros(cpmMicros: bigint): bigint {
  return cpmMicros / 1000n;
}

/**
 * The user's cut of that cost.
 *
 * Both divisions truncate, which is specified behaviour rather than an accident of the
 * type (spec §8.1). Truncation is deterministic, and the reconciliation job recomputes
 * these values and compares them exactly - a rule that depended on floating point would
 * make that comparison unreliable.
 */
export function userCreditMicros(costMicros: bigint, revSharePercent: bigint): bigint {
  return (costMicros * revSharePercent) / 100n;
}
```

- [x] **Step 6: Run the test to verify it passes**

Run: `npx vitest run services/api/test/money.test.ts`
Expected: PASS, all cases.

- [x] **Step 7: Run the full verification gate**

Run: `npm run verify`
Expected: typecheck clean, firewall clean, all existing tests still passing.

- [x] **Step 8: Commit**

```bash
git add services/api/package.json services/api/src/money.ts services/api/test/money.test.ts tsconfig.json vitest.config.ts package.json
git commit -m "feat(api): micros arithmetic in bigint"
```

---

### Task 2: `contract.ts` and the type firewall

**Files:**
- Create: `services/api/src/contract.ts`
- Create: `services/api/test/contract.test.ts`
- Modify: `.dependency-cruiser.cjs` (add a rule after `mock-server-must-not-import-client`, which ends at line 103)

**Interfaces:**
- Consumes: nothing.
- Produces: `ThemeName`, `CadenceName`, `ReceiptOutcome`, `ServeRequestBody`, `ServedCreative`, `ServeResponseBody`, `SubmittedReceipt`, `ReceiptsRequestBody`, `BalanceResponseBody`, `ConfigResponseBody`, `LedgerRow`, `LedgerResponseBody`; `TAG_VOCABULARY: readonly string[]`; `LIMITS`; `isTag(v: string): boolean`; `parseServeRequest(raw: unknown): ServeRequestBody | null`; `parseReceiptsRequest(raw: unknown): ReceiptsRequestBody | null`.

- [x] **Step 1: Write the failing test**

`services/api/test/contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseServeRequest, parseReceiptsRequest, isTag, TAG_VOCABULARY, LIMITS } from "../src/contract.ts";

describe("the tag vocabulary is closed", () => {
  it("holds exactly the 45 tags the client knows", () => {
    expect(TAG_VOCABULARY).toHaveLength(45);
    expect(isTag("lang:typescript")).toBe(true);
    expect(isTag("fw:react")).toBe(true);
    expect(isTag("lang:brainfuck")).toBe(false);
    expect(isTag("")).toBe(false);
  });
});

describe("parseServeRequest", () => {
  it("accepts a well-formed body", () => {
    const parsed = parseServeRequest({ tags: ["lang:rust"], themeKind: "dark", count: 2 });
    expect(parsed).toEqual({ tags: ["lang:rust"], themeKind: "dark", count: 2 });
  });

  it("drops tags outside the vocabulary rather than failing the request", () => {
    const parsed = parseServeRequest({ tags: ["lang:rust", "evil"], themeKind: "dark", count: 1 });
    expect(parsed?.tags).toEqual(["lang:rust"]);
  });

  it("rejects a malformed body", () => {
    expect(parseServeRequest({ tags: "no", themeKind: "dark", count: 1 })).toBeNull();
    expect(parseServeRequest({ tags: [], themeKind: "puce", count: 1 })).toBeNull();
    expect(parseServeRequest({ tags: [], themeKind: "dark", count: "1" })).toBeNull();
    expect(parseServeRequest({ tags: [], themeKind: "dark" })).toBeNull();
    expect(parseServeRequest(null)).toBeNull();
  });

  it("clamps count to the response ceiling the client enforces", () => {
    expect(parseServeRequest({ tags: [], themeKind: "dark", count: 9999 })?.count).toBe(LIMITS.maxCreatives);
    expect(parseServeRequest({ tags: [], themeKind: "dark", count: -3 })?.count).toBe(0);
  });
});

describe("parseReceiptsRequest", () => {
  const receipt = {
    receiptId: "r-1",
    creativeId: "c-1",
    shownAt: 1_700_000_000_000,
    dwellMs: 4200,
    themeKind: "dark",
    outcome: "impression",
  };

  it("accepts a well-formed batch", () => {
    expect(parseReceiptsRequest({ receipts: [receipt] })?.receipts).toHaveLength(1);
  });

  it("rejects a batch containing any malformed receipt", () => {
    expect(parseReceiptsRequest({ receipts: [{ ...receipt, outcome: "stolen" }] })).toBeNull();
    expect(parseReceiptsRequest({ receipts: [{ ...receipt, dwellMs: "long" }] })).toBeNull();
    expect(parseReceiptsRequest({ receipts: [{ ...receipt, receiptId: "" }] })).toBeNull();
    expect(parseReceiptsRequest({ receipts: {} })).toBeNull();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/api/test/contract.test.ts`
Expected: FAIL — cannot resolve `../src/contract.ts`.

- [x] **Step 3: Write the implementation**

`services/api/src/contract.ts`. Note the header comment — it exists so nobody "helpfully" refactors this into a shared import:

```ts
/**
 * Wire types for the serving contract, written from the spec.
 *
 * Spec D1: this is a third hand-written copy of the contract, alongside the client's and
 * the mock server's. That is deliberate. A server that imports the client's types cannot
 * catch a contract mismatch, and catching one is the main thing the separation buys.
 * `api-must-not-import-client` fails CI on any import from `packages/`. Do not refactor
 * this into a shared module.
 *
 * Money is a decimal string here for the reason it is everywhere else: JSON has no
 * bigint, and a JSON number would already have lost precision above 2^53.
 */

export type ThemeName = "light" | "dark";
export type CadenceName = "off" | "light" | "standard" | "max";
export type ReceiptOutcome = "impression" | "click" | "dismissed";

/** Independently re-declared under D1. Must stay in step with the client's vocabulary. */
export const TAG_VOCABULARY = [
  "lang:c", "lang:cpp", "lang:csharp", "lang:css", "lang:go", "lang:html",
  "lang:java", "lang:javascript", "lang:json", "lang:kotlin", "lang:lua",
  "lang:markdown", "lang:php", "lang:python", "lang:ruby", "lang:rust",
  "lang:shell", "lang:sql", "lang:swift", "lang:typescript", "lang:yaml",

  "fw:angular", "fw:django", "fw:express", "fw:laravel", "fw:next",
  "fw:nuxt", "fw:rails", "fw:react", "fw:spring", "fw:svelte", "fw:vue",

  "tool:cargo", "tool:docker", "tool:gradle", "tool:kubernetes", "tool:maven",
  "tool:npm", "tool:terraform", "tool:vite", "tool:webpack",

  "platform:backend", "platform:desktop", "platform:mobile", "platform:web",
] as const;

const TAG_SET: ReadonlySet<string> = new Set(TAG_VOCABULARY);

export function isTag(value: string): boolean {
  return TAG_SET.has(value);
}

/** Mirrors `packages/ads/src/validation.ts` exactly. A looser server produces creatives every client drops. */
export const LIMITS = {
  advertiser: 40,
  headline: 80,
  body: 160,
  creativeId: 64,
  url: 2048,
  maxCreatives: 50,
} as const;

export const CREATIVE_ID = /^[A-Za-z0-9_-]+$/;

const THEMES: ReadonlySet<string> = new Set<ThemeName>(["light", "dark"]);
const OUTCOMES: ReadonlySet<string> = new Set<ReceiptOutcome>(["impression", "click", "dismissed"]);

export interface ServeRequestBody {
  tags: string[];
  themeKind: ThemeName;
  count: number;
}

export interface ServedCreative {
  creativeId: string;
  advertiser: string;
  headline: string;
  body: string | null;
  clickUrl: string;
  logoLight: string;
  logoDark: string;
  ttlMs: number;
}

export interface ServeResponseBody {
  creatives: ServedCreative[];
}

export interface SubmittedReceipt {
  receiptId: string;
  creativeId: string;
  shownAt: number;
  dwellMs: number;
  themeKind: ThemeName;
  outcome: ReceiptOutcome;
}

export interface ReceiptsRequestBody {
  receipts: SubmittedReceipt[];
}

export interface ReceiptsResponseBody {
  acked: string[];
}

export interface BalanceResponseBody {
  availableMicros: string;
  lifetimeMicros: string;
}

export interface ConfigResponseBody {
  killSwitch: boolean;
  caps: { minIntervalMs?: number; dailyCap?: number };
  projections: Record<CadenceName, string>;
}

/** New in this slice. Additive, so no existing client is affected. */
export interface LedgerRow {
  entryId: string;
  kind: string;
  micros: string;
  description: string;
  createdAt: number;
  refId: string | null;
}

export interface LedgerResponseBody {
  rows: LedgerRow[];
  nextCursor: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && Number.isFinite(v);

export function parseServeRequest(raw: unknown): ServeRequestBody | null {
  if (!isRecord(raw)) return null;
  const { tags, themeKind, count } = raw;

  if (!Array.isArray(tags)) return null;
  if (typeof themeKind !== "string" || !THEMES.has(themeKind)) return null;
  if (!isFiniteInt(count)) return null;

  // An unknown tag is dropped rather than failing the request: a newer client sending a
  // tag this server has not shipped yet should still get ads, not a 400.
  const known = tags.filter((t): t is string => typeof t === "string" && isTag(t));

  return {
    tags: known,
    themeKind: themeKind as ThemeName,
    count: Math.max(0, Math.min(count, LIMITS.maxCreatives)),
  };
}

export function parseReceiptsRequest(raw: unknown): ReceiptsRequestBody | null {
  if (!isRecord(raw)) return null;
  const { receipts } = raw;
  if (!Array.isArray(receipts)) return null;

  const parsed: SubmittedReceipt[] = [];
  for (const item of receipts) {
    if (!isRecord(item)) return null;
    const { receiptId, creativeId, shownAt, dwellMs, themeKind, outcome } = item;

    if (typeof receiptId !== "string" || receiptId.length === 0 || receiptId.length > LIMITS.creativeId) return null;
    if (typeof creativeId !== "string" || !CREATIVE_ID.test(creativeId) || creativeId.length > LIMITS.creativeId) return null;
    if (!isFiniteInt(shownAt) || shownAt < 0) return null;
    if (!isFiniteInt(dwellMs) || dwellMs < 0) return null;
    if (typeof themeKind !== "string" || !THEMES.has(themeKind)) return null;
    if (typeof outcome !== "string" || !OUTCOMES.has(outcome)) return null;

    parsed.push({
      receiptId,
      creativeId,
      shownAt,
      dwellMs,
      themeKind: themeKind as ThemeName,
      outcome: outcome as ReceiptOutcome,
    });
  }

  return { receipts: parsed };
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run services/api/test/contract.test.ts`
Expected: PASS.

- [x] **Step 5: Add the firewall rule**

In `.dependency-cruiser.cjs`, immediately after the `mock-server-must-not-import-client` rule (which closes at line 103), add:

```js
{
  name: "api-must-not-import-client",
  comment:
    "Spec D1: the real service must not import the client's types, for the same reason " +
    "the mock server must not. A server that shares the client's definitions cannot " +
    "catch a contract mismatch, and catching one is the main thing the separation buys.",
  severity: "error",
  from: { path: "^services/api" },
  to: { path: "^packages/" },
},
```

- [x] **Step 6: Prove the rule actually bites**

Temporarily append to `services/api/src/contract.ts`:

```ts
import { TAG_VOCABULARY as X } from "../../../packages/ads/src/types.ts";
```

Run: `npm run firewall`
Expected: FAIL, naming `api-must-not-import-client`.

Then delete that import line and re-run: `npm run firewall`
Expected: PASS.

A rule nobody has watched fail is a rule nobody knows works.

- [x] **Step 7: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 8: Commit**

```bash
git add services/api/src/contract.ts services/api/test/contract.test.ts .dependency-cruiser.cjs
git commit -m "feat(api): wire types, and a firewall that keeps them separate"
```

---

### Task 3: `ledger.ts`

The heart of the slice. Entries are append-only; a balance is a fold over them.

**Files:**
- Create: `services/api/src/ledger.ts`
- Create: `services/api/test/ledger.test.ts`

**Interfaces:**
- Consumes: `money.ts` (`INT64_MAX`, `INT64_MIN`).
- Produces: `type LedgerKind`; `interface LedgerEntry { entryId, uid, kind, micros, refId, createdAt, description, reason?, adminUid?, providerRef?, currency? }`; `interface Balance { availableMicros, lifetimeMicros, pendingWithdrawalMicros }`; `EMPTY_BALANCE`; `foldBalance(entries: readonly LedgerEntry[]): Balance`; `applyEntry(b: Balance, e: LedgerEntry): Balance`.

- [x] **Step 1: Write the failing test**

`services/api/test/ledger.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { foldBalance, applyEntry, EMPTY_BALANCE, type LedgerEntry, type LedgerKind } from "../src/ledger.ts";

let seq = 0;
const entry = (kind: LedgerKind, micros: bigint): LedgerEntry => ({
  entryId: `e-${++seq}`,
  uid: "u-1",
  kind,
  micros,
  refId: null,
  createdAt: seq,
  description: "",
});

describe("foldBalance", () => {
  it("is empty for no entries", () => {
    expect(foldBalance([])).toEqual(EMPTY_BALANCE);
  });

  it("counts credits toward both available and lifetime", () => {
    const b = foldBalance([entry("impression", 2000n), entry("click", 3000n)]);
    expect(b.availableMicros).toBe(5000n);
    expect(b.lifetimeMicros).toBe(5000n);
  });

  it("subtracts a reversal from available and from lifetime", () => {
    // Lifetime is 'what you actually earned', so a clawback must reduce it too -
    // otherwise a fraudulent user keeps a lifetime figure they never legitimately earned.
    const b = foldBalance([entry("impression", 2000n), entry("reversal", -2000n)]);
    expect(b.availableMicros).toBe(0n);
    expect(b.lifetimeMicros).toBe(0n);
  });

  it("moves a requested withdrawal from available into pending", () => {
    const b = foldBalance([entry("impression", 5000n), entry("withdrawal_requested", -3000n)]);
    expect(b.availableMicros).toBe(2000n);
    expect(b.pendingWithdrawalMicros).toBe(3000n);
    expect(b.lifetimeMicros).toBe(5000n);
  });

  it("clears pending when a withdrawal is paid, without touching available", () => {
    const b = foldBalance([
      entry("impression", 5000n),
      entry("withdrawal_requested", -3000n),
      entry("withdrawal_paid", -3000n),
    ]);
    expect(b.availableMicros).toBe(2000n);
    expect(b.pendingWithdrawalMicros).toBe(0n);
  });

  it("returns a failed withdrawal to available", () => {
    const b = foldBalance([
      entry("impression", 5000n),
      entry("withdrawal_requested", -3000n),
      entry("withdrawal_failed", 3000n),
    ]);
    expect(b.availableMicros).toBe(5000n);
    expect(b.pendingWithdrawalMicros).toBe(0n);
  });

  it("lets an adjustment move available in either direction", () => {
    expect(foldBalance([entry("adjustment", 700n)]).availableMicros).toBe(700n);
    expect(foldBalance([entry("impression", 700n), entry("adjustment", -200n)]).availableMicros).toBe(500n);
  });
});

describe("the fold is the invariant", () => {
  it("agrees with applyEntry over any sequence", () => {
    const kinds: LedgerKind[] = ["impression", "click", "reversal", "adjustment"];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom(...kinds),
            micros: fc.bigInt({ min: -10n ** 9n, max: 10n ** 9n }),
          }),
          { maxLength: 200 },
        ),
        (raw) => {
          const entries = raw.map((r) => entry(r.kind, r.micros));
          const folded = foldBalance(entries);
          const stepped = entries.reduce(applyEntry, EMPTY_BALANCE);
          expect(stepped).toEqual(folded);
        },
      ),
    );
  });

  it("never lets pending go negative", () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: 0n, max: 10n ** 6n }), { maxLength: 50 }), (amounts) => {
        const entries = amounts.map((a) => entry("withdrawal_requested", -a));
        expect(foldBalance(entries).pendingWithdrawalMicros >= 0n).toBe(true);
      }),
    );
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/api/test/ledger.test.ts`
Expected: FAIL — cannot resolve `../src/ledger.ts`.

- [x] **Step 3: Write the implementation**

`services/api/src/ledger.ts`:

```ts
/**
 * The money ledger.
 *
 * Spec §6.2: nothing here is ever updated or deleted. A correction is a new entry that
 * references the one it corrects. An admin who can edit history is an admin who can
 * steal, so the structure - not a policy document - is what prevents it.
 *
 * Pure: a balance is a fold over entries. `balances/{uid}` in Firestore is a cache of
 * this function's output, and where the two disagree, this function wins.
 */

export type LedgerKind =
  | "impression"
  | "click"
  | "reversal"
  | "adjustment"
  | "withdrawal_requested"
  | "withdrawal_paid"
  | "withdrawal_failed";

export interface LedgerEntry {
  entryId: string;
  uid: string;
  kind: LedgerKind;
  /** Signed. Credits positive, debits negative. */
  micros: bigint;
  /** The entry this one corrects or settles, when there is one. */
  refId: string | null;
  createdAt: number;
  description: string;
  /** Present only on `adjustment`. */
  reason?: string;
  /** Present only on `adjustment`. */
  adminUid?: string;
  /** Present only on the withdrawal kinds. Shaped for Wise. */
  providerRef?: string;
  /** Present only on the withdrawal kinds. ISO 4217. */
  currency?: string;
}

export interface Balance {
  availableMicros: bigint;
  lifetimeMicros: bigint;
  pendingWithdrawalMicros: bigint;
}

export const EMPTY_BALANCE: Balance = {
  availableMicros: 0n,
  lifetimeMicros: 0n,
  pendingWithdrawalMicros: 0n,
};

/**
 * Fold one entry into a balance.
 *
 * `lifetimeMicros` tracks what was actually earned, so a reversal reduces it - otherwise
 * a user whose fraudulent earnings were clawed back keeps a lifetime figure they never
 * legitimately earned, which is exactly the number a dashboard shows most prominently.
 */
export function applyEntry(balance: Balance, entry: LedgerEntry): Balance {
  const { kind, micros } = entry;

  switch (kind) {
    case "impression":
    case "click":
      return {
        ...balance,
        availableMicros: balance.availableMicros + micros,
        lifetimeMicros: balance.lifetimeMicros + micros,
      };

    case "reversal":
      return {
        ...balance,
        availableMicros: balance.availableMicros + micros,
        lifetimeMicros: balance.lifetimeMicros + micros,
      };

    case "adjustment":
      return { ...balance, availableMicros: balance.availableMicros + micros };

    case "withdrawal_requested":
      // `micros` is negative: available falls, the same magnitude becomes pending.
      return {
        ...balance,
        availableMicros: balance.availableMicros + micros,
        pendingWithdrawalMicros: balance.pendingWithdrawalMicros - micros,
      };

    case "withdrawal_paid":
      // The hold settles. Available already fell at request time.
      return {
        ...balance,
        pendingWithdrawalMicros: balance.pendingWithdrawalMicros + micros,
      };

    case "withdrawal_failed":
      // The hold is released and the money comes back.
      return {
        ...balance,
        availableMicros: balance.availableMicros + micros,
        pendingWithdrawalMicros: balance.pendingWithdrawalMicros - micros,
      };
  }
}

export function foldBalance(entries: readonly LedgerEntry[]): Balance {
  return entries.reduce(applyEntry, EMPTY_BALANCE);
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run services/api/test/ledger.test.ts`
Expected: PASS.

If the `withdrawal_paid` case fails, check the sign convention: `withdrawal_paid` carries a negative `micros` matching the request, so adding it to pending reduces pending to zero.

- [x] **Step 5: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add services/api/src/ledger.ts services/api/test/ledger.test.ts
git commit -m "feat(api): an append-only ledger, folded into a balance"
```

---

### Task 4: The `Store` port and the in-memory implementation

**Files:**
- Create: `services/api/src/store.ts`
- Create: `services/api/src/memoryStore.ts`
- Create: `services/api/test/memoryStore.test.ts`

**Interfaces:**
- Consumes: `ledger.ts` (`LedgerEntry`, `Balance`), `money.ts`.
- Produces: `interface Store` with `getUser`, `putUser`, `activeCampaignsFor`, `getCreative`, `putCampaign`, `putCreative`, `recordServe`, `findServe`, `createReceiptIfAbsent`, `appendEntryAndUpdateBalance`, `getBalance`, `listEntries`, `addSpend`, `getConfig`, `putConfig`, `writeAudit`; `interface Clock { now(): number }`; `interface IdGen { next(prefix: string): string }`; `createMemoryStore(): Store & { reset(): void }`.

- [x] **Step 1: Write the failing test**

`services/api/test/memoryStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { LedgerEntry } from "../src/ledger.ts";

let store: ReturnType<typeof createMemoryStore>;

beforeEach(() => {
  store = createMemoryStore();
});

const entry = (entryId: string, micros: bigint): LedgerEntry => ({
  entryId,
  uid: "u-1",
  kind: "impression",
  micros,
  refId: null,
  createdAt: 1,
  description: "Ad",
});

describe("receipt idempotency", () => {
  it("creates a receipt once and refuses the second attempt", async () => {
    const first = await store.createReceiptIfAbsent({ receiptId: "r-1", uid: "u-1", creativeId: "c-1", outcome: "impression", creditedMicros: 2000n });
    const second = await store.createReceiptIfAbsent({ receiptId: "r-1", uid: "u-1", creativeId: "c-1", outcome: "impression", creditedMicros: 2000n });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe("appendEntryAndUpdateBalance", () => {
  it("keeps the balance cache equal to the fold of the entries", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 2000n));
    await store.appendEntryAndUpdateBalance(entry("e-2", 3000n));

    const balance = await store.getBalance("u-1");
    expect(balance.availableMicros).toBe(5000n);
    expect(balance.lifetimeMicros).toBe(5000n);
  });

  it("refuses to append the same entry id twice", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 2000n));
    await expect(store.appendEntryAndUpdateBalance(entry("e-1", 2000n))).rejects.toThrow(/already exists/i);
  });
});

describe("listEntries", () => {
  it("returns newest first and paginates by cursor", async () => {
    for (let i = 1; i <= 5; i++) {
      await store.appendEntryAndUpdateBalance({ ...entry(`e-${i}`, 100n), createdAt: i });
    }

    const page1 = await store.listEntries("u-1", { limit: 2, cursor: null });
    expect(page1.rows.map((r) => r.entryId)).toEqual(["e-5", "e-4"]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await store.listEntries("u-1", { limit: 2, cursor: page1.nextCursor });
    expect(page2.rows.map((r) => r.entryId)).toEqual(["e-3", "e-2"]);
  });

  it("never returns another user's entries", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 100n));
    await store.appendEntryAndUpdateBalance({ ...entry("e-2", 100n), uid: "u-2" });

    const rows = await store.listEntries("u-1", { limit: 10, cursor: null });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.uid).toBe("u-1");
  });
});

describe("serve records", () => {
  it("finds an unexpired serve for the right uid and creative", async () => {
    await store.recordServe({ serveId: "s-1", uid: "u-1", creativeId: "c-1", servedAt: 1000, expiresAt: 2000 });

    expect(await store.findServe("u-1", "c-1", 1500)).not.toBeNull();
    expect(await store.findServe("u-1", "c-1", 2500)).toBeNull();
    expect(await store.findServe("u-2", "c-1", 1500)).toBeNull();
    expect(await store.findServe("u-1", "c-9", 1500)).toBeNull();
  });
});

describe("spend", () => {
  it("accumulates across shards", async () => {
    await store.addSpend("camp-1", 1000n);
    await store.addSpend("camp-1", 500n);
    expect(await store.getSpend("camp-1")).toBe(1500n);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/api/test/memoryStore.test.ts`
Expected: FAIL — cannot resolve `../src/memoryStore.ts`.

- [x] **Step 3: Write the port**

`services/api/src/store.ts`:

```ts
/**
 * The persistence port.
 *
 * Spec D2: every persistence operation goes through this interface, following ad-core
 * decision #3 - which put Firebase auth behind an injected transport so it could be built
 * and tested with no Firebase project in existence. The same trick makes this whole slice
 * buildable before a GCP account exists, and keeps CI free of cloud credentials forever.
 *
 * Implementations: `memoryStore.ts` for tests, `adapters/firestoreStore.ts` for production.
 */
import type { Balance, LedgerEntry } from "./ledger.ts";

export interface Clock {
  now(): number;
}

export interface IdGen {
  next(prefix: string): string;
}

export type UserStatus = "active" | "banned";

export interface UserRecord {
  uid: string;
  status: UserStatus;
  createdAt: number;
  linkedAt?: number;
}

export interface CampaignRecord {
  campaignId: string;
  advertiserId: string;
  cpmMicros: bigint;
  budgetMicros: bigint;
  targetTags: string[];
  status: "active" | "paused" | "ended";
}

export interface CreativeRecord {
  creativeId: string;
  campaignId: string;
  advertiser: string;
  headline: string;
  body: string | null;
  clickUrl: string;
  logoLight: string;
  logoDark: string;
  status: "approved" | "pending" | "rejected";
}

export interface ServeRecord {
  serveId: string;
  uid: string;
  creativeId: string;
  servedAt: number;
  expiresAt: number;
}

export interface ReceiptRecord {
  receiptId: string;
  uid: string;
  creativeId: string;
  outcome: string;
  creditedMicros: bigint;
}

export interface ServingConfig {
  killSwitch: boolean;
  caps: { minIntervalMs?: number; dailyCap?: number };
  defaultCpmMicros: bigint;
  revSharePercent: bigint;
  spendShardCount: number;
  serveTtlMs: number;
}

export interface Page {
  limit: number;
  cursor: string | null;
}

export interface EntryPage {
  rows: LedgerEntry[];
  nextCursor: string | null;
}

export interface AuditRecord {
  adminUid: string;
  action: string;
  subjectUid: string;
  at: number;
}

export interface Store {
  getUser(uid: string): Promise<UserRecord | null>;
  putUser(user: UserRecord): Promise<void>;

  putCampaign(campaign: CampaignRecord): Promise<void>;
  activeCampaignsFor(tags: readonly string[]): Promise<CampaignRecord[]>;

  putCreative(creative: CreativeRecord): Promise<void>;
  getCreative(creativeId: string): Promise<CreativeRecord | null>;
  creativesForCampaign(campaignId: string): Promise<CreativeRecord[]>;

  recordServe(serve: ServeRecord): Promise<void>;
  findServe(uid: string, creativeId: string, now: number): Promise<ServeRecord | null>;

  /** True when created, false when the id already existed. This is the idempotency gate. */
  createReceiptIfAbsent(receipt: ReceiptRecord): Promise<boolean>;

  /** Appends and updates the derived balance atomically. Throws if the entry id exists. */
  appendEntryAndUpdateBalance(entry: LedgerEntry): Promise<void>;
  getBalance(uid: string): Promise<Balance>;
  listEntries(uid: string, page: Page): Promise<EntryPage>;

  addSpend(campaignId: string, micros: bigint): Promise<void>;
  getSpend(campaignId: string): Promise<bigint>;

  getConfig(): Promise<ServingConfig>;
  putConfig(config: ServingConfig): Promise<void>;

  writeAudit(record: AuditRecord): Promise<void>;
  listAudit(): Promise<AuditRecord[]>;
}
```

- [x] **Step 4: Write the in-memory implementation**

`services/api/src/memoryStore.ts`:

```ts
/**
 * The in-memory `Store`.
 *
 * Backs every unit and conformance test. It is not a stub: it enforces the same
 * invariants Firestore will - idempotent receipt creation, refusal of a duplicate entry
 * id, and a balance cache written in the same step as the append. A test double that is
 * more permissive than production tests nothing worth testing.
 */
import { applyEntry, EMPTY_BALANCE, type Balance, type LedgerEntry } from "./ledger.ts";
import type {
  AuditRecord, CampaignRecord, CreativeRecord, EntryPage, Page, ReceiptRecord,
  ServeRecord, ServingConfig, Store, UserRecord,
} from "./store.ts";

export const DEFAULT_CONFIG: ServingConfig = {
  killSwitch: false,
  caps: { minIntervalMs: 300_000, dailyCap: 12 },
  defaultCpmMicros: 8_000_000n,
  revSharePercent: 50n,
  spendShardCount: 4,
  serveTtlMs: 600_000,
};

export function createMemoryStore(): Store & { reset(): void } {
  let users = new Map<string, UserRecord>();
  let campaigns = new Map<string, CampaignRecord>();
  let creatives = new Map<string, CreativeRecord>();
  let serves = new Map<string, ServeRecord>();
  let receipts = new Map<string, ReceiptRecord>();
  let entries: LedgerEntry[] = [];
  let balances = new Map<string, Balance>();
  let spend = new Map<string, bigint>();
  let audit: AuditRecord[] = [];
  let config: ServingConfig = { ...DEFAULT_CONFIG };

  return {
    reset() {
      users = new Map();
      campaigns = new Map();
      creatives = new Map();
      serves = new Map();
      receipts = new Map();
      entries = [];
      balances = new Map();
      spend = new Map();
      audit = [];
      config = { ...DEFAULT_CONFIG };
    },

    async getUser(uid) {
      return users.get(uid) ?? null;
    },
    async putUser(user) {
      users.set(user.uid, user);
    },

    async putCampaign(campaign) {
      campaigns.set(campaign.campaignId, campaign);
    },
    async activeCampaignsFor(tags) {
      const wanted = new Set(tags);
      return [...campaigns.values()].filter(
        (c) =>
          c.status === "active" &&
          // An untargeted campaign matches everyone; that is how house ads reach a user
          // whose tags we have not seen before.
          (c.targetTags.length === 0 || c.targetTags.some((t) => wanted.has(t))),
      );
    },

    async putCreative(creative) {
      creatives.set(creative.creativeId, creative);
    },
    async getCreative(creativeId) {
      return creatives.get(creativeId) ?? null;
    },
    async creativesForCampaign(campaignId) {
      return [...creatives.values()].filter((c) => c.campaignId === campaignId && c.status === "approved");
    },

    async recordServe(serve) {
      serves.set(serve.serveId, serve);
    },
    async findServe(uid, creativeId, now) {
      for (const s of serves.values()) {
        if (s.uid === uid && s.creativeId === creativeId && s.expiresAt > now) return s;
      }
      return null;
    },

    async createReceiptIfAbsent(receipt) {
      if (receipts.has(receipt.receiptId)) return false;
      receipts.set(receipt.receiptId, receipt);
      return true;
    },

    async appendEntryAndUpdateBalance(entry) {
      if (entries.some((e) => e.entryId === entry.entryId)) {
        throw new Error(`ledger entry ${entry.entryId} already exists`);
      }
      entries.push(entry);
      const current = balances.get(entry.uid) ?? EMPTY_BALANCE;
      balances.set(entry.uid, applyEntry(current, entry));
    },

    async getBalance(uid) {
      return balances.get(uid) ?? EMPTY_BALANCE;
    },

    async listEntries(uid, page: Page): Promise<EntryPage> {
      const mine = entries
        .filter((e) => e.uid === uid)
        .sort((a, b) => b.createdAt - a.createdAt || b.entryId.localeCompare(a.entryId));

      const start = page.cursor === null ? 0 : mine.findIndex((e) => e.entryId === page.cursor) + 1;
      const rows = mine.slice(start, start + page.limit);
      const last = rows.at(-1);
      const more = start + rows.length < mine.length;

      return { rows, nextCursor: more && last !== undefined ? last.entryId : null };
    },

    async addSpend(campaignId, micros) {
      spend.set(campaignId, (spend.get(campaignId) ?? 0n) + micros);
    },
    async getSpend(campaignId) {
      return spend.get(campaignId) ?? 0n;
    },

    async getConfig() {
      return config;
    },
    async putConfig(next) {
      config = next;
    },

    async writeAudit(record) {
      audit.push(record);
    },
    async listAudit() {
      return [...audit];
    },
  };
}
```

- [x] **Step 5: Run the test to verify it passes**

Run: `npx vitest run services/api/test/memoryStore.test.ts`
Expected: PASS.

- [x] **Step 6: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 7: Commit**

```bash
git add services/api/src/store.ts services/api/src/memoryStore.ts services/api/test/memoryStore.test.ts
git commit -m "feat(api): the store port, and a memory store that enforces its invariants"
```

---

### Task 5: `targeting.ts`

**Files:**
- Create: `services/api/src/targeting.ts`
- Create: `services/api/test/targeting.test.ts`

**Interfaces:**
- Consumes: `store.ts` (`CampaignRecord`).
- Produces: `interface Candidate { campaign: CampaignRecord; spentMicros: bigint }`; `selectCampaigns(candidates: readonly Candidate[], tags: readonly string[], count: number): CampaignRecord[]`.

- [x] **Step 1: Write the failing test**

`services/api/test/targeting.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectCampaigns, type Candidate } from "../src/targeting.ts";
import type { CampaignRecord } from "../src/store.ts";

const campaign = (id: string, cpm: bigint, tags: string[], budget = 1_000_000n): CampaignRecord => ({
  campaignId: id,
  advertiserId: "adv-1",
  cpmMicros: cpm,
  budgetMicros: budget,
  targetTags: tags,
  status: "active",
});

const candidate = (c: CampaignRecord, spent = 0n): Candidate => ({ campaign: c, spentMicros: spent });

describe("selectCampaigns", () => {
  it("ranks by CPM, highest first", () => {
    const picked = selectCampaigns(
      [
        candidate(campaign("low", 2_000_000n, ["lang:rust"])),
        candidate(campaign("high", 9_000_000n, ["lang:rust"])),
        candidate(campaign("mid", 5_000_000n, ["lang:rust"])),
      ],
      ["lang:rust"],
      3,
    );
    expect(picked.map((c) => c.campaignId)).toEqual(["high", "mid", "low"]);
  });

  it("drops campaigns whose tags do not intersect the request", () => {
    const picked = selectCampaigns(
      [
        candidate(campaign("rust", 9_000_000n, ["lang:rust"])),
        candidate(campaign("php", 9_000_000n, ["lang:php"])),
      ],
      ["lang:rust"],
      5,
    );
    expect(picked.map((c) => c.campaignId)).toEqual(["rust"]);
  });

  it("keeps an untargeted campaign, which is how house ads reach anyone", () => {
    const picked = selectCampaigns([candidate(campaign("house", 1_000_000n, []))], ["lang:rust"], 5);
    expect(picked.map((c) => c.campaignId)).toEqual(["house"]);
  });

  it("drops a campaign that has spent its budget", () => {
    const picked = selectCampaigns(
      [
        candidate(campaign("spent", 9_000_000n, ["lang:rust"], 5000n), 5000n),
        candidate(campaign("funded", 1_000_000n, ["lang:rust"], 5000n), 0n),
      ],
      ["lang:rust"],
      5,
    );
    expect(picked.map((c) => c.campaignId)).toEqual(["funded"]);
  });

  it("drops a campaign that cannot afford even one more impression", () => {
    // 8 CPM costs 8000 micros per impression; 100 micros left is not enough.
    const picked = selectCampaigns(
      [candidate(campaign("nearly", 8_000_000n, ["lang:rust"], 8000n), 7900n)],
      ["lang:rust"],
      5,
    );
    expect(picked).toEqual([]);
  });

  it("never returns more than asked for", () => {
    const picked = selectCampaigns(
      [candidate(campaign("a", 3n * 10n ** 6n, [])), candidate(campaign("b", 2n * 10n ** 6n, []))],
      [],
      1,
    );
    expect(picked).toHaveLength(1);
  });

  it("returns nothing when asked for nothing", () => {
    expect(selectCampaigns([candidate(campaign("a", 10n ** 6n, []))], [], 0)).toEqual([]);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/api/test/targeting.test.ts`
Expected: FAIL — cannot resolve `../src/targeting.ts`.

- [x] **Step 3: Write the implementation**

`services/api/src/targeting.ts`:

```ts
/**
 * Which campaigns may be served, and in what order.
 *
 * Pure: takes candidates and returns a ranked subset. No store, no clock. v1 ranks by
 * CPM alone - an auction is a pricing decision the contract does not constrain, and can
 * replace this function without touching anything that calls it.
 */
import { advertiserCostMicros } from "./money.ts";
import type { CampaignRecord } from "./store.ts";

export interface Candidate {
  campaign: CampaignRecord;
  spentMicros: bigint;
}

export function selectCampaigns(
  candidates: readonly Candidate[],
  tags: readonly string[],
  count: number,
): CampaignRecord[] {
  if (count <= 0) return [];

  const wanted = new Set(tags);

  const eligible = candidates.filter(({ campaign, spentMicros }) => {
    if (campaign.status !== "active") return false;

    // An empty target list matches everyone. That is how a house ad reaches a user whose
    // tags we have never seen.
    const matches = campaign.targetTags.length === 0 || campaign.targetTags.some((t) => wanted.has(t));
    if (!matches) return false;

    // Serving an ad the campaign cannot pay for creates a user credit with no funding
    // behind it, so the check is 'can it afford one more', not 'is there anything left'.
    const remaining = campaign.budgetMicros - spentMicros;
    return remaining >= advertiserCostMicros(campaign.cpmMicros) && remaining > 0n;
  });

  eligible.sort((a, b) => {
    if (a.campaign.cpmMicros === b.campaign.cpmMicros) {
      return a.campaign.campaignId.localeCompare(b.campaign.campaignId);
    }
    return a.campaign.cpmMicros > b.campaign.cpmMicros ? -1 : 1;
  });

  return eligible.slice(0, count).map((c) => c.campaign);
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run services/api/test/targeting.test.ts`
Expected: PASS.

- [x] **Step 5: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add services/api/src/targeting.ts services/api/test/targeting.test.ts
git commit -m "feat(api): campaign targeting and CPM ranking"
```

---

### Task 6: `plausibility.ts`

**Files:**
- Create: `services/api/src/plausibility.ts`
- Create: `services/api/test/plausibility.test.ts`

**Interfaces:**
- Consumes: `contract.ts` (`SubmittedReceipt`), `store.ts` (`ServeRecord`).
- Produces: `type RejectReason = "no-serve" | "dwell-too-short" | "dwell-too-long" | "shown-in-future" | "not-earning"`; `MIN_DWELL_MS`, `MAX_DWELL_MS`; `checkReceipt(receipt, serve, now): { ok: true } | { ok: false; reason: RejectReason }`.

- [x] **Step 1: Write the failing test**

`services/api/test/plausibility.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkReceipt, MIN_DWELL_MS, MAX_DWELL_MS } from "../src/plausibility.ts";
import type { SubmittedReceipt } from "../src/contract.ts";
import type { ServeRecord } from "../src/store.ts";

const NOW = 1_700_000_100_000;

const receipt = (over: Partial<SubmittedReceipt> = {}): SubmittedReceipt => ({
  receiptId: "r-1",
  creativeId: "c-1",
  shownAt: NOW - 10_000,
  dwellMs: 4200,
  themeKind: "dark",
  outcome: "impression",
  ...over,
});

const serve = (over: Partial<ServeRecord> = {}): ServeRecord => ({
  serveId: "s-1",
  uid: "u-1",
  creativeId: "c-1",
  servedAt: NOW - 20_000,
  expiresAt: NOW + 20_000,
  ...over,
});

describe("checkReceipt", () => {
  it("accepts an ordinary impression", () => {
    expect(checkReceipt(receipt(), serve(), NOW)).toEqual({ ok: true });
  });

  it("refuses a receipt with no matching serve - this is the whole defence", () => {
    expect(checkReceipt(receipt(), null, NOW)).toEqual({ ok: false, reason: "no-serve" });
  });

  it("refuses a dwell too short to have been seen", () => {
    const result = checkReceipt(receipt({ dwellMs: MIN_DWELL_MS - 1 }), serve(), NOW);
    expect(result).toEqual({ ok: false, reason: "dwell-too-short" });
  });

  it("refuses a dwell longer than any plausible session", () => {
    const result = checkReceipt(receipt({ dwellMs: MAX_DWELL_MS + 1 }), serve(), NOW);
    expect(result).toEqual({ ok: false, reason: "dwell-too-long" });
  });

  it("refuses a receipt claiming to have been shown in the future", () => {
    const result = checkReceipt(receipt({ shownAt: NOW + 60_000 }), serve(), NOW);
    expect(result).toEqual({ ok: false, reason: "shown-in-future" });
  });

  it("refuses to pay for a dismissal, without calling it fraud", () => {
    // A dismissal is honest and worth recording; it just earns nothing.
    expect(checkReceipt(receipt({ outcome: "dismissed" }), serve(), NOW)).toEqual({
      ok: false,
      reason: "not-earning",
    });
  });

  it("accepts a click", () => {
    expect(checkReceipt(receipt({ outcome: "click" }), serve(), NOW)).toEqual({ ok: true });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/api/test/plausibility.test.ts`
Expected: FAIL — cannot resolve `../src/plausibility.ts`.

- [x] **Step 3: Write the implementation**

`services/api/src/plausibility.ts`:

```ts
/**
 * Is this receipt worth paying for?
 *
 * Spec §9: anonymous UIDs are free and unlimited to mint, so identity is not a defence.
 * The defence is that money is only ever created by a receipt matching a serve this
 * server itself issued, which caps an attacker at the same rate limit an honest user has.
 * Everything else here is a secondary check on top of that one.
 *
 * Pure: the caller supplies the serve record and the time.
 */
import type { SubmittedReceipt } from "./contract.ts";
import type { ServeRecord } from "./store.ts";

/** Below this, the ad cannot have been read. */
export const MIN_DWELL_MS = 1_000;

/** Above this, the client was left open on a desk and the impression is not attention. */
export const MAX_DWELL_MS = 300_000;

/** Tolerance for a client clock that runs slightly fast. */
const CLOCK_SKEW_MS = 30_000;

export type RejectReason =
  | "no-serve"
  | "dwell-too-short"
  | "dwell-too-long"
  | "shown-in-future"
  | "not-earning";

export type Verdict = { ok: true } | { ok: false; reason: RejectReason };

export function checkReceipt(
  receipt: SubmittedReceipt,
  serve: ServeRecord | null,
  now: number,
): Verdict {
  // The load-bearing check. Without it, /v1/receipts mints money for anyone with a token.
  if (serve === null) return { ok: false, reason: "no-serve" };

  if (receipt.outcome === "dismissed") return { ok: false, reason: "not-earning" };
  if (receipt.shownAt > now + CLOCK_SKEW_MS) return { ok: false, reason: "shown-in-future" };
  if (receipt.dwellMs < MIN_DWELL_MS) return { ok: false, reason: "dwell-too-short" };
  if (receipt.dwellMs > MAX_DWELL_MS) return { ok: false, reason: "dwell-too-long" };

  return { ok: true };
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run services/api/test/plausibility.test.ts`
Expected: PASS.

- [x] **Step 5: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add services/api/src/plausibility.ts services/api/test/plausibility.test.ts
git commit -m "feat(api): receipt plausibility checks"
```

---

### Task 7: `auth.ts` — the token, role, and ban gate

**Files:**
- Create: `services/api/src/auth.ts`
- Create: `services/api/test/auth.test.ts`

**Interfaces:**
- Consumes: `store.ts` (`Store`, `UserRecord`, `Clock`).
- Produces: `interface VerifiedToken { uid: string; claims: Record<string, unknown> }`; `interface TokenVerifier { verify(idToken: string): Promise<VerifiedToken | null> }`; `type AuthFailure = "missing-token" | "bad-token" | "banned" | "not-admin"`; `authenticate(deps, header: string | undefined): Promise<{ ok: true; uid: string; isAdmin: boolean } | { ok: false; failure: AuthFailure }>`; `bearerFrom(header: string | undefined): string | null`.

- [x] **Step 1: Write the failing test**

`services/api/test/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { authenticate, bearerFrom, type TokenVerifier } from "../src/auth.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;

const verifier: TokenVerifier = {
  async verify(idToken) {
    if (idToken === "good") return { uid: "u-1", claims: {} };
    if (idToken === "admin") return { uid: "admin-1", claims: { admin: true } };
    return null;
  },
};

const clock = { now: () => 1_000 };

beforeEach(async () => {
  store = createMemoryStore();
  await store.putUser({ uid: "u-1", status: "active", createdAt: 0 });
  await store.putUser({ uid: "admin-1", status: "active", createdAt: 0 });
});

describe("bearerFrom", () => {
  it("extracts a token from a well-formed header", () => {
    expect(bearerFrom("Bearer abc")).toBe("abc");
    expect(bearerFrom("bearer abc")).toBe("abc");
  });

  it("rejects a malformed header", () => {
    for (const bad of [undefined, "", "abc", "Basic abc", "Bearer", "Bearer  "]) {
      expect(bearerFrom(bad)).toBeNull();
    }
  });
});

describe("authenticate", () => {
  it("accepts a valid token for an active user", async () => {
    const result = await authenticate({ store, verifier, clock }, "Bearer good");
    expect(result).toEqual({ ok: true, uid: "u-1", isAdmin: false });
  });

  it("reports the admin claim", async () => {
    const result = await authenticate({ store, verifier, clock }, "Bearer admin");
    expect(result).toEqual({ ok: true, uid: "admin-1", isAdmin: true });
  });

  it("refuses a missing header", async () => {
    expect(await authenticate({ store, verifier, clock }, undefined)).toEqual({
      ok: false,
      failure: "missing-token",
    });
  });

  it("refuses a token the verifier rejects", async () => {
    expect(await authenticate({ store, verifier, clock }, "Bearer forged")).toEqual({
      ok: false,
      failure: "bad-token",
    });
  });

  it("refuses a banned user even though the token is valid", async () => {
    // Spec decision #6: a ban must bite now, not when the token next refreshes.
    await store.putUser({ uid: "u-1", status: "banned", createdAt: 0 });
    expect(await authenticate({ store, verifier, clock }, "Bearer good")).toEqual({
      ok: false,
      failure: "banned",
    });
  });

  it("creates a user record on first sight, so anonymous auth needs no signup call", async () => {
    const fresh = createMemoryStore();
    const result = await authenticate({ store: fresh, verifier, clock }, "Bearer good");
    expect(result).toEqual({ ok: true, uid: "u-1", isAdmin: false });
    expect(await fresh.getUser("u-1")).toEqual({ uid: "u-1", status: "active", createdAt: 1_000 });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/api/test/auth.test.ts`
Expected: FAIL — cannot resolve `../src/auth.ts`.

- [x] **Step 3: Write the implementation**

`services/api/src/auth.ts`:

```ts
/**
 * Who is calling, and are they allowed to?
 *
 * Spec §7: identity comes from the token, never from a body field. Roles come from
 * Firebase custom claims, which live inside the verified token, so authorising a request
 * costs no reads. Ban status comes from Firestore instead, because a ban has to take
 * effect on the next request rather than whenever the token happens to refresh
 * (decision #6).
 */
import type { Clock, Store } from "./store.ts";

export interface VerifiedToken {
  uid: string;
  claims: Record<string, unknown>;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<VerifiedToken | null>;
}

export interface AuthDeps {
  store: Store;
  verifier: TokenVerifier;
  clock: Clock;
}

export type AuthFailure = "missing-token" | "bad-token" | "banned" | "not-admin";

export type AuthResult =
  | { ok: true; uid: string; isAdmin: boolean }
  | { ok: false; failure: AuthFailure };

export function bearerFrom(header: string | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export async function authenticate(deps: AuthDeps, header: string | undefined): Promise<AuthResult> {
  const token = bearerFrom(header);
  if (token === null) return { ok: false, failure: "missing-token" };

  const verified = await deps.verifier.verify(token);
  if (verified === null) return { ok: false, failure: "bad-token" };

  // First sight of an anonymous UID creates its record. §8.4 of the brief promises first
  // launch performs anonymous auth "with no UI and no wall", so there is no signup call
  // in which to do this.
  let user = await deps.store.getUser(verified.uid);
  if (user === null) {
    user = { uid: verified.uid, status: "active", createdAt: deps.clock.now() };
    await deps.store.putUser(user);
  }

  if (user.status === "banned") return { ok: false, failure: "banned" };

  return { ok: true, uid: verified.uid, isAdmin: verified.claims["admin"] === true };
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run services/api/test/auth.test.ts`
Expected: PASS.

- [x] **Step 5: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add services/api/src/auth.ts services/api/test/auth.test.ts
git commit -m "feat(api): token verification, roles from claims, bans from the store"
```

---

### Task 8: `serve.ts`

**Files:**
- Create: `services/api/src/serve.ts`
- Create: `services/api/test/serve.test.ts`

**Interfaces:**
- Consumes: `contract.ts`, `store.ts`, `targeting.ts`, `money.ts`.
- Produces: `interface ServeDeps { store: Store; clock: Clock; ids: IdGen }`; `handleServe(deps, uid: string, body: ServeRequestBody): Promise<ServeResponseBody>`.

- [x] **Step 1: Write the failing test**

`services/api/test/serve.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { handleServe } from "../src/serve.ts";
import { createMemoryStore, DEFAULT_CONFIG } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
const deps = () => ({ store, clock: { now: () => 5_000 }, ids: { next: (p: string) => `${p}-${++counter}` } });

beforeEach(async () => {
  counter = 0;
  store = createMemoryStore();
  await store.putCampaign({
    campaignId: "camp-1",
    advertiserId: "adv-1",
    cpmMicros: 8_000_000n,
    budgetMicros: 1_000_000n,
    targetTags: ["lang:rust"],
    status: "active",
  });
  await store.putCreative({
    creativeId: "c-1",
    campaignId: "camp-1",
    advertiser: "Acme",
    headline: "Ship faster",
    body: "A tool for Rust teams",
    clickUrl: "https://acme.test/x",
    logoLight: "https://cdn.test/l.png",
    logoDark: "https://cdn.test/d.png",
    status: "approved",
  });
});

describe("handleServe", () => {
  it("returns a matching creative", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toHaveLength(1);
    expect(res.creatives[0]?.creativeId).toBe("c-1");
    expect(res.creatives[0]?.headline).toBe("Ship faster");
  });

  it("writes a serve record, so the matching receipt can later be trusted", async () => {
    await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(await store.findServe("u-1", "c-1", 5_500)).not.toBeNull();
  });

  it("gives that record a TTL from config", async () => {
    await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    const beyondTtl = 5_000 + DEFAULT_CONFIG.serveTtlMs + 1;
    expect(await store.findServe("u-1", "c-1", beyondTtl)).toBeNull();
  });

  it("serves nothing when the kill switch is on", async () => {
    await store.putConfig({ ...DEFAULT_CONFIG, killSwitch: true });
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });

  it("serves nothing when no campaign matches the tags", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:php"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });

  it("skips a campaign with no approved creative", async () => {
    await store.putCreative({
      creativeId: "c-1",
      campaignId: "camp-1",
      advertiser: "Acme",
      headline: "Ship faster",
      body: null,
      clickUrl: "https://acme.test/x",
      logoLight: "https://cdn.test/l.png",
      logoDark: "https://cdn.test/d.png",
      status: "pending",
    });
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });

  it("never exceeds the count asked for", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 0 });
    expect(res.creatives).toEqual([]);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/api/test/serve.test.ts`
Expected: FAIL — cannot resolve `../src/serve.ts`.

- [x] **Step 3: Write the implementation**

`services/api/src/serve.ts`:

```ts
/**
 * POST /v1/serve.
 *
 * Every returned creative also writes a `serves` record. That record is the only reason
 * a later receipt can be believed (spec §9), so the write is not optional bookkeeping -
 * it is the thing that makes the money path safe.
 */
import type { ServeRequestBody, ServeResponseBody, ServedCreative } from "./contract.ts";
import type { Clock, IdGen, Store } from "./store.ts";
import { selectCampaigns, type Candidate } from "./targeting.ts";

export interface ServeDeps {
  store: Store;
  clock: Clock;
  ids: IdGen;
}

export async function handleServe(
  deps: ServeDeps,
  uid: string,
  body: ServeRequestBody,
): Promise<ServeResponseBody> {
  const config = await deps.store.getConfig();
  if (config.killSwitch || body.count <= 0) return { creatives: [] };

  const campaigns = await deps.store.activeCampaignsFor(body.tags);

  const candidates: Candidate[] = await Promise.all(
    campaigns.map(async (campaign) => ({
      campaign,
      spentMicros: await deps.store.getSpend(campaign.campaignId),
    })),
  );

  const ranked = selectCampaigns(candidates, body.tags, body.count);

  const now = deps.clock.now();
  const creatives: ServedCreative[] = [];

  for (const campaign of ranked) {
    if (creatives.length >= body.count) break;

    const approved = await deps.store.creativesForCampaign(campaign.campaignId);
    const creative = approved[0];
    if (creative === undefined) continue;

    await deps.store.recordServe({
      serveId: deps.ids.next("s"),
      uid,
      creativeId: creative.creativeId,
      servedAt: now,
      expiresAt: now + config.serveTtlMs,
    });

    creatives.push({
      creativeId: creative.creativeId,
      advertiser: creative.advertiser,
      headline: creative.headline,
      body: creative.body,
      clickUrl: creative.clickUrl,
      logoLight: creative.logoLight,
      logoDark: creative.logoDark,
      ttlMs: config.serveTtlMs,
    });
  }

  return { creatives };
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run services/api/test/serve.test.ts`
Expected: PASS.

- [x] **Step 5: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add services/api/src/serve.ts services/api/test/serve.test.ts
git commit -m "feat(api): serve ads, and record that we did"
```

---

### Task 9: `receipts.ts` — where money is created

**Files:**
- Create: `services/api/src/receipts.ts`
- Create: `services/api/test/receipts.test.ts`

**Interfaces:**
- Consumes: `contract.ts`, `store.ts`, `plausibility.ts`, `money.ts`, `ledger.ts`.
- Produces: `interface ReceiptDeps { store: Store; clock: Clock; ids: IdGen }`; `handleReceipts(deps, uid: string, body: ReceiptsRequestBody): Promise<ReceiptsResponseBody>`.

- [x] **Step 1: Write the failing test**

`services/api/test/receipts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { handleReceipts } from "../src/receipts.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { SubmittedReceipt } from "../src/contract.ts";

const NOW = 100_000;
let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
const deps = () => ({ store, clock: { now: () => NOW }, ids: { next: (p: string) => `${p}-${++counter}` } });

const receipt = (over: Partial<SubmittedReceipt> = {}): SubmittedReceipt => ({
  receiptId: "r-1",
  creativeId: "c-1",
  shownAt: NOW - 5_000,
  dwellMs: 4_200,
  themeKind: "dark",
  outcome: "impression",
  ...over,
});

beforeEach(async () => {
  counter = 0;
  store = createMemoryStore();
  await store.putCampaign({
    campaignId: "camp-1",
    advertiserId: "adv-1",
    cpmMicros: 8_000_000n,
    budgetMicros: 1_000_000n,
    targetTags: [],
    status: "active",
  });
  await store.putCreative({
    creativeId: "c-1",
    campaignId: "camp-1",
    advertiser: "Acme",
    headline: "Ship faster",
    body: null,
    clickUrl: "https://acme.test/x",
    logoLight: "https://cdn.test/l.png",
    logoDark: "https://cdn.test/d.png",
    status: "approved",
  });
  await store.recordServe({ serveId: "s-1", uid: "u-1", creativeId: "c-1", servedAt: NOW - 10_000, expiresAt: NOW + 10_000 });
});

describe("handleReceipts", () => {
  it("credits the user at the configured share of the CPM", async () => {
    // 8 CPM = 8000 micros per impression; 50% share = 4000 micros to the user.
    const res = await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    expect(res.acked).toEqual(["r-1"]);

    const balance = await store.getBalance("u-1");
    expect(balance.availableMicros).toBe(4_000n);
    expect(balance.lifetimeMicros).toBe(4_000n);
  });

  it("charges the campaign the full cost, not the user's share", async () => {
    await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    expect(await store.getSpend("camp-1")).toBe(8_000n);
  });

  it("is idempotent - a replayed receipt acks but pays once", async () => {
    await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    const second = await handleReceipts(deps(), "u-1", { receipts: [receipt()] });

    expect(second.acked).toEqual(["r-1"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(4_000n);
  });

  it("acks but does not pay a receipt with no matching serve", async () => {
    // The forged-receipt case. Acking is deliberate: the client must be able to clear its
    // queue, and telling an attacker which receipts were disbelieved helps only them.
    const res = await handleReceipts(deps(), "u-1", { receipts: [receipt({ receiptId: "r-9", creativeId: "c-nonexistent" })] });
    expect(res.acked).toEqual(["r-9"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(0n);
  });

  it("acks but does not pay another user's serve", async () => {
    const res = await handleReceipts(deps(), "u-2", { receipts: [receipt({ receiptId: "r-2" })] });
    expect(res.acked).toEqual(["r-2"]);
    expect((await store.getBalance("u-2")).availableMicros).toBe(0n);
  });

  it("acks but does not pay a dismissal", async () => {
    const res = await handleReceipts(deps(), "u-1", { receipts: [receipt({ receiptId: "r-3", outcome: "dismissed" })] });
    expect(res.acked).toEqual(["r-3"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(0n);
  });

  it("acks but does not pay an implausible dwell", async () => {
    const res = await handleReceipts(deps(), "u-1", { receipts: [receipt({ receiptId: "r-4", dwellMs: 5 })] });
    expect(res.acked).toEqual(["r-4"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(0n);
  });

  it("writes a human-readable description onto the ledger row", async () => {
    await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    const page = await store.listEntries("u-1", { limit: 10, cursor: null });
    expect(page.rows[0]?.description).toBe("Ad from Acme, 4.2s");
  });

  it("handles a batch, paying only the receipts that earn", async () => {
    await store.recordServe({ serveId: "s-2", uid: "u-1", creativeId: "c-1", servedAt: NOW, expiresAt: NOW + 10_000 });
    const res = await handleReceipts(deps(), "u-1", {
      receipts: [receipt({ receiptId: "r-a" }), receipt({ receiptId: "r-b", outcome: "dismissed" })],
    });
    expect(res.acked).toEqual(["r-a", "r-b"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(4_000n);
  });

  it("acks an empty batch", async () => {
    expect(await handleReceipts(deps(), "u-1", { receipts: [] })).toEqual({ acked: [] });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/api/test/receipts.test.ts`
Expected: FAIL — cannot resolve `../src/receipts.ts`.

- [x] **Step 3: Write the implementation**

`services/api/src/receipts.ts`:

```ts
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
import { advertiserCostMicros, userCreditMicros } from "./money.ts";
import type { LedgerEntry } from "./ledger.ts";

export interface ReceiptDeps {
  store: Store;
  clock: Clock;
  ids: IdGen;
}

/** "Ad from Acme, 4.2s" - resolved server-side so user and admin views cannot diverge. */
function describe(advertiser: string, receipt: SubmittedReceipt): string {
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

    if (!verdict.ok) {
      acked.push(receipt.receiptId);
      continue;
    }

    const creative = await deps.store.getCreative(receipt.creativeId);
    if (creative === null) {
      acked.push(receipt.receiptId);
      continue;
    }

    const cost = advertiserCostMicros(config.defaultCpmMicros);
    const credit = userCreditMicros(cost, config.revSharePercent);

    // The idempotency gate. If this returns false the receipt was already paid, and we
    // ack without paying again.
    const created = await deps.store.createReceiptIfAbsent({
      receiptId: receipt.receiptId,
      uid,
      creativeId: receipt.creativeId,
      outcome: receipt.outcome,
      creditedMicros: credit,
    });

    if (!created) {
      acked.push(receipt.receiptId);
      continue;
    }

    const entry: LedgerEntry = {
      entryId: deps.ids.next("e"),
      uid,
      kind: receipt.outcome === "click" ? "click" : "impression",
      micros: credit,
      refId: receipt.receiptId,
      createdAt: now,
      description: describe(creative.advertiser, receipt),
    };

    await deps.store.appendEntryAndUpdateBalance(entry);
    await deps.store.addSpend(creative.campaignId, cost);

    acked.push(receipt.receiptId);
  }

  return { acked };
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run services/api/test/receipts.test.ts`
Expected: PASS.

- [x] **Step 5: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add services/api/src/receipts.ts services/api/test/receipts.test.ts
git commit -m "feat(api): receipts, idempotent and paid only when believable"
```

---

### Task 10: `balance.ts` and `config.ts`

**Files:**
- Create: `services/api/src/balance.ts`
- Create: `services/api/src/config.ts`
- Create: `services/api/test/balance.test.ts`
- Create: `services/api/test/config.test.ts`

**Interfaces:**
- Consumes: `store.ts`, `money.ts`, `contract.ts`.
- Produces: `handleBalance(store, uid): Promise<BalanceResponseBody>`; `handleLedger(store, uid, page: Page): Promise<LedgerResponseBody>`; `handleConfig(store): Promise<ConfigResponseBody>`.

- [x] **Step 1: Write the failing tests**

`services/api/test/balance.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { handleBalance, handleLedger } from "../src/balance.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { LedgerEntry } from "../src/ledger.ts";

let store: ReturnType<typeof createMemoryStore>;

const entry = (id: string, micros: bigint, createdAt: number): LedgerEntry => ({
  entryId: id,
  uid: "u-1",
  kind: "impression",
  micros,
  refId: null,
  createdAt,
  description: `Ad ${id}`,
});

beforeEach(() => {
  store = createMemoryStore();
});

describe("handleBalance", () => {
  it("returns zeros for a user with no history", async () => {
    expect(await handleBalance(store, "u-new")).toEqual({
      availableMicros: "0",
      lifetimeMicros: "0",
    });
  });

  it("returns micros as decimal strings, never numbers", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 4_000n, 1));
    const res = await handleBalance(store, "u-1");
    expect(res).toEqual({ availableMicros: "4000", lifetimeMicros: "4000" });
    expect(typeof res.availableMicros).toBe("string");
  });
});

describe("handleLedger", () => {
  it("returns rows newest first with a stringified amount", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 1_000n, 1));
    await store.appendEntryAndUpdateBalance(entry("e-2", 2_000n, 2));

    const res = await handleLedger(store, "u-1", { limit: 10, cursor: null });
    expect(res.rows.map((r) => r.entryId)).toEqual(["e-2", "e-1"]);
    expect(res.rows[0]?.micros).toBe("2000");
    expect(res.rows[0]?.description).toBe("Ad e-2");
    expect(res.nextCursor).toBeNull();
  });

  it("paginates", async () => {
    for (let i = 1; i <= 3; i++) await store.appendEntryAndUpdateBalance(entry(`e-${i}`, 100n, i));

    const first = await handleLedger(store, "u-1", { limit: 2, cursor: null });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toBe("e-1");

    const second = await handleLedger(store, "u-1", { limit: 2, cursor: first.nextCursor });
    expect(second.rows.map((r) => r.entryId)).toEqual(["e-1"]);
  });

  it("returns nothing for a user with no entries", async () => {
    expect(await handleLedger(store, "u-none", { limit: 10, cursor: null })).toEqual({
      rows: [],
      nextCursor: null,
    });
  });
});
```

`services/api/test/config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { handleConfig } from "../src/config.ts";
import { createMemoryStore, DEFAULT_CONFIG } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;

beforeEach(() => {
  store = createMemoryStore();
});

describe("handleConfig", () => {
  it("reports the kill switch and caps", async () => {
    const res = await handleConfig(store);
    expect(res.killSwitch).toBe(false);
    expect(res.caps.dailyCap).toBe(12);
  });

  it("computes a projection for every cadence the client knows", async () => {
    const res = await handleConfig(store);
    for (const preset of ["off", "light", "standard", "max"]) {
      expect(typeof res.projections[preset as keyof typeof res.projections]).toBe("string");
    }
  });

  it("projects nothing for the off cadence", async () => {
    expect((await handleConfig(store)).projections.off).toBe("0");
  });

  it("projects more for a busier cadence", async () => {
    const p = (await handleConfig(store)).projections;
    expect(BigInt(p.max) > BigInt(p.standard)).toBe(true);
    expect(BigInt(p.standard) > BigInt(p.light)).toBe(true);
  });

  it("reports zero projections when the kill switch is on, since nothing will be served", async () => {
    await store.putConfig({ ...DEFAULT_CONFIG, killSwitch: true });
    const p = (await handleConfig(store)).projections;
    expect(p.standard).toBe("0");
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run services/api/test/balance.test.ts services/api/test/config.test.ts`
Expected: FAIL — cannot resolve the two new modules.

- [x] **Step 3: Write `balance.ts`**

```ts
/**
 * GET /v1/balance and GET /v1/ledger.
 *
 * Spec §7: a user's history is selected by the verified UID, never by a parameter the
 * caller supplies, so there is no request a client can craft to read someone else's
 * money. The `uid` argument here always comes from `authenticate`.
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

export async function handleLedger(store: Store, uid: string, page: Page): Promise<LedgerResponseBody> {
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
```

- [x] **Step 4: Write `config.ts`**

```ts
/**
 * GET /v1/config.
 *
 * D1 of the ad-core design: the client is forbidden from computing money, so projected
 * hourly earnings are computed here and the client only selects and formats a row.
 *
 * The contract says this endpoint "may only tighten" - the service never emits caps
 * looser than the client's shipped defaults, so a compromised config cannot be used to
 * spam users with ads.
 */
import { advertiserCostMicros, formatMicros, userCreditMicros } from "./money.ts";
import type { CadenceName, ConfigResponseBody } from "./contract.ts";
import type { Store } from "./store.ts";

/** Ads per hour at each cadence. Mirrors the client's presets. */
const ADS_PER_HOUR: Record<CadenceName, bigint> = {
  off: 0n,
  light: 2n,
  standard: 4n,
  max: 12n,
};

export async function handleConfig(store: Store): Promise<ConfigResponseBody> {
  const config = await store.getConfig();

  const perImpression = userCreditMicros(
    advertiserCostMicros(config.defaultCpmMicros),
    config.revSharePercent,
  );

  const projections = {} as Record<CadenceName, string>;
  for (const [name, rate] of Object.entries(ADS_PER_HOUR) as [CadenceName, bigint][]) {
    // A projection while the kill switch is on would be a promise the server has already
    // decided not to keep.
    projections[name] = formatMicros(config.killSwitch ? 0n : perImpression * rate);
  }

  return { killSwitch: config.killSwitch, caps: config.caps, projections };
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run services/api/test/balance.test.ts services/api/test/config.test.ts`
Expected: PASS.

- [x] **Step 6: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 7: Commit**

```bash
git add services/api/src/balance.ts services/api/src/config.ts services/api/test/balance.test.ts services/api/test/config.test.ts
git commit -m "feat(api): balance, ledger history, and server-computed projections"
```

---

### Task 11: `admin.ts` — privileged reads, always audited

**Files:**
- Create: `services/api/src/admin.ts`
- Create: `services/api/test/admin.test.ts`

**Interfaces:**
- Consumes: `store.ts`, `balance.ts`, `ledger.ts`.
- Produces: `interface AdminDeps { store: Store; clock: Clock }`; `handleAdminLedger(deps, adminUid: string, subjectUid: string, page: Page): Promise<LedgerResponseBody>`; `handleSetUserStatus(deps, adminUid: string, subjectUid: string, status: UserStatus): Promise<void>`.

- [x] **Step 1: Write the failing test**

`services/api/test/admin.test.ts`:

```ts
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
    const audit = await store.listAudit();
    expect(audit).toEqual([{ adminUid: "admin-1", action: "read-ledger", subjectUid: "u-1", at: 7_000 }]);
  });
});

describe("handleSetUserStatus", () => {
  it("bans a user", async () => {
    await handleSetUserStatus(deps(), "admin-1", "u-1", "banned");
    expect((await store.getUser("u-1"))?.status).toBe("banned");
  });

  it("audits the ban", async () => {
    await handleSetUserStatus(deps(), "admin-1", "u-1", "banned");
    const audit = await store.listAudit();
    expect(audit[0]).toEqual({ adminUid: "admin-1", action: "set-status:banned", subjectUid: "u-1", at: 7_000 });
  });

  it("refuses to act on a user who does not exist", async () => {
    await expect(handleSetUserStatus(deps(), "admin-1", "nobody", "banned")).rejects.toThrow(/no such user/i);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/api/test/admin.test.ts`
Expected: FAIL — cannot resolve `../src/admin.ts`.

- [x] **Step 3: Write the implementation**

`services/api/src/admin.ts`:

```ts
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

  // Same function the user's own view calls, so the two can never drift.
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
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run services/api/test/admin.test.ts`
Expected: PASS.

- [x] **Step 5: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add services/api/src/admin.ts services/api/test/admin.test.ts
git commit -m "feat(api): admin reads and bans, both audited"
```

---

### Task 12: `server.ts` — routing and error mapping

**Files:**
- Create: `services/api/src/server.ts`
- Create: `services/api/src/cli.ts`
- Create: `services/api/test/server.test.ts`

**Interfaces:**
- Consumes: every handler module.
- Produces: `interface ApiServer { url: string; close(): Promise<void> }`; `createApiServer(options: { port?: number; store?: Store; verifier?: TokenVerifier; clock?: Clock; ids?: IdGen }): Promise<ApiServer>`.

- [x] **Step 1: Write the failing test**

`services/api/test/server.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createApiServer, type ApiServer } from "../src/server.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { TokenVerifier } from "../src/auth.ts";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "good") return { uid: "u-1", claims: {} };
    if (token === "admin") return { uid: "admin-1", claims: { admin: true } };
    return null;
  },
};

let server: ApiServer;
let store: ReturnType<typeof createMemoryStore>;
const auth = { authorization: "Bearer good", "content-type": "application/json" };

beforeAll(async () => {
  store = createMemoryStore();
  server = await createApiServer({ store, verifier });
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  store.reset();
});

const get = (path: string, headers: Record<string, string> = auth) =>
  fetch(`${server.url}${path}`, { headers });

const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${server.url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("authentication", () => {
  it("rejects every /v1 endpoint without a bearer token", async () => {
    expect((await get("/v1/balance", {})).status).toBe(401);
    expect((await get("/v1/config", {})).status).toBe(401);
    expect((await post("/v1/serve", { tags: [], themeKind: "dark", count: 1 }, {})).status).toBe(401);
    expect((await post("/v1/receipts", { receipts: [] }, {})).status).toBe(401);
  });

  it("rejects a forged token", async () => {
    const headers = { authorization: "Bearer forged", "content-type": "application/json" };
    expect((await get("/v1/balance", headers)).status).toBe(401);
  });

  it("rejects a banned user with 403, not 401", async () => {
    await store.putUser({ uid: "u-1", status: "banned", createdAt: 0 });
    expect((await get("/v1/balance")).status).toBe(403);
  });
});

describe("routing", () => {
  it("404s an unknown path", async () => {
    expect((await get("/v1/nope")).status).toBe(404);
    expect((await get("/nope")).status).toBe(404);
  });

  it("400s a malformed serve body", async () => {
    expect((await post("/v1/serve", { tags: "no", themeKind: "dark", count: 1 })).status).toBe(400);
  });

  it("400s a body that is not JSON", async () => {
    const res = await fetch(`${server.url}/v1/serve`, { method: "POST", headers: auth, body: "{{{" });
    expect(res.status).toBe(400);
  });

  it("serves the balance as decimal strings", async () => {
    const res = await get("/v1/balance");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ availableMicros: "0", lifetimeMicros: "0" });
  });
});

describe("admin routes", () => {
  it("refuses a non-admin with 403", async () => {
    expect((await get("/v1/admin/users/u-1/ledger")).status).toBe(403);
  });

  it("allows an admin", async () => {
    const headers = { authorization: "Bearer admin", "content-type": "application/json" };
    const res = await get("/v1/admin/users/u-1/ledger", headers);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], nextCursor: null });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run services/api/test/server.test.ts`
Expected: FAIL — cannot resolve `../src/server.ts`.

- [x] **Step 3: Write the implementation**

`services/api/src/server.ts`:

```ts
/**
 * Routing and error mapping.
 *
 * Deliberately the least clever file in the service: a bug in `money.ts` is expensive and
 * quiet, a bug here is obvious the first time anyone calls the endpoint. All the logic
 * worth testing hard lives in the modules this one wires together.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { authenticate, type TokenVerifier } from "./auth.ts";
import { handleServe } from "./serve.ts";
import { handleReceipts } from "./receipts.ts";
import { handleBalance, handleLedger } from "./balance.ts";
import { handleConfig } from "./config.ts";
import { handleAdminLedger } from "./admin.ts";
import { parseReceiptsRequest, parseServeRequest } from "./contract.ts";
import { createMemoryStore } from "./memoryStore.ts";
import type { Clock, IdGen, Store } from "./store.ts";

export interface ApiServer {
  url: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const ADMIN_LEDGER = /^\/v1\/admin\/users\/([^/]+)\/ledger$/;

export async function createApiServer(options: {
  port?: number;
  store?: Store;
  verifier?: TokenVerifier;
  clock?: Clock;
  ids?: IdGen;
} = {}): Promise<ApiServer> {
  const store = options.store ?? createMemoryStore();
  const clock = options.clock ?? { now: () => Date.now() };

  let counter = 0;
  const ids = options.ids ?? { next: (prefix: string) => `${prefix}-${++counter}-${Date.now()}` };

  const verifier = options.verifier;
  if (verifier === undefined) throw new Error("a TokenVerifier is required");

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    if (!path.startsWith("/v1/")) {
      send(res, 404, { error: "not found" });
      return;
    }

    const auth = await authenticate({ store, verifier, clock }, req.headers.authorization);
    if (!auth.ok) {
      // A ban is 403 rather than 401: the credentials are fine, the answer is still no,
      // and a client that retries auth on a 401 would loop forever.
      const status = auth.failure === "banned" ? 403 : 401;
      send(res, status, { error: auth.failure });
      return;
    }

    const admin = ADMIN_LEDGER.exec(path);
    if (admin !== null && req.method === "GET") {
      if (!auth.isAdmin) {
        send(res, 403, { error: "not-admin" });
        return;
      }
      const subject = decodeURIComponent(admin[1] ?? "");
      const page = { limit: 50, cursor: url.searchParams.get("cursor") };
      send(res, 200, await handleAdminLedger({ store, clock }, auth.uid, subject, page));
      return;
    }

    if (path === "/v1/serve" && req.method === "POST") {
      let raw: unknown;
      try {
        raw = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "malformed body" });
        return;
      }
      const body = parseServeRequest(raw);
      if (body === null) {
        send(res, 400, { error: "malformed serve request" });
        return;
      }
      send(res, 200, await handleServe({ store, clock, ids }, auth.uid, body));
      return;
    }

    if (path === "/v1/receipts" && req.method === "POST") {
      let raw: unknown;
      try {
        raw = JSON.parse(await readBody(req));
      } catch {
        send(res, 400, { error: "malformed body" });
        return;
      }
      const body = parseReceiptsRequest(raw);
      if (body === null) {
        send(res, 400, { error: "malformed receipts request" });
        return;
      }
      send(res, 200, await handleReceipts({ store, clock, ids }, auth.uid, body));
      return;
    }

    if (path === "/v1/balance" && req.method === "GET") {
      send(res, 200, await handleBalance(store, auth.uid));
      return;
    }

    if (path === "/v1/ledger" && req.method === "GET") {
      const limitRaw = Number(url.searchParams.get("limit") ?? "50");
      const limit = Number.isInteger(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;
      send(res, 200, await handleLedger(store, auth.uid, { limit, cursor: url.searchParams.get("cursor") }));
      return;
    }

    if (path === "/v1/config" && req.method === "GET") {
      send(res, 200, await handleConfig(store));
      return;
    }

    send(res, 404, { error: "not found" });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: "internal" });
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [x] **Step 4: Write the CLI entry point**

`services/api/src/cli.ts`:

```ts
/**
 * Run the service. Cloud Run supplies PORT; locally it defaults to 8788 so it does not
 * collide with the mock server on 8787.
 */
import { createApiServer } from "./server.ts";
import { createFirebaseVerifier } from "../adapters/firebaseAuth.ts";
import { createFirestoreStore } from "../adapters/firestoreStore.ts";

const port = Number(process.env["PORT"] ?? 8788);

const server = await createApiServer({
  port,
  store: createFirestoreStore(),
  verifier: createFirebaseVerifier(),
});

process.stdout.write(`api listening on ${server.url}\n`);
```

- [x] **Step 5: Run the test to verify it passes**

Run: `npx vitest run services/api/test/server.test.ts`
Expected: PASS.

Note: `cli.ts` imports the adapters, which do not exist until Task 14. Typecheck will fail until then — **write `cli.ts` in Task 14 instead if you are running tasks strictly in order.** Skip Step 4 here and note it as deferred.

- [x] **Step 6: Run the full verification gate**

Run: `npm run verify`
Expected: all green (with `cli.ts` deferred to Task 14).

- [x] **Step 7: Commit**

```bash
git add services/api/src/server.ts services/api/test/server.test.ts
git commit -m "feat(api): routing, with bans as 403 and forgeries as 401"
```

---

### Task 13: The conformance suite

Proves the real service and the mock agree. Spec D3 — the highest-value item in the slice.

**Files:**
- Create: `services/api/test/conformance/contractSuite.ts`
- Create: `services/api/test/conformance/api.test.ts`
- Create: `mock-server/test/conformance.test.ts`

**Interfaces:**
- Consumes: `server.ts`, `mock-server/src/server.ts`.
- Produces: `describeContract(name: string, start: () => Promise<{ url: string; close(): Promise<void>; reset(): Promise<void> }>): void`.

- [x] **Step 1: Write the shared suite**

`services/api/test/conformance/contractSuite.ts`:

```ts
/**
 * The contract, as a suite that runs against any implementation of it.
 *
 * Spec D3: `mock-server` and `services/api` are independent implementations of the same
 * wire contract, and the only way to know they still agree is to run the same assertions
 * against both. Drift becomes a test failure rather than a production incident.
 *
 * These assertions read the wire shape loosely on purpose. Typing them through either
 * side's interfaces would couple them again and defeat the independence that makes the
 * comparison meaningful.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

export interface Harness {
  url: string;
  close(): Promise<void>;
  reset(): Promise<void>;
}

export function describeContract(name: string, start: () => Promise<Harness>): void {
  describe(`contract: ${name}`, () => {
    let harness: Harness;
    const auth = { authorization: "Bearer good", "content-type": "application/json" };

    beforeAll(async () => {
      harness = await start();
    });

    afterAll(async () => {
      await harness.close();
    });

    beforeEach(async () => {
      await harness.reset();
    });

    const get = (path: string, headers: Record<string, string> = auth) =>
      fetch(`${harness.url}${path}`, { headers });

    const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
      fetch(`${harness.url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

    it("rejects every endpoint without a bearer token", async () => {
      expect((await get("/v1/balance", {})).status).toBe(401);
      expect((await get("/v1/config", {})).status).toBe(401);
      expect((await post("/v1/serve", { tags: [], themeKind: "dark", count: 1 }, {})).status).toBe(401);
      expect((await post("/v1/receipts", { receipts: [] }, {})).status).toBe(401);
    });

    it("returns balance as decimal integer strings", async () => {
      const body = await (await get("/v1/balance")).json() as Record<string, unknown>;
      expect(typeof body["availableMicros"]).toBe("string");
      expect(typeof body["lifetimeMicros"]).toBe("string");
      expect(body["availableMicros"]).toMatch(/^-?[0-9]{1,19}$/);
      expect(body["lifetimeMicros"]).toMatch(/^-?[0-9]{1,19}$/);
    });

    it("returns a config with a projection for every cadence", async () => {
      const body = await (await get("/v1/config")).json() as Record<string, any>;
      expect(typeof body["killSwitch"]).toBe("boolean");
      expect(typeof body["caps"]).toBe("object");
      for (const preset of ["off", "light", "standard", "max"]) {
        expect(typeof body["projections"][preset]).toBe("string");
        expect(body["projections"][preset]).toMatch(/^-?[0-9]{1,19}$/);
      }
    });

    it("rejects a malformed serve request with 400", async () => {
      expect((await post("/v1/serve", { tags: "no", themeKind: "dark", count: 1 })).status).toBe(400);
      expect((await post("/v1/serve", { tags: [], themeKind: "puce", count: 1 })).status).toBe(400);
      expect((await post("/v1/serve", { tags: [], themeKind: "dark" })).status).toBe(400);
    });

    it("returns creatives within the client's field limits", async () => {
      const res = await post("/v1/serve", { tags: ["lang:rust"], themeKind: "dark", count: 3 });
      expect(res.status).toBe(200);

      const body = await res.json() as { creatives: Record<string, any>[] };
      expect(Array.isArray(body.creatives)).toBe(true);
      expect(body.creatives.length).toBeLessThanOrEqual(50);

      for (const c of body.creatives) {
        expect(c["creativeId"]).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
        expect(String(c["advertiser"]).length).toBeLessThanOrEqual(40);
        expect(String(c["headline"]).length).toBeLessThanOrEqual(80);
        if (c["body"] !== null) expect(String(c["body"]).length).toBeLessThanOrEqual(160);
        expect(String(c["clickUrl"]).length).toBeLessThanOrEqual(2048);
        expect(typeof c["ttlMs"]).toBe("number");
      }
    });

    it("never returns more creatives than asked for", async () => {
      const body = await (await post("/v1/serve", { tags: ["lang:rust"], themeKind: "dark", count: 1 })).json() as { creatives: unknown[] };
      expect(body.creatives.length).toBeLessThanOrEqual(1);
    });

    it("acks every receipt it is sent", async () => {
      const receipt = {
        receiptId: "r-conformance-1",
        creativeId: "c-1",
        shownAt: Date.now() - 5_000,
        dwellMs: 4_200,
        themeKind: "dark",
        outcome: "impression",
      };
      const body = await (await post("/v1/receipts", { receipts: [receipt] })).json() as { acked: string[] };
      expect(body.acked).toContain("r-conformance-1");
    });

    it("is idempotent on a replayed receipt", async () => {
      const receipt = {
        receiptId: "r-conformance-2",
        creativeId: "c-1",
        shownAt: Date.now() - 5_000,
        dwellMs: 4_200,
        themeKind: "dark",
        outcome: "impression",
      };
      await post("/v1/receipts", { receipts: [receipt] });
      const before = await (await get("/v1/balance")).json() as Record<string, string>;

      await post("/v1/receipts", { receipts: [receipt] });
      const after = await (await get("/v1/balance")).json() as Record<string, string>;

      expect(after["availableMicros"]).toBe(before["availableMicros"]);
    });

    it("acks an empty batch", async () => {
      const body = await (await post("/v1/receipts", { receipts: [] })).json() as { acked: string[] };
      expect(body.acked).toEqual([]);
    });

    it("404s an unknown path", async () => {
      expect((await get("/v1/definitely-not-a-route")).status).toBe(404);
    });
  });
}
```

- [x] **Step 2: Run the suite against the real service**

`services/api/test/conformance/api.test.ts`:

```ts
import { describeContract } from "./contractSuite.ts";
import { createApiServer } from "../../src/server.ts";
import { createMemoryStore } from "../../src/memoryStore.ts";
import type { TokenVerifier } from "../../src/auth.ts";

const verifier: TokenVerifier = {
  async verify(token) {
    return token === "good" ? { uid: "u-conformance", claims: {} } : null;
  },
};

describeContract("services/api", async () => {
  const store = createMemoryStore();

  // Seeded so the serve assertions have inventory to return. The conformance suite must
  // not depend on how either implementation gets its inventory, only on the wire shape.
  await store.putCampaign({
    campaignId: "camp-conformance",
    advertiserId: "adv-1",
    cpmMicros: 8_000_000n,
    budgetMicros: 10_000_000n,
    targetTags: [],
    status: "active",
  });
  await store.putCreative({
    creativeId: "c-1",
    campaignId: "camp-conformance",
    advertiser: "Acme",
    headline: "Ship faster",
    body: "A tool for teams",
    clickUrl: "https://acme.test/x",
    logoLight: "https://cdn.test/l.png",
    logoDark: "https://cdn.test/d.png",
    status: "approved",
  });

  const server = await createApiServer({ store, verifier });

  return {
    url: server.url,
    close: () => server.close(),
    async reset() {
      // Deliberately not a full reset: the seeded inventory must survive, or every serve
      // assertion would run against an empty pool and pass vacuously.
    },
  };
});
```

- [x] **Step 3: Run the same suite against the mock**

`mock-server/test/conformance.test.ts`:

```ts
import { describeContract } from "../../services/api/test/conformance/contractSuite.ts";
import { createMockServer } from "../src/server.ts";

describeContract("mock-server", async () => {
  const server = await createMockServer();
  return {
    url: server.url,
    close: () => server.close(),
    async reset() {
      await fetch(`${server.url}/__test__/reset`, { method: "POST" });
    },
  };
});
```

- [x] **Step 4: Run both**

Run: `npx vitest run services/api/test/conformance mock-server/test/conformance.test.ts`
Expected: PASS for both implementations.

If the real service fails an assertion the mock passes, the real service is wrong — the mock has been the reference for 194 client tests. Fix the service, not the suite.

- [x] **Step 5: Check the firewall still holds**

`mock-server/test/conformance.test.ts` imports from `services/`, not `packages/`, so `mock-server-must-not-import-client` is unaffected.

Run: `npm run firewall`
Expected: PASS. If it fails, the rule's `to.path` is broader than `^packages/` — read the failure before changing anything.

- [x] **Step 6: Run the full verification gate**

Run: `npm run verify`
Expected: all green.

- [x] **Step 7: Commit**

```bash
git add services/api/test/conformance mock-server/test/conformance.test.ts
git commit -m "test(api): one contract suite, two implementations"
```

---

### Task 14: The Firestore and Firebase adapters

The only code in the slice that cannot be tested without cloud tooling. Everything above stays green whether or not this task's tests can run.

**Files:**
- Create: `services/api/adapters/firestoreStore.ts`
- Create: `services/api/adapters/firebaseAuth.ts`
- Create: `services/api/src/cli.ts` (deferred from Task 12)
- Create: `services/api/Dockerfile`
- Create: `services/api/test/emulator/firestoreStore.emulator.test.ts`
- Modify: `vitest.config.ts` (exclude the emulator suite from the default run)
- Modify: `package.json` (add `test:emulator`)

**Interfaces:**
- Consumes: `store.ts` (`Store`), `auth.ts` (`TokenVerifier`).
- Produces: `createFirestoreStore(): Store`; `createFirebaseVerifier(): TokenVerifier`.

- [x] **Step 1: Add `firebase-admin` as a dependency of the service only**

Run: `npm install firebase-admin --save-optional`

It is optional because nothing in `src/` imports it — the unit and conformance suites must keep running if it is absent.

- [x] **Step 2: Exclude the emulator suite from the default test run**

In `vitest.config.ts`, add to `test.exclude`:

```ts
exclude: ["**/node_modules/**", "**/__fixtures__/**", "**/test/emulator/**"],
```

In the root `package.json` scripts:

```json
"test:emulator": "firebase emulators:exec --only firestore \"vitest run services/api/test/emulator\""
```

- [x] **Step 3: Write the Firestore adapter**

`services/api/adapters/firestoreStore.ts`. The whole file is a translation between the `Store` port and Firestore's API — bigint to int64 on write, back on read:

```ts
/**
 * The `Store` port against Firestore.
 *
 * Spec D2: this is the only file that knows Firestore exists. Everything above it is
 * tested against `memoryStore.ts`, so a bug here is a translation bug - which is why the
 * emulator tests below check exactly the translation: bigint to int64 and back, the
 * atomicity of the append, and the idempotency of receipt creation.
 *
 * Firestore stores integers as int64 natively, but the JS client hands them back as
 * `number`, which silently loses precision above 2^53. Micros are therefore written as
 * strings and converted at the boundary. That costs a little space and buys exactness.
 */
import { applyEntry, EMPTY_BALANCE, type Balance, type LedgerEntry } from "../src/ledger.ts";
import type {
  AuditRecord, CampaignRecord, CreativeRecord, EntryPage, Page, ReceiptRecord,
  ServeRecord, ServingConfig, Store, UserRecord,
} from "../src/store.ts";

// Imported lazily so the unit suites never load firebase-admin.
type Firestore = import("firebase-admin/firestore").Firestore;

export function createFirestoreStore(db?: Firestore): Store {
  const lazy = async (): Promise<Firestore> => {
    if (db !== undefined) return db;
    const { getFirestore } = await import("firebase-admin/firestore");
    const { initializeApp, getApps } = await import("firebase-admin/app");
    if (getApps().length === 0) initializeApp();
    db = getFirestore();
    return db;
  };

  const toMicros = (v: unknown): bigint => BigInt(typeof v === "string" ? v : "0");
  const fromMicros = (v: bigint): string => v.toString();

  return {
    async getUser(uid) {
      const snap = await (await lazy()).collection("users").doc(uid).get();
      return snap.exists ? (snap.data() as UserRecord) : null;
    },

    async putUser(user) {
      await (await lazy()).collection("users").doc(user.uid).set(user);
    },

    async putCampaign(c) {
      await (await lazy()).collection("campaigns").doc(c.campaignId).set({
        ...c,
        cpmMicros: fromMicros(c.cpmMicros),
        budgetMicros: fromMicros(c.budgetMicros),
      });
    },

    async activeCampaignsFor(tags) {
      const db = await lazy();
      const active = await db.collection("campaigns").where("status", "==", "active").get();

      const wanted = new Set(tags);
      return active.docs
        .map((d) => {
          const raw = d.data();
          return {
            ...(raw as Omit<CampaignRecord, "cpmMicros" | "budgetMicros">),
            cpmMicros: toMicros(raw["cpmMicros"]),
            budgetMicros: toMicros(raw["budgetMicros"]),
          } as CampaignRecord;
        })
        .filter((c) => c.targetTags.length === 0 || c.targetTags.some((t) => wanted.has(t)));
    },

    async putCreative(c) {
      await (await lazy()).collection("creatives").doc(c.creativeId).set(c);
    },

    async getCreative(creativeId) {
      const snap = await (await lazy()).collection("creatives").doc(creativeId).get();
      return snap.exists ? (snap.data() as CreativeRecord) : null;
    },

    async creativesForCampaign(campaignId) {
      const snap = await (await lazy())
        .collection("creatives")
        .where("campaignId", "==", campaignId)
        .where("status", "==", "approved")
        .get();
      return snap.docs.map((d) => d.data() as CreativeRecord);
    },

    async recordServe(serve) {
      await (await lazy()).collection("serves").doc(serve.serveId).set(serve);
    },

    async findServe(uid, creativeId, now) {
      const snap = await (await lazy())
        .collection("serves")
        .where("uid", "==", uid)
        .where("creativeId", "==", creativeId)
        .where("expiresAt", ">", now)
        .limit(1)
        .get();
      const doc = snap.docs[0];
      return doc === undefined ? null : (doc.data() as ServeRecord);
    },

    async createReceiptIfAbsent(receipt) {
      const ref = (await lazy()).collection("receipts").doc(receipt.receiptId);
      try {
        // `create` fails if the document exists. That failure IS the idempotency check,
        // and it is atomic in a way a read-then-write never is.
        await ref.create({ ...receipt, creditedMicros: fromMicros(receipt.creditedMicros) });
        return true;
      } catch {
        return false;
      }
    },

    async appendEntryAndUpdateBalance(entry: LedgerEntry) {
      const db = await lazy();
      const entryRef = db.collection("ledger").doc(entry.entryId);
      const balanceRef = db.collection("balances").doc(entry.uid);

      await db.runTransaction(async (tx) => {
        const existing = await tx.get(entryRef);
        if (existing.exists) throw new Error(`ledger entry ${entry.entryId} already exists`);

        const balanceSnap = await tx.get(balanceRef);
        const current: Balance = balanceSnap.exists
          ? {
              availableMicros: toMicros(balanceSnap.data()?.["availableMicros"]),
              lifetimeMicros: toMicros(balanceSnap.data()?.["lifetimeMicros"]),
              pendingWithdrawalMicros: toMicros(balanceSnap.data()?.["pendingWithdrawalMicros"]),
            }
          : EMPTY_BALANCE;

        const next = applyEntry(current, entry);

        tx.set(entryRef, { ...entry, micros: fromMicros(entry.micros) });
        tx.set(balanceRef, {
          availableMicros: fromMicros(next.availableMicros),
          lifetimeMicros: fromMicros(next.lifetimeMicros),
          pendingWithdrawalMicros: fromMicros(next.pendingWithdrawalMicros),
        });
      });
    },

    async getBalance(uid) {
      const snap = await (await lazy()).collection("balances").doc(uid).get();
      if (!snap.exists) return EMPTY_BALANCE;
      const raw = snap.data();
      return {
        availableMicros: toMicros(raw?.["availableMicros"]),
        lifetimeMicros: toMicros(raw?.["lifetimeMicros"]),
        pendingWithdrawalMicros: toMicros(raw?.["pendingWithdrawalMicros"]),
      };
    },

    async listEntries(uid, page: Page): Promise<EntryPage> {
      const db = await lazy();
      let q = db
        .collection("ledger")
        .where("uid", "==", uid)
        .orderBy("createdAt", "desc")
        .limit(page.limit + 1);

      if (page.cursor !== null) {
        const cursorSnap = await db.collection("ledger").doc(page.cursor).get();
        if (cursorSnap.exists) q = q.startAfter(cursorSnap);
      }

      const snap = await q.get();
      const docs = snap.docs.slice(0, page.limit);
      const rows = docs.map((d) => {
        const raw = d.data();
        return { ...(raw as LedgerEntry), micros: toMicros(raw["micros"]) };
      });
      const more = snap.docs.length > page.limit;
      const last = rows.at(-1);

      return { rows, nextCursor: more && last !== undefined ? last.entryId : null };
    },

    async addSpend(campaignId, micros) {
      const db = await lazy();
      const config = await this.getConfig();
      const shard = Math.floor(Math.random() * config.spendShardCount);
      const ref = db.collection("campaigns").doc(campaignId).collection("spendShards").doc(String(shard));

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = toMicros(snap.data()?.["micros"]);
        tx.set(ref, { micros: fromMicros(current + micros) });
      });
    },

    async getSpend(campaignId) {
      const snap = await (await lazy())
        .collection("campaigns").doc(campaignId).collection("spendShards").get();
      return snap.docs.reduce((total, d) => total + toMicros(d.data()["micros"]), 0n);
    },

    async getConfig(): Promise<ServingConfig> {
      const snap = await (await lazy()).collection("config").doc("serving").get();
      const raw = snap.data() ?? {};
      return {
        killSwitch: raw["killSwitch"] === true,
        caps: (raw["caps"] as ServingConfig["caps"]) ?? {},
        defaultCpmMicros: toMicros(raw["defaultCpmMicros"]),
        revSharePercent: toMicros(raw["revSharePercent"]),
        spendShardCount: typeof raw["spendShardCount"] === "number" ? raw["spendShardCount"] : 4,
        serveTtlMs: typeof raw["serveTtlMs"] === "number" ? raw["serveTtlMs"] : 600_000,
      };
    },

    async putConfig(config) {
      await (await lazy()).collection("config").doc("serving").set({
        ...config,
        defaultCpmMicros: fromMicros(config.defaultCpmMicros),
        revSharePercent: fromMicros(config.revSharePercent),
      });
    },

    async writeAudit(record: AuditRecord) {
      await (await lazy()).collection("adminAudit").add(record);
    },

    async listAudit() {
      const snap = await (await lazy()).collection("adminAudit").orderBy("at", "desc").limit(500).get();
      return snap.docs.map((d) => d.data() as AuditRecord);
    },
  };
}
```

- [x] **Step 4: Write the auth adapter**

`services/api/adapters/firebaseAuth.ts`:

```ts
/**
 * `TokenVerifier` against Firebase Admin.
 *
 * The client signs in anonymously over the Identity Toolkit REST endpoints
 * (`packages/ads/src/auth.ts`); this verifies the ID token that produces. Roles arrive as
 * custom claims inside the verified token, so a role check costs no read.
 */
import type { TokenVerifier, VerifiedToken } from "../src/auth.ts";

export function createFirebaseVerifier(): TokenVerifier {
  return {
    async verify(idToken: string): Promise<VerifiedToken | null> {
      try {
        const { getAuth } = await import("firebase-admin/auth");
        const { initializeApp, getApps } = await import("firebase-admin/app");
        if (getApps().length === 0) initializeApp();

        const decoded = await getAuth().verifyIdToken(idToken, true);
        return { uid: decoded.uid, claims: decoded as unknown as Record<string, unknown> };
      } catch {
        // A token that fails verification for any reason is simply not a token. The
        // caller maps this to 401; distinguishing 'expired' from 'forged' in the response
        // would tell an attacker which of the two they achieved.
        return null;
      }
    },
  };
}
```

- [x] **Step 5: Write `cli.ts`** — the file deferred from Task 12. Use the code given in Task 12, Step 4, verbatim.

- [x] **Step 6: Write the Dockerfile**

`services/api/Dockerfile`:

```dockerfile
# Node 24 runs the TypeScript directly, so there is no build stage - the same property
# that lets `npm run mock-server` start with no build step.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY services/api ./services/api

ENV NODE_ENV=production
EXPOSE 8788

CMD ["node", "services/api/src/cli.ts"]
```

- [x] **Step 7: Write the emulator tests**

`services/api/test/emulator/firestoreStore.emulator.test.ts`:

```ts
/**
 * The only tests that need external tooling. Run with `npm run test:emulator`.
 *
 * They check exactly what the adapter is responsible for and nothing else: that micros
 * survive the round trip as exact integers, that the append is atomic, and that receipt
 * creation is genuinely idempotent under Firestore's semantics rather than the memory
 * store's.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFirestoreStore } from "../../adapters/firestoreStore.ts";
import type { Store } from "../../src/store.ts";

let store: Store;

beforeEach(() => {
  process.env["FIRESTORE_EMULATOR_HOST"] ??= "127.0.0.1:8080";
  process.env["GCLOUD_PROJECT"] ??= "adcode-test";
  store = createFirestoreStore();
});

describe("micros survive the round trip exactly", () => {
  it("preserves a value far above 2^53, where a JS number would have lost precision", async () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    await store.appendEntryAndUpdateBalance({
      entryId: `e-${Date.now()}`,
      uid: "u-precision",
      kind: "adjustment",
      micros: huge,
      refId: null,
      createdAt: Date.now(),
      description: "precision probe",
    });

    expect((await store.getBalance("u-precision")).availableMicros).toBe(huge);
  });
});

describe("receipt idempotency under Firestore", () => {
  it("creates once and refuses the replay", async () => {
    const receiptId = `r-${Date.now()}`;
    const record = { receiptId, uid: "u-1", creativeId: "c-1", outcome: "impression", creditedMicros: 4_000n };

    expect(await store.createReceiptIfAbsent(record)).toBe(true);
    expect(await store.createReceiptIfAbsent(record)).toBe(false);
  });
});

describe("the append is atomic", () => {
  it("refuses a duplicate entry id", async () => {
    const entryId = `e-dup-${Date.now()}`;
    const entry = {
      entryId,
      uid: "u-dup",
      kind: "impression" as const,
      micros: 1_000n,
      refId: null,
      createdAt: Date.now(),
      description: "dup probe",
    };

    await store.appendEntryAndUpdateBalance(entry);
    await expect(store.appendEntryAndUpdateBalance(entry)).rejects.toThrow(/already exists/i);
    expect((await store.getBalance("u-dup")).availableMicros).toBe(1_000n);
  });
});
```

- [x] **Step 8: Run the default suite, which must not need the emulator**

Run: `npm run verify`
Expected: all green, with the emulator suite excluded.

- [x] **Step 9: Run the emulator suite if the tooling is available**

Run: `npm run test:emulator`
Expected: PASS.

If `firebase-tools` is not installed, this is the one place in the plan where a step can be legitimately skipped. Record it as **unverified** rather than passing — an adapter nobody has run against a real Firestore is an adapter nobody knows works.

- [x] **Step 10: Commit**

```bash
git add services/api/adapters services/api/src/cli.ts services/api/Dockerfile services/api/test/emulator vitest.config.ts package.json package-lock.json
git commit -m "feat(api): Firestore and Firebase adapters, behind the port"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §4 architecture, ports | 4 |
| §5 data model | 4, 14 |
| §5.1 creative limits | 2 |
| §5.2 sharded spend | 4, 14 |
| §6.1 ledger kinds | 3 |
| §6.2 reversals not edits, balance invariant | 3, 4 |
| §7 four contract endpoints | 8, 9, 10 |
| §7 new ledger endpoints | 10, 11 |
| §8 request flows | 8, 9 |
| §8.1 credit computation | 1 |
| §9 abuse posture | 6, 7, 9 |
| §10 testing, conformance | 13 |
| D1 type firewall | 2 |
| D2 store port | 4, 14 |
| D3 conformance suite | 13 |
| D4 bigint money | 1 |

**Known gaps, deliberately deferred and not silently dropped:**

- ~~**Per-UID rate ceilings (§9)**~~ — **closed during execution as Task 15.** `src/rateLimit.ts`, fixed windows, `requestsPerWindow` and `rateWindowMs` in config, enforced in `server.ts` after authentication and before routing so no endpoint can be exempted by accident. Returns 429 with `retry-after`.
- **The nightly reconciliation job (§6.2)** has no task. The invariant is enforced inside `appendEntryAndUpdateBalance` in both store implementations, so drift can only arise from a direct console edit. The job is a safety net for that case and belongs with the admin panel.
- **Withdrawal entry kinds** are implemented and tested in `ledger.ts` (Task 3) but no endpoint raises them, exactly as §12 intends. The fold is correct and tested ahead of the flow that will use it.

**Type consistency:** `Store` method names are used identically in Tasks 4, 8, 9, 10, 11, 13, 14. `LedgerEntry` field names match between `ledger.ts` (Task 3), `memoryStore.ts` (Task 4) and `firestoreStore.ts` (Task 14). `Page`/`EntryPage` shapes match between `store.ts`, `balance.ts` and `admin.ts`. `advertiserCostMicros`/`userCreditMicros` are called with the same argument order in Tasks 5, 9 and 10.

**One ordering hazard, called out where it bites:** `cli.ts` imports the adapters and therefore cannot typecheck until Task 14. Task 12 Step 5 says to defer it; Task 14 Step 5 says to write it.

---

## Execution record

Executed 2026-08-18 on `feat/platform-foundation`. All fourteen tasks completed, plus a
Task 15 that closed the rate-limiting gap above.

**Verified:** `npm run verify` green after every task — final run 1347 tests across 81
files, typecheck and firewall clean. The `api-must-not-import-client` rule was watched
failing before being trusted. The conformance suite passes against both `services/api`
and `mock-server`, 11 assertions each.

**Not verified:** `services/api/adapters/firestoreStore.ts`. The emulator suite is written
and `firebase-tools` is installed, but the Firestore emulator is a Java process and there
is no JDK on this machine. The adapter typechecks and nothing above the port depends on
it having run. Run `npm run test:emulator` once a JDK is available before deploying.

**Two plan bugs found while executing**, both in test expectations rather than design:
the `$8 CPM` comment in Task 1 stated the cost and credit the wrong way round (assertions
were right), and Task 10's pagination test expected `nextCursor` to be the next row rather
than the last one returned. Both fixed in the committed tests.
