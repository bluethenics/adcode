# Ad core design — slice 1

**Date:** 2026-08-16
**Status:** approved for implementation
**Source brief:** `2026-08-15-scratch-ide-build-prompt.md`
**Scope:** all twelve `packages/ads` modules + `mock-server`, headless. No Electron, no window.

---

## 1. Why this slice

The brief's §14.4 says to start with the pure modules "because they are also the modules
where a bug is most expensive." This slice takes that further: §2 guarantees `packages/ads`
has no Electron, Monaco, or DOM imports at all, and §8 shows why — `renderer.ts` writes to a
swappable `NotificationSink` and `adService.ts` is thin wiring behind IDE adapters. So every
one of the twelve modules is testable with fakes before a window exists.

That makes the whole ad client completable and provably correct now, leaving the editor-shell
slice with nothing to do but write adapters. It also keeps `client.ts` and `mock-server`
together, which matters: a mock server with no client exercising it is untested fixture code.

**Non-goals for this slice:** any UI, Electron, Monaco, xterm, LSP/DAP, the memory store, the
MCP server, packaging, signing. `packages/memory` exists here only as an empty boundary for
the firewall rule to bite on.

---

## 2. Decisions taken during brainstorming

| # | Question | Decision |
|---|---|---|
| 1 | First slice | The pure logic core, expanded to all 12 ad modules + mock server |
| 2 | Projected earnings vs. "client never computes money" | `/v1/config` ships a server-computed `projections` table; the client selects and formats a row |
| 3 | `auth.ts` with no Firebase project | Real Firebase **REST** implementation behind an injected `HttpTransport`, unit-tested against stubbed responses |
| 4 | Dependency posture | Zero runtime dependencies; hand-rolled validation |

---

## 3. Deviations from the brief

Each of these departs from something the brief states. They are listed so they can be
overruled deliberately rather than discovered later.

**D1 — `/v1/config` gains a `projections` field.**
§1 forbids the client computing money; §8.1 requires showing projected hourly earnings per
frequency preset. As written these cannot both hold. The server now computes the table.

**D2 — `auth.ts` uses Firebase Auth's REST endpoints, not the Firebase JS SDK.**
§8.4 says "It does use the Firebase **Auth** SDK directly." The SDK's auth layer expects
browser storage for persistence and would be the only runtime dependency in a package whose
value proposition (§2) is having none. The REST endpoints (`accounts:signUp`,
`securetoken.googleapis.com/v1/token`) are stable, public, and trivially stubbable. The
security posture of §1 is unchanged: identity still comes from a Firebase ID token, and no
signing key ships in the binary.

**D3 — `Micros` is `bigint`, not `number`.**
§1 says int64 micros, "Never floats." A JavaScript `number` *is* an IEEE-754 double. It is
exact below 2^53 (about $9 billion in micros), so `number` would work in practice — but the
rule exists to exclude precisely that reasoning from a revenue-share ledger. Consequence:
money crosses the wire as a **decimal string**, since JSON has no bigint, which gives
`validation.ts` a sharp obligation (parse digit-strings to bigint, reject everything else)
instead of a soft one.

**D4 — no schema library.**
`validation.ts` is hand-rolled. Decisive reason: §9 requires `__proto__` rejection, which has
to happen at `JSON.parse` time via a reviver, because a schema library only ever sees an
object that has already been constructed — by which point the prototype pollution has
happened.

**D5 — no ESLint.**
§2's stack list names vitest and fast-check; §1 names dependency-cruiser. ESLint appears
nowhere, and ESLint 10 + typescript-eslint 8 is an unforced compatibility risk. Purity is
enforced instead by dependency-cruiser rules plus `test/purity.test.ts`, which reads the five
pure modules' own source and asserts they contain no clock, randomness, or I/O access. That
is a stronger guarantee than a lint rule because it runs in the same suite as everything else.

**D6 — no npm workspaces.**
The repository is on a **FAT32** volume. FAT32 has no symlinks, and npm's workspace linking
is symlink-based; `npm install` fails with `EISDIR: illegal operation on a directory,
symlink`. §2's directory layout is preserved exactly, and the boundaries it exists to create
are enforced by dependency-cruiser and tsconfig rather than by `node_modules` symlinks. Slice 1
needs no cross-package imports at all — `ads` must not import `memory`, and `mock-server` must
not import either — so nothing is lost here. This becomes a real constraint only when
`apps/desktop` needs to import both packages. *Moving the repo to an NTFS volume would remove
this deviation entirely and is the recommended fix before the shell slice.*

**D7 — the frequency invariant is restated.**
§1 says remote config must never make the IDE "more annoying than its shipped defaults," but
§8.1 offers a user-selectable `max` preset (15min/20 per day) that is looser than the shipped
default (30min/8). The enforceable invariant is: *remote config may only tighten the user's
current effective caps.* `tightenCaps` implements that, and the property test asserts it.

**D8 — TypeScript pinned to 5.9.3.**
npm resolves `typescript@latest` to 6.0.3; §2 specifies TypeScript 5.x.

**D9 — `erasableSyntaxOnly` is on repo-wide.**
§10 relies on Node 24 running TypeScript with no build step. Node's type stripping cannot
handle enums, namespaces, or parameter properties. Turning the compiler flag on repo-wide
makes that a compile-time guarantee rather than a convention someone breaks in month three.

---

## 4. Architecture

### 4.1 Dependency direction

```
                         types.ts          (types + port interfaces; no logic)
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   pure modules        I/O modules          adapters
   scheduler           receiptQueue         renderer      ← NotificationSink
   validation          auth                 adService     ← composition root
   tagger              client
   ledger              assetCache
   sponsorsView
```

Pure modules import `types.ts` and nothing else — enforced by
`pure-modules-import-only-types` and `pure-modules-no-node-builtins`. I/O modules receive
every capability through a port. `adService.ts` is the only file that constructs anything real.

### 4.2 The six ports

All I/O in this package crosses one of these. Slice 1 ships a fake for each; the shell slice
ships the real ones.

| Port | Implemented by | Consumed by |
|---|---|---|
| `Clock` | host | receiptQueue, client, assetCache, adService |
| `HttpTransport` | host | auth, client, assetCache |
| `FileStore` | host | receiptQueue, assetCache |
| `TokenProvider` | `auth.ts` | client |
| `NotificationSink` | IDE | renderer |
| `IdeSignals` | IDE | adService |

The pure five receive no port at all. `scheduler.decide` gets `now` inside `SchedulerState`,
per §8.1's signature.

---

## 5. Core types

```ts
declare const MicrosBrand: unique symbol;
type Micros = bigint & { readonly [MicrosBrand]: true };

type ThemeKind = "light" | "dark";
type FrequencyPreset = "off" | "light" | "standard" | "max";
type Outcome = "impression" | "click" | "dismissed";

interface FrequencyCaps { minIntervalMs: number; dailyCap: number }

type SuppressReason =
  | "ads-disabled" | "kill-switch" | "frequency-off" | "settling"
  | "window-unfocused" | "debug-active" | "do-not-disturb"
  | "daily-cap" | "min-interval" | "no-creative";

type SchedulerDecision = { show: true } | { show: false; reason: SuppressReason };
```

### 5.1 Constants

| Constant | Value | Source |
|---|---|---|
| `SETTLE_MS` | 60_000 | §1 "60s settle period after launch" |
| `AUTO_DISMISS_MS` | 8_000 | §1 "8s auto-dismiss" |
| `MIN_DWELL_MS` | 4_000 | §1 "at least 4 seconds on screen" |
| `FETCH_TIMEOUT_MS` | 3_000 | §9 "3s fetch timeout" |
| `PREFETCH_TARGET` | 10 | §9 "~10 creatives" |
| `RECEIPT_QUEUE_CAP` | 500 | §9 "capped at 500, oldest dropped" |
| `MAX_TAGS` | 8 | not specified in the brief; chosen |

### 5.2 Frequency presets

| Preset | `minIntervalMs` | `dailyCap` |
|---|---|---|
| `off` | 0 | 0 |
| `light` | 3_600_000 | 4 |
| `standard` *(default)* | 1_800_000 | 8 |
| `max` | 900_000 | 20 |

`off` is short-circuited by the `frequency-off` reason before caps are consulted; its zero
values exist so that no code path can read an undefined cap.

---

## 6. Module contracts

### 6.1 `scheduler.ts` — pure

```ts
decide(state: SchedulerState): SchedulerDecision
tightenCaps(local: FrequencyCaps, remote: Partial<FrequencyCaps>): FrequencyCaps
```

Suppression is evaluated in exactly §8.1's order — user intent, then context, then rate
limits, then inventory — so the reason returned stays meaningful as telemetry:

```
ads-disabled → kill-switch → frequency-off → settling → window-unfocused
→ debug-active → do-not-disturb → daily-cap → min-interval → no-creative
```

`tightenCaps` takes the **stricter** of each field: `max` of the two intervals, `min` of the
two caps. A remote value that is negative, `NaN`, non-finite, or not a number is discarded and
the local value stands — hostile input can never widen a cap.

### 6.2 `validation.ts` — pure

Entry point takes a **raw JSON string**, never a parsed object, because `__proto__` must be
rejected before an object exists:

```ts
parseServeResponse(raw: string): Result<Creative[], ValidationError>
parseConfigResponse(raw: string): Result<RemoteConfig, ValidationError>
parseBalanceResponse(raw: string): Result<Balance, ValidationError>
```

Rules, from §9 and §1:

- `JSON.parse` with a reviver that rejects the keys `__proto__`, `constructor`, `prototype`
- unknown fields rejected (not ignored)
- every URL `https:` only; `javascript:`, `data:`, `http:` rejected
- asset URLs must match an allowlisted host by **exact** hostname equality — a host that
  merely suffixes the allowed host is rejected
- text fields length-capped and stripped of markup: `advertiser` ≤ 40, `headline` ≤ 80,
  `body` ≤ 160, `creativeId` ≤ 64 matching `^[A-Za-z0-9_-]+$`
- both `logoLight` and `logoDark` required; a creative missing either is rejected
- monetary fields parsed from `^-?[0-9]{1,19}$` decimal strings into `bigint`

### 6.3 `tagger.ts` — pure

```ts
tag(input: { languageIds: string[]; filenames: string[] }): string[]
```

Filename-only detection (§1: never reads file *contents*). Every input is reduced to its
basename before matching, so a path arriving where a filename was expected cannot leak a
directory name. The final step intersects the result against `TAG_VOCABULARY` and slices to
`MAX_TAGS`, so even a carelessly edited mapping table cannot emit a tag that was not compiled
into the binary. This is why the §1 privacy claim is structural rather than aspirational.

Output is sorted and de-duplicated for stable request bodies and cache keys.

### 6.4 `ledger.ts` — pure

Mirrors the server balance and formats micros for display using **integer arithmetic only**:
`bigint` division and remainder, never `toFixed`, never division into a float. Negative values
and values above int64 range are handled explicitly.

### 6.5 `sponsorsView.ts` — pure

Shapes balance, history, and the server's `projections` table into view-model data. Per D1 it
**selects and formats** a projection; it never multiplies a rate by a count.

### 6.6 `receiptQueue.ts` — I/O

Disk-backed via `FileStore`, capped at 500 with oldest-dropped, deduped by `receiptId`.
Survives process restart; flushes on reconnect. A receipt is only ever enqueued if the
impression was valid (painted, focused for the full duration, ≥ 4s).

### 6.7 `auth.ts` — I/O

Firebase Anonymous Auth over REST (D2). Implements `TokenProvider`. Caches the ID token with
a refresh skew so a request never carries a token about to expire; refreshes via the secure
token endpoint; surfaces failure as a typed error rather than throwing into the caller's path.

### 6.8 `client.ts` — I/O

The four `/v1/*` calls with a 3s timeout, bounded exponential backoff with jitter, and
`validation.ts` applied to every response body before it is returned. Sends
`Authorization: Bearer <token>` from `TokenProvider` on every request; identity never appears
in a body field.

### 6.9 `assetCache.ts` — I/O

Fetches creative assets over `https` from the allowlisted host and caches them via
`FileStore`, so assets are never hot-linked (§1: hot-linking would hand every advertiser the
user's IP address and a fingerprinting beacon on every impression).

### 6.10 `renderer.ts` — adapter

Creative → notification, through a swappable `NotificationSink`. Owns the impression-validity
rule and the live theme swap: a toast on screen when the OS flips at sunset swaps `logoLight`
for `logoDark` rather than going invisible.

### 6.11 `adService.ts` — wiring

Startup, the 60s tick, IDE adapters. Thin. Wrapped so that any throw is contained — §9's
governing rule is that the worst permitted outcome of any ad-side failure is that the user
sees no ad.

### 6.12 `types.ts`

Types and port interfaces only. No logic.

---

## 7. Serving contract

All requests carry `Authorization: Bearer <firebase-id-token>`. Identity comes from the token,
never from a body field.

| Endpoint | Request | Response |
|---|---|---|
| `POST /v1/serve` | `{ tags[], themeKind, count }` | `{ creatives: [...] }` each with `creativeId`, `logoLight`, `logoDark`, `clickUrl`, `ttlMs` |
| `POST /v1/receipts` | `{ receipts: [...] }` | `{ acked: string[] }`, idempotent by `receiptId` |
| `GET /v1/balance` | — | `{ availableMicros, lifetimeMicros }` as decimal strings |
| `GET /v1/config` | — | `{ killSwitch, caps, projections }` — **may only tighten** |
| `POST /__test__/reset` | — | test-only state reset |

`projections` (D1) maps each `FrequencyPreset` to a server-computed micros-per-hour decimal
string.

---

## 8. Mock server

Node 24 runs it directly with no build step (§10). It implements the contract from the spec
above and **shares no types with the client** — its request/response shapes are hand-written
separately, and `mock-server-must-not-import-client` fails CI on any import from `packages/`.
A mock that shares the client's definitions cannot catch a contract mismatch, which is the
main thing it exists to do.

Also serves an asset host for `assetCache.ts`, and supports seeding a deterministic creative
so the end-to-end tests are not flaky.

---

## 9. Testing

Per §14.4, every module is written test-first: failing test, confirm it fails for the right
reason, implement, confirm it passes, commit.

| Target | Approach |
|---|---|
| `scheduler.ts` | Exhaustive unit tests across the suppression matrix, **plus** a fast-check property (500+ runs): no sequence of events can exceed the daily cap or violate the minimum interval. Driven through a simulator that owns day-rollover, so the property covers the real system rather than one function call. |
| `tagger.ts` | fast-check property (1000+ runs): for arbitrary hostile input, every emitted tag is in `TAG_VOCABULARY` and the count is ≤ `MAX_TAGS`. Explicit cases for paths-where-filenames-were-expected. |
| `validation.ts` | Hostile corpus: script tags in text fields, non-https URLs, `javascript:` URLs, prototype pollution, oversized strings, missing dark asset, and a host that merely *suffixes* the allowed host. |
| `client.ts` | Against the mock server: timeout, 5xx, malformed JSON, offline→online flush, receipt dedupe, token refresh. |
| Firewall | `packages/ads` has no import path to `packages/memory`. Verified two ways: the CI rule passes on the real tree, **and** a planted violation in a fixture makes the rule fail — a guard that has never been seen to fire is not known to work. Release blocker. |
| Purity | `test/purity.test.ts` reads the five pure modules' source and asserts no `Date`, `Math.random`, `process`, `fetch`, or `require`. |

---

## 10. Verification

```
npm run verify      # typecheck + firewall + full suite
```

Done for this slice when: all twelve modules implemented and green, both property tests
passing at their required run counts, the firewall proven to fire on a planted violation, and
`npm run verify` clean from a cold clone.

---

## 11. Carried forward

Open questions this slice deliberately does not answer, recorded so they are not rediscovered:

- **MCP transport (brief gap #4).** §5.2 puts the MCP server in the Electron main process and
  expects Claude Code to connect — but stdio transport *spawns* a command and cannot attach to
  a running process. Options are HTTP transport (memory reachable only while the IDE runs) or a
  standalone `adcode-mcp` stdio binary reading the store directly. The latter is possible only
  because §5.1 makes markdown the source of truth, and it makes §11's "concurrent writes from
  two MCP clients" a genuine multi-process locking requirement.
- **Tree-sitter × Monaco (brief gap #6).** No tree-sitter API exists in Monaco; under
  `sandbox: true` this means `web-tree-sitter` WASM plus `wasm-unsafe-eval` in a CSP §1
  requires be strict. Bespoke integration hiding behind one word in a feature list.
- **"Prettier-equivalent formatter" (brief gap #7).** Bundle MIT-licensed Prettier, or write
  one? These are wildly different builds.
- **FAT32 (D6).** Recommend moving to NTFS before the shell slice.
- **External blockers.** Windows OV/EV certificate (1–3 weeks org validation, hardware token),
  Apple Developer Program + macOS hardware for notarization, and §13's "used it for a full
  working day" are all outside what this build can complete.
