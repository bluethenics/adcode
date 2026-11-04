# ADCode prepaid model wallet — research, 29 October 2026

## Recommendation

Use OpenRouter as the first upstream, behind ADCode's own server. Users purchase ADCode usage credits, select a model, and pay its displayed input/output/cache rates from that balance. Keep provider keys on the server. Keep this new paid catalogue separate from the Heabsy subscription entitlement: unlimited Heabsy must not imply unlimited paid OpenRouter inference.

The owner approved a fixed 35% markup over provider inference rates. The prepaid wallet is implemented with $10, $20, $50 and $100 purchases, separate from included tokens and Heabsy plans. Model availability requires an owner-supplied server key. See the [launch record](paid-model-wallet-launch-2026-10-30.md) for deployment and desktop-release status. A subscriber discount is not enabled.

## Demand: usage is not sales

[OpenRouter rankings](https://openrouter.ai/rankings?context-length=1M) report tokens processed, not purchases, unique buyers or revenue. The snapshot's weekly table lists DeepSeek V4.1 Flash, GLM 5.3 Flash, Step 5 Preview, MiMo-V2.6-Flash, Tencent Hy4 Preview, GPT-6 Luna, Claude Opus 5.5, GLM 5.3, NVIDIA Nemotron 3 Ultra (free), and DeepSeek V4 Flash 0731. Other date/window views show the newer DeepSeek V4.1 Flash 1017 prominently. Free variants and temporary promotions can drive high usage without proving paid demand.

Companies: DeepSeek; Z.ai (GLM); StepFun; Xiaomi (MiMo); Tencent (Hy4); OpenAI (GPT); Anthropic (Claude); NVIDIA (Nemotron). MiniMax M3.1 Flash and Moonshot AI's Kimi K3.1 Pro are also prominent in current trending tables.

I could not verify a public OpenCode model-sales leaderboard. OpenCode's published catalogue establishes availability and prices, not which models its customers buy most.

## Low-cost launch shortlist

USD per one million text tokens. These are catalogue reference rates retrieved from the [OpenRouter models API](https://openrouter.ai/api/v1/models), not a guarantee of every serving provider's price. The raw dated snapshot is saved in `output/openrouter-model-catalogue-2026-10-29.json`.

| Model | Model company | Input / 1M | Output / 1M |
| --- | --- | ---: | ---: |
| DeepSeek V4.1 Flash | DeepSeek | $0.045 | $0.50 |
| GPT-6 Luna | OpenAI | $0.10 | $0.50 |
| MiMo-V2.6-Flash | Xiaomi | $0.14 | $0.28 |
| GLM 5.3 Flash | Z.ai | $0.15 | $0.50 |
| Qwen3.8 Flash | Alibaba | $0.15 | $0.47 |
| MiniMax M3.1 Flash | MiniMax | $0.15 | $0.60 |

All six advertise tool support in this catalogue. Test them on ADCode's actual editing/tool-call workloads before selecting defaults. My initial product recommendation is GPT-6 Luna for lightweight work, DeepSeek/MiniMax for coding-agent evaluation, and MiMo as another low-cost option. Keep GLM available but avoid making it the sole default until the current provider throttling is addressed. Heabsy's observed failures do not establish the reliability of every other provider serving GLM.

Provider pages and the catalogue can show different prices. For example, the GLM page surfaced cheaper promotional providers, while DeepSeek's cheapest input provider had much higher output pricing than the catalogue baseline. DeepSeek 1017 also has scheduled price overrides, and GPT-6 Luna has a higher rate beyond 272K prompt tokens. Pin tested providers or cap acceptable provider prices; never sell using only a headline minimum input rate. Preserve distinct prices for uncached input, cached input, cache writes, output/reasoning and optional tools.

## OpenCode comparison

OpenCode's current [Console model documentation](https://opencode.ai/v2/docs/console/models/) redirects from the former Zen URL. Paid models can be used from other coding clients; free-tier chat models require OpenCode. Do not build a resale business on its temporary free promotions.

Published OpenCode reference rates include GLM 5.3 Flash $0.15/$0.50, Qwen3.8 Flash $0.15/$0.47, GPT-6 Luna $0.10/$0.50 for prompts up to 272K, and DeepSeek V4.1 Flash $0.30/$1.20. Model variants, selected providers and cache pricing must match before comparing two prices.

[OpenCode billing](https://opencode.ai/v2/docs/console/billing/) adds 4.6% + $0.31 to credit purchases. [OpenRouter Standard](https://openrouter.ai/pricing) adds 5.5% when buying credits; Business adds 8%, without changing the model list prices. OpenRouter is the recommended initial integration because its platform and terms explicitly address integrating models into customer-facing products. Model-specific terms still apply: see [OpenRouter terms, section 5](https://openrouter.ai/terms).

## Markup and contribution

Define markup over base inference cost, not over customer deposits. A 35% markup means $1.00 of base model usage is sold for $1.35. It is a 25.93% gross margin before the upstream platform fee and ADCode's expenses.

Illustrative model: a customer purchases and fully spends $20 of ADCode credits; OpenRouter Standard adds 5.5% to ADCode's inference funding; Dodo costs 4% + $0.40; ADCode sets aside 3% of revenue for operating losses/support/infrastructure. Taxes are excluded. This reserve is an assumption, not a measured ADCode expense.

| Markup over base model rate | Inference + OpenRouter | Dodo | Assumed reserve | Contribution left |
| --- | ---: | ---: | ---: | ---: |
| 20% | $17.58 | $1.20 | $0.60 | $0.62 / 3.08% |
| 30% | $16.23 | $1.20 | $0.60 | $1.97 / 9.85% |
| 35% | $15.63 | $1.20 | $0.60 | $2.57 / 12.85% |
| 40% | $15.07 | $1.20 | $0.60 | $3.13 / 15.64% |

Formula: contribution / deposit = 1 - payment percentage - fixed payment fee / deposit - (1 + upstream funding fee) / (1 + markup) - operating reserve percentage.

The [Dodo pricing table](https://dodopayments.com/fr/pricing) lists additional costs, including international cards (+1.5%) and some billing/payment methods. The 35% example falls to about 11.35% contribution with the international surcharge alone, and lower with other applicable charges. Refunds and disputes can overwhelm the assumed reserve. These figures are contribution estimates before fixed overhead, income tax, acquisition costs and the actual refund/dispute experience, not guaranteed net profit. Check the account's contracted fees before launch.

At $5 top-ups the fixed $0.40 fee alone consumes 8%; at $20 it consumes 2%. This is why $10 minimum/$20 suggested is preferable to many tiny purchases. Buy OpenRouter credits in sensible batches rather than matching every individual customer deposit, and preserve enough cash to serve outstanding customer credits.

## Charging flow and customer experience

1. Confirm a Dodo payment through a signed, idempotent webhook, then add USD usage credits to a separate money ledger. Do not credit on a checkout redirect.
2. Authenticate the ADCode user and atomically reserve enough credit for the selected request, including the maximum accepted output. Concurrent agents must share this reservation system.
3. Send the request through ADCode's server with the provider key. Record the serving model/provider and a price snapshot.
4. Settle confirmed billable usage, release unused credit, and reconcile ambiguous/interrupted requests against the provider's usage record. A cancelled request may still incur real provider usage; do not automatically treat it as free or charge its full reservation.
5. Show the model's price before use, remaining dollars, actual per-message charges and a ledger. Offer an optional per-task dollar cap, low-balance alerts and explicit opt-in auto-top-up.
6. Never charge twice for a fallback. Keep fallback within the user's accepted price ceiling; ask before switching to a more expensive model. Retry failures without duplicating completed tools.

The current repository meters purchased token quantities; a USD wallet needs its own monetary ledger and reconciliation, rather than renaming those quantities as dollars. Existing Heabsy subscriptions, token packs and the proposed paid catalogue need explicit boundaries in the UI and accounting.
