-- The numbers worth saying out loud: how many people use ADCode, and how many ads it showed.
--
-- `public_stats` answers "how big is the network" with lifetime totals. It cannot say who is
-- still here, and "632 developers" with no sense of how many opened the editor this week is
-- the figure an advertiser learns to discount. This is the admin's view, with windows.
--
-- What counts as active: an account that fetched ads (the editor prefetches whenever it is
-- running and online, whatever the person's ad settings) or reported a day of editor
-- activity. A day of activity counts from the start of its UTC day, which can only ever
-- under-count a rolling window - never the other way round.
--
-- What counts as an ad shown: the same rule as `public_stats` and `stats_for_campaign` - a
-- receipt that billed somebody (cost_micros > 0) and is not a click. A serve is not an ad
-- shown: it is the editor keeping a card ready, and most expire unseen.

create index if not exists serves_served_at_idx on public.serves (served_at) where test = false;
create index if not exists receipts_created_at_idx on public.receipts (created_at) where cost_micros > 0;

create or replace function public.growth_stats(p_now bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  day_ms as (select 86400000::bigint as d),
  seen as (
    select s.uid, s.served_at as at
      from public.serves s
     where not s.test and s.served_at > p_now - 30 * (select d from day_ms)
    union all
    select a.uid, (extract(epoch from a.day::date) * 1000)::bigint
      from public.activity_daily a
     where a.day >= to_char(to_timestamp(p_now / 1000.0) at time zone 'UTC' - interval '30 days', 'YYYY-MM-DD')
  ),
  shown as (
    select r.created_at as at
      from public.receipts r
     where r.cost_micros > 0 and r.outcome <> 'click'
  ),
  days as (
    select to_char(g, 'YYYY-MM-DD') as day,
           (extract(epoch from g) * 1000)::bigint as start_ms
      from generate_series(
        date_trunc('day', to_timestamp(p_now / 1000.0) at time zone 'UTC') - interval '29 days',
        date_trunc('day', to_timestamp(p_now / 1000.0) at time zone 'UTC'),
        interval '1 day'
      ) as g
  )
  select jsonb_build_object(
    'developers',  (select count(*) from public.users u where u.status = 'active'),
    'joined7d',    (select count(*) from public.users u where u.created_at > p_now - 7 * (select d from day_ms)),
    'joined30d',   (select count(*) from public.users u where u.created_at > p_now - 30 * (select d from day_ms)),
    'active1d',    (select count(distinct uid) from seen where at > p_now - (select d from day_ms)),
    'active7d',    (select count(distinct uid) from seen where at > p_now - 7 * (select d from day_ms)),
    'active30d',   (select count(distinct uid) from seen),
    'adsShown',    (select count(*) from shown),
    'adsShown7d',  (select count(*) from shown where at > p_now - 7 * (select d from day_ms)),
    'adsShown30d', (select count(*) from shown where at > p_now - 30 * (select d from day_ms)),
    'clicks',      (select count(*) from public.receipts r where r.cost_micros > 0 and r.outcome = 'click'),
    'creditedMicros', (select coalesce(sum(r.credited_micros), 0)::text from public.receipts r where r.cost_micros > 0),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', days.day,
        'active', (select count(distinct uid) from seen
                    where at >= days.start_ms and at < days.start_ms + (select d from day_ms)),
        'joined', (select count(*) from public.users u
                    where u.created_at >= days.start_ms and u.created_at < days.start_ms + (select d from day_ms)),
        'adsShown', (select count(*) from shown
                      where at >= days.start_ms and at < days.start_ms + (select d from day_ms))
      ) order by days.day), '[]'::jsonb)
      from days
    )
  );
$$;

-- Supabase grants new functions to `anon` and `authenticated` by default. This one reads
-- every account's activity, so only the API's service role may call it.
revoke all on function public.growth_stats(bigint) from public, anon, authenticated;
grant execute on function public.growth_stats(bigint) to service_role;
