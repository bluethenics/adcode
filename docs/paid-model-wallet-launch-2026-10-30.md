# Paid model credits launch — 30 October 2026

## Product and configuration

Owner authorization: add popular models to ADCode, accept provider keys in the admin panel, sell prepaid USD credits and charge provider inference rates plus 35%. Heabsy subscriptions and included-token purchases remain separate. No subscriber discount is enabled.

The production catalogue has 25 entries: four existing included/subscription models and 21 new paid connections covering 13 selected models. Eight connections use direct company accounts (DeepSeek, OpenAI, Z.ai, MiniMax, Xiaomi and Anthropic); thirteen use OpenRouter. The selection uses OpenRouter token-usage rankings and OpenCode's published catalogue, not an unverified model-sales leaderboard. See the dated research report and public catalogue snapshot.

New keys must be supplied by the owner at https://adcode.bluethenics.com/admin/tagflow under Server connections. Missing-key models stay hidden from the public picker and appear as Coming soon on the signed-in wallet page. Key saving is enabled; credentials are encrypted Worker secrets and never sent to customers. No new provider key was entered during setup.

| Model | Company | Connections |
| --- | --- | --- |
| DeepSeek V4.1 Flash 1017 | DeepSeek | Direct, OpenRouter |
| DeepSeek V4.1 Flash | DeepSeek | OpenRouter |
| GPT-6 Luna | OpenAI | Direct, OpenRouter |
| GLM 5.3 Flash | Z.ai | Direct, OpenRouter |
| GLM 5.3 | Z.ai | Direct, OpenRouter |
| MiniMax M3.1 Flash | MiniMax | Direct, OpenRouter |
| MiMo V2.6 Flash | Xiaomi | Direct, OpenRouter |
| Claude Opus 5.5 | Anthropic | Direct, OpenRouter |
| Claude Sonnet 5.5 | Anthropic | Direct, OpenRouter |
| Hy4 preview | Tencent | OpenRouter |
| Step 5 Preview | StepFun | OpenRouter |
| Qwen3.8 Flash | Alibaba / Qwen | OpenRouter |
| Kimi K3.1 Pro | Moonshot AI | OpenRouter |

## Accounting

Top-ups: $10, $20, $50 and $100 USD; no expiry. The live Dodo product is ADCode Paid Model Credits (`pdt_0Nqo1QhzsnjAYiwomnPWN`). Checkout disables coupons and currency selection and stores a pending order before redirecting. Only a signed, verified payment webhook adds spendable funds. Tax is excluded from purchased credits; partial refunds use the original gross payment ratio. Refund/dispute events are idempotent, including events arriving before the payment webhook.

Usage reserves an atomic maximum charge and releases unused funds after settlement. Concurrent requests cannot overspend; settlements cannot charge twice or exceed the hold. Failed connections and provider refusals release the hold. Negative balances from reversals block further usage. Holds expire after 30 minutes; the relay hard stop is 20 minutes.

OpenRouter reported inference cost is preferred; otherwise provider token counts and configured rates determine the charge. Cached input and cache writes are disjoint. GPT-6 Luna's long-context tier and cache-write premium are applied. Direct DeepSeek uses its ordinary weekday peak/off-peak schedule; special holiday/promotional invoice discounts are not inferred. Missing usage produces an explicitly estimated history entry. Paid provider-hosted tools and custom cache controls are rejected; normal IDE function tools are supported. Paid streams are never restarted or moved to another model automatically.

Wallet models bypass included-token, Pro and campaign allowances. An explicit paid-credit client header prevents old desktop versions from using wallet models with a misleading free-price display. Customers need the new desktop update; the separately deployed web IDE remains intentionally paused.

## Deployment status

Applied migrations: `20261029175011_prepaid_model_wallet`, `20261030004708_model_wallet_reversal_ordering`, `20261029180301_popular_paid_models`. Wallet tables force RLS and are accessible only to the service role. Anonymous reservation attempts were denied.

Marketing/API Worker `adcode`: final production version `bf24eaf4-7f26-4f4b-b21f-12ed6cdcb68f`, including wallet, admin, catalogue, paused/blocked checkout guards and cache/long-context billing. Production build passed. The signed-in customer page was checked for its cache-write prices and disabled purchase buttons while the launch gate is active.

Cloud Worker `adcode-cloud`: `34c60a57-a3be-452a-a59d-8433c2b621e0`; browser assets and paid-credit header forwarding updated, existing deployment variables preserved, container rollout disabled. Web IDE pause preserved.

Desktop v2.4.7 is published at https://github.com/bluethenics/adcode/releases/tag/v2.4.7 and verified as GitHub's latest stable release. All ten installer/update assets are uploaded. The Windows installed-upgrade check and Windows/Linux/macOS build jobs passed. Source branch `codex/paid-model-credits-release` is based on published v2.4.4; release commit `1427200cd4aba0c33bf3b5d60761fd73c47952d5`. Successful CI: https://github.com/bluethenics/adcode/actions/runs/40987263965 .

The earlier v2.4.5 attempt failed generated-help freshness; v2.4.6 passed the full test suite but failed the dependency audit. Both unpublished immutable tags were preserved. Help was refreshed and the vulnerable transitive `re2js` dependency was updated from 2.8.6 to 2.9.1 before v2.4.7. Final CI passed 5,739 tests (three skipped), type checks, dependency boundaries and the high-severity audit gate. Four lower-severity dependency advisories remain. Installers retain the project's existing unsigned status; macOS remains advertised as coming soon.

Microsoft Store package prepared separately on 30 October: `release/store/ADCode-2.4.7-x64.appx` (183,992,151 bytes), manifest version `2.4.7.0`, identity `bluethenics.ADCode`, publisher matching the existing 2.4.4 Store package. Built from the release commit with a fresh locked dependency install; packaged paid-credit header and DOMPurify 3.4.17 verified. The archived application payload matches the built payload. SHA-256: `ec31cdbfec406c7a9bf679766c46101526e9bd65e8b8f5cd55d0800915ddcfdc`. The copy's checksum was verified; the `.sha256` companion is beside it. The file is ready for owner upload and has not been submitted to Partner Center.

After verifying and publishing the desktop release, `DODO_WALLET_PRODUCT_ID` was restored successfully from `output/dodo-wallet-product-routing.json`. No temporary launch gate remains. Checkout still requires at least one configured paid-provider key, an enabled catalogue and an eligible verified account. As verified during setup, all new paid-provider keys were absent, so no customer can purchase unusable credits. The public release-note record was added with announcements off.

## Validation

- API wallet/relay/payment-event/funding tests: 121 passed, followed by 15 wallet cases including streamed settlement, interrupted streams, pricing and tool restrictions.
- PostgreSQL accounting checks passed: purchases, mismatches, duplicates, reserve/settle, capped charges, refunds, disputes, negative debt, stale holds and permissions.
- Root TypeScript and site production build passed.
- Desktop targeted tests: 71 passed; native build and desktop type checking passed. Final release CI: 5,739 passed, three skipped; all installer checks passed.
- Cloud: 130 tests and type checking passed.
- Live admin verified: 25 models, 21 paid entries, direct provider fields, fixed 35% billing and encrypted-key form. No real payment or paid-model inference was performed because new provider keys are absent.

Outstanding operational issue: the original Heabsy provider throttling requires provider capacity/account-limit work. The implementation does not claim to remove upstream 429s or all long-stream interruptions.
