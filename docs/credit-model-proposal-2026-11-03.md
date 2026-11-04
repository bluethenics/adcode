# Credit model proposal — 3 November 2026

A proposal, not a change: nothing here is live. It combines Lovable's credit model (daily free credits, plus a monthly pool on paid plans that rolls over) with Freebuff's (free AI paid for by ads shown while the agent works). The goal is that every credit spent is paid for, by a plan, a pack or ad revenue.

## What the data says

Figures from `tagflow_usage`, `ai_model_requests` and the order tables, 1–2 November.

| | Figure |
| --- | --- |
| Recorded provider cost, 1 Nov | $153.54 at list price (about $130 after the 15% partner discount) |
| Daily users of included AI | about 1,350 |
| Payments, last 14 days | about $15 a day (packs plus receipts in all currencies); 10 active subscriptions |
| Cost from the top 3 accounts | $58.36 (38%): two Weekly ($3/week) and one Monthly subscriber on pre-1 Nov plans, which keep millions of tokens a day until their period ends |
| Free users under 11 credits a day | 1,125 of about 1,350 |
| Biggest model by cost | DeepSeek V4.1 Flash Uncensored: 7,656 requests, $117, about 37k input tokens each |

Two corrections change the picture:

1. **Recorded cost was overstated.** It priced cached input at the full input rate, while Heabsy bills it at about a tenth (DeepSeek: 0.04 against 0.40). Agent steps resend the same history, so most of their input is cached. Fixed in the 3 November deploy; real cost is likely well under the $130–150 recorded.
2. **The legacy plans end on their own.** The three costliest accounts move to cost credits at their next renewal. That removes about 38% of the recorded cost.

## Every plan already pays for itself at full use

At list cost (1 credit = $0.001) and before the partner discount:

| Plan | Price | Credits at full use | List cost at full use | Our cost (85%) |
| --- | --- | --- | --- | --- |
| Weekly | $3/week | 225/day × 7 = 1,575 | $1.58 | $1.34 |
| Monthly | $9/month | 225 × 30 = 6,750 | $6.75 | $5.74 |
| Pro | $29/month | 900 × 30 = 27,000 | $27.00 | $22.95 |
| Max | $99/month | 3,000 × 30 = 90,000 | $90.00 | $76.50 |
| Unlimited | $299/month | 7,500 × 30 = 225,000 | $225.00 | $191.25 |

Monthly, Pro and Max have thin margins at full use. Most subscribers don't use everything, which is where a monthly pool helps (below). **The gap is the free tier.** A heavy free user costs up to about $2.55 a month (100 credits a day), and nothing pays for it except ads.

## Proposal

### Free: base credits plus ad-earned credits (the Freebuff part)

- **Base:** 30 credits a day, about four agent steps. Enough to try ADCode properly.
- **Earned:** each sponsored card shown while an agent works adds credits, up to 70 more a day, for 100 in all. The credits per card come from real Imprezia revenue per impression, so every free credit is paid for. Ads already run; this ties free usage to them.
- Switching ads off keeps the base 30, so the trade stays honest: ads in exchange for more AI.

### Paid: a monthly pool that rolls over (the Lovable part)

- Each plan gets its monthly total as a pool, spendable on any day. Pro, for example, gets 27,000 credits a month instead of 900 a day.
- Unused credits roll over for one month while the subscription stays active. A daily cap removes the main frustration ("out of credits today" with the month barely used), and that frustration drove many of the reports.
- Keep a small daily bonus of 30 free credits on top for every account, so a paying user is never worse off than a free one.

### Margin guard

- Include a model only when its credit rates are at or above its list price. All 11 enabled Heabsy models already are.
- Each pack and plan price must cover full-use cost at 85% of list. The table above passes.

## Update, 3 November: what an ad view is worth, and the first measurements

**An ad view is worth about $0.002.** ADCode's own ad serving (`serves`, `ledger_entries`, before Imprezia-only on 30 Oct) credited developers about $1 per 1,000 impressions as their half, so about $2 per 1,000 in total. Imprezia's own rate is in its dashboard, not our database, and its SDK cards no longer credit developer balances. At $0.002 a view, the 70 ad-earned credits in the proposal ($0.07 of list cost) would take about 35 sponsored views a day per person. Cards appear under replies, so that is not realistic. **Ads cannot fund the free tier credit-for-credit.** The free allowance is an acquisition cost, and the lever is converting heavy free users, not earning back their usage with ads.

That changes the recommendation. Keep the free allowance meaningful (it is what brings people in) and spend the effort on conversion:

- At the moment credits run out (the card now offers Upgrade plan and Buy credits), offer a smaller first pack, such as $3 for 1,500 credits, below the $10 Boost. That lowers the first-payment barrier.
- Show heavy free users (more than 80 credits on three days) how much they did, as in "you used 1,240 credits this week", with the monthly-pool plans. Weekly is the cheapest step.
- Keep the monthly pool with rollover for paid plans, as above.

**First measurements after the 3 Nov fixes** (about 12 hours from 00:48 UTC against the same hours on 2 Nov):

| | Before | After |
| --- | --- | --- |
| Requests served | 9,334 | 13,701 (+47%) |
| Share of requests served | 14% | 50% |
| People who got AI answers | 893 | 1,228 (+38%) |
| False "conversation too big" refusals | 53,774 | 2,839 (−95%) |
| Checkouts opened / payments received | 3 / 1 | 9 / 2 |

Purchases are too few to call a trend yet; check again after a week.

**Click fraud to resolve:** on 28 Oct one account (`U5b2m34z…`) produced 82,069 ad "clicks" in 6.5 hours and was credited $82.42, which is still in its available earnings balance. Every other account had at most 540 clicks. Hold or reverse it before any payout.

## What this needs

- A credit-pool column and rollover in the cost-credit SQL (`reserve_ai_cost_credits`, settlement), plus a migration.
- Ad-impression crediting, which needs Imprezia's revenue per impression.
- Pricing page, account page and desktop meter copy.
- Help entries, a web guide and a docs-seed run, per CLAUDE.md.

That is a real billing change and should be its own reviewed piece of work, with the numbers above confirmed first.
