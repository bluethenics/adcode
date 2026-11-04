# Report fixes — 1 November 2026

Reviewed 121 unresolved reports at the saved cutoff. Verified fixes resolved 58 reports; 48 individually addressed confirmation emails were delivered. Each resolved report was marked closed and then removed as requested. The other 168 already-closed reports were left alone. Private snapshots, prior replies, matched delivery receipts and audit records remain under `output/`; they must not be published.

## Available fixes

- Verification delivery no longer depends on Firebase's exhausted email quota. Resend delivery, scanner-safe confirmation, token expiry and replay protection were checked with a disposable account. Confirming ownership is immediately visible across backend caches. The account and test credentials were removed afterward.
- Free included AI is available with 10 daily cost credits after email verification. Nine subscription-required reports were covered by this correction. Current paid periods on original models retain their previous allowance until expiry.
- A Weekly subscriber's live access was checked as active through 5 November 2026, 07:50 UTC; their confirmation explains how to refresh the matching account without repurchasing.
- The combined website deployment is `e78390c3-650b-40c6-8761-afa90d6a34e8`. An authenticated admin inference after deployment returned “ok” from Qwen3.8 27B Queen. No additional verification emails or subscription changes were made for that smoke check.

## Published desktop patch

An isolated branch `codex/report-patch-20261101`, based on published v2.4.10, is at `C:/Users/SINAN/.codex/worktrees/adcode-report-patch-20261101`. Version 2.4.11 is tagged at `0c6e95175a922f893215da0779e30890c87477ac` and was published on GitHub at 17:34:58 UTC: https://github.com/bluethenics/adcode/releases/tag/v2.4.11. The successful release build is https://github.com/bluethenics/adcode/actions/runs/41331083239. The patch waits for a conversation to finish before retrying or continuing, supports the hosted Google sign-in fallback, displays normalized credits and Unlimited fair use correctly, updates plan help, and preserves space for selected report diagnostics. It excludes unrelated shared-checkout features.

Focused tests cover race ordering, cancellation, cleanup, timeouts, real errors, Google callback state and origin, report diagnostic retention, normalized credit amounts and Unlimited wallet behavior. All type checks passed, with zero dependency-boundary errors. The full local suite passed 5,824 of 5,826 tests initially: generated help was stale and a timing assertion recorded 100.95 ms against 100 ms while packaging ran. Regenerating the two documentation files and rerunning both affected files passed all 26 checks. Clean release CI passed 491 test files (5,823 passed, three platform-specific skips), the installed Windows upgrade check, Windows/Linux packages and final cross-platform asset verification. Downloaded CI Windows files also passed checksum, size, manifest and blockmap verification locally. The dependency audit passed the high-severity release threshold (existing low/moderate advisories remain). Local packaged UI recheck passed with zero suspicious runtime lines after an initial CSS-inspector three-second loading timeout.

The quiet admin changelog was published without an announcement card or subscriber email. It explicitly states that Microsoft Store submission and rollout remain pending. Proof: `output/live-release-2.4.11-published.png`. Installers are unsigned; the public release notes disclose this.

A fresh Store build is in `C:/Users/SINAN/.codex/worktrees/adcode-report-store-20261101`, using a clean `npm ci`. It uses Electron 43.8.3 and DOMPurify 3.4.17, matching the lockfile and CI. The shared root dependency folder was stale (43.7.9 / 3.4.16), so the first local Store artifact must not be distributed; it was renamed `ADCode-local-unverified-dependencies.appx`. The fresh checkout's 33 targeted tests passed. Store identity matches the installed package exactly: `bluethenics.ADCode`, publisher `CN=D5C2302F-6F6C-4A0E-B93A-F757B1A7CC4D`, display publisher `bluethenics`. The developer portal is signed out, so Store submission requires the owner to sign in. No Store-based report is falsely closed while that delivery is pending.

The owner subsequently instructed “dont pakabge it rn”. Further packaging, package validation and Store submission work stopped. GitHub 2.4.11 had already been published before that instruction. The fresh Store package exists but has not been submitted. No new Store release or further packaging is authorized by this pause.

## Remaining reports

63 reports remain: 11 open and 52 triaged. These include old provider disconnects and capacity errors, desktop sign-in and retry issues awaiting an update, local model context/tool limitations, custom-provider configuration, inaccessible customer project compile failures, and missing diagnostics. A bounced/suppressed address was not bypassed. An older renewal/cancellation question remains pending rather than being treated as authorization to cancel billing.

No report notification emails matching the resolved groups were found in Gmail. Unrelated and unresolved messages were retained; no mailbox deletion is claimed.

Evidence and receipt files include `output/report-fix-cutoff-2026-11-01.private.json`, `output/report-fixed-matched-receipts-2026-11-01.private.json`, `output/report-resolution-records-2026-11-01.private.json`, and the corresponding additional-plan, delivery and resolution files. Customer addresses and report bodies are intentionally omitted from this document.
