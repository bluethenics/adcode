# Subscription recovery and shared AI usage — 29 October 2026

## Live account recovery

Four successful Weekly purchases were missing from `ai_subscriptions`. Verified payment journals and their owned checkouts identified three; the older fourth purchase was corroborated by its signed payment event and Dodo's authenticated subscription/payment emails.

Restored accounts: `animekun946@gmail.com`, `hackgut777@gmail.com`, `paisbww@gmail.com`, and `the.banxat@gmail.com`. The complaint mistyped the first account as `aninekun946@gmail.com` and contained a payment-ID typo; recovery followed the owned payment records.

Recovery used `apply_ai_subscription_event_v2` with unique support event IDs and recorded an audit entry per account. Original seven-day terms were reconstructed from payment time; Dodo's exact `next_billing_date` still needs reconciliation because direct dashboard verification was unavailable. No new charge or renewal was created. Verification found four active Weekly subscriptions and zero unmatched recorded subscription payments.

At the owner's request, each account received exactly 5,000,000 bonus tokens through `grant_ai_tokens`, with the idempotency reference `weekly-activation-apology-2026-10-29`. Total gifts: 20,000,000 tokens. Prior negative purchased balances were retained, so displayed balances can be slightly below 5M. Individual apology emails confirmed restored Weekly access and the gift; all four sends returned Gmail's `SENT` label.

## Implemented changes awaiting release

- Tagflow and every other included provider share one weekly token balance, including fallback answers. Exhaustion applies to all included models.
- Defaults: 11M free tokens/week; Weekly and Monthly 66M/week; Pro 165M/week. Prices remain $3/week, $9/month, and $19/month.
- Packs: 55M/$10, 154M/$25, 330M/$50. Pro invite reward: 4.4M. Credit and saved account/provider allowances also increase 10% through the migration.
- A successful subscription payment can recover access by retrieving Dodo's authoritative subscription, validating its customer/product/account, and applying its actual paid period. This supports discounts and non-USD payments; unavailable lookups return a retryable failure.
- Token-order responses now include the same effective subscribed plan/weekly allowance as the usage endpoint.
- Desktop usage, composer, sidebar, account menu, pricing, and help copy describe the shared balance.

The source changes and `20261029114851_shared_ai_allowance_increase.sql` have not been deployed. Live restored subscriptions currently receive the existing 60M Weekly allowance until release. The 5M apology gifts are already live.

## Verification

API, accounting, payment-recovery, pricing, documentation, and shared-meter tests passed. The real Electron usage dialog passed separately after a timeout during concurrent production builds. Root, desktop, and web TypeScript checks passed. Postgres migration tests cover saved limits, zero allowances, provider pools, boosts, unchanged purchased/gift balances, and invite rewards. The desktop production build passed.

The web production build passed in an isolated NTFS snapshot after E: hit its known `EISDIR/readlink` filesystem issue. Reusable heading, billing, and campaign components were extracted from route files to resolve Next's existing invalid page-export errors; redirects and embedded portal forms retain their behavior. All 451 web tests outside the existing metadata-date suite passed. That suite has a pre-existing sitemap privacy-date assertion mismatch (21 versus 28 October).

The browser tool refused dashboard inspection because it could not verify Chrome's current URL, so the Dodo endpoint's lifecycle-event filter has not been inspected or changed.
