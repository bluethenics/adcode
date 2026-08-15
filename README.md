# ADCode

An ad-supported, AI-native IDE. See `2026-08-15-scratch-ide-build-prompt.md` for the brief.

**Status: slice 1 complete.** The whole ad client and the mock serving contract are built
and tested, headless. No editor shell yet — that is the next slice.

```
npm install
npm run verify        # typecheck + architecture rules + full suite
npm run mock-server   # serving contract on :8787, no build step
```

## What exists

| Path | State |
|---|---|
| `packages/ads` | All twelve modules from brief §8. Complete, 194 tests. |
| `mock-server` | All four `/v1/*` endpoints, an asset host, `POST /__test__/reset`, fault injection. 21 tests. |
| `packages/memory` | An empty boundary so the firewall rule has a real target. Slice 2. |
| `apps/desktop` | Not started. The long pole. |

Design decisions and the nine documented deviations from the brief are in
`docs/specs/2026-08-16-ad-core-design.md`. The build order is in
`docs/plans/2026-08-16-ad-core.md`.

## The two rules that shape this codebase

**The firewall.** `packages/ads` may never import from `packages/memory`. The ad side
promises that nothing from the user's code leaves the machine; the AI memory side is full
of exactly that. `.dependency-cruiser.cjs` enforces it, and `test/firewall.test.ts` asserts
both that the rule passes on the real tree *and* that a planted violation makes it fire — a
guard that has never been seen to fire is not known to work. Per brief §11 this failing is a
release blocker.

**Money is `bigint`.** All monetary values are int64 micros of USD, formatted with integer
arithmetic only, and carried on the wire as decimal strings. A JavaScript `number` is a
float; it happens to be exact below 2⁵³, but a revenue-share ledger is not the place to rely
on "happens to be".

## Architecture

`packages/ads` is plain TypeScript — no Electron, Monaco, or DOM imports — which is what
makes the entire client testable in milliseconds before a window exists.

- **Five pure modules** (`scheduler`, `validation`, `tagger`, `ledger`, `sponsorsView`)
  import only `types.ts` or one another. Enforced twice: dependency-cruiser proves what they
  import, and `test/purity.test.ts` reads their source to prove they never reach for `Date`,
  `Math.random`, `process`, or `fetch` — which need no import at all.
- **Three I/O modules** (`receiptQueue`, `auth`, `client`) and `assetCache` receive every
  capability through one of six ports.
- **Two adapters** (`renderer`, `adService`). `adService` is the only file that constructs
  anything real, and every one of its entry points is wrapped so that a collaborator's
  failure costs an ad and never a keystroke.

The mock server shares **no types** with the client. A mock built on the client's own
definitions cannot catch a contract mismatch, which is the main thing it exists to do.

## Known constraints

- **This repo is on a FAT32 volume**, which has no symlinks, so npm workspaces cannot be
  used (`EISDIR` on install). Package boundaries are enforced by dependency-cruiser instead.
  Moving to NTFS before the shell slice would remove this entirely.
- **Distribution is blocked on things money and calendar time buy**, not code: a Windows
  OV/EV certificate needs organisation validation (1–3 weeks) and hardware-token storage, and
  notarization needs an Apple Developer account plus macOS hardware.
