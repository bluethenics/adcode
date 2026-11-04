# Max and Unlimited Fair Use

The owner requested a larger Max subscription and an all-model Unlimited tier, then explicitly selected $299/month Unlimited with clearly stated fair-use limits. Two products were created and verified in the existing bluethenics Dodo account. Existing products and subscriptions were not changed.

| Product | Monthly price | Daily credits | Coverage | Dodo product ID |
| --- | ---: | ---: | --- | --- |
| ADCode Max | $99 | 2,400 | Included models, including available Heabsy partner routes; separate USD-wallet routes retain separate billing | `pdt_0Nqyk4CwpzeI9PsQogG1h` |
| ADCode Unlimited - Fair Use | $299 | 5,000 | All enabled, connected ADCode-hosted models, including premium models | `pdt_0NqykdoKvHfrtM2lHwUpC` |

Both are SaaS subscriptions billed once per month in USD, with applicable taxes added at checkout, no trial, and no automatic expiry after a fixed number of periods. Product descriptions disclose daily credit rules and cancellation. They were created through Dodo's product form; no payment was made and no customer was subscribed.

Unlimited means unlimited **model access**, not unlimited tokens, requests or provider capacity. The 24-hour fair-use window starts on first usage. Requests must fit the remaining allowance. Usage pauses at exhaustion and resumes after refill. Purchased token balances and the separate USD wallet are not charged automatically. Normal provider limits and model context windows remain in force. Premium models consume credits at their existing displayed provider-plus-35% rates, including cache and long-context rules. This is stated on the page, in checkout descriptions, FAQs and account usage copy.

The new catalogue is implemented across API plan IDs, payment products, signed webhook product matching, subscription storage, gift/promo selection, expiry/ranking, MRR reporting, checkout selection links and desktop plan names. The private `reserve_ai_fair_use` database function reserves daily allowance without spending purchased balances. Max/Unlimited checkout is blocked until cost-based accounting is enabled. Product configuration still needs these runtime values during the coordinated release:

```
DODO_PLAN_MAX_ID=pdt_0Nqyk4CwpzeI9PsQogG1h
DODO_PLAN_UNLIMITED_ID=pdt_0NqykdoKvHfrtM2lHwUpC
```

The public page places Monthly, Pro and Max side by side, recommends Pro for daily coding, and shows Max's fourfold capacity increase clearly. Weekly is a smaller commitment beside the main comparison. Unlimited is a separate $299 all-model offer with the numeric fair-use allowance next to its price and CTA. A coverage table distinguishes included models from premium models. No fake sales counts, countdowns or scarcity claims were added. The $50 top-up is now called Power to distinguish it from the Max subscription.

At full 31-day Max usage, provider list cost is $74.40, or $63.24 with the quoted 15% Heabsy discount. Contribution is $35.76 before fees and other operating costs at that discount. Unlimited's daily credits bound displayed usage to $155 over 31 days; without assuming any partner discount, at least $144 remains before fees and operating costs if configured prices cover actual provider charges. This is contribution, not guaranteed net profit. Free-user acquisition costs remain separate. Confirm model rates and the partner discount against invoices.

Validation: 240 targeted tests pass, plus API/web/desktop TypeScript checks. All migrations replay in PGlite. Database tests cover Max/Unlimited webhooks, strongest-plan selection, expiry, MRR, concurrent reservations, private RPC access and protection of purchased balances. Browser checks at 1440px and 390px show no page overflow and verify the plan comparison and fair-use disclosure.

The website/API/database are live. Both product IDs are configured as encrypted Worker settings. Four coordinated migrations introduced separate cost windows, Max/Unlimited, fixed current-period protection, and the Heabsy catalogue launch. Existing subscription prices remain unchanged. Use ADCode checkout rather than standalone Dodo links so the account identity reaches signed webhook fulfillment. See the [live launch record](heabsy-credit-launch-2026-11-01.md).

Evidence: [Dodo product list](../output/max-unlimited-dodo-products.png), [desktop pricing preview](../output/expanded-pricing-desktop.png), [mobile pricing preview](../output/expanded-pricing-mobile.png).
