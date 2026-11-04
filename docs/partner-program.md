# Partner program (30% of referred advertisers' spend)

Status: **spec only, nothing built.** This document is the design; no code, schema or UI
has been changed. When it is built, work through the ship checklist at the bottom.

It extends the invite programme (`docs/referrals.md`) rather than replacing it. The
existing engine — codes, attribution, the nightly settlement, the append-only ledger —
does most of the work; the partner program adds a higher rate, an optional flat bounty,
an application gate, and its own ledger kinds so partner money is separable from invite
money in every report.

## The terms, as a partner is told them

> Apply to become a partner. Once approved, your links pay you **30% of everything an
> advertiser you bring spends** on ADCode ads, for **as long as the admin's window says**
> (default 365 days from when they sign up), plus **a flat bounty for every advertiser you
> bring that actually funds** (amount set in Admin; can be zero). It lands in the same
> balance as your ad earnings and withdraws the same way.

- **30% is a cut of gross spend** — what the advertiser paid for the views, the same base
  the existing 5% advertiser referral uses — not a cut of ADCode's half. This matches the
  existing programme's arithmetic and the social-post promise ("a cut of what they spend").
- **Non-partners keep the existing terms**: 10% of an invited person's ad earnings, 5% of
  an invited advertiser's spend. The partner rate *replaces* the 5% for advertisers the
  partner brought; it never stacks with it (one attribution per advertiser, ever).
- **The bounty is earned on money, not on signups.** An advertiser who signs up and never
  funds pays a bounty of nothing. This is what keeps fake signups from minting money.
- Everything is tracked, end to end, and both sides see the same numbers.

## A partner's funnel, tracked end to end

| Stage | Where it is recorded | Who sees it |
|---|---|---|
| Someone clicks the partner's post link | Website analytics on `/i/<code>?for=ads` (consenting visits, per code, with the `from` tag) | Partner (their link's visits) and Admin (Sources) |
| An advertiser signs up through it | `attributions` row: `(advertiser, id) → code, referrer_uid, how, claimed_at, partner` — one per advertiser, ever | Partner ("advertisers brought") and Admin (Sources, Partners) |
| The advertiser funds their first credit order | `partner_bounties` row + a `partner_bounty` ledger entry, triggered by the Dodo webhook that marks the order `paid` | Partner (bounty line) and Admin |
| Every paid view of that advertiser's campaigns | `receipts` (already recorded) → nightly share rows in `referral_shares` (base and share, per advertiser per day) → a `partner_share` ledger entry → balance | Partner (earnings, last 30 days) and Admin (Sources: spend, paid out, ADCode kept) |
| The advertiser refunds or disputes | Existing `advertiser_credit_orders` statuses; the advertiser's receipts stop paying shares while an order is disputed/reversed/review — same rule as today | Admin |

Nothing in the chain is inferred after the fact: attribution is written once at signup,
bounties are written once at funding, shares are written per day at settlement, and every
payout traces to a ledger entry whose id says which day and which advertiser it came from.

## What the admin configures

New **Admin > Growth > Terms** section (beside the invite terms), backed by a
`partner_terms` row (id = 1, single row, like `referral_config`):

| Setting | Default | Meaning |
|---|---|---|
| Partner percent | **30** | Cut of a referred advertiser's gross spend. Bounded 0–50. |
| Bounty per funded advertiser | **$0 (off)** | Flat amount, in micros, paid once when the advertiser's first credit order reaches `paid`. |
| Window days | **365** | How long an attribution keeps paying. Same semantics as the invite window. |
| Applications open | **on** | Turns the apply form off without deleting anything in flight. |

The form shows the money math live as the numbers are typed: of $1.00 of spend, the
viewer pool takes 50¢, an overlapping inviter takes 10¢, the partner takes 30¢, and
ADCode keeps the rest. At 30% + a 10% inviter overlap ADCode keeps 10¢ on the dollar
before payment fees — the panel says so, because 30% on top of a referred viewer is thin
and the person setting it should see that before saving, not in the month-end numbers.

Rate and window changes apply to **settlement days after the change**; days already
settled are never repriced (their ledger entry id already exists, so a re-run pays them
nothing again). Changing the window does reach attributions already made — the existing
programme reads the window at settlement time too — so the panel warns in plain words.

## Who qualifies: self-serve application

- Any signed-in account applies from the dashboard's **Partners** section (and a line in
  the desktop's Invite & earn panel linking there): the channels they post on, audience
  size, and links to the posts they plan to run. One application per account.
- Applications land in **Admin > Growth > Partners > Applications**: approve, reject with
  a note, or leave pending. Every decision writes an `audit_log` row like the rest of the
  admin panel.
- **Approval makes the account a partner from that moment.** It is not retroactive:
  advertisers attributed before approval keep the 5% terms; advertisers attributed after
  it get the partner terms. The application form says this plainly ("your higher rate
  starts for advertisers who sign up after approval") because promising retroactive money
  is how a programme becomes a dispute.
- A partner can be suspended (fraud, self-referrals, spam). Future attributions stop
  being partner attributions; existing ones keep the rate they were attributed under, and
  the settlement already refuses to pay a referrer whose account is not `active`.

## Schema (one new migration, after the current latest)

```
partner_terms        (id=1) partner_percent, bounty_micros, window_days,
                     applications_open
partner_applications (uid pk, status pending|approved|rejected, channels, audience,
                     links, note, applied_at, decided_at, decided_by)
partner_bounties     (advertiser_id pk, partner_uid, code, amount_micros, order_id,
                     ledger_entry_id, paid_at)   -- one bounty per advertiser, ever
attributions         + partner boolean not null default false   -- snapshot at claim
ledger_entries kind check: + 'partner_share', 'partner_bounty'
```

- `attributions.partner` is **copied at claim time** from whether the code's owner was an
  approved partner, the same way `referrer_uid` is copied — nothing done to the account
  later rewrites who earns what. The existing comment on `attributions` states this
  principle; the partner column follows it.
- The two ledger kinds are what make partner money separable everywhere: the dashboard's
  ledger labels (`LedgerRows.tsx`), the earnings-kind set (`DashboardBody.tsx`), and any
  "partner earnings vs invite earnings" sum all read the kind.
- Escaped hatch, explicitly scoped: an admin action to flip `partner` on an existing
  attribution, for the "I approved them a day after their first advertiser signed up"
  case. It writes an `audit_log` row and only ever raises the rate; it cannot lower one.

## Settlement: the same nightly run, one more branch

`settle_referrals` (SQL) and `planReferralShares` (TypeScript) already read every paid,
non-house receipt for a UTC day, join the advertiser's attribution, check the window and
the referrer's status, and sum the base per referrer per advertiser. The partner branch
is: **if the attribution says `partner`, multiply by `partner_percent` from
`partner_terms` instead of `advertiser_percent` from `referral_config`**, and write the
share as its own ledger entry.

- Entry ids carry the idempotency, exactly as today: `referral:<uid>:<day>` for invite
  shares, `partner:<uid>:<day>` for partner shares. A partner can legitimately earn both
  on the same night (they invited the viewers *and* brought the advertiser); they are two
  entries, each idempotent, each labelled.
- Share rows keep landing in `referral_shares` (base and share per advertiser per day), so
  the Sources report's "paid out" column and the partner's own per-advertiser breakdown
  read one table. `share ÷ base` recovers the rate that was applied.
- Bounties settle in the same nightly pass rather than inside the payment webhook: the
  pass scans credit orders newly `paid`, inserts `partner_bounties` (unique on
  advertiser_id, so a re-run or a duplicate webhook pays nobody twice), and writes the
  `partner_bounty` ledger entry with id `partner-bounty:<advertiser_id>`.
- The TypeScript in `services/api/src/referrals.ts` and the SQL stay locked together the
  way they are today: one fixture, both implementations, `node
  scripts/check-referrals-sql.mjs .` after any change to either.

### Worked example

An advertiser signs up from a partner's post on 1 March and funds $1,000 of credits, then
spends it over the month. Partner percent 30, bounty $50, no inviter overlap:

- Bounty: **$50**, the night the order goes `paid`.
- Spend share: **$300** across the month, paid nightly as the views settle — $30.00 for
  every $100 of views that day, floored once per advertiser per day (at most a micro lost).
- With an inviter overlap (the viewer was someone else's invite): that inviter's 10% also
  comes out of ADCode's half; the partner's 30% is untouched and so is the viewer's 50%.

## Surfaces

**Partner-facing (web dashboard, `apps/web`)**
- A **Partners** section: the apply form; once approved, the terms as configured, the
  advertiser link (`/i/<code>?for=ads` — the same link shape `ReferAdvertiser.tsx` hands
  out today), visits, advertisers brought (with spend and earnings each), bounty status,
  lifetime and last-30-days earnings, and the ledger entries behind them.
- `/advertise` and the invite page keep working unchanged; a partner's link is the same
  link, it just pays the partner terms instead of the referral terms.

**Admin (`apps/web` admin panel)**
- **Growth > Partners**: Applications tab (approve/reject), and the existing partners
  list gains a partner column and partner-rate rows in Sources.
- **Growth > Terms**: the partner settings beside the invite settings, with the live
  money-math warning.

**Desktop (`apps/desktop`)**
- The Invite & earn panel shows partner status and a line summarising partner earnings,
  and links to the dashboard to apply. No new desktop command is required; if one is
  added, the command-uniqueness rule below applies.

**API**
- `POST /v1/partner/apply`, `GET /v1/partner` (status + dashboard numbers) — must be added
  to the method allowlist in `apps/cloud/src/accountApi.ts` or they answer 405.
- `GET/POST /admin/partner-applications`, `GET/POST /admin/partner-terms`, and the
  `partner` flag surfaced through `referral_source_facts`.

## Fraud and abuse: what is already covered, what is new

Already enforced by the existing engine and reused unchanged:

- One attribution per advertiser, ever — the first code they sign up with wins; a partner
  cannot claim an advertiser who arrived through someone else's link or a campaign code.
- The advertiser's creator cannot be attributed to their own code (`checkAdvertiserClaim`
  excludes the owner's accounts), so a partner cannot bring themselves.
- A banned or suspended referrer earns nothing; house advertisers never pay shares;
  advertisers with a disputed, reversed or review-required order pay nothing while that
  stands; receipts are only paid when they exist and match what the server sent.

New with this programme:

- The bounty requires a *funded* advertiser, not a signup — the trigger is the webhook
  that marks a credit order `paid`, idempotent on the webhook id like every other
  provider event.
- The bounty is **not clawed back** if the advertiser later refunds that first order. The
  spend share self-corrects (bad-order days pay nothing); the bounty is small, one-off,
  and reversing it would surprise partners more than it saves. Stated here so it is a
  decision, not an accident.
- Applications are gated by a human on purpose: self-serve signup with auto-approval plus
  a 30% rate is a spam magnet. The `applications_open` switch is the pressure valve.

## Ship checklist (what the repo's own tests enforce)

Per `CLAUDE.md`, a feature is not shipped until it is findable. For this programme:

1. Help entries in `packages/help/src/entries/` — plain, why and how, written for someone
   who has never seen it.
2. A row in `packages/help/src/features.ts`. Partners get keywords only unless they add a
   desktop command of their own — **a command belongs to exactly one feature**, and
   reusing `terminal.*` or `referrals.*` commands here fails `features.test.ts`.
3. The Feature library in the workbench — generated from 1 and 2; check it renders.
4. Settings popover, in-app guide and universal search — they read the same two files.
5. A guide at `apps/web/src/lib/docsGuides.ts`: numbered steps, concrete benefits, and an
   honest "why is this better than a generic affiliate link" answer (here: the cut is
   withdrawable cash from a real ledger, tracked per advertiser per day, not store
   credit, and the advertiser's own 50% viewer share is never touched).
6. Run `node scripts/docs-seed.mjs` — `docsSeed.test.ts` fails otherwise. No new kind of
   action is introduced (no new desktop commands), so the generator needs no teaching.
7. Every command a feature names must be registered in
   `apps/desktop/src/renderer/main.ts` (`featureCommandCoverage.test.ts`).
8. `npm run verify`, then `node scripts/check-referrals-sql.mjs .` for the settlement
   change, then the real acceptance: `npm run desktop:build && node scripts/smoke.mjs`,
   reading the printed values rather than the exit code.

## Decisions worth overruling if they read wrong

- **30% of gross spend, not of ADCode's half.** It is what "a cut of what the advertiser
  spends" says, and it matches the 5% it replaces. If it is meant to be a cut of ADCode's
  take, the number should be roughly double and the admin warning changes.
- **Snapshot at claim** for the partner flag, so money follows the terms on offer when
  the advertiser signed up. The admin flip-action is the relief valve.
- **No bounty clawback** on refunds of the first order.
- **Window default 365 days**, admin-settable either way, including to lifetime by
  setting it to the maximum the check constraint allows (1,095) — a true "forever" would
  need a sentinel value; not worth a special case until someone asks.
- **One global partner rate**, not per-partner rates. Per-partner deals can be layered
  later by extending `partner_terms` into a table keyed by partner; the attribution
  snapshot would then copy the rate, not a boolean. One global number is the honest
  version of what a single-admin programme actually does.
