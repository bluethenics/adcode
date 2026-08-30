# ADCode release readiness — 2026-08-30

Supersedes `RELEASE-READINESS-2026-08-28.md`. That report's seven blockers still stand
except where noted; this one records what changed on 30 August and what the candidate is
now.

## Decision

**1.0.0 is code-complete and buildable. Nothing has been published.**

Every branch is merged into `main`, the version is `1.0.0`, the tree verifies, builds,
packages and passes both packaged smoke journeys. The web and API were deployed. No GitHub
release exists and no installer has been distributed.

The gates that stop a public download are unchanged in kind: the binaries are unsigned,
there is no release channel, and the terms are still an unreviewed template. One gate got
sharper rather than softer — Dodo Payments is now in **live mode**, so the money paths are
real while the document governing them has still not been read by a lawyer.

## What changed today

| Change | Why it mattered |
|---|---|
| Seven branches consolidated into `main` | `feat/ai-workspaces` turned out to contain `feat/dashboards-and-ios-web` entirely, and four other branches were already inside `main`. The merge was clean; nothing was rebuilt or re-derived. |
| Cash-out repaired and migrated | The withdrawal RPCs named an `evidence` column that did not exist, so every payout request raised `42703`. All four payout corridors shipped disabled, so no payout profile could be saved. Both fixed and applied to production. |
| Sign-in restored on the website | The deployed bundle had been built without `NEXT_PUBLIC_FIREBASE_*`, so the site told every visitor sign-in was not configured. |
| Category filter rebuilt in the feature library | The category strip was `overflow-x: auto` with `scrollbar-width: none` — reachable by keyboard, unreachable by pointer. |
| Symbol-search smoke check corrected | It re-dispatched its query six times at 1400ms; each dispatch invalidated the in-flight search it was waiting for. |
| Nested worktree removed | `.worktrees/ai-workspaces` sat inside the folder the editor indexes. Its own directory walk exceeded two minutes and it destabilised three timing-sensitive smoke checks. |

## Verified evidence

| Gate | Result | Evidence |
|---|---|---|
| Typecheck, architecture firewall, full suite | Pass | `npm run verify`: 190 files / 2,695 tests; firewall 0 errors, 65 `no-orphans` warnings |
| Desktop production build | Pass | `npm run desktop:build`, exit 0 |
| Workbench smoke | Pass | `node scripts/smoke.mjs`: 136 checks, exit 0, 0 suspicious log lines |
| Ad delivery smoke | Pass | `node scripts/smoke-ads.mjs`: 25 checks all true, exit 0, 0 suspicious log lines — serve targeted with real vocabulary tags, toast painted, receipt returned, balance moved |
| Web production build | Pass | `npm run web:build`, exit 0 |
| Windows packaging | Pass | `npm run package`, exit 0 |
| Supabase migrations | Applied | Three migrations pushed and verified by query afterwards |
| Worker deployment | Deployed | `/v1/health` returns `{"ok":true}`; Firebase key confirmed present in the live bundle |
| Windows signing | **Fail** | `Get-AuthenticodeSignature` reports `NotSigned` for both executables |

Artifacts, version 1.0.0, built 2026-08-30 in
`C:\Users\user\AppData\Local\adcode\release`:

```text
ADCode-Setup-x64.exe        114,563,898 bytes
ADCode-Portable-x64.exe     114,334,410 bytes
latest.yml                  version 1.0.0
```

`scripts/package.mjs` writes there rather than to `release/` because the repository is on a
FAT32 volume. Repackaging changes the hashes, so read them again from the files you actually
publish.

## Database state after the migrations

Verified by querying the project, not by the migration exit code:

- `payout_corridors`: **70 rows, all enabled**, previously 4 rows, all disabled.
- `withdrawals`: 0 rows at migration time, so swapping the status constraint was safe. It now
  admits `requested`, `approved`, `paid`, `rejected`, `failed`, `cancelled`, `returned`.
- `payout_profiles` and `withdrawals` both carry `destination_key_id`.
- `reserve_withdrawal`, `transition_withdrawal`, `apply_advertiser_credit_event` and
  `reconcile_advertiser_credits` all present.

Live data at the time: 4 advertiser credit orders, 22 ledger entries, 1 provider event.

## A deployment hazard worth naming

`apps/web/.env.production` is **gitignored**. Every `NEXT_PUBLIC_FIREBASE_*` value is inlined
into the client bundle at build time, so a build run anywhere that file is absent — a fresh
clone, a second worktree, a CI runner — produces a site that loads, serves every page, and
quietly tells visitors that sign-in is not configured. No error, no failed build.

That is what happened to the deployment before today's. It was diagnosed by fetching each
JS chunk the live `/admin` page loads and grepping for the API key, which was absent while
the "isn't configured" string was present.

**A production build should fail when those four variables are missing.** Until it does,
this will recur, and the only symptom is on the deployed site.

## Public-release blockers

Gates 1, 2, 4, 6 and 7 from the 2026-08-28 report are unchanged: signing, release channel,
legal and licensing, dependency advisories, and staging/rollback drills. Two have moved.

### Gate 3 — domain: half done

`bluethenics.com` now uses Cloudflare's nameservers (`maisie`/`reese.ns.cloudflare.com`) and
the apex resolves. **`adcode.bluethenics.com` still returns NXDOMAIN** — the Worker custom
domain has not been added, so the three addresses the site publishes point at a hostname that
does not exist. One dashboard step closes it; see `SETUP.md` R1.

The canonical origin deliberately remains `adcode.bluethenics01.workers.dev` for 1.0.0. It is
written into `apps/web/.env.production`, `install.ps1`, `install.sh` and the CORS list, and
the Dodo webhook is registered against it. Moving it is one deliberate commit, not a side
effect of adding a domain.

### Gate 5 — money mode: now live, and unverified

Dodo Payments has been switched to live. The refund and dispute branches repaired today have
never executed against the real provider — they were broken until 2026-08-29, so no
production refund has ever exercised them. `SETUP.md` R3 is the procedure: fund the smallest
amount Dodo accepts from a card you own, confirm the credit and the row, then refund it and
confirm the order moves to `reversed`.

Until that is done, the live claim is that money in and money back both work, on the evidence
of unit tests alone.
