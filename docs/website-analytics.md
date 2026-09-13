# Website analytics

Reports live at `/admin/analytics`, using the existing verified administrator access check. Collection is first-party at `POST /v1/website-events`; reports use `GET /v1/admin/website-analytics?days=30`.

## Enable in production

1. Apply `supabase/migrations/20260913090000_website_analytics.sql` and `supabase/migrations/20260913090100_website_analytics_retention.sql` to the same Supabase project used by the site. Existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` settings are reused; no browser API key is added.
2. Set `NEXT_PUBLIC_SITE_ORIGIN` to the exact public origin, including protocol. Collection rejects other origins. For local testing set it to the local website origin.
3. Deploy the website/API together. Sign in as an administrator and open **Analytics**.
4. Verify the `website-analytics-retention` Supabase Cron job is active. The retention migration enables `pg_cron` and schedules `select public.purge_website_analytics();` daily at 03:17 GMT (08:47 India time). It deletes events older than 90 days and analytics rate-limit counters older than one day.
5. In a separate non-admin page, allow analytics, navigate between pages, and copy an installation command. After three seconds, refresh the admin report. Decline analytics and verify no further event requests are sent.

## What the reports mean

- Periods include today in UTC. 7, 30, and 90 days are available, with aggregate JSON export.
- Only consenting traffic is measured. Do Not Track and Global Privacy Control override an accepted preference. No historical backfill is possible.
- Session IDs are per browser tab, reused across refreshes using session storage, and rotate after 30 minutes of inactivity. They are not user counts and do not link desktop activity or account identities.
- Sources use first-session `utm_source`, or the external referring hostname; `utm_campaign` is optional. Use short campaign labels containing only letters, digits, periods, underscores, or hyphens. Query strings and referring paths are never submitted.
- Install intent is the percentage of sessions with a page view and an install-copy/download-click event. It does not prove installation. Actions are browser-observed success signals, not authoritative revenue or billing records.
- Supported actions: installation copies, download clicks, advertiser entry clicks, successful sign-in/email signup, advertiser/campaign creation, support success, outbound links, scroll 50/90%, and capped generic browser-error counts.
- Performance uses Next.js Web Vitals: LCP, CLS, INP, FCP, TTFB where the browser reports them. Attribution belongs to the original document path, not subsequent SPA routes. Values are measured once per metric ID and summarized at the 75th percentile. Visible engagement is time with the document visible.
- Reports read at most the most recent 20,000 events in the period and display a prominent partial-data warning when that limit is reached. For higher traffic, replace the bounded raw-event report read with database-side aggregation before relying on full-period totals.

## Operational behavior

No cookies, user identities, text input, raw errors, recordings, IP addresses, or full user-agent strings are stored in events. Campaign-detail routes are normalized. Public ingestion validates a fixed schema, accepts at most 20 events, deduplicates UUID event IDs in Postgres, and applies persistent global (600 batches/minute) and session (30 batches/minute) ceilings. Origin checks limit browser misuse, not spoofed requests from bots. Add edge rate limiting if abuse occurs.

Delivery is best effort, batched every three seconds or at 20 events, and flushed when a page is hidden or left. It uses keepalive requests without credentials. Failed deliveries are dropped to keep analytics from affecting website operation. Reports distinguish loading, empty, partial, and failed states. If the migration is missing, the report shows an error; it does not invent zero traffic.
