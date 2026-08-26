# Advertising Credits, Market Pricing, and Manual Payouts Design

**Date:** 2026-08-26

**Status:** Draft for written review; all design sections approved in chat

**Scope:** Dodo-funded advertiser credits, second-price ad auctions, public demand data,
manual publisher payouts, payout-country eligibility, and the related portal/admin UI.

## 1. Summary

ADCode will sell advertisers non-transferable, non-withdrawable advertising credits through
Dodo Payments. One credit represents one US dollar of campaign spending power. ADCode, not
Dodo, remains the source of truth for credit balances, campaign commitments, impression
charges, developer earnings, and payout holds.

Eligible campaigns compete in a second-price auction. The highest maximum CPM bid wins and
pays one cent above the next eligible bid, subject to a $3 CPM floor and never more than its
own bid. The clearing price is captured when the ad is served and is later used by receipt
verification. Developers receive 50% of the cleared impression price.

Developers can request a payout after meeting a $50 minimum and the other eligibility rules.
An administrator approves each request and makes the transfer outside ADCode. The payout
workflow is provider-neutral and stores the external provider, reference, exchange details,
and platform-paid fee. Country/currency availability and required bank fields are maintained
in the admin panel.

The public website shows an aggregated market snapshot: indicative clearing CPM, active
funded campaigns, and low/medium/high demand, refreshed every 60 seconds.

## 2. Confirmed product decisions

- One advertising credit equals $1 USD of campaign spending power.
- Credits do not expire and cannot be transferred or withdrawn by advertisers.
- Dodo uses a one-time, dynamically priced product and hosted Checkout Sessions.
- Browser redirects never grant credits; signed webhooks are authoritative.
- The auction floor is $3 CPM.
- The auction increment is $0.01 CPM.
- Developers receive 50% of the cleared impression charge.
- Refunds and disputes remove advertiser credits. If the credits were spent, the advertiser
  may become negative and all of its campaigns stop. Developer earnings are not silently
  reversed.
- The public demand snapshot refreshes every 60 seconds.
- The minimum developer payout is $50 USD.
- Payouts are manually reviewed and manually transferred; there is no payout API.
- ADCode pays the transfer fee. The requested amount is the amount removed from the
  developer's balance, not the requested amount plus the fee.
- Payout destinations use structured, corridor-specific bank details.
- Payout country/currency corridors are admin-managed because provider availability changes.
- Sensitive payout destinations are encrypted at the application layer.

## 3. Current system and migration posture

The repository already contains advertiser accounts, campaign budgets and CPM bids, Dodo
signature verification, funding records, developer earnings and balances, payout requests,
Supabase/Firestore/memory adapters, advertiser and developer portals, and an admin Money
area. This work extends those foundations instead of introducing a separate billing service.

Existing ledger and funding history must remain readable. Database changes are additive,
with explicit backfills where existing fields acquire new meaning. No migration deletes or
rewrites developer ledger entries. Existing pending withdrawals are mapped to `requested`.
Existing paid, rejected, and cancelled withdrawals retain their meanings.

The existing Dodo adapter uses the deprecated `POST /payments` flow and returns
`payment_link`. It will move to `POST /checkouts` and return `session_id` plus
`checkout_url`, as required by Dodo's current Checkout Sessions API.

## 4. Money boundaries and invariants

ADCode has two distinct ledgers:

1. **Advertiser credit ledger.** Signed entries represent purchased credits and later
   reversals or restorations. Campaign receipts remain the record of credit consumption.
2. **Developer earnings ledger.** Verified impressions/clicks create earnings; payout
   requests, completion, rejection, failure, and cancellation move or release holds.

The following invariants are mandatory:

- A provider event changes advertiser credits at most once.
- A Dodo payment credits only the advertiser order to which its checkout session belongs.
- Total reversals for a payment never exceed its original credited amount.
- A campaign cannot reserve or spend credits the advertiser does not have, except that an
  external refund or dispute may make an already-spent account negative.
- A verified ad receipt charges the clearing cost captured on its serve record.
- A receipt cannot charge the advertiser without creating the corresponding developer
  earning in the same transaction.
- A payout request cannot create a hold without creating a visible withdrawal record.
- A payout decision cannot release or consume a hold without changing the withdrawal state
  in the same transaction.
- Admin configuration changes affect future serves and future payout requests only.
- Money is `bigint`/`int64` in services and storage and a decimal string on JSON boundaries.

## 5. Advertiser credits and Dodo Checkout Sessions

### 5.1 Credit orders

Before contacting Dodo, ADCode creates a credit order containing:

- ADCode order ID
- advertiser ID and authenticated owner UID
- credit amount in USD micros
- currency, fixed to `USD`
- provider, fixed to `dodo`
- status: `pending`, `paid`, `partially_reversed`, `reversed`, `disputed`, `cancelled`, or
  `review_required`
- provider checkout session ID and payment ID when known
- creation, expiry, and update timestamps

Checkout creation accepts whole-cent amounts only and retains the existing $10 minimum. The
amount is validated by the server; UI presets are convenience only. If the configured Dodo
product later imposes a higher minimum, the server limit, portal copy, and setup guide must be
changed together before that product is used.

The Dodo request uses `POST /checkouts` with:

- the configured one-time product ID
- `quantity: 1`
- the order's USD amount in the product cart's lowest denomination
- the authenticated advertiser contact details
- the ADCode order ID in metadata
- explicit success and cancel return URLs

The checkout session ID is saved on the order before its URL is returned to the browser.
Checkout creation failures leave an expired or cancelled order and do not create credits.

### 5.2 Webhook verification and matching

The webhook endpoint verifies the exact raw body using Dodo's Standard Webhooks headers:
`webhook-id`, `webhook-timestamp`, and `webhook-signature`. Verification uses constant-time
comparison, a five-minute timestamp tolerance, HTTPS, and a bounded request body.

Each accepted webhook is correlated by provider object IDs and the stored checkout/order
identity. A `payment.succeeded` event must match the expected order, session/product, amount,
and currency. If the webhook payload lacks a field needed for that comparison, the server
retrieves the payment through Dodo's authenticated payment-detail endpoint before crediting.
Unknown or mismatched events are acknowledged to avoid retry storms, recorded as sanitized
`review_required` events, and shown to admins. They never create credits.

The browser's return URL is informational. Query parameters such as `status=succeeded` never
change a balance.

### 5.3 Provider events and advertiser credit entries

The endpoint subscribes to:

- `payment.succeeded`
- `refund.succeeded`
- `dispute.opened`
- `dispute.accepted`
- `dispute.lost`
- `dispute.won`
- `dispute.cancelled`

Each provider event is deduplicated by `webhook-id`; payment, refund, and dispute object IDs
also have unique constraints so equivalent events cannot be applied under two webhook IDs.
Stored event records contain only the identifiers, type, sanitized amounts/status, processing
outcome, and timestamps—not full webhook bodies or payment details.

Credit entries are signed micros with kinds `purchase`, `refund`, `dispute_hold`,
`dispute_release`, and `admin_adjustment`. Each entry references the provider event and
original payment where applicable.

- `payment.succeeded` appends a positive purchase entry.
- `refund.succeeded` appends a negative entry for the successful refund amount.
- `dispute.opened` appends a reversible negative hold and suspends the advertiser.
- `dispute.accepted` and `dispute.lost` make the hold final without applying a second debit.
- `dispute.won` and `dispute.cancelled` append an equal positive release and allow an admin or
  automatic rule to restore the advertiser when its balance is non-negative.

Partial refunds are supported. Cumulative negative entries tied to one payment are capped at
the original purchase. A refund and dispute concerning the same money pass through one
reversal state machine so the amount cannot be debited twice.

### 5.4 Credit balance and negative accounts

Advertiser balance views expose:

- purchased credits
- refunds and dispute holds
- net funded credits
- permanently spent credits
- currently committed campaign credits
- available credits

Available credit is net funded credit minus spent and active remaining campaign commitments.
Refunds or disputes can make it negative. A negative or disputed advertiser is suspended,
cannot activate a campaign, and has every active campaign paused. No
developer ledger entry is automatically reversed; admins receive a negative-balance flag.

## 6. Second-price auction

### 6.1 Eligibility

A campaign enters an auction only when:

- the advertiser is active and non-negative
- the campaign is active
- at least one creative is approved
- targeting matches the request, or the target list is empty
- the maximum CPM bid is at least the configured $3 floor
- the campaign has enough remaining budget for its own maximum per-impression charge

The campaign CPM field is renamed in UI copy to **maximum CPM bid**. Existing stored CPMs are
valid maximum bids.

### 6.2 Ranking and clearing

Eligible campaigns are ordered by maximum CPM descending. Equal bids use a deterministic
rotating hash based on a server time bucket, request/user identity, and campaign ID. This
keeps an auction reproducible for support while rotating ties over time instead of permanently
favouring the lexicographically first campaign.

For each selected position, the clearing CPM is:

```
min(winner maximum bid, max($3.00 floor, next eligible bid + $0.01))
```

When there is no next eligible campaign, the winner pays the lesser of its maximum bid and
the $3 floor. Since bids below the floor are not eligible, this resolves to the $3 floor.
For batched serves, each selected campaign uses the next ranked campaign, including the first
non-selected campaign for the last selected position. This is a generalized second-price
auction for equivalent ad slots.

The service records `max_bid_cpm_micros`, `clearing_cpm_micros`, and `cost_micros` on every
non-test serve. A verified receipt copies `cost_micros` from that serve. Test serves store and
charge zero. Later bid, floor, revenue-share, or campaign changes cannot change an existing
serve's price.

Developer credit is exactly 50% of the captured cost using integer arithmetic. Rounding
continues to truncate micros deterministically.

### 6.3 Atomic receipt settlement

Receipt creation, campaign spend, advertiser consumption, the developer ledger entry, and
developer balance update occur atomically. Supabase uses a transactional SQL function;
Firestore uses a transaction; the memory adapter provides the same observable contract.
Duplicate receipts acknowledge successfully without repeating any money movement.

## 7. Public live-demand snapshot

`GET /v1/demand` is public, read-only, rate-limited, and cacheable for 60 seconds. It returns:

```json
{
  "clearingCpmMicros": "3000000",
  "activeCampaigns": 0,
  "demandLevel": "low",
  "floorCpmMicros": "3000000",
  "asOf": 1787692800000
}
```

The indicative clearing CPM is computed from active, funded campaigns with an approved
creative, using the same floor and second-price formula across the site-wide candidate set.
Actual targeted auctions may differ, so UI copy calls this a market indication rather than a
guaranteed price.

Demand levels use explicit initial thresholds:

- `low`: zero or one active funded campaign
- `medium`: two through four active funded campaigns
- `high`: five or more active funded campaigns

Only aggregate fields are returned. Advertiser identities, bids, budgets, target tags, and
segment-level counts are never public.

The landing page reserves a fixed-size market panel to prevent layout shift, refreshes every
60 seconds, and shows the snapshot age. On failure it shows the $3 floor and “Live market
unavailable”; it does not present an old snapshot as current. The advertiser campaign builder
uses the same endpoint beside the maximum-bid field.

## 8. Manual developer payouts

### 8.1 Eligibility

A payout request is eligible only when all of these rules pass server-side:

- available developer earnings are at least $50 USD
- the requested amount is at least $50 and no more than the available balance
- the amount uses whole cents
- the user's email is verified
- the account is at least seven days old
- no withdrawal is in `requested` or `approved`
- a payout profile exists
- its country/currency corridor is enabled
- all fields required by the current corridor schema are present and valid

The developer dashboard receives every rule and its explanation so it can show a complete
checklist. Saving a profile re-evaluates eligibility immediately. Request submission repeats
all checks inside the money transaction.

### 8.2 Corridors and required fields

`payout_corridors` stores country code, currency code, enabled state, required field kinds,
help text, source URL/note, last-verified timestamp, and admin audit metadata. Initial rows are
seeded from Wise's currently published India outbound countries and currencies, but the model
is provider-neutral and administrators can enable, disable, or revise a corridor without a
deployment.

Required fields use a controlled vocabulary with server validators, including IBAN,
SWIFT/BIC, account number, routing number, sort code, IFSC, BSB, bank/branch code, CLABE,
bank name, recipient address, email/phone contact, and an admin-defined supplemental field.
The UI renders only the fields selected for that corridor. Arbitrary executable regular
expressions are not stored in the database.

Pay-by-email is not offered for an INR-funded sender because Wise documents that route as
unavailable. A user's country is the destination/account country, not an inferred IP location.

### 8.3 Encryption and snapshots

Legal name, recipient address, and bank fields are serialized in a versioned payload and
encrypted with AES-256-GCM before persistence. The key is a base64-encoded 32-byte deployment
secret named `PAYOUT_ENCRYPTION_KEY`; it is never available to browser code. Country, currency, schema
version, timestamps, and masked last characters remain queryable in plaintext.

Encrypted payloads store a key version. Rotation is a maintenance operation: deploy the new
key alongside the previous key, re-encrypt every profile and withdrawal snapshot, verify the
migration, and only then remove the previous key. Losing all configured versions makes the
bank details intentionally unrecoverable.

Withdrawal rows contain an encrypted snapshot of the destination as it existed when the
request was made. Editing a payout profile cannot redirect an existing request. Only the
owning user and authorized admins can request decrypted details; list endpoints return masked
summaries by default. Decrypt operations and admin views create audit records.

### 8.4 Withdrawal states and transitions

Withdrawal states are `requested`, `approved`, `paid`, `rejected`, `failed`, and `cancelled`.
Allowed transitions are:

- `requested -> approved | rejected | cancelled`
- `approved -> paid | failed`

The user may cancel only a requested payout. Approval prevents destination edits or
cancellation from changing the admin's in-progress transfer.

Creating `requested` writes the withdrawal and moves the amount from available to pending in
one transaction. Approval changes no money. `paid` consumes the hold. `rejected`, `failed`, or
`cancelled` releases the hold to available earnings. An admin marks a transfer failed only
after confirming that external funds were not sent or were returned.

A paid record requires:

- provider name
- provider transfer reference
- requested USD amount
- source amount and currency
- recipient amount and currency
- exchange rate or an explicit “provider calculated” marker
- transfer fee and currency
- decision timestamp and admin UID

The platform pays the fee. Fees are operational expenses and never reduce the developer's
requested amount or earnings balance.

### 8.5 India/Wise disclosure

The software remains provider-neutral because Wise's current India documentation says that
personal INR-funded transfers are for personal use or close relatives, and Wise personal
accounts are for personal rather than business transactions. `SETUP.md` must state that this
does not describe publisher earnings and instruct the operator to confirm a compliant payout
method before real payouts. The product must not label an Indian personal Wise account as a
supported or compliant publisher-payout rail.

References:

- [Wise guide to INR transfers](https://wise.com/help/articles/2932151/guide-to-inr-transfers)
- [Wise account usage](https://wise.com/help/articles/2897226/what-is-a-wise-account)
- [Wise pay-by-email limits](https://wise.com/help/articles/2932105/how-can-i-send-money-to-an-email-address)

## 9. APIs and service boundaries

The implementation keeps pure rules separate from I/O:

- `auction` computes eligible ordering and captured prices from candidates.
- `creditOrders` validates and creates orders through a `PaymentProvider` port.
- `providerEvents` verifies and maps Dodo events into normalized credit mutations.
- `advertiserCredits` applies normalized mutations atomically.
- `demand` computes a safe public aggregate.
- `payoutCorridors` validates country/currency destinations.
- `payoutCrypto` encrypts and decrypts versioned destination payloads.
- `withdrawals` owns eligibility and state transitions.

Required HTTP capabilities are:

- authenticated advertiser checkout creation
- authenticated advertiser credit/order history
- signed public Dodo webhook reception
- public demand snapshot
- authenticated developer payout read/profile/request/cancel
- admin payout approve/pay/reject/fail operations
- admin credit-event review and advertiser suspension controls
- admin payout-corridor CRUD
- admin market configuration and current demand

Every money endpoint returns typed refusal codes. UI messages distinguish validation,
eligibility, configuration, provider outage, conflict/idempotency, and server failure.

## 10. User experience

### 10.1 Public website

The existing economics proof strip becomes or includes a live market panel with current
indicative CPM, active funded campaigns, demand level, snapshot age, and a campaign CTA. The
panel is accessible, responsive, and does not depend on JavaScript for its explanatory copy.

Static marketing claims that quote an $8 CPM or a fixed per-view earning are replaced with
auction-aware copy. Structured data, FAQs, `llms.txt`, and `llms-full.txt` must not promise a
fixed clearing price. They may state the $3 floor and 50% share.

### 10.2 Advertiser portal

Billing uses “advertising credits” consistently and shows purchased, available, committed,
spent, refunded, and disputed values. One credit is always displayed as $1 USD of spend.
Purchase history shows pending, paid, partially reversed, reversed, disputed, or review
required.

Campaign creation labels CPM as a maximum bid, shows live indicative demand, explains that the
cleared price may be lower, and validates against the floor. Campaign details show maximum bid,
average cleared CPM, spend, and remaining budget.

### 10.3 Developer dashboard

The payout panel shows every eligibility rule, dynamic country/currency selection, structured
bank fields, masked saved details, and the withdrawal state history. Summaries never display
complete account identifiers.

### 10.4 Admin

The admin navigation groups Overview, People, Ads & Market, Money, Content, and Tools.
Navigation badges show pending creative reviews, requested/approved payouts, refund/dispute
reviews, and negative advertiser balances.

Money contains Payouts, Credit Purchases, Refunds & Disputes, Corridors, and Audit. Ads &
Market contains the $3 floor, 50% share, current clearing indication, active campaign count,
demand level, and future-only configuration controls. High-impact configuration changes
require confirmation and write before/after audit values.

Payout details are masked until an admin expands a request. The expanded view provides
copyable structured fields and a complete transfer checklist. No UI button claims to send
money; it records approval and the result of a transfer made elsewhere.

## 11. Security and privacy

- Dodo API keys, webhook secrets, and payout encryption keys are deployment secrets only.
- The Dodo credential exposed during design must be revoked and must never be stored or used.
- Test and live Dodo credentials, product IDs, and webhook secrets are distinct.
- Checkout creation and payout requests are rate-limited per authenticated account.
- Webhook authentication is signature-based; IP allowlists are not treated as authentication.
- Full webhook bodies, card data, and decrypted payout destinations are excluded from logs.
- Decrypted payout data is returned only through owner/admin-authorized endpoints.
- Admin decisions and sensitive reads are audited with actor, action, target, and timestamp.
- CORS and authorization continue to deny browser access outside approved origins and roles.
- Database roles continue to deny direct client reads of financial and payout tables.

## 12. Failure behavior and recovery

- Dodo unavailable during checkout: retain a failed/expired order and show a retryable error.
- Checkout succeeds but webhook is delayed: show the order as pending; never credit from the
  return URL.
- Invalid webhook signature: return a non-2xx rejection and apply nothing.
- Valid but unknown/mismatched event: acknowledge, quarantine for admin review, apply nothing.
- Duplicate or reordered event: converge through provider-object state and unique keys.
- Transaction failure: roll back the complete money mutation and allow a safe retry.
- Negative advertiser after reversal: pause serving and flag admin; preserve developer entries.
- Demand endpoint unavailable: show the floor and an unavailable state.
- Corridor disabled after profile save: retain the encrypted profile but fail eligibility until
  a supported destination is saved.
- Transfer failure: keep the payout approved until external failure/return is confirmed, then
  mark failed and release the hold atomically.
- Encryption key missing: payout-detail reads and writes fail closed; other app features remain
  available and admin health reports the configuration error.

## 13. Testing strategy

Implementation follows test-first development.

### Pure and property tests

- eligibility filtering and deterministic tie rotation
- one-campaign floor pricing
- two- and many-campaign second-price clearing
- winner never pays above its bid
- monotonicity when a losing bid rises
- integer rounding and 50% developer share
- demand thresholds and public redaction
- corridor field validation and payout eligibility
- encryption round trips, tamper rejection, masking, and authorization

### Money and concurrency tests

- receipt uses captured serve cost after later bid/config changes
- duplicate receipt creates exactly one charge and earning
- provider retries and equivalent provider objects apply once
- partial/full refunds and dispute open/win/loss sequences
- refund plus dispute cannot reverse more than the purchase
- reversal can produce a negative account and pauses campaigns
- checkout/order mismatch never credits
- concurrent campaign activation cannot reserve the same credits twice
- payout request and hold are atomic
- concurrent payout requests cannot drain one balance twice
- every withdrawal transition conserves available plus pending earnings

### Adapter and HTTP tests

- Supabase transactional functions and row translation
- Firestore transaction behavior and encrypted document mapping
- memory adapter conformance
- Checkout Sessions request/response mapping using official-shaped fixtures
- raw webhook headers/body, size limit, signature, age, and errors
- typed API refusals, authorization, rate limits, and redacted responses

### UI and end-to-end tests

- live demand loading, refresh, age, and fallback
- advertiser checkout, credit history, disputes, and maximum-bid copy
- dynamic payout fields and masked summaries
- admin approve/pay/reject/fail transitions and required evidence
- admin corridor editing and navigation badges
- full typecheck, dependency firewall, unit suite, web/desktop builds, and smoke tests
- final manual Dodo test-mode checkout plus signed dashboard webhook before live mode

No automated test uses a real Dodo credential or real payout destination.

## 14. Setup and rollout

`SETUP.md` will provide an operator sequence that can be completed without reading source:

1. Revoke the credential exposed during design.
2. Complete Dodo business verification in test mode.
3. Create a one-time USD advertising-credit product with dynamic amount support.
4. Create the webhook endpoint and subscribe to every event listed in section 5.3.
5. Set test `DODO_API_KEY`, `DODO_PRODUCT_ID`, and `DODO_WEBHOOK_SECRET` through Wrangler's
   interactive secret command.
6. Generate and store a 32-byte `PAYOUT_ENCRYPTION_KEY` as a Worker secret.
7. Apply additive Supabase migrations and verify the new tables/functions.
8. Seed and review payout corridors against the current provider documentation.
9. Send signed Dodo dashboard examples and confirm idempotent processing.
10. Complete a test checkout and verify order, webhook, credit entry, and portal balance.
11. Exercise a test refund/dispute sequence.
12. Exercise a manual payout through requested, approved, and paid using non-sensitive test
    destination data.
13. Run the full verification suite.
14. Obtain legal/accounting review of advertiser credits, refunds, publisher earnings, taxes,
    and the intended payout rail.
15. Create distinct live Dodo resources/secrets and enable live mode only after all checks pass.

Switching Dodo environments must be explicit. An unset mode remains test mode so missing
configuration cannot collect real money.

## 15. External references

- [Dodo Checkout Sessions](https://docs.dodopayments.com/api-reference/checkout-sessions/create)
- [Dodo one-time integration guide](https://docs.dodopayments.com/developer-resources/integration-guide)
- [Dodo webhooks](https://docs.dodopayments.com/developer-resources/webhooks)
- [Dodo webhook event guide](https://docs.dodopayments.com/developer-resources/webhooks/intents/webhook-events-guide)
- [Wise countries/regions](https://wise.com/help/articles/2571942/what-countriesregions-can-i-send-to)
- [Wise currencies](https://wise.com/help/articles/2571907/what-currencies-can-i-send-to-and-from)
- [Wise INR transfer restrictions](https://wise.com/help/articles/2932151/guide-to-inr-transfers)

## 16. Out of scope

- Wise or bank payout API integration
- Automatic payout scheduling or execution
- Automatic identity/KYC verification by ADCode
- Tax withholding or tax-form generation
- Multiple internal credit currencies or speculative exchange-rate balances
- Credit transfer between advertisers
- Advertiser self-service refunds from within ADCode
- Reversing developer earnings automatically after an advertiser dispute
- Segment-level public demand or advertiser bid disclosure
