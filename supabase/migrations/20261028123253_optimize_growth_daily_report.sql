-- Keep the growth report inside the API's 8 s database deadline as activity grows.
-- Only the daily chart calculation changes; totals, cohorts, first-day funnels and
-- the existing service-role-only access remain the same.
create or replace function public.growth_stats(p_now bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
  with
  k as (
    select 86400000::bigint as d,
           (extract(epoch from date_trunc('day', to_timestamp(p_now / 1000.0) at time zone 'UTC')) * 1000)::bigint as today,
           (extract(epoch from date_trunc('week', to_timestamp(p_now / 1000.0) at time zone 'UTC')) * 1000)::bigint as this_week
  ),
  seen_all as (select x.uid, x.at from public.growth_sightings() x),
  spans as (select x.uid, min(x.at) as first_seen, max(x.at) as last_seen from seen_all x group by x.uid),
  people as (
    select u.uid, s.first_seen, s.last_seen
      from public.users u
      left join spans s on s.uid = u.uid
     where u.status = 'active'
  ),
  devs as (select * from people where first_seen is not null),
  seen as (
    select x.uid, x.at, x.at >= s.first_seen + (select d from k) as is_return
      from seen_all x
      join spans s on s.uid = x.uid
     where x.at > p_now - 30 * (select d from k)
  ),
  shown as (
    select r.created_at as at from public.receipts r where r.cost_micros > 0 and r.outcome <> 'click'
  ),

  -- Aggregate each input once. Correlated daily subqueries scanned the materialized
  -- activity history 60 times and exceeded the API's eight-second database deadline.
  daily_seen as (
    select (floor(at::numeric / 86400000) * 86400000)::bigint as start_ms,
           count(distinct uid) as active,
           count(distinct uid) filter (where is_return) as returning
      from seen
     group by 1
  ),
  daily_joined as (
    select (floor(first_seen::numeric / 86400000) * 86400000)::bigint as start_ms,
           count(*) as joined
      from devs
     group by 1
  ),
  daily_shown as (
    select (floor(at::numeric / 86400000) * 86400000)::bigint as start_ms,
           count(*) as ads_shown
      from shown
     group by 1
  ),
  days as (
    select to_char(g, 'YYYY-MM-DD') as day, (extract(epoch from g) * 1000)::bigint as start_ms
      from generate_series(
        date_trunc('day', to_timestamp(p_now / 1000.0) at time zone 'UTC') - interval '29 days',
        date_trunc('day', to_timestamp(p_now / 1000.0) at time zone 'UTC'),
        interval '1 day'
      ) as g
  ),
  weeks as (
    select (select this_week from k) - w * 7 * (select d from k) as start_ms
      from generate_series(0, 5) as w
  ),
  recent as (
    select uid, first_seen, first_seen + (select d from k) as until
      from devs
     where first_seen > p_now - 30 * (select d from k)
  ),
  first_day as (
    select m.uid, m.name
      from public.milestones m
      join recent r on r.uid = m.uid
     where m.first_at between r.first_seen and r.until
        or m.last_at between r.first_seen and r.until
  ),
  j1 as (
    select r.uid, r.until,
           (select case when m.first_at between r.first_seen and r.until then m.first_at
                        when m.last_at between r.first_seen and r.until then m.last_at end
              from public.milestones m where m.uid = r.uid and m.name = 'welcome_shown') as t
      from recent r
  ),
  j2 as (
    select j.uid, j.until,
           (select case when m.first_at between j.t and j.until then m.first_at
                        when m.last_at between j.t and j.until then m.last_at end
              from public.milestones m where m.uid = j.uid and m.name = 'prompt_sent') as t
      from j1 j where j.t is not null
  ),
  j3 as (
    select j.uid, j.until,
           (select case when m.first_at between j.t and j.until then m.first_at
                        when m.last_at between j.t and j.until then m.last_at end
              from public.milestones m where m.uid = j.uid and m.name = 'turn_ok') as t
      from j2 j where j.t is not null
  ),
  j4 as (
    select j.uid, j.until,
           (select case when m.first_at between j.t and j.until then m.first_at
                        when m.last_at between j.t and j.until then m.last_at end
              from public.milestones m where m.uid = j.uid and m.name = 'preview_opened') as t
      from j3 j where j.t is not null
  ),
  names as (
    select name, ord
      from unnest(array[
        'welcome_shown', 'welcome_done', 'welcome_skipped', 'project_created', 'folder_opened',
        'ai_needed', 'ai_connected_free', 'ai_connected_local', 'ai_connected_key',
        'prompt_sent', 'turn_ok', 'turn_failed', 'preview_opened'
      ]) with ordinality as t(name, ord)
  )
  select jsonb_build_object(
    'accounts',    (select count(*) from people),
    'developers',  (select count(*) from devs),
    'joined7d',    (select count(*) from devs where first_seen > p_now - 7 * (select d from k)),
    'joined30d',   (select count(*) from recent),
    'active1d',    (select count(distinct uid) from seen where at > p_now - (select d from k)),
    'active7d',    (select count(distinct uid) from seen where at > p_now - 7 * (select d from k)),
    'active30d',   (select count(distinct uid) from seen),
    'returning1d', (select count(distinct uid) from seen where is_return and at > p_now - (select d from k)),
    'returning7d', (select count(distinct uid) from seen where is_return and at > p_now - 7 * (select d from k)),
    'adsShown',    (select count(*) from shown),
    'adsShown7d',  (select count(*) from shown where at > p_now - 7 * (select d from k)),
    'adsShown30d', (select count(*) from shown where at > p_now - 30 * (select d from k)),
    'clicks',      (select count(*) from public.receipts r where r.cost_micros > 0 and r.outcome = 'click'),
    'creditedMicros', (select coalesce(sum(r.credited_micros), 0)::text from public.receipts r where r.cost_micros > 0),
    'paidOutMicros',  (select coalesce(sum(w.amount_micros), 0)::text from public.withdrawals w where w.status = 'paid'),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', days.day,
        'active', coalesce(daily_seen.active, 0),
        'returning', coalesce(daily_seen.returning, 0),
        'joined', coalesce(daily_joined.joined, 0),
        'adsShown', coalesce(daily_shown.ads_shown, 0)
      ) order by days.day), '[]'::jsonb)
      from days
      left join daily_seen using (start_ms)
      left join daily_joined using (start_ms)
      left join daily_shown using (start_ms)
    ),
    'cohorts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'weekStart', to_char(to_timestamp(weeks.start_ms / 1000.0) at time zone 'UTC', 'YYYY-MM-DD'),
        'joined', (select count(*) from devs
                    where first_seen >= weeks.start_ms and first_seen < weeks.start_ms + 7 * (select d from k)),
        'back1d', (select count(*) from devs
                    where first_seen >= weeks.start_ms and first_seen < weeks.start_ms + 7 * (select d from k)
                      and last_seen >= first_seen + (select d from k)),
        'back7d', (select count(*) from devs
                    where first_seen >= weeks.start_ms and first_seen < weeks.start_ms + 7 * (select d from k)
                      and last_seen >= first_seen + 7 * (select d from k))
      ) order by weeks.start_ms), '[]'::jsonb)
      from weeks
    ),
    'funnel', jsonb_build_object(
      'base', (select count(*) from recent),
      'steps', (
        select jsonb_agg(jsonb_build_object(
          'name', names.name,
          'accounts', (select count(distinct f.uid) from first_day f where f.name = names.name)
        ) order by names.ord)
        from names
      ),
      'journey', jsonb_build_array(
        jsonb_build_object('name', 'welcome_shown',  'accounts', (select count(*) from j1 where t is not null)),
        jsonb_build_object('name', 'prompt_sent',    'accounts', (select count(*) from j2 where t is not null)),
        jsonb_build_object('name', 'turn_ok',        'accounts', (select count(*) from j3 where t is not null)),
        jsonb_build_object('name', 'preview_opened', 'accounts', (select count(*) from j4 where t is not null))
      )
    )
  );
$$;

revoke all on function public.growth_stats(bigint) from public, anon, authenticated;
grant execute on function public.growth_stats(bigint) to service_role;
