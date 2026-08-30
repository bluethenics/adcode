# What a lawyer should look at, and in what order

**Status: not reviewed by a lawyer. ADCode 1.0.0 is published and downloadable.** The public terms no longer say so — that sentence
offered no protection while publicly inviting challenge to the document governing live money
paths — but the fact is unchanged and it lives here instead.

Written 2026-08-30, against `apps/web/src/app/terms/page.tsx` and
`apps/web/src/app/privacy/page.tsx`.

This is not legal advice. It is a list of the places where the terms make a promise that
costs money if it is wrong, ordered so an hour of a lawyer's time is spent on the clauses
that carry real exposure rather than on boilerplate.

## Why this is now urgent rather than tidy

Dodo Payments is in **live mode** (`docs/RELEASE-READINESS-2026-08-30.md`, Gate 5). Real
advertiser money comes in and real developer payouts go out. Every clause below has already
been live for the transactions that have occurred.

## Tier 1 — review before the next advertiser is invoiced

### 1. The entity, and personal liability

The terms name no legal entity. They say ADCode is "operated from India" and use "we"
throughout. The operator is a sole proprietor, so **every obligation in the document is a
personal one**: advertiser refunds, developer balances, and any claim arising from a
creative served through the marketplace.

The two questions worth an hour: whether to incorporate before taking more advertiser money,
and whether a counterparty can currently identify who they are contracting with well enough
for the terms to bind them. A contract with an unidentifiable party is a weak contract in
both directions.

### 2. Balances are an unsecured debt

`## Earnings` states plainly that a balance is money owed, not money held in escrow, and that
a user would be an ordinary creditor on insolvency. That disclosure is honest and it is the
right thing to have said. What a lawyer should confirm is whether holding user funds this way
engages Indian payment-system or deposit-taking rules at the volumes expected — the answer
usually depends on scale and on whether balances are pooled.

### 3. Advertiser indemnity and creative liability

`## Advertisers` requires advertisers to warrant they own the creative and to indemnify us
for claims arising from it, and says review "is a filter, not advice". The exposure this is
guarding against is real: ADCode *serves* third-party creatives to identifiable users, so an
IP claim or an advertising-standards complaint names us alongside the advertiser.

Confirm the indemnity is enforceable as drafted against a business counterparty in India, and
whether the human review step weakens the "we are a conduit" position rather than
strengthening it.

### 4. Payouts, KYC and sanctions

`## Who can use ADCode` and `## Withdrawals` cover sanctions screening, identity verification
and tax withholding in general terms. Cross-border payouts to individuals is the single most
regulated thing this product does. Needs specialist confirmation of: what identity
verification is mandatory at what threshold, what must be reported, and whether the
70 enabled `payout_corridors` include any country that should be switched off.

### 5. Age 18 for earnings

`## Who can use ADCode` sets 18 to earn or withdraw. There is still no date-of-birth field
anywhere in `services/api` or the schema — the check is an explicit confirmation recorded
at the moment payout details are saved, not a verified age.

The first draft of these terms claimed we do not show cards to under-18s and do not approve
their payouts. Neither was true. Stating an intended control as an implemented one is worse
than having no clause at all: it is a promise that can be shown false by reading the code.
The wording now matches what the software does.

**Done on 2026-08-30.** A sixth rule now sits beside the other five in
`services/api/src/withdrawals.ts` (`RuleId` includes `adult`), backed by
`payout_profiles.adult_confirmed_at` and a checkbox on the payout form. A timestamp
rather than a boolean, because the question that would be asked is *when* they confirmed.
Existing profiles are deliberately not backfilled: they were never shown the question, and
writing a timestamp onto them would manufacture a confirmation that never happened.

What a lawyer should still confirm is whether an unverified self-declaration is sufficient
for cross-border payouts, or whether identity verification is required at some threshold.

## Tier 2 — review before public launch

### 6. Liability cap

Capped at the greater of US$100 or twelve months of credits, with carve-outs for death or
personal injury by negligence, fraud, and anything not excludable. The carve-outs are there
because a cap without them is more likely to be struck in full. Confirm the figure is
defensible for a free product that also pays its users.

### 7. Consumer law and the EU/UK

The terms carve out non-excludable consumer rights and preserve the right to sue locally
where the law gives it. If ADCode is downloaded in the EU or UK — it will be — confirm
whether that is sufficient, and whether GDPR obligations attach beyond what
`apps/web/src/app/privacy/page.tsx` already describes.

### 8. Dormant balances

`## Dormant accounts` closes accounts after 24 months and lapses balances under the payout
minimum. Unclaimed-property rules vary and are frequently mandatory. Confirm whether this is
permitted, and whether the email-first step is enough notice.

### 9. AI providers

`## Your code stays yours` discloses that connecting a provider sends code to that provider
under their terms. Confirm the disclosure discharges our obligation, given we route the
request.

## Broken facts to fix regardless of legal review

These are wrong now, whatever a lawyer says.

| What | Where | Problem |
|---|---|---|
| Governing law venue | `## Law and disputes` | Names "the courts of India" with no city. Valid, but naming your city gives a stronger exclusive-venue clause. |
| Entity | everywhere | The terms name no legal person. See item 1 - this is the largest single exposure and it is not fixable by editing a document. |

## Fixed on 2026-08-30

- Privacy page showed `dateTime="2026-08-28"` while printing "18 August 2026". On a document
  whose purpose is recording what was true and when, the two dates disagreeing is a defect.
- Both documents promised that changes would be "described in the blog". The blog was retired
  in the single-page restructure and redirects to the homepage, so the notice mechanism both
  documents committed to did not exist. Now the release notes.
- The terms gained governing law, a liability cap, warranty disclaimers, an advertiser
  indemnity, age limits, sanctions and tax wording, dormancy, assignment, severability, force
  majeure and a notices clause — none of which were present.
