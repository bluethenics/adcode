# Project A — Branded IDE + Ad Client

**Date:** 2026-08-10
**Status:** Approved design, ready for implementation planning
**Scope:** Subsystems 1 and 2 of the ADCode platform

---

## 1. Context

The goal is an ad-supported IDE that is indistinguishable from VS Code, shows sponsored
slide-in notifications, and pays users 50% of the advertising revenue their attention
generates. Advertisers apply through a landing page and watch live campaign stats.

That is five subsystems, not one project:

| # | Subsystem | Project |
|---|---|---|
| 1 | The IDE itself, at VS Code parity | **A** |
| 2 | Ad delivery inside the IDE | **A** |
| 3 | Advertiser landing page, application, campaign management | B |
| 4 | Live stats dashboard and ad-serving API | B |
| 5 | Earnings ledger, payouts, KYC, fraud | C |

This document specifies **Project A only**. B and C get their own spec → plan → build
cycles. Project A is built against a defined API contract and a mock server, so it can be
completed and tested before B exists.

### 1.1 Why a fork, not a rewrite

VS Code's source is open as Code-OSS (MIT), but the Microsoft-branded build is not
redistributable: the name and icon are trademarked, and the Extension Marketplace, the C#
debugger, and the telemetry stack are proprietary and licensed only for official builds.

"Exact copy" therefore means **fork Code-OSS, rebrand, and source extensions from Open
VSX** — the same path taken by VSCodium, Cursor, and Windsurf. Writing an IDE from scratch
to VS Code parity is a multi-year effort and would guarantee the opposite of the "user must
not experience any issue" requirement.

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| IDE base | Fork Code-OSS, desktop | It *is* VS Code, so parity is free. |
| Ad surface | Native notification toast + Sponsors sidebar | Uses VS Code's real notification queue, so ads cannot stack up or cover code. |
| Motion | Deliberate slide-in from the right | Reads as an arrival, not a system alert. |
| Targeting | Coarse on-device tags + opt-in interests | Sellable CPM with a privacy policy developers accept. |
| First run | No account; anonymous UID, sign in only to cash out | A login wall in front of a code editor is where users quit. |
| Frequency | Conservative default + user earnings slider | Users who want more money opt into more ads themselves. |
| Revenue split | 50% of **gross** advertiser spend | The only reading that supports an unasterisked "we pay 50%". |
| Client architecture | Surgical fork patch (≤4 files) + built-in extension | Real ad unit without the fork-maintenance death spiral. |
| Auth & data | Firebase Auth (anonymous → linked) + Firestore | Anonymous-to-linked upgrade exactly matches the first-run flow. |

---

## 3. Repository and build

```
E:/adcode/
├─ vscode/                      Code-OSS, git submodule pinned to a release tag
├─ patches/
│   ├─ 0001-product-rebrand.patch
│   └─ 0002-sponsored-notification.patch
├─ extensions/adcode-ads/       the ad client (built-in extension)
├─ build/                       packaging, signing, update feed
├─ scripts/                     apply-patches, verify-patches, dev-run
├─ mock-server/                 local implementation of the serving contract
└─ docs/superpowers/specs/
```

**`vscode/` is never edited directly.** Every source change is a versioned diff in
`patches/`. Upgrading VS Code is: bump the submodule tag, run `scripts/verify-patches`,
repair whatever rotted. A nightly CI job applies the patches against upstream `main`, so a
break surfaces as a red build weeks before it could reach users.

### 3.1 Patch 0001 — rebrand

Edits `product.json`: `nameShort`, `nameLong`, `applicationName`, `dataFolderName`,
`urlProtocol`, win32 and darwin bundle identifiers, `extensionsGallery` pointed at Open
VSX, and `updateUrl` pointed at our update feed. Replaces icon assets. **Strips Microsoft
telemetry endpoints** — leaving them in would ship user data to Microsoft under our brand.

`dataFolderName` matters more than it appears: it is what prevents our IDE's settings from
colliding with a real VS Code installation on the same machine.

### 3.2 Patch 0002 — sponsored notification

Adds one new notification kind to the workbench notification renderer, with a logo slot, a
"Sponsored" label, its own registered theme color token, and the slide-in motion. Confined
to the notifications part (`src/vs/workbench/browser/parts/notifications/`) plus one CSS
file. Exact file list is pinned when the submodule is first cloned.

The patch also carries a render-time zen-mode guard, because zen-mode state is not exposed
through the public extension API (see §5.2).

---

## 4. The ad client

Six modules, each with one responsibility and independently testable.

| Module | Responsibility | Depends on |
|---|---|---|
| `tagger.ts` | Derive coarse interest tags on-device from open language IDs and workspace framework markers. Emits tags only. | vscode API |
| `scheduler.ts` | Decide whether to show an ad now. Frequency caps and suppression. | nothing — pure |
| `client.ts` | HTTPS API calls: fetch creatives, post receipts, read balance. Retry, backoff, offline queue. | fetch, auth token |
| `renderer.ts` | Turn a creative into the sponsored notification. Light/dark asset selection, button wiring. | vscode API |
| `ledger.ts` | Mirror the server-authoritative balance; cache for offline display. | client |
| `sponsorsView.ts` | Sidebar webview: ad history, balance, frequency setting, cash-out entry. | ledger |

`scheduler.ts` is deliberately a **pure function**: `(StateSnapshot) → Show | Suppress(reason)`.
No VS Code imports, no clock reads, no I/O. The single most user-visible behavior in the
product — how often people are interrupted — is therefore exhaustively unit-testable
without launching an editor.

### 4.1 What `tagger.ts` may and may not emit

**May emit:** language IDs of open editors (`typescript`, `go`, `rust`); presence of
framework markers detected by filename only (`package.json`, `Dockerfile`, `go.mod`,
`requirements.txt`); user-selected interest categories.

**May never emit or transmit:** file contents, file paths, directory names, workspace
names, git remotes, branch names, dependency lists, environment variables, or any
free-text drawn from the user's code.

Filename-level detection only. The tagger does not read the *contents* of `package.json`
or any other manifest.

---

## 5. Behavior

### 5.1 Frequency defaults

| Setting | Default |
|---|---|
| Minimum interval | 30 minutes |
| Daily cap | 8 |
| Auto-dismiss | 8 seconds, timer paused on hover |
| Settle period after launch | 60 seconds |

Users choose **Off / Light / Standard / Max** in settings, with projected hourly earnings
shown beside each option. "Off" is a real option and disables earnings accordingly.

### 5.2 Suppression rules

Two layers, deliberately:

**Extension layer** (testable, in `scheduler.ts`): no ad during an active debug session; no
ad when the window is unfocused; no ad within the launch settle period; no ad when VS
Code's Do Not Disturb is on; no ad that would violate the interval or daily cap.

**Patch layer** (render-time, in patch 0002): no ad while zen mode is active. Zen-mode
state is not available through the public extension API, so this guard reads the layout
service directly on the workbench side.

The second layer is also defense in depth — if the extension logic is ever wrong, the
render path still refuses in the cases that matter most.

### 5.3 Motion specification

```
                      ┌─────────────────┐
   offscreen  ····▸   │ [logo] Sponsored│  ◂···· editor edge
   translateX(100%)   │ Sentry — catch  │
   opacity 0          │ errors before…  │
                      └─────────────────┘
                      translateX(0), opacity 1
```

| Property | Value |
|---|---|
| Enter | `translateX(calc(100% + 12px)) → 0`, `opacity 0 → 1`, 220ms, `cubic-bezier(.16,1,.3,1)` |
| Exit | reverse, 160ms, ease-in |
| Stack reflow | existing toasts shift with a 180ms transform transition |

Three hard constraints:

1. **Only `transform` and `opacity` animate.** Both are GPU-composited. Animating `top`,
   `right`, `width`, or `height` forces layout every frame *while the user is typing*,
   which surfaces as input latency in the one application where latency is unforgivable.
   `will-change` is set on enter and removed on completion so no compositor layer is
   pinned for the session.
2. **Reduce-motion is honored.** When VS Code's reduce-motion setting is active (it follows
   the OS on `auto`), the slide is replaced by a 100ms opacity fade with no translation.
3. **The toast stays within VS Code's existing toast region**, which already reserves space
   clear of the scrollbar and minimap.

### 5.4 What counts as an impression

A receipt is generated only when **all** hold: the toast actually painted; the window was
focused for the duration; and it remained on screen at least 4 seconds. Anything else is
discarded client-side and never reported.

The client never computes money. It reports receipts; the server decides what an impression
is worth and owns the balance. The status-bar figure is a cached mirror. Anything else
makes the ledger forgeable by anyone with a debugger — which, given the users are
developers running the app locally, is all of them.

**"Authenticated", not "signed".** A receipt is authenticated by the Firebase ID token on
the request, and the server stamps `serverTs` and decides validity. Embedding a signing key
in the desktop binary to sign receipts client-side would be security theater: the key ships
with the app, so anyone can extract it and mint receipts. The client is treated as
untrusted throughout, and receipt validity is a server-side judgment (§6.6, §13).

---

## 6. Firebase integration

### 6.1 Identity

First launch performs **Firebase Anonymous Auth** — no UI, no wall — yielding a UID and ID
token. Earnings accrue against that UID server-side. At cash-out the client runs
`linkWithCredential`, upgrading *the same UID* to a real account. The balance carries over
with no ledger-merge logic required.

**The UID is stable, not rotating, and this is a deliberate trade-off.** A ledger cannot
accrue against an identifier that rotates. The consequence is that the anonymous UID is a
persistent pseudonymous identifier tied to one install, and the tag history attached to it
accumulates over time. That is a weaker privacy position than a rotating ID would give, and
it is the unavoidable price of paying users at all. It must be stated plainly in the
privacy policy rather than glossed as "anonymous".

What limits the exposure is §4.1: the tags themselves are coarse and contain nothing drawn
from the user's code, so a long history of them still reveals little. Users can reset the
identifier from settings, which forfeits any unclaimed balance — the client warns before
doing so.

Desktop OAuth uses the system browser with a deep-link return through the custom URL
protocol registered in patch 0001 (`adcode://auth/callback`), then a custom-token exchange.
Credentials never transit an embedded webview.

### 6.2 Access boundary

**The IDE never talks to Firestore directly.** It calls the HTTPS API (Cloud Run or
Functions v2), which owns Firestore. This keeps money-touching security rules at "no client
writes, ever", keeps the serving contract stable across schema churn, and avoids shipping
Firebase credentials inside a desktop binary that users can trivially inspect.

The boundary is Firestore specifically. The client *does* use the Firebase **Auth** SDK
directly — that is how it obtains the anonymous UID and ID token in the first place, and
how `linkWithCredential` runs at cash-out. Auth is designed for untrusted clients; Firestore
rules on a money ledger are not a place to find out whether that generalizes.

The Project B web dashboard is the opposite case: it reads Firestore directly with the
client SDK under read-only rules, where `onSnapshot` satisfies the live-stats requirement
with no polling infrastructure.

### 6.3 Data model

```
advertisers/{advertiserId}
campaigns/{campaignId}          budgetMicros, bidMicros, targetTags[], status
creatives/{creativeId}          campaignId, headline, body, logoLight, logoDark, clickUrl
devices/{uid}                   createdAt, tags[], frequencyPref, linkedAt
receipts/{receiptId}            uid, creativeId, kind, shownMs, focused, clientTs,
                                serverTs, status
ledgerEntries/{entryId}         uid, type, amountMicros, receiptId, createdAt
balances/{uid}                  availableMicros, lifetimeMicros
stats_daily/{campaignId}/{date} impressions, clicks, spendMicros
```

### 6.4 Money handling

All monetary values are **int64 micros of USD**. Never floats — binary floating point
cannot represent decimal currency exactly, and a rounding drift in a revenue-share ledger
is a legal problem, not a rounding problem.

`ledgerEntries` is **append-only and writable only by Cloud Functions**. Corrections are
new compensating entries, never edits. On a valid impression the server writes paired
entries: 50% credit to the user, 50% to the platform, both referencing the same receipt ID.
`balances` is derived, never authored by hand.

### 6.5 Write volume

Impressions must **not** write one Firestore document per event. Receipts land in a raw
collection or Pub/Sub topic and are aggregated in batches by a scheduled Function into
`stats_daily` using sharded counters. A naive per-event increment hits the per-document
write-rate limit and produces a bill out of proportion to the revenue being counted.

### 6.6 Known gap

Firebase App Check has no attestation provider for desktop applications. Combined with
§5.4 — no client-side receipt signing is meaningful, because any key shipped in the binary
can be extracted — anti-abuse rests **entirely on server-side heuristics**. There is no
cryptographic proof that a receipt came from a genuine, unmodified install.

This is inherent to shipping a native app to developers, not a gap to be closed later. It
is carried into Project C's fraud work and recorded as a risk in §13.

---

## 7. Serving contract

| Endpoint | Purpose |
|---|---|
| `POST /v1/serve` | `{ tags[], themeKind, count }` → creatives with light and dark assets, each with `creativeId` and TTL. Fills the prefetch cache. Identity comes from the Firebase ID token on the request, never a body field. |
| `POST /v1/receipts` | Batch of receipts, authenticated by Firebase ID token. Idempotent by receipt ID. |
| `GET /v1/balance` | Server-authoritative earnings. |
| `GET /v1/config` | Kill switch and cap ceilings. **May only tighten client caps, never loosen them.** |

The constraint on `/v1/config` is load-bearing: Project B cannot — through bug,
misconfiguration, or compromise — make the IDE more annoying than its shipped defaults.

`mock-server/` implements all four endpoints locally so Project A is completable and
testable without Project B.

---

## 8. Failure modes

> **Governing rule:** the ad client may fail in any way. The worst permitted outcome is
> that the user sees no ad.

| Failure | Behavior |
|---|---|
| Extension throws on activation | Activates on `onStartupFinished`, never `*`. The extension host isolates it; editor and startup time unaffected. |
| Ad server down or slow | 3s fetch timeout. A prefetch cache of ~10 creatives means a display never waits on the network. Offline: serve from cache until exhausted, then go quiet. |
| Receipts cannot be sent | Queue to disk, capped at 500, oldest dropped. Flush on reconnect. Deduped server-side by receipt ID, so users do not lose earnings to flaky wifi. |
| Malformed or hostile creative | Schema-validated before render: unknown fields rejected, text length capped, `https` only, assets restricted to the allowlisted asset host. |
| Server tries to over-serve | Frequency caps are client-side and authoritative. A compromised ad server still cannot spam users. |
| Ad click | `env.openExternal` to the system browser, `https` only. Never a webview, never in-editor navigation. |
| Emergency | Signed remote kill switch plus a local `adcode.ads.enabled` setting. Either stops everything. |

Creative assets are **fetched and cached by us, never hot-linked from advertiser servers**.
Hot-linking would hand every advertiser the users' IP addresses and a fingerprinting beacon
on every impression, quietly undoing the entire privacy position established in §4.1.

---

## 9. Theming

Code-OSS provides OS-following light/dark once `window.autoDetectColorScheme` is defaulted
on, with `workbench.preferredLightColorTheme` and `preferredDarkColorTheme` preset. On top
of that:

- Creatives carry `logoLight` and `logoDark`. The renderer selects via
  `window.activeColorTheme.kind` and subscribes to `onDidChangeActiveColorTheme`, so a
  toast on screen when the OS flips at sunset swaps its logo live rather than going
  invisible.
- The sponsored toast styles itself entirely from VS Code theme color tokens, plus one
  newly registered token for the "Sponsored" label. Third-party themes — which most
  developers use — then style it correctly instead of it reading as a foreign object
  pasted onto Dracula.
- High-contrast themes map to their light or dark counterpart for asset selection and
  respect the contrast border token.

---

## 10. Testing

- **`scheduler.ts`** — exhaustive unit tests across the suppression matrix, plus a property
  test: *no sequence of events can produce more than the daily cap or violate the minimum
  interval.* This is the behavior users judge the product on, so it carries the strongest
  guarantee in the codebase.
- **`client.ts`** — mock-server tests for timeout, 5xx, malformed JSON, offline→online
  flush, receipt dedupe, token refresh.
- **`renderer.ts`** — creative validation against hostile input: script in text fields,
  non-https URLs, oversized strings, missing dark asset.
- **`tagger.ts`** — assertion that no path, filename, or file content ever appears in
  emitted output, including for adversarially named files.
- **Patches** — `scripts/verify-patches` in CI, plus a smoke test that launches the built
  app and asserts a seeded creative renders in both themes and honors reduce-motion.
- **Integration** — `@vscode/test-electron`.
- **Manual gate, once per release** — a person uses the build as their actual editor for a
  full working day. No automated suite catches "this is annoying."

---

## 11. Distribution

Targets: Windows x64/arm64, macOS universal, Linux deb/rpm/tar.gz.

| Platform | Requirement |
|---|---|
| Windows | Code-signing certificate. Unsigned installers hit a SmartScreen "unrecognized app" wall that kills conversion. Since 2023 these certs require hardware-token or HSM storage. **Budget 1–3 weeks of organization validation before anything can be signed.** |
| macOS | Apple Developer Program ($99/yr) and notarization, or Gatekeeper refuses to open the app at all. |
| Linux | Free; a signing key is needed only to publish apt/yum repositories. |

Auto-update reuses VS Code's own update client via `updateUrl` in `product.json`, backed by
a small service implementing its update contract — a JSON feed plus artifact hosting.

---

## 12. Out of scope for Project A

Advertiser landing page, application flow, campaign creation, the live stats dashboard, the
real ad server, wallets, withdrawals, KYC, tax forms, fraud analytics beyond receipt
integrity, and any web or browser version of the IDE.

**Project A is done when:** a signed, installable, rebranded VS Code shows sponsored
slide-in toasts sourced from the mock server, honors every suppression rule, tracks a
mirrored balance against an anonymous Firebase UID, and follows the OS theme.

---

## 13. Risks

| Risk | Assessment |
|---|---|
| **Open VSX extension gap** | The most significant threat to "user must not experience any issue." Several of the most-used extensions — the C/C++ tools, C# debugger, Pylance, Remote-SSH — are Microsoft-licensed and **cannot legally be used in a fork**. Open VSX has open alternatives for some, none for others. This gap is inherent to every VS Code fork and must be disclosed to users up front rather than discovered by them. |
| **Fork maintenance** | Mitigated by keeping patches to two files-sets and CI-verifying them nightly, but VS Code ships monthly and the burden never reaches zero. |
| **Windows cert lead time** | 1–3 weeks of validation blocks the first signable release. Start this early; it is calendar time, not work. |
| **Sybil fraud** | No desktop attestation exists and client-side receipt signing is not meaningful (§5.4, §6.6). Impression farming via VMs is the obvious attack on a pay-per-impression product, and defense is server-side heuristics only. Deferred to Project C, but it constrains how generous the per-impression rate can safely be. |
| **Pseudonymous UID persistence** | Paying users requires a stable identifier, so "anonymous" here means pseudonymous-and-persistent (§6.1). Must be disclosed accurately in the privacy policy; a fork that oversells its privacy story to developers gets audited in public. |
| **Margin under "50% of gross"** | Payment fees, hosting, asset delivery, and payout rails all come out of the platform's half. Real margin is materially under 50%. This is a business risk, accepted deliberately in exchange for an unasterisked claim. |
| **Two-sided cold start** | Advertisers will not buy inventory that does not exist, and the 50% pitch does not attract users until it pays meaningfully. Project B should not assume inbound advertiser demand. |
