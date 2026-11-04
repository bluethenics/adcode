# Report fixes — 2 November 2026

74 reports were not closed (22 open, 52 triaged). 53 whose cause is already fixed in production were marked closed, then deleted as requested. A private snapshot of them is in `output/report-fix-snapshot-2026-11-02.private.json` (gitignored; never publish it). 21 remain: 13 fixed in this working tree and waiting for a deploy or desktop release, and 8 that need a person.

## Closed: fixed in production already

Checked against `ai_model_requests`, not assumed:

| Reports | Evidence |
| --- | --- |
| 40 × "Included AI stream interrupted" (2.3.2–2.4.4, 26–30 Oct) | `stream-interrupted` fell from 3,624 (28 Oct) to 0–34 a day since 31 Oct |
| 6 × "Could not reach the provider" / HTTP 502 (28–29 Oct) | `request-ended` and `upstream-http` down more than 90% from 28–29 Oct |
| 1 × tinyllama "does not support tools" | Correct, specific explanation already shown; a model choice, not a defect |
| 5 × sign-in/verification whose accounts are now verified | `users.email_verified` true; four have used included AI since |
| 4 × "verification email never arrived" (accounts with an email) | All attempts predate the 1 Nov Resend delivery fix; 103 sends and 23 confirmations went out in the last 24 hours |

## Deployed

Worker `76495acd-bc4a-4381-9565-7e465ff3772b` went live at 16:58 UTC on 2 November. It was built from `C:/Users/SINAN/AppData/Local/Temp/adcode-deploy-fixes-20261102`, a copy of the source behind the previous live version `00c0f5b8` (`C:/Users/SINAN/.codex/worktrees/adcode-usage-access-20261101`) with exactly eight files changed: the four server files below and their tests. None of the shared checkout's other uncommitted work shipped. Roll back with `npx wrangler rollback 00c0f5b8-f076-487f-94fe-6d7d607c750d`.

## Local-currency token packs (Daniel and three others)

Dodo charged four $10 Boost buyers in EUR, BRL and GBP; `providerEvents.ts` dropped every non-USD payment, so the orders stayed pending and nothing was credited. The owner approved crediting them: `output/repair-local-currency-token-packs-2026-11-02.sql` marked each order paid and added 5,000 credits with a ledger entry and an applied event. Token-pack checkouts now charge in USD, and a non-USD token payment is checked against Dodo's USD settlement, or held for review instead of being dropped.

## Server fixes (live in `76495acd`)

- **False "conversation too big" (HTTP 413, 6 reports).** Admission priced every byte of the request as a token, about 3× the server's own token estimate, so users with 10–32 credits left were refused on short agent chats (the tool list alone is tens of kilobytes). In the last 24 hours this refused **482 of 1,534 active users**, 55,978 requests. Admission now uses the same token estimate as the context check; settlement still charges only what was really used and is still capped at the reservation. The refusal names the real cause, the balance, the cost and a free model to switch to. `services/api/src/tagflow.ts`.
- **Paid subscribers on an older period refused new models (402 "legacy-plan-model").** Free accounts could use those models while paying ones could not. New models now draw on the plan's current credit allowance; original models keep the protected allowance.
- **Accounts with no email could never verify (3 reports).** Firebase's lookup fell back to nothing when the account had no top-level email. It now uses the sign-in provider's address as the place to send ADCode's own link; opening that link is still the proof. A linked account with no address at all is told to add one, not to "sign in" again. `services/api/src/accountIdentity.ts`.
- **Queue refusals were one undifferentiated `queue-capacity` (2,901 on 2 Nov).** They are now recorded as `queue-account`, `queue-timeout` or `queue-capacity`, and the per-account refusal says that parallel chats and helpers count.

**Desktop (needs a release):**

- The composer meter counted credits held for a reply in progress as spent, so it plunged and recovered mid-reply. It now shows spent credits and names the hold in its tooltip.

- Failure cards for: credits too low for a long step (instead of "too big"), the older-plan 402 (instead of "out of credit"), a retired model with the provider's named successor (Gemini 2.5 Flash-Lite → 3.5), Ollama's context window with the exact setting to raise, a no-email account, and both kinds of queue refusal (instead of "too many requests a minute").
- "1 chats are already working" names the busy chat.
- The sign-in gate offers "Add an email" for a linked account without one, wired to the existing `account.linkEmail`, which had no caller.
- The gate's ASCII field now thickens under the pointer (no idle loop; reduced motion honoured).

**Website:** pricing and account plan cards show the price per day, a floor of agent steps a day per plan (6.8 credits per uncached DeepSeek step, from `includedCharge`), and cancel-any-time next to the buttons.

## Still open, needing a person

- **Weekly subscription cancellation request.** Not treated as authorisation to cancel billing.
- **Custom providers.** NVIDIA "fetch failed", custom GLM HTTP 400, and a custom connection's "Invalid request parameters". These need the users' endpoint details.
- **Agent loops on user projects.** Two reports of "three identical failed calls to run_command": a cargo compile error and unsaved files blocking edits.
- **"Signed-in account changed"** on an unverified account.

## Repairs to the Codex/OpenCode edits

Typecheck was clean; 6 tests failed. All six were stale against intended changes: two web tests still expected 5M tokens (live is 100 credits a day), the docs seed was stale, the paused live-session command was still listed in the feature catalogue, and the invite-copied message had been reworded.

## 3 November: deployed

Approved by the owner and live since 00:48 UTC on 3 November:

- **Website/API:** Worker `245b6815-0f6b-4f9f-8f36-4a7e8efe2e4c`, built from `C:/Users/SINAN/adcode-deploys/20261103`. Roll back with `npx wrangler rollback 76495acd-bc4a-4381-9565-7e465ff3772b` from `apps/web`.
- **Queue:** `adcode-projects` Worker `a5dd1dbe-4a76-4fd9-bbc9-df62c69b45b2`, deployed with `apps/web/node_modules/.bin/wrangler deploy --config apps/collab-relay/wrangler.jsonc`. The bundle differs from the 1 Nov release only by the queue change. Roll back with `npx wrangler rollback 2b3615ca-80e6-4fcb-a340-919516e38d1e --name adcode-projects`.

Live checks: the site and API return 200. The published config carries release dates for the 7 models added on 1 Nov, the pricing page shows 7 New tags, and the queue Worker's `/health` is ok.

Measured 40 minutes either side of the deploy: "compact and retry" loops (`credit-context`) fell from 280 to 6. Near-empty balances paused instead (`credit-near-empty`, 88). `queue-account` refusals fell from 26 to 7, and served requests rose from 247 to 329 as morning traffic grew.

Later the same day, the one remaining non-USD buyer (BRL, paid 12 minutes before the 2 Nov fix) was credited 5,000 credits with the owner's approval. Twelve people behind 15 credit reports were answered from bluethenics01@gmail.com, and those reports were closed and deleted (private copy in `output/report-replied-snapshot-2026-11-03.private.json`). The only purchase after the fix was charged in USD and credited automatically.

### What the build contains

The website/API build is at `C:/Users/SINAN/adcode-deploys/20261103`. It is the base folder `C:/Users/SINAN/.codex/worktrees/adcode-usage-access-20261101` plus 18 files (the 8 from `76495acd` and 10 more); `diff -rq` shows nothing else. Production deploys need the owner's go-ahead, so it is not live. The earlier folder in `%TEMP%` was partly deleted by Windows and must not be used again.

- **Near-empty balances pause** until the refill (HTTP 429 `daily-limit` with `resetsAt`) instead of sending clients into compaction retries. One account retried 1,527 times overnight.
- **True provider cost:** cached input is recorded at the cache rate, so admin cost reports stop overstating agent chats.
- **New models:** the service publishes each model's `releaseDate`. The desktop model chip and Connect view, and the website's credit-rate table, mark New for 45 days. The config parser accepts the field; before, an unknown model field disabled all of included AI.
- **Pricing page:** the credit-rate table lists only the models offered now (11, not the 37-model catalogue). On `/ai-tokens`, Unlimited spans the row instead of wrapping alone.
- **Queue (`adcode-projects` Worker):** Free runs 4 requests at once, up from 2, matching the desktop's parallel chats. Extra requests wait in place instead of being refused (up to 16 per account). `queue-account` refused 1,928 requests from 23 accounts in eleven hours while providers had room. This Worker deploys separately; its source in `apps/collab-relay` matches live `2b3615ca` except `priority.ts`.

Desktop (next release): the usage dialog scrolls as one with pinned range tabs, and the Vibe sidebar footer goes compact under 900px so Chats keeps the room. Feature library rows show New. Out-of-credits cards name the refill time and offer Upgrade plan and Buy credits, and buy actions say "credits" everywhere.

Two models in Heabsy's price list stay off: Heabsy refuses our account for Qwen3.8 27B Uncensored Fast (HTTP 403) and DeepSeek V4.1 Flash 1017 Uncensored is not in our model list. Prices for the 11 that are on already match the list. The credit-model proposal is `docs/credit-model-proposal-2026-11-03.md`.

Also in the next desktop release:

- **Unsaved files mid-task** (rep-20): when the unsaved-work guard refuses a command partway through a task, the card names the files and offers **Save all and continue**. Before, it said "The assistant stopped with an error" after three refused commands.
- **Custom providers** (rep-36 NVIDIA, rep-1 and rep-6 custom HTTP 400): a failed connection check on an address the user typed explains the likely cause. That's the address and a missing `/v1`, the model name, or the key. The raw error stays in brackets. `apps/desktop/src/shared/connectionCheck.ts`.

## 3 November, afternoon: plans, Starter pack, click fraud

- **ADCode 2.4.13** is published on GitHub as Latest (2.4.12 was tagged, then withheld for a dependency advisory). The Store package is `output/ADCode-2.4.13-x64-store.appx`; the website release note waits in `output/release-note-2.4.13.md` for Admin → Releases.
- **Plan allowances (owner's decision):** Weekly 280, Monthly 200, Pro 650, Max 2,200 and Unlimited 6,700 daily credits. Each keeps about a 40% margin at full use after the provider's list price (ADCode pays 85%) and about 5% fees. A paid period ending before 18:00 UTC on 3 Nov plus one billing interval keeps the better of its old and new allowance. Live as Worker `ab19d8bf` (rollback `npx wrangler rollback b4f46f41-6424-4312-8ae7-66e50accff34`).
- **Starter pack:** $3 for 1,500 credits, the same $2 per 1,000 as Boost, added to the live pack list (previous config in `output/tagflow-paid-config-before-starter-2026-11-03.json`). "Buy credits" on an out-of-credits refusal now opens the packs.
- **Click fraud reversed:** one account's 82,069 ad clicks on 28 Oct ($82.42) were reversed with a ledger `reversal` entry and the account was flagged in the audit log. Nothing had been withdrawn.
- **Measured after the 3 Nov server fixes** (about 12 hours against the same hours on 2 Nov): served requests 9,334 → 13,701, people who got answers 893 → 1,228, and false "too big" refusals 53,774 → 2,839.

## 3 November, evening: release published, website matches the release

- **Release note:** 2.4.13 is published in `public.releases` (`output/publish-release-2.4.13.sql`, quiet: no card, no email), so Store and portable installs offer 2.4.13 instead of 2.4.11. The Store package is in Microsoft's review.
- **Website/API:** Worker `12b659b3-d9df-4333-b005-b9b20792fa06`, live since about 14:00 UTC, built from `C:/Users/SINAN/adcode-deploys/20261103-release`. Its web, API and package sources match the release branch exactly; against `ab19d8bf` the only differences are `apps/web/src/lib/firebase.ts`, `services/api/src/requestPriority.ts` and the fork-chat files in `packages/ai`, `packages/help` and `packages/settings`. Roll back with `npx wrangler rollback ab19d8bf-c286-433a-8a3b-9f5d64065a99` from `apps/web`. Checked live: the main pages and `/docs/whats-new-2-4-13` return 200, `/ai-tokens` lists Starter first with per-day prices, `/pricing` shows the new allowances and 7 New tags, and `/v1/releases` leads with 2.4.13.
- **Imprezia:** a reply-all on the existing thread gave them our status and asked for the production key and siteId/placementId. Waiting for their answer.
- **Advertisers (Worker `7ae9559b`, about 14:25 UTC, owner approved; rollback `npx wrangler rollback 12b659b3-d9df-4333-b005-b9b20792fa06`):** no ad had served since 29 Oct because every funded campaign's budget was spent. `/advertisers` is live (Advertise links point there). It was restyled after a Haiku survey of Freebuff's advertiser pages, with placement frames, a sample workspace and repeated Start a campaign buttons. `/v1/stats` now counts only campaigns that can serve (0 now, was 3). Advertiser and wallet top-ups are charged in USD, because the webhook drops other currencies.
- **28 Oct click fraud drained the house campaigns.** One account (still `active`) billed 82,070 clicks against 2,532 serves: about $81 of venet's $100, $62 of "Adcode · Sep 2026" and $21 of freebuff. venet and jace are the owner's own accounts, so no outside advertiser paid for it. The cause: settlement was keyed on the client's receipt id, so every invented id billed again. Fixed in `7c52c0d4` (one view and one click per serve; all 1,202 API tests pass) and live since 4 Nov as Worker `00ec6069-8659-4317-a9fd-486fbf2e5e6b` with the owner's approval, built from `C:/Users/SINAN/adcode-deploys/20261104-receipts` (live `7ae9559b` plus `receipts.ts` only). Roll back with `npx wrangler rollback 7ae9559b-9491-4555-9bc7-4fa56894f1e4`. On 4 Nov the owner approved suspending the account: it is now `banned` with a `set-status:banned` audit row, exactly as the admin panel's ban does (`output/suspend-click-fraud-account-2026-11-04.sql`). It had no pending withdrawal.
- **Paid models refused to older editors:** releases before 2.4.12 do not send the paid-credits header, so 101 people in a week (61 on the evening of 3 Nov) picked a paid model and were told only "Update ADCode". The refusal now links the download page (`bc3fa1e5`); built in `C:/Users/SINAN/adcode-deploys/20261104-wallet`, not deployed yet. The owner chose not to restore the budgets yet (4 Nov).
- **Outreach:** unsent Gmail drafts to Huy (XChange; their $1 checkout failed at session creation), Galang (gal) and Parsa. gitappdownload was left out: its card links to gitapp.download ("best mac pc games tools, download the software on one click"), which looks like a cracked-software site and needs review before it ever serves.
- **One-week check:** a scheduled task runs on 11 Nov at 09:00 IST with `output/one-week-check-2026-11-10*.sql`. It compares 26 Oct–2 Nov with 3–10 Nov and writes `docs/one-week-check-2026-11-10.md`. The "before" week: 419,581 requests, 214,122 served, 5,700 people answered, 58,231 false "too big" refusals, 6 packs paid ($60), 22 subscriptions started.
