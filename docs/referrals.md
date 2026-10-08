# Invites and Sources

How ADCode's invite programme works, how to put it live, and how to read what it tells
you. Design: `docs/superpowers/specs/2026-10-06-referrals-and-growth-loops-design.md`
(local working document).

## What it is

- **Every account has an invite link**, `https://adcode.bluethenics.com/i/<code>`, made the
  first time the account opens Invite & earn (desktop) or the dashboard's Invites section.
- **Whoever invites a person** is credited 10% of the cost of every paid view that person
  sees, for 365 days from the claim. **Whoever brings an advertiser** is credited 5% of
  what it spends, for 365 days. Both come out of ADCode's half; the invited person's own
  50% is never touched.
- **Campaign codes** are codes with no owner, made in Admin > Growth > Links for your
  own posts and ads (`threads-oct06`). They pay nobody; they only say where people came from.
- **Thank-you awards**: Admin > Feedback > Thank with an award credits the person who filed a
  report (`contribution` ledger entry, once per report, at most $100).

## How a code reaches an account

The Microsoft Store installer drops a link's query string, so the code travels by hand:

1. The invite page's download button copies `ADCode invite: <code>` to the clipboard.
2. On first launch the welcome looks at the clipboard once (in the main process), and again
   whenever the window regains focus while the welcome is open. Only that exact line or an
   invite link is ever sent. Invite & earn has a paste box for the first 14 days.
3. The invite page remembers the code in the browser for 30 days, so signing in to the
   dashboard claims it, and an advertiser signing up is attributed.

## Putting it live - in this order

1. **Apply `supabase/migrations/20261007120000_referrals.sql`** to production. It needs
   `20261006180000_growth_first_seen.sql` (for `milestone_days`), which is already applied.
   Until it is, every invite endpoint answers 503 `referrals-unavailable` and the desktop and
   web hide their invite UI; serving, receipts and balances are unaffected.
2. **Admin > Growth > Terms**: tick ADCode's own advertiser as house, so its spend never
   pays a share. Check the terms (10 / 5 / 365 / 14) and save.
3. **Deploy the web** (the API ships with it).
4. **Settle a day by hand** once (Admin > Growth > Terms > Settle a day, yesterday) to see
   it run. After that pg_cron does it at 00:30 UTC for the previous seven days; a day that
   was already paid pays nothing again.
5. **Release the desktop** - Invite & earn, the clipboard pickup, the build share card, the
   live-session invite and the Store rating ask are in the app.
6. Make campaign links for your posts in Admin > Growth > Links and put their links in
   the posts instead of the bare homepage.
7. Optional: give the house campaign an "Invite & earn" creative pointing at `/invite`.

## Where it lives in the admin

Everything is under **Growth** in the admin sidebar: Overview (what is left to set up, the
headline numbers and the Sources table), Partners (who invites and what they brought),
Links (campaign links for your own posts), Loops (every place ADCode asks people to share,
with invite-page visits per loop) and Terms (rates, house advertisers, settling a day).

Loops are measured by the tag on the link each one hands out: the editor adds
`?from=build`, `readme`, `collab`, `x`, `threads` or `email`, the dashboard `?from=dashboard`,
the portal `?from=portal`, and the advertiser pitch `?for=ads`. The invite page records that
as the visit's source. The catalogue is `apps/web/src/lib/loops.ts`; a new loop gets a tag
and an entry there.

## Reading Sources

Admin > Growth > Overview (partners in Growth > Partners), by when people arrived (7 / 30 / 90 days, all time):

| Column | Meaning |
|---|---|
| Visits | Consenting visitors to the code's invite page (website analytics) |
| People | Accounts that arrived with the code (Unknown: new accounts with none) |
| Real users | Of those, seen using ADCode at least once |
| Came back | Seen on two or more different days |
| Ad revenue | What their paid, non-house views cost advertisers, since they arrived |
| Advertisers / spend | Advertisers who signed up with the code, and their spend since |
| Paid out | Invite shares actually paid for them (`referral_shares`) |
| ADCode kept | Revenue and spend, less developers' credit and invite shares |

The tile **New real users with a source** is the one to watch first: it says whether
attribution works at all. A view by an invited person of a referred advertiser's ad counts
in both rows, so the money columns are not added across rows.

## Where the rules live

- `services/api/src/referrals.ts` - every rule, pure, with `test/referrals.test.ts`.
- `supabase/migrations/20261007120000_referrals.sql` - the same settlement and facts in SQL.
  It was replayed with every migration in PGlite and held to the TypeScript on one fixture;
  re-run `node scripts/check-referrals-sql.mjs .` (after `npm install --no-save @electric-sql/pglite`) for any change to either side.
- `apps/desktop/src/main/referralClient.ts` - what the editor sends, and when.
