# ADCode release readiness — 2026-08-28 (updated 2026-08-30)

## Decision

**Ready for local and explicitly labeled limited preview testing. Not ready for a public
production release.**

The desktop feature candidate builds, packages, and passes both packaged smoke journeys.
The 2026-08-30 candidate also includes the complete feature library, universal search, menu
routes, a public generated feature guide, `adcode open [path]`, and repeatable
accessibility/visual smoke coverage. The final review hardening closes filesystem-link escape,
internal Team-task authorization, interrupted apply/rollback recovery, missed scheduled-target,
Team resume/cleanup/quota, second-instance open, and durable redacted trace gaps.
The exact web candidate is deployed as an explicitly labeled limited preview on the existing
Cloudflare Worker and is healthy on its `workers.dev` address. Public release is
blocked by identity/signing, domain/support, legal, dependency-risk, production-mode, and
release-channel gates that cannot be truthfully completed by source changes alone.

Limited-preview Worker version `3a149822-3c7a-4453-8b3a-6416bead8adc` was deployed on
2026-08-30. No public production deployment or GitHub release was created. Publishing while
the gates below are red would make an unsigned binary and legally unreviewed real-money
service available through an update channel with no verified rollback release.

## Verified candidate evidence

| Gate | Result | Evidence |
|---|---|---|
| Desktop typecheck, architecture firewall, full unit/integration suite | Pass | Final `npm run verify`: 189 files / 2,664 tests; 0 architecture errors (35 existing orphan warnings) |
| Desktop production build | Pass | Electron/Vite built main, preload, and 1,469 renderer modules |
| Web production build | Pass | `npm run web:build`; Next compiled, typechecked, and generated 117 pages, including the docs index and 88 feature articles |
| Docs and terminal launch | Pass | The shared desktop/mobile header exposes Docs with active-state semantics; the sitemap includes the index and all feature articles; `adcode open [folder-or-file]` validates its target and enters the ordinary full-service desktop session, including subsequent opens routed into the live instance |
| Windows packaging | Pass | `npm run package -- --win`; installer, portable binary, blockmap, and `latest.yml` generated |
| Feature discovery and universal search | Pass | Developer and packaged journeys verified the activity icon below Earnings, View-menu route, explanatory search, What/Why/How help, safe setting dispatch, Features/Commands/Files/Symbols/Recent folders, focused search shortcuts, Escape/outside-click cleanup, and stable workbench sizing |
| Visual and accessibility audit | Pass | `node scripts/smoke.mjs --visual-only`; inspected light/comfortable, Midnight/compact, approximately 208% zoom, keyboard result selection, dialog/combobox/listbox semantics, reduced-motion transform removal, and forced-colors 2px focus outline |
| Packaged desktop smoke | Pass | `node scripts/smoke.mjs --packaged`; full workbench journey including a hard symbol-search success gate, 0 suspicious log lines |
| Packaged ad smoke | Pass | `node scripts/smoke-ads.mjs --packaged`; serve, notification, receipt, balance, and queue journey, 0 suspicious log lines |
| Worker limited-preview deployment | Pass | Version `3a149822-3c7a-4453-8b3a-6416bead8adc` deployed 2026-08-30; live checks returned 200 for health, Docs, the All Features article, and sitemap discovery. Previous version `d53ff8e1-35c6-4aad-a21d-d6d1ca71a9df` remains the rollback candidate |
| Required Worker secret names | Present | Supabase, Firebase, payout encryption, and Dodo secret names are registered in Cloudflare; values were not read or exposed |
| Secret/path exposure in AI feature | Pass by design/tests | Main-process containment follows real paths and refuses link escapes; internal role tasks cannot enter generic review/apply IPC; traces persist bounded provider/tool outcomes without proposal or tool-result contents |
| AI transaction recovery and Team lifecycle | Pass | Interrupted apply restores the selected pre-write state, interrupted rollback completes only from known checkpoint contents, unknown human edits become conflicts, paused Teams resume from validated children, and private Team sandboxes/bases are cleaned after cancel or applied combined review |

Windows preview artifacts are in:

```text
C:\Users\user\AppData\Local\adcode\release\ADCode-Setup-x64.exe
C:\Users\user\AppData\Local\adcode\release\ADCode-Portable-x64.exe
C:\Users\user\AppData\Local\adcode\release\latest.yml
```

At audit time the installer was 115,161,794 bytes with SHA-256
`16E8F48745323BE10CB87C8AFD268B1416D91097E4CA69F1010EDD8ECB359539`.
The portable build was 114,932,307 bytes with SHA-256
`561A48E483B2C7D31AC59DEBBBC4EAD84C5309BBF83E8336C30AAA3C0CD6FB3D`.
Repackaging changes those hashes, so calculate them again for the actual published files.

## Public-release blockers

### 1. Desktop signing and platform coverage

`Get-AuthenticodeSignature` reports `NotSigned` for both Windows executables. No Windows
certificate environment is configured. No signed/notarized macOS build or Linux package was
produced on this Windows host. SmartScreen/Gatekeeper warnings are not acceptable as an
unlabeled public release.

**Close:** configure the organization-owned Windows certificate; build and verify signed
Windows artifacts; build, sign, and notarize macOS on macOS; build/test Linux artifacts on
Linux or a trusted CI matrix. Verify the publisher identity after download on clean VMs.

### 2. No release/update channel

The configured repository is `bluethenics/adcode`, but GitHub has no releases. The GitHub
CLI is not installed and no `GH_TOKEN`/`GITHUB_TOKEN` is present in this environment. The
local `latest.yml` therefore has nowhere safe to be consumed by electron-updater, and there
is no previous release to use for rollback.

**Close:** install/authenticate release tooling through an organization-controlled account;
publish signed installers, platform update metadata, checksums, reviewed notes, and rollback
instructions together; install and upgrade through the public feed on clean machines.

### 3. Custom domain and support promises

`adcode.bluethenics.com` does not resolve. Its MX lookup also returns no usable mail route,
while the public pages promise `support@`, `privacy@`, and `advertise@` addresses on that
domain. The healthy Worker currently lives at `adcode.bluethenics01.workers.dev`.

**Close:** create and verify the custom-domain DNS/Worker route, TLS, canonical origin, MX
and mailboxes; test inbound and outbound support messages; rerun health, auth, checkout, and
download tests through the final hostname.

### 4. Legal review and licensing

The live Terms page says it is a template not reviewed by a lawyer. ADCode accepts
advertiser funds and represents developer earnings/withdrawals, making review necessary
before public or real-money use. The repository and desktop package are also marked
`UNLICENSED`, with no release license file.

The audit corrected a factual privacy contradiction in the candidate: advertising and
earnings services do not receive project source, but a selected AI provider can receive
prompts/source/tool results and inline completion receives bounded cursor context. That
correction still requires counsel/product approval and deployment before it becomes the
public copy.

**Close:** approve Terms, Privacy, advertiser terms, payout/tax/KYC obligations, retention,
AI-provider disclosures, and the distribution license; record approver and date; remove the
template warning only after approval.

### 5. Production money mode is not verified

Cloudflare contains Dodo, Supabase, Firebase, and payout secrets, including a `DODO_MODE`
secret name. Secret values were intentionally not inspected, so this audit cannot prove
whether the deployed service is safely in test mode or already configured for live charges.
Payout execution remains a manual bank-transfer workflow, and no staging-to-production
payment, refund, webhook replay, withdrawal, reconciliation, or jurisdiction approval was
performed here.

**Close:** have an authorized owner verify the mode without exposing credentials; keep live
mode disabled until test checkout/webhook/refund and payout controls pass; run a documented
staging migration/backup/restore; confirm ledger reconciliation, fraud response, Dodo live
approval, payout corridors, tax/KYC, and an operational owner.

### 6. Production dependency advisories

`npm audit --omit=dev` reports 0 critical, 0 high, and 6 moderate findings across 247
production dependencies. The chain begins at direct `firebase-admin` and includes
`@google-cloud/storage`, `retry-request`, `teeny-request`, `gaxios`, and `uuid` (a missing
buffer bounds check advisory). The deployed Worker architecture says `firebase-admin` is
not used at runtime, but the root production graph still includes it.

**Close:** remove the unused production dependency/legacy adapter path if safe, or upgrade
and reverify. If it must remain, document scope/exploitability and obtain explicit security
risk acceptance; rerun the production audit in release CI.

### 7. Staging, observability, and rollback drills

Source and local smoke tests pass, but the audit did not receive evidence of production-like
staging, database migration backup/restore, alert ownership, crash reporting, payment
reconciliation monitoring, or a rehearsed Cloudflare/GitHub rollback.

**Close:** deploy the exact candidate to staging, execute the release matrix, define alert
thresholds and owners, rehearse Worker rollback to the previous version, and prove desktop
rollback/update behavior with at least two signed versions.

## Safe release sequence

1. Resolve or accept the six moderate advisories; rerun verify, builds, packaging, and both
   packaged smoke journeys from a clean release checkout.
2. Finish legal/licensing and support-domain gates before enabling real money.
3. Verify Cloudflare secrets/mode and database backup/restore through authorized owners.
4. Produce signed platform artifacts in CI and verify signatures/checksums on clean hosts.
5. Deploy the exact web/API candidate to staging and complete auth, advertiser checkout,
   webhook, ad serve/receipt, earnings, withdrawal, admin, and rollback tests.
6. Publish a limited preview cohort first, with the AI settings serving as kill switches.
7. Observe crashes, failed/paused AI tasks, rollback/conflict rate, token reservations,
   editor latency, payment errors, and support load before expanding.
8. Create the reviewed GitHub release and production Cloudflare deployment only after every
   public gate above is recorded green.

## Rollback

- **AI behavior:** switch to Review mode, disable scheduled messages, disable terminal
  auto-continue, or disable inline completion. Turning off isolated workspaces keeps chat
  but disables file tools; it does not permit direct AI writes.
- **AI file changes:** use the task rollback checkpoint. Rollback refuses to overwrite later
  human edits; resolve those manually instead of bypassing the check.
- **Desktop:** retain the previous signed installer/update metadata. Roll back the release
  assets and update metadata together, then test the updater from both adjacent versions.
- **Web/API:** use Cloudflare deployment rollback to the known-good version. Database
  migrations must be backward-compatible or have a tested restore/down path before rollout.
- **Money:** disable live Dodo mode/checkout and payout corridors through the authorized
  operational process; preserve append-only ledger history and reconcile in-flight events.
