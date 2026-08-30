# ADCode release readiness — 2026-08-30, second pass

Supersedes the morning's `RELEASE-READINESS-2026-08-30.md` for the gates it moves. Every
other gate in that report still stands as written.

## Decision

**Still not shippable to the public. Two gates closed, one opened, four unchanged.**

Nothing has been published. No GitHub release exists and no installer has been distributed.

## What changed this afternoon

| Commit | Change |
|---|---|
| `7f39ef332` | Every feature reachable: 11 check commands with empty-state answers, a Check Conflicts button, menu rows, and a catalogue that offers commands before switches |
| `9b9364416` | Eight written articles given URLs that resolve; retired routes no longer advertised in `llms.txt`, `llms-full.txt`, `feed.xml` |
| `f711447ae` | Organization logo and `sameAs`, a `WebSite` node, `SoftwareApplication` version and download URL, named answer-engine crawl rules, a real 404 |
| `60ed6169c` | Terms rewritten to carry governing law, liability cap, warranty disclaimer, advertiser indemnity, age limit, sanctions, tax, dormancy and the general clauses |
| `c8e6f64ed` | Canonical host moved to the brand domain; 18+ made a recorded check rather than a sentence |

## Gate 3 — domain: closed

`adcode.bluethenics.com` resolves and serves. Verified, not assumed:

```text
custom domain   200
workers.dev     200
/v1/health      {"ok":true}   (on the custom domain)
```

The canonical origin has moved with it. Canonicals, the sitemap, the robots `Host` line,
Open Graph and both install scripts now name `adcode.bluethenics.com`, and
`apps/web/src/middleware.ts` 308s the `workers.dev` origin to it.

Before that, the brand domain served every page carrying a canonical pointing at
`workers.dev` — so a crawler reaching the brand was told the real site was a shared platform
subdomain, and every signal the brand earned was being consolidated onto a host that cannot
carry brand authority.

**`/v1` is exempt from the redirect and must stay exempt.** Dodo's webhook is registered
against the `workers.dev` URL. `apps/web/test/canonicalHost.test.ts` asserts the exemption.

### A deploy hazard this inherits

`NEXT_PUBLIC_SITE_ORIGIN` is set in three places and **two of them are gitignored**:
`.env.local` (highest precedence), `.env.production`, and `wrangler.jsonc` (committed).
All three now say the brand domain on this machine, but a build run anywhere the first two
are absent will not necessarily agree. This is the same class of failure the morning report
described for the Firebase keys, and it has the same symptom: a site that builds cleanly and
is quietly wrong.

The first build after the change still emitted the old canonical, because `.env.local`
overrides `.env.production` and only the latter had been edited. Read the built
`index.html` before deploying, not the env file you think you changed.

## Gate 4 — legal: improved, still unreviewed

The terms had no governing law, no liability cap, no warranty disclaimer, no advertiser
indemnity, no age limit, and nothing about sanctions, tax, dormancy, assignment or
severability. All present now, in the plain voice the document already had.

Two live defects fixed: the privacy page printed "18 August 2026" while its `dateTime`
attribute said `2026-08-28`, and both documents promised changes would be "described in the
blog" — a surface retired in the single-page restructure.

`docs/legal/LEGAL-REVIEW.md` lists what a lawyer should read first. **Still not reviewed,
and Dodo remains in live mode**, so the gate is open. What changed is that an hour of legal
time now goes to entity and personal liability, balances as unsecured debt, the advertiser
indemnity, and cross-border payouts, rather than to drafting from nothing.

## Newly opened — the smoke run is flaky on pointer checks

The morning's report recorded 136 checks, exit 0. This afternoon, on identical desktop
source, four consecutive runs gave:

| Run | Result |
|---|---|
| 1 | **142 checks, exit 0, 0 suspicious lines** — the six new conflict checks all pass |
| 2 | Threw at `View > All Features…`: "no such row" |
| 3 | Hung with no output; a stale Electron from run 2 held CDP port 9333 |
| 4 | 100 checks, exit 1, `explorerFlow` threw: "Rename: no context menu is open" |

`git status` was clean throughout and no `apps/desktop` source changed between run 1 and
run 4, so this is not a code regression. The failures are all pointer-driven — context
menus, right-click, drag — which is the family the morning report already described as
sensitive to anything overlapping the window.

**Run 3 is the operational lesson: a failed run leaves Electron alive holding port 9333, and
the next run attaches to the stale window or hangs.** Kill Electron between runs.

The six checks added for the conflict work passed in every run that reached them:

```text
conflictsButtonExists:  true
conflictsAnswerShown:   true
conflictsSaysNone:      "No merge conflicts."
conflictsStatusLine:    "No merge conflicts - nothing to resolve."
localHistoryBridge:     true
updateStatusBridge:     true
```

This needs characterising before the suite can be trusted as a release gate again. It is not
a reason to hold the release on its own; it is a reason not to cite a green smoke run as
evidence until it reproduces.

## Unchanged blockers

1. **Windows binaries unsigned.** Re-verified: `Get-AuthenticodeSignature` reports
   `NotSigned` for both `ADCode-Setup-x64.exe` and `ADCode-Portable-x64.exe`. Every
   downloader gets a SmartScreen warning.
2. **No release channel.** No GitHub release, no update feed exercised end to end.
3. **Gate 5 — refunds and disputes never executed against live Dodo.** Unchanged and
   unchanged in importance: the repaired branches have only ever run against unit tests.
4. **Dependency advisories.** `npm audit --omit=dev` reports **6 moderate** in the
   `firebase-admin` → `@google-cloud/storage` → `teeny-request` chain.
5. **Staging and rollback drills.** Not done.

## New, small, and worth doing before launch

- `support@adcode.bluethenics.com` is the only contact address in the terms. The subdomain
  now resolves, but whether that mailbox receives mail has not been verified. A published
  terms document with a dead contact address is a problem in several jurisdictions.
- The 18+ confirmation ships with no backfill, by design. Existing payout profiles fail the
  new rule until their holder confirms once. That is correct, and it means anyone with a
  saved profile sees one new checklist item on their next visit.

## Verified this pass

| Gate | Result | Evidence |
|---|---|---|
| Typecheck, firewall, full suite | Pass | `npm run verify`: 194 files / 2,736 tests; firewall 0 errors, 66 warnings |
| Web production build | Pass | `npm --prefix apps/web run build`, exit 0, 124 static pages |
| Desktop production build | Pass | `npm run desktop:build`, exit 0 |
| Canonical host | Pass | Built `index.html` carries `rel="canonical" href="https://adcode.bluethenics.com"`; sitemap and robots `Host` agree |
| Custom domain | Pass | 200, and `/v1/health` returns `{"ok":true}` |
| Windows signing | **Fail** | `NotSigned`, both executables |
| Workbench smoke | **Flaky** | See above |
