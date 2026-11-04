# Heabsy subscriptions and model errors — 29 October 2026

## Implemented in source

- Heabsy (`custom-heabsy`) requires a current subscription or gifted plan. Purchased tokens, boosts and public usage campaigns alone cannot unlock it. The server refuses access before calling the provider, including while token sales are off.
- Existing billing periods are preserved: Weekly $3/week with 20M tokens/week; Monthly $9/month with 100M tokens/week; Pro $29/month with unlimited tokens. Finite allowances remain shared across included models and devices; purchased balances can extend usage for an eligible subscriber.
- Pro requests create no weekly/purchased-token hold. Usage and token-order responses both report unmetered access, so released desktop meters display unlimited. A finite `weeklyTokens: 0` plus `unlimited: true` represents Pro in the catalogue; zero is never used as its enforced cap.
- Free-model fallback cannot enter Heabsy. The public catalogue advertises `subscriptionRequired`. Desktop failures offer Upgrade plan and Choose model, rather than suggesting that purchased tokens unlock access.
- Pricing, account plan cards, structured metadata and key search/help copy reflect the new tiers. Recurring checkout verifies the actual Dodo product price, currency and billing interval before creating a session; an old $19 Pro product cannot silently sell the new $29 offer.
- A migration updates the subscription revenue estimate to the $29 Pro catalogue rate. This is an estimate at current catalogue prices, not a measurement of grandfathered subscription revenue.

## Live investigation

Read-only queries against production `ai_model_requests`, covering a rolling 24 hours on 29 October. Admin test requests were excluded. Results vary slightly between queries as the window moves.

Provider error rate is provider errors / (successes + provider errors); account rejections, cancellations and unfinished telemetry are excluded.

| Model | Successes | Provider failures | Provider error rate |
| --- | ---: | ---: | ---: |
| Heabsy GLM 5.3 Flash Uncensored | 20,698 | 30,837 | 59.84% |
| Tagflow Code 27B | 3,784 | 1,467 | 27.94% |
| Heabsy Xiaomi MiMo V2.6 Flash | 6,221 | 1,473 | 19.14% |
| Heabsy Qwen3.8 27B | 9,621 | 1,923 | 16.66% |

The dominant Heabsy failure is HTTP 429 from the provider. A nearby snapshot counted 30,364 GLM throttles, 1,907 Qwen throttles and 1,392 MiMo throttles. GLM throttles averaged about six seconds; Qwen/MiMo about 2.4 seconds. The service already has retries, cooldowns and fallbacks; these do not create upstream capacity.

Heabsy traffic came from 2,883 accounts with about 89,687 attempts; the busiest account made 1,409 attempts and the five busiest together made 5,352 (about 6%). This does not establish one-account abuse as the main cause. Subscription gating should reduce public demand, but cannot guarantee removal of provider throttling for subscribers.

Tagflow is a separate problem. One query found 1,390 interrupted streams averaging 1,104,801 ms (18.4 minutes). Duration buckets found 867 interruptions in minute 19 and 399 in minute 20. The relay has a 20-minute hard stop, a two-minute idle timeout and three minutes to start responding. The concentration near the hard stop is consistent with timeout-driven failures, but request telemetry does not distinguish a relay timeout from an upstream disconnect; it cannot prove every such interruption has the same cause. No timeout was increased without that evidence.

There were also thousands of `context-length` rejections (roughly 4,099 MiMo, 3,890 GLM and 3,528 Qwen). These occur before provider execution and are excluded from the provider error rate. They warrant a separate review of conversation compaction and input/output headroom.

## Release and follow-up

Released to production on 29 October 2026. Worker code version: `e4812184-8b3c-45a9-9c07-dd98ee5cac1c`, followed by server-secret updates enabling admin key saving. Both production hostnames serve the updated plans and subscription requirements. The shared-allowance and Pro-price migrations were applied. Four existing active Weekly subscriptions received a temporary 60M-token boost through their current paid period, preserving the prior allowance without rewriting payment records or billing periods.

Dodo live products now show Weekly $3/week, Monthly $9/month and Pro $29/month with matching descriptions. The webhook retains its existing payment/refund/dispute events and now includes seven supported subscription lifecycle events. A live Pro checkout was opened and visibly verified at $29/month; no purchase was completed.

Live checkout testing also exposed unsupported `redirect: "error"` in the Workers runtime. The Dodo adapter now uses `manual` for product and subscription lookups. Product readiness is checked before reserving a checkout, and safe diagnostics identify price/configuration failures. One local checkout reservation created by this verification before the runtime fix was expired only after confirming that no upstream session had been created; other users' reservations were untouched.

Admin provider-key saving is enabled with an account-scoped Workers Scripts: Edit token, explicitly approved by the owner. Its write permission was verified, the temporary setup file was removed, and the admin form was left on OpenRouter for the owner to enter their key. No provider keys were entered or replaced during this setup.

Next operational steps: inspect Heabsy provider capacity/account limits, and add explicit timeout-cause telemetry to distinguish Tagflow hard stops, idle timeouts and upstream interruptions. Do not label subscription access as a fix for provider capacity.

Validation: targeted API, payment, quota, pricing and desktop failure tests; root/web/desktop TypeScript checks; all migrations replayed successfully in PGlite with AI-plan accounting checks; production build and live catalogue, pricing and checkout checks. The adaptive output-headroom change is live, reducing avoidable context-length rejections. The later prepaid USD wallet and 35% markup are implemented separately; see the [30 October launch record](paid-model-wallet-launch-2026-10-30.md) for the current deployment and desktop-release status.
