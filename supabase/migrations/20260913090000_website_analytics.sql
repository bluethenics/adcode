-- Website telemetry is separate from advertising receipts and account records.
create table public.website_events (
  id uuid primary key,
  session uuid not null,
  name text not null check (length(name) <= 40),
  path text not null check (length(path) <= 160),
  source text not null check (length(source) <= 80),
  campaign text not null check (length(campaign) <= 80),
  device text not null check (device in ('desktop', 'mobile', 'tablet')),
  value double precision not null check (value >= 0 and value <= 3600000),
  received_at bigint not null
);
create index website_events_time_idx on public.website_events (received_at desc, id);
alter table public.website_events enable row level security;
revoke all on public.website_events from anon, authenticated;
grant select, insert on public.website_events to service_role;

-- Run daily through Supabase Cron (see docs/website-analytics.md).
create or replace function public.purge_website_analytics() returns void
language sql security definer set search_path = '' as $$
  delete from public.website_events
  where received_at < (extract(epoch from now() - interval '90 days') * 1000)::bigint;
  delete from public.request_counts
  where (uid = 'website-analytics-global' or uid like 'website-session:%')
    and window_start < (extract(epoch from now() - interval '1 day') * 1000)::bigint;
$$;
revoke all on function public.purge_website_analytics() from public, anon, authenticated;
grant execute on function public.purge_website_analytics() to service_role;
