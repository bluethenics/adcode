# Cost-based AI credits

Published on 1 November 2026. See [live launch record](heabsy-credit-launch-2026-11-01.md) for deployment details and provider-access checks.

The owner's WhatsApp export quotes 13 Heabsy model prices and a 15% partner discount. The discount is a planning assumption until the provider account/invoice confirms it. The supplier's advice about making free usage unpleasant is reference material, not a product requirement. Free use should be useful and upgrades should buy more capacity.

| Plan | Price | Daily credits | Maximum list cost per period | Provider cost at 15% discount | Contribution before other costs |
| --- | --- | ---: | ---: | ---: | ---: |
| Free | $0 | 10 | $0.31 / 31 days | $0.2635 | Acquisition expense |
| Weekly | $3 / week | 150 | $1.05 / 7 days | $0.8925 | $2.1075 (70.25%) |
| Monthly | $9 / month | 150 | $4.65 / 31 days | $3.9525 | $5.0475 (56.08%) |
| Pro | $29 / month | 600 | $18.60 / 31 days | $15.81 | $13.19 (45.48%) |

These are contribution estimates, not net profit or guaranteed revenue. Subtract payment fees, hosting, refunds, support, abuse and free-user costs. Without the partner discount, full-use Monthly still leaves $4.35 and Pro $10.40 before these costs. One fully used free account costs at most about $0.264 per 31 days at the discount; 1,000 such accounts cost about $264. Monitor free acquisition spend against conversion and ad revenue.

Monthly gives the same daily capacity as Weekly for less over sustained use. Pro gives 4× Monthly capacity for about 3.22× the price. Daily credits do not roll over; purchased credits never expire. Free credits are included in the plan allowance, not added again.

| Top-up | Price | Credits | Maximum provider cost, discounted | Contribution before other costs |
| --- | ---: | ---: | ---: | ---: |
| Boost | $10 | 5,000 | $4.25 | $5.75 |
| Plus | $25 | 14,000 | $11.90 | $13.10 |
| Power | $50 | 30,000 | $25.50 | $24.50 |

One credit consumes $0.001 of undiscounted model cost. Input, output and cached input are priced separately. Example: DeepSeek 10k uncached input + 2k output costs 6.8 credits; with 8k of that input cached, 3.92 credits. No fixed number of requests or agent steps is promised. Keep the provider discount private; users see credits and model rates.

Legacy purchased units stay unchanged: 11,000 stored units = one credit, so 55M/154M/330M balances map to 5,000/14,000/30,000 credits. No paid pack orders existed at cutover; positive grants remain. Existing paid subscribers retain the old allowances on the five original models until their fixed current paid-period end, without extending that protection on renewal. Separate USD-wallet routes retain their 35% markup. Unlimited covers those routes within its daily fair-use credits; other plans use the separate USD wallet.

The server enables the new accounting only for `paid.accounting = cost-v1`. Legacy configurations retain their previous allowances until cutover. New reservations cover the full maximum quote atomically; replies are fitted to available credits, unused reservations are released, and charged usage is bounded by the quote. Unknown/zero-priced models cannot serve cost-credit requests. Fallbacks must fit the original cost ceiling.

The production migration uses a separate `cost_day` window. Existing `paid_week` windows, historical reservations and legacy boosts remain intact; old in-flight requests settle to their recorded window kind. No traffic drain or usage reset was needed. The final catalogue migration snapshots current paid periods and enables `cost-v1` atomically after the new API deploys. Dodo's Weekly, Monthly, Pro and top-up descriptions were updated to the daily cost-credit terms. Max and Unlimited have their own products.

After rollout verify a free request, cached settlement, daily refill, a finite Pro account, a top-up webhook, refund reversal, and the desktop credit display. Track daily provider spend, contribution per plan, conversion and cost per converted user; adjust acquisition budgets based on observed data rather than promising maximum revenue.

References: supplied chat (31 October 2026); [Heabsy DeepSeek pricing](https://heabsy.com/models/deepseek-v4.1-flash-unc); [Claude usage limits](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work). Claude uses session and weekly windows; this implementation deliberately retains ADCode's daily refill storage.

Validation: 194 core pricing, billing and accounting tests pass; 59 additional compatibility checks pass (11 overlap with the core set). API, website and desktop TypeScript checks pass. All migrations replay successfully in PGlite, including targeted concurrent holds and cost settlement. Pricing pages were rendered at desktop and mobile widths with no horizontal overflow.
