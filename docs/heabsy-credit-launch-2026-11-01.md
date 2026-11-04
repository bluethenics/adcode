# Heabsy catalogue and credit launch — 1 November 2026

Live site: https://adcode.bluethenics.com/pricing

The first coordinated release deployed Worker `6fca74bc-78d7-481e-a0f0-c94a3285802e`; the account-access diagnostic release is `801a661e-27f3-4539-915f-d710f1980eb2`. Source is isolated at `C:/Users/SINAN/.codex/worktrees/adcode-credit-launch-20261101` so unrelated work in the shared checkout is not published accidentally.

| Offer | Price | Daily credits |
| --- | --- | ---: |
| Free | $0 | 10 |
| Weekly | $3/week | 150 |
| Monthly | $9/month | 150 |
| Pro | $29/month | 600 |
| Max | $99/month | 2,400 |
| Unlimited model access, fair use | $299/month | 5,000 |

Credits follow separate input, cached-input and output prices. One credit covers $0.001 of list model cost. Heabsy rates came from its official machine-readable catalogue on this date, cross-checked with the supplier's quote. Separate USD-wallet routes use their displayed cost-plus-35% pricing; Unlimited covers them using daily credits. Unlimited never spends saved purchased credits or the USD wallet automatically.

All 37 publicly ready Heabsy models were registered with exact upstream IDs, including uncensored variants. The public catalogue is broader than account-specific access: live tests found Heabsy HTTP 403 for Uncensored Fast and HTTP 404 for GPT 6 Astra. The authenticated `/v1/models` endpoint returned 25 IDs including aliases, mapping to 11 unique registered routes. Those 11 are enabled; 26 inaccessible routes remain registered but disabled until provider access changes. The public API now offers 13 routes: 11 Heabsy and two separately funded direct-wallet routes. The administrator-only access check reads the authenticated list without exposing the key.

At cutover nine active subscriptions were snapshotted. Their previous allowances on original models survive through each already-paid period's end; renewals use credits. The earlier pre-release backup had eight subscriptions; one Monthly purchase arrived before cutover and was included automatically. No paid token-pack orders existed. Positive grants remain, and negative unpaid free-request overshoot with no reserved purchased balance was waived. Historical and active old holds were not reset.

The public API was checked for `cost-v1`, 110,000 internal free units (10 credits), five paid plans and 39 ready routes before account-specific filtering. Targeted accounting tests, SQL migration replay, API/web/desktop types and the isolated production build passed. Production Dodo Weekly, Monthly, Pro and AI top-up descriptions now disclose daily cost credits; prices and billing intervals were retained.

Evidence: `output/live-pricing-2026-11-01.png`, `output/live-dodo-credit-products-2026-11-01.png`. Customer/configuration backups in `output/*.private.json` are private and must not be published.

The latest email-verification backend is Worker `2ba92619-908b-4b9a-b19f-927dc628d1b6`. It replaces quota-exhausted Firebase email delivery with existing Resend and makes verification visible immediately across Worker caches. Live disposable-account proof: mail delivered; GET did not verify; POST verified immediately; replay returned 410; free AI returned 200/“ok”; actual cost-credit settlement used 32 internal units and left 109,968 of 110,000. Test credentials and accounts were removed. Further combined Google-fallback, shared-project and priority releases are owned by the existing “Add project overview icon” chat and must preserve this backend and catalogue.

The combined website deployment `e78390c3-650b-40c6-8761-afa90d6a34e8` preserves these changes and adds the other chat's Google fallback and shared-project integration. A subsequent authenticated admin test returned “ok” from Qwen3.8 27B Queen. Report resolution and remaining limitations are recorded in `docs/report-fixes-2026-11-01.md`.
