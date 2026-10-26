# Full-chat completion audit — 26 October 2026

This audit covers the pasted Claude handoff and the subsequent requests in this chat: paid usage, subscriptions, provider ads, support reports, unlimited-usage recovery, update notices, installation progress and repeatable daily releases. It distinguishes implemented behavior, published behavior and acceptance that still depends on an external provider or the owner.

## Completed and published web/API work

- Heabsy credit packs, 10M free tokens per week, purchased tokens afterward and the original Tagflow free access are implemented. Subscription choices are Weekly ($3/week, 60M/week), Monthly ($9/month, 60M/week) and Pro ($19/month, 150M/week).
- Subscription checkout, customer portal, signed lifecycle events, owner/product checks, event ordering and durable duplicate-checkout protection are implemented. All three Dodo products and their production secrets are configured. No purchase was made on the owner's behalf.
- Promo codes, plan gifts, temporary allowance boosts, individual resets, bounded reset-everyone batches and Pro invites are implemented. An invitee's first subscription rewards both accounts with 4M tokens once, provided the inviter's Pro subscription remains active. Reset-everyone processes at most 500 accounts per request, preserves busy holds and supports retry; its page checkpoint is held in browser memory.
- Admin provider connections store encrypted, write-only keys. Compatible HTTPS JSON providers can supply mapped serving and event-verification endpoints with per-network payout rules. Owned delivery snapshots, verified receipt settlement and ledger deduplication protect payouts. A key by itself cannot specify an arbitrary provider's protocol.
- Worker `9e18b288-834f-4686-8f8c-5ff838650ca1` contains the approved release and subsequent response-stream/cancellation corrections. The three additive follow-up database migrations are applied. Public health, configuration, plans and documentation checks passed. Rollback Worker: `875aa567-c36b-42cb-8d62-939c01c04fbb`.
- Reproduced response defects were corrected: immediate model fallback on throttling, bounded database/JWKS operations without cross-request promise sharing, clean interrupted-stream errors, valid final provider data handling, pre-header cancellation and once-only concurrent settlement. A controlled canceled request produced a canceled outcome without the previous hung-runtime error. This is not a 500,000-user load-test result.

See [the rollout record](ai-plans-and-ad-networks-rollout-2026-10-25.md).

## Support reports and desktop fixes

The three support records cover **52 distinct reports**: 29 on 24 October, 13 on 25 October and 10 on 26 October, with no overlap. A fresh exact-key reconciliation checked all 52 report records and their reply/provider receipts: **45 report records have replies, representing 37 distinct delivered messages**. Multiple reports from the same account share one reply. Seven accounts still had no verified contact email; no guessed recipient or duplicate message was used. The confirmed sender was `ADCode <adcode@bluethenics.com>`.

The reviewed batch ends at report timestamp `1792980050256`. Reports remain triaged rather than falsely marked resolved. Some project-specific Gradle/CMake/compiler failures need the reporter's missing build configuration; Russian localization was requested but has not been implemented or promised in a reply.

Desktop source includes the reviewed fixes for account switching, bounded verification/retry, schedule-file recovery, cross-device settings writes, fallback file watching, readable HTML/provider errors, checklist compatibility and repeated-tool failures. Commit `037f44f5` brings previously uncommitted report fixes into the release source. Background-throttling changes mitigate a reported freeze; they do not establish that every freeze has been reproduced or eliminated.

Unlimited account allowances recheck after two minutes instead of waiting for an old allowance reset. Provider/request throttling rechecks after one minute and uses distinct wording; enabling unlimited account usage does not remove an upstream provider's real rate limit.

Support records: [24 October](error-report-triage-2026-10-24.md), [25 October](error-report-triage-2026-10-25.md), [26 October](error-report-triage-2026-10-26.md).

## Desktop update and daily-release work

Update notices, background download progress and Update now are implemented. Before installation, every open window must finish the same strict unsaved-work check: recovery drafts are persisted, crash-recovery-disabled windows refuse until saved, and a timeout/reloaded/new window cannot be treated as consent. A refused update unlocks every window and can be retried. Only one installation is started. Store and portable installations use their appropriate official destination.

The Windows installer continuation adds visible installation progress and automatic reopening for an explicit in-app update, including the older 2.4.0 caller. Ordinary background install-on-quit remains a separate quiet path. The final packaged acceptance and publication status are recorded below after the release candidate has been built; source tests alone are not evidence of a published installer.

The daily-release tooling prepares a fresh patch version, consistent desktop/root metadata and a changelog from committed improvements. It refuses dirty or stale release source and reused versions. The GitHub workflow verifies manifests, file sizes, SHA-512 and Windows blockmaps before creating a stable draft. Run-owned temporary draft prereleases transfer binaries between standard runners without retaining a second copy in Actions artifact storage. No timer publishes unreviewed changes, and no paid release service is required. See [the daily release guide](daily-desktop-releases.md).

## External acceptance and constrained work still open

- **Dodo real-card acceptance:** the owner should complete a Weekly purchase, verify activation, then cancel through the portal. Checkout/webhook/portal tests and product configuration have passed; this financial action has not been performed by an agent.
- **Imprezia production inventory:** the verified Native 1.2 Exchange integration is a non-billable `test:1` preview. Production inventory, privacy/rendering/tracking requirements and payout reconciliation need an agreed provider contract before live desktop impressions can be billed.
- **beehiiv:** the supplied API supplies newsletter advertisement content. Its read-only preview does not establish desktop ad-serving permission or verified desktop earnings.
- **Historical incident holds:** the handoff's approximate count could not be tied to reservation IDs. Bounded indexed reads identified candidate accounts, but an old allowance window does not prove an individual held request is orphaned. The reservation table lacks a selective account/day index. No heavy production scan, speculative settlement, balance change or counter reset was performed. An offline-tested concurrent recovery-index proposal is available for a separately budgeted maintenance operation; exact IDs and terminal-outcome evidence are required before settlement.
- **Capacity:** no production stress test certifies 500,000 simultaneous users. Current fixes and short live checks must not be represented as that guarantee.

## Verification evidence

- Independent local SQL checks for plans, paid tokens and ad networks passed.
- Independent plan/ad-network review: 87 tests passed. Independent report-fix review: 123 tests passed.
- Prior full shared-workspace verification: 5,643 tests across 466 files, all four type projects and dependency firewall passed.
- Prior actual desktop smoke: all printed checks passed, with zero suspicious log lines. The two-window updater test verified refusal/unlock, a successful retry, exact persisted recovery drafts and unchanged project files.
- A clean committed release checkout is used for the final build because a shared-workspace build can include changes GitHub would otherwise omit. Final installer evidence and its draft link are added after that run; desktop publication is not implied by web/API deployment.
- Clean committed source at `037f44f5`: all four type projects, dependency firewall and **5,635 tests across 463 files** passed. The visible-updater/docs change at `305b0380` passed another **97 focused tests** in the clean checkout and a desktop build.
- The tracked Windows NSIS marker probe passed **10 actual compiled/runtime cases**, including the older 2.4.0 silent explicit-update call, visible progress, scope-page skipping and stock automatic relaunch. It does not install ADCode or substitute for the full installed-upgrade gate.
- Daily-release review passed **37 release tests**, root type checking and workflow parsing. The installed-upgrade gate was independently reviewed, but must pass on a disposable Windows runner before an installer is represented as accepted.
- The release dependency audit found outdated packages. Commit `eb24b77e` updates compatible patched dependencies; isolated root, web and cloud lock audits each report **zero vulnerabilities**. Exact-lock installation, final application verification and the compatible Cloudflare build remain required after this dependency change.
- The first clean-checkout application smoke had zero suspicious log lines and all checks except its Changes-badge assertion passed. That assertion incorrectly required uncommitted files. Commit `a0b84995` compares the real repository state with the badge, including a clean checkout; the complete smoke is rerun with the final dependencies rather than treating the initial result as a pass.
