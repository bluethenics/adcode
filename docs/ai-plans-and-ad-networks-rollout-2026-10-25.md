# AI plans, ad networks and report fixes — 25–26 October 2026

## Implemented

- Weekly: $3/week, 60M Heabsy tokens/week. Monthly: $9/month, 60M/week. Pro: $19/month, 150M/week and two eligible invites. An invitee who accepts before first subscribing and a still-active Pro inviter receive 4M purchased tokens each, once per invitee.
- Signed subscription events, immutable account/customer ownership, product-ID-based plan changes, chronological event handling, expiry-aware allowance caching, checkout and customer portal.
- Durable per-account hosted-checkout claims prevent multiple payable subscriptions across Worker instances. Same-plan retries resume the saved URL. An ambiguous provider failure preserves the claim for 25 hours rather than creating another potentially payable session. Missing product configuration is checked before claiming. Support must reconcile an ambiguous checkout with Dodo before any manual recovery.
- Admin gifts, boosts, promos and weekly reset for one account or everyone. Everyone resets process at most 500 accounts per request, preserve busy holds, show progress and support pausing/resuming. Keep the admin page open: its progress checkpoint is currently local to that page.
- Website plan comparison, confirmed activation, code redemption, invite sharing and subscription management. Desktop plan meter and Upgrade plan action. Searchable help, feature catalogue and web guides.
- Generic HTTPS JSON ad APIs with configurable requests/field mappings, encrypted write-only provider keys, per-view/per-click payout snapshots and provider-confirmed event settlement. Direct campaigns retain delivery priority. The desktop's existing ad controls apply.
- External artwork passes through an issued-delivery-only server proxy on the approved asset host, with bounded raster downloads. Receipt batches make bounded progress and duplicate payouts are rejected atomically.
- Imprezia supports its documented non-billable Native 1.2 Exchange test preview, using provisioned app bundle/domain and an Exchange-enabled serving key. Its fixed endpoint is `POST https://x.imprezia.ai/v1/bid`; tests always use `test:1`, respect no-bid/expiry and never execute HTML or trackers or invoke bearer notice URLs. Live delivery remains disabled: approved inventory, privacy/rendering/tracking support and an agreed billing/reconciliation process are still required. A notice acknowledgement is not revenue confirmation. Reference: https://demo.imprezia.ai/docs/exchange. An arbitrary API key alone cannot describe arbitrary providers.
- beehiiv publication/offer advertisements are a read-only newsletter content preview. The supplied endpoint does not provide desktop ad delivery or verified desktop earnings.
- Checklist status normalization and retirement after repeated invalid updates, early rechecking after allowance changes, and bounded rate-limit waits. Provider throttling remains distinct from an unlimited ADCode allowance. HTML edge errors retain their HTTP status but show a readable message.

## Dodo configuration completed

Created these recurring products under the `adcode` brand with SaaS tax category and USD pricing. No purchase was made.

| Plan | Product | Recurrence |
| --- | --- | --- |
| Weekly | `pdt_0NqTxj8yBt5W0zfQ17C1P` | $3 every 1 week |
| Monthly | `pdt_0NqTy6TGnS4Txwjpd69sG` | $9 every 1 month |
| Pro | `pdt_0NqTyXgababs030e9ilb0` | $19 every 1 month |

Saved and verified the three `DODO_PLAN_*_ID` bindings on Worker `adcode`. This configures the existing Worker; it does not publish the new application code.

## Database deployment order

Production already contains `20261024140000_ai_plans.sql`. Before deploying the new Worker, apply these additive migrations in order:

1. `20261025040106_harden_ai_plan_events_and_cache.sql`
2. `20261025040541_ad_network_connections.sql`
3. `20261025063235_guard_ai_plan_checkouts.sql`

All new credentials, plan and settlement tables/RPCs are service-role-only. Do not deploy the checkout code before the checkout-claim RPC exists. Existing `PAYOUT_ENCRYPTION_KEY` can derive a separate namespaced ad-network key; a dedicated `AD_NETWORK_ENCRYPTION_KEY` overrides it. Do not replace an encryption root without preserving previous-key reads until credentials are re-encrypted.

## Verification and release gates

Full verification passed all four TypeScript projects, the dependency firewall and 5,593 tests across 460 files. The firewall reported existing orphan warnings. An initial outdated admin-navigation test expectation was corrected. A Next production build generated all 203 pages successfully. The final Imprezia test-preview addition and distinct React sibling keys passed focused tests and type checks. The Cloudflare-compatible build and local runtime preview also passed before publication.

Local browser fixtures confirmed delayed subscription activation, successful promo redemption after an expiry error, encrypted-key entry clearing, beehiiv content preview, disabled unsupported delivery, and phone layout without page overflow. Fixtures use synthetic data and do not exercise a live card purchase.

Web/API publication completed with owner approval: Worker `89833de3-3ac8-48cf-b9f6-17f87a1869f7`; rollback version `77af3bc8-4186-4986-9323-9b3f5340e651`. The three migrations were applied before deployment. Remote history names `harden_ai_plan_events_and_cache`, `ad_network_connections` and `guard_ai_plan_checkouts` identify the corresponding local SQL files; MCP assigns remote application timestamps.

Follow-up server correction `60c78fb` is live in Worker `875aa567-c36b-42cb-8d62-939c01c04fbb`; rollback is `89833de3-3ac8-48cf-b9f6-17f87a1869f7`. The persistent live stack mapped to Next's response pipe rejecting an interrupted SSE body. The relay now emits a sanitized protocol error and closes the body normally, including premature EOF without a completion marker. Existing 2.4.0 clients already reject these error events. Four real HTTP/Next bridge and desktop-client integration cases, 127 other relay/adapter tests, root/web type checks, a fresh Cloudflare build and local preview passed. The public health, configuration, plan and admin pages passed after publication. This fixes the reproduced failure path; a short observation window cannot prove every future upstream interruption is resolved.

The final server correction, `97712502`, is published in Worker `9e18b288-834f-4686-8f8c-5ff838650ca1`; rollback is `875aa567-c36b-42cb-8d62-939c01c04fbb`. A later canceled request exposed a distinct OpenNext adapter promise that stays pending when a client disconnects before response headers. A regression against the installed adapter reproduced that condition. Incoming request signals are now enabled and every OpenNext request has an outer cancellation guard; native video responses retain their existing path. OpenNext's existing `waitUntil` preserves handler cleanup. Concurrent stream cancellation/read failure share one request-local settlement write. Complete final SSE data lines without a blank separator are now normalized safely; missing completion markers, malformed JSON, invalid completion reasons and upstream error payloads still fail safely.

Final server validation: 147 focused relay/client/transport/cancellation tests, root/web type checks, independent review with 99 test cases rerun, a fresh Cloudflare build and local preview all passed. Live health, configuration, plans, ad-network settings and update docs returned 200; plan prices and allowances remained correct. The local workerd disconnect probe did not propagate aborts through its development proxy and was inconclusive; the installed-adapter regression and official Cloudflare request-signal contract provide the verified evidence. A short live observation cannot establish that every provider interruption is eliminated.

Production follow-up at 08:08 IST on 26 October: a controlled read-only `/status` request was canceled by the client. Cloudflare recorded it as canceled without a runtime-hung error. A version-filtered error query returned zero errors, and the latest three AI completion invocations returned 200. This verifies the observed cancellation path and current traffic, not long-term absence of all provider failures. Public checks are recorded in `output/live-cancel-check-2026-10-26.log`.

Built a fresh NTFS temporary release snapshot because the original generated `.open-next` folder was inaccessible. The snapshot preserves the existing status, analytics and support changes from the shared workspace, recorded in `output/release-snapshot-825f86d.json`; the task checkpoint itself commits only this task's owned hunks. OpenNext Cloudflare build and local runtime checks passed. Local API 503s were expected without production secrets. After publication, `/`, `/ai-tokens`, `/admin/ad-networks`, `/v1/health` and `/v1/ai/tagflow/config` all returned 200, health was true, and all three plan prices/allowances were correct.

Remaining acceptance: owner subscribes and cancels a real Weekly plan through Dodo; no purchase was made by the agent. Desktop installer/updater publication remains separate. Desktop implementation and local acceptance are complete; do not represent these fixes as shipped.

The requested desktop update notice is implemented: an available-version card offers Update now/Later, download progress remains visible, and a separate ready notice can offer a restart. Store installations open the official Store product; portable installations open the official download page. Restart preparation requires every editor window to acknowledge and persist its exact unsaved recovery snapshot, rejects conflicting copies or failed/oversized writes, and refuses to close an unresponsive or unprotected window. The review also covered repeated install requests and retry after failure. Chat tabs now support mouse-wheel navigation when overflowing.

Follow-up full verification passed all four TypeScript projects, the dependency firewall and 5,643 tests across 466 files (`output/verify-desktop-finish-2026-10-25.log`). The final review corrections passed 66 focused updater checks, with 59 independently rerun by the reviewer. The initial isolated desktop smoke failures were traced to Git's trust requirement for the temporary NTFS/FAT worktree; a process-local trust entry fixed them without changing global Git settings. A remaining smoke filename assertion accepted only `.ts` even when the actual correct definition was `.tsx`; its assertion now accepts supported JS/TS extensions. Final desktop build and full smoke passed with no failed checks and zero suspicious log lines (`output/desktop-smoke-update-final-2026-10-25.log`). The actual two-window test refused installation with recovery off and another window dirty, unlocked both windows after refusal, then saved the exact draft and installed once on retry with recovery enabled while leaving the source file unchanged. Runtime source hashes matched the accepted temporary build. Commit: `3e99d455`.

No 500,000-user load test was performed. The changes remove known unbounded admin work and redundant configuration reads; those checks do not establish production capacity.

See `error-report-triage-2026-10-25.md` and `error-report-triage-2026-10-26.md` for 23 reviewed reports and 18 delivered support messages through cutoff `1792980050256`. Approximately three historical reservation holds mentioned in the handoff remain unexamined: production has only a primary-key reservation index, and no IDs were supplied. No unindexed reservation scan or speculative balance adjustment was performed.
