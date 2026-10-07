# Website analytics

Reports live at `/admin/analytics`, using the existing verified administrator access check. Collection is first-party at `POST /v1/website-events`; reports use `GET /v1/admin/website-analytics?days=30`.

## Enable in production

1. Apply `supabase/migrations/20260913090000_website_analytics.sql`, `supabase/migrations/20260913090100_website_analytics_retention.sql`, `20261006120000_model_catalog_and_outcomes.sql` (button placement) and `20261006180100_website_event_times.sql` (when each event happened, and replacing a changed Web Vital) to the same Supabase project used by the site. Until the last two are applied, events are still recorded, without placement or occurrence time. Existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` settings are reused; no browser API key is added.
2. Set `NEXT_PUBLIC_SITE_ORIGIN` to the exact public origin, including protocol. Collection rejects other origins. For local testing set it to the local website origin.
3. Deploy the website/API together. Sign in as an administrator and open **Analytics**.
4. Verify the `website-analytics-retention` Supabase Cron job is active. The retention migration enables `pg_cron` and schedules `select public.purge_website_analytics();` daily at 03:17 GMT (08:47 India time). It deletes events older than 90 days and analytics rate-limit counters older than one day.
5. An administrator's browser is not counted once they sign in (Admin > Analytics shows this and has a **Count this browser** switch). For a setup check, turn counting on in that browser, allow analytics, navigate between pages, and copy an installation command. After three seconds, refresh the admin report. Decline analytics and verify no further event requests are sent. Turn counting off again when done. Automated browsers (WebDriver, headless) are never counted, so the check has to be done by hand.

### Verify the production database

Run these read-only queries in the linked Supabase project's SQL editor after applying
the migrations. Both table names must be present and the retention job must be active.
The existing `request_counts` table is required by analytics rate limiting and retention.

```sql
select to_regclass('public.website_events') as events_table,
       to_regclass('public.request_counts') as rate_limits_table;

select jobname, schedule, active
from cron.job
where jobname = 'website-analytics-retention';
```

The production origin is already set to `https://adcode.bluethenics.com` in
`apps/web/wrangler.jsonc`. Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
exist as Worker secrets in that deployment; local public Firebase settings do not
configure database access. Keep the service-role key out of all `NEXT_PUBLIC_*` variables.

After deploying, open `https://adcode.bluethenics.com/admin/analytics` as a verified
administrator. In browser developer tools, consenting visits should send batches to
`/v1/website-events`. A successful `/v1/health` response alone does not prove analytics
storage or retention works. Confirm the report contains the new visit and verify the
Cron run history after its next scheduled execution.

## What the reports mean

- Periods include today in UTC. 7, 30, and 90 days are available, with aggregate JSON export.
- Only consenting traffic is measured. Do Not Track and Global Privacy Control override an accepted preference. No historical backfill is possible.
- Session IDs are per browser tab, reused across refreshes using session storage, and rotate after 30 minutes with nobody scrolling, clicking, typing or recording an action. A session that resumes after that starts with its own page view, so an install or campaign that ends it still counts in the funnels. Engagement and Web Vitals never start a session; they belong to the visit they measured. Sessions are not user counts and do not link desktop activity or account identities.
- Sources use the landing page's `utm_source`, or the external referring hostname, read when the page opens and kept in memory (not stored) until the visitor answers the consent banner - so clicking around first no longer turns a tagged visit into "direct". A full page reload before consent still loses it; storing it before consent would need consent. `utm_campaign` is optional. Reports group spellings of one place into one channel (t.co, x.com and twitter as `x`; l.threads.com as `threads`; and so on), including events recorded before the grouping. Use short campaign labels containing only letters, digits, periods, underscores, or hyphens. Query strings and referring paths are never submitted.
- Install intent is the percentage of sessions with a page view and an install-copy/download-click event. It does not prove installation. Actions are browser-observed success signals, not authoritative revenue or billing records.
- The installation-pages funnel starts at `/versions` or `/docs/installing-adcode`, so general docs readers and returning dashboard users do not inflate its starting count. The sitewide funnel remains available for comparison. Successful copies of the exact Windows/Linux installer commands from documentation now count as install intent; arbitrary copied code and failed copies do not. These newly tracked copies cannot be backfilled.
- Supported actions: installation copies, download clicks, advertiser entry clicks, successful sign-in and sign-up (Google and GitHub sign-ups count as sign-ups when Firebase reports a new account), advertiser/campaign creation, support success, outbound links, scroll 50/90%, and capped generic browser-error counts. Send-to-desktop counts when the share sheet was used or the link copied, not when the button was pressed; the email link counts on the click. Install copies, downloads and sends carry the button they came from (`hero`, `closing`, `sticky`, `versions-windows`, `docs-codebox`, ...). A link that records its own click is marked `data-tracked` and is not counted again by the page-wide listener.
- Advertiser entry includes an advertiser link click, the first interaction with the homepage campaign form in each session (and again just before a campaign is created, so it always has an entry in the same session), or a visit to the advertiser portal or its campaign builder. Campaign creation is measured in both builders. Homepage conversions before this instrumentation cannot be recovered; compare periods after deployment. This funnel measures campaign creation, not completed checkout or paid campaigns.
- Performance uses Next.js Web Vitals: LCP, CLS, INP, FCP, TTFB where the browser reports them. Attribution belongs to the original document path, not subsequent SPA routes. CLS and INP can change after their first report; a later value is re-sent under the same event id and replaces the earlier one, so the 75th percentile describes whole visits. Engaged time is time with the document visible, counting at most one minute past the last scroll, click, key press or pointer movement.
- Events are dated by when they happened: the browser sends each event's age in milliseconds and the API stores `occurred_at = received_at - age`, so a batch keeps its order and two requests that cross on the network do not swap a funnel's steps. Rows from before this have only `received_at`.
- Reports read at most the most recent 20,000 events in the period and display a prominent partial-data warning when that limit is reached. For higher traffic, replace the bounded raw-event report read with database-side aggregation before relying on full-period totals.

## Operational behavior

No cookies, user identities, text input, raw errors, recordings, IP addresses, or full user-agent strings are stored in events. Campaign-detail routes are normalized. Public ingestion validates a fixed schema, accepts at most 20 events, deduplicates UUID event IDs in Postgres, and applies persistent global (600 batches/minute) and session (30 batches/minute) ceilings. Origin checks limit browser misuse, not spoofed requests from bots. Add edge rate limiting if abuse occurs.

Delivery is batched every three seconds or at 20 events, and flushed when a page is hidden or left. It uses keepalive requests without credentials. Events stay in a bounded outbox (100 events, in session storage) until the API confirms them: network errors, 408, 429 and 5xx are retried with backoff, four attempts in all, and a batch still unconfirmed when the page unloads is sent again from the next page in that tab. Because the API keeps the first copy of each event id, a batch that did arrive is never counted twice. Malformed (4xx) batches are dropped. Requests from crawlers and automated browsers are answered as accepted and stored nowhere. Reports distinguish loading, empty, partial, and failed states. If the migration is missing, the report shows an error; it does not invent zero traffic.
