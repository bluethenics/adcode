-- Who actually uses ADCode, who came back, and how far new people get.
--
-- Production on 2026-10-03: 633 accounts, but 214 had never fetched an ad or reported
-- anything, and 181 of those were born within five seconds of another account. A race in
-- the desktop client signed up two or three anonymous accounts on first launch (fixed in the
-- same release as this migration). Counting those as "developers" overstated the network by
-- about a third, and every day's "active" figure was mostly that day's sign-ups, which made
-- the retention problem invisible on the chart.
--
-- This migration:
--
--   1. `milestones` - the first-session funnel: fixed names (welcome shown, model connected,
--      prompt sent, turn succeeded, ...) with the first and last time each happened. No
--      prompt, file, key or model output; the table has no column that could hold one.
--   2. `developer_counts` - the public counter's "developers": active accounts seen at least
--      once (a non-test serve, a day of activity, or a milestone).
--   3. `growth_stats` - the same rule for the admin numbers, plus who came back (returning
--      users per day, six weeks of sign-up cohorts) and the funnel.
--
-- `services/api/src/growth.ts` is the same definition in TypeScript, and
-- `services/api/test/growth.test.ts` pins its cases. Change both or neither.

create table if not exists public.milestones (
  uid      text    not null,
  name     text    not null check (name ~ '^[a-z_]{1,40}$'),
  first_at bigint  not null,
  last_at  bigint  not null,
  count    integer not null default 1 check (count >= 1),
  primary key (uid, name)
);

create index if not exists milestones_name_idx on public.milestones (name, first_at);

do $$
begin
  execute 'alter table public.milestones enable row level security';
  execute 'alter table public.milestones force row level security';
  execute 'revoke all on public.milestones from anon, authenticated';
end $$;

-- One flush. Grouped by name first, so a batch that names one milestone twice is one row
-- (ON CONFLICT cannot touch the same row twice in a statement), and so "first" stays the
-- earliest and the count adds whichever of two concurrent flushes lands second.
create or replace function public.record_milestones(p_uid text, p_items jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.milestones as m (uid, name, first_at, last_at, count)
  select p_uid,
         item->>'name',
         min((item->>'at')::bigint),
         max((item->>'at')::bigint),
         count(*)::integer
    from jsonb_array_elements(p_items) as item
   group by item->>'name'
  on conflict (uid, name) do update set
    first_at = least(m.first_at, excluded.first_at),
    last_at  = greatest(m.last_at, excluded.last_at),
    count    = m.count + excluded.count;
$$;

revoke all on function public.record_milestones(text, jsonb) from public, anon, authenticated;
grant execute on function public.record_milestones(text, jsonb) to service_role;

-- The public counter. Every `exists` is an index lookup: serves (uid, ...), activity
-- (uid, day) and milestones (uid, name) all lead with the uid.
create or replace function public.developer_counts(p_now bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with dev as (
    select u.created_at
      from public.users u
     where u.status = 'active'
       and (   exists (select 1 from public.serves s where s.uid = u.uid and not s.test)
            or exists (select 1 from public.activity_daily a where a.uid = u.uid)
            or exists (select 1 from public.milestones m where m.uid = u.uid))
  )
  select jsonb_build_object(
    'developers',         (select count(*) from dev),
    'developersThisWeek', (select count(*) from dev where created_at > p_now - 7 * 86400000::bigint)
  );
$$;

revoke all on function public.developer_counts(bigint) from public, anon, authenticated;
grant execute on function public.developer_counts(bigint) to service_role;

create or replace function public.growth_stats(p_now bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  k as (
    select 86400000::bigint as d,
           (extract(epoch from date_trunc('day', to_timestamp(p_now / 1000.0) at time zone 'UTC')) * 1000)::bigint as today
  ),
  -- Every moment an account was seen. Activity counts from the start of its UTC day, which
  -- can only under-count a window or a return, never the other way round.
  seen_all as (
    select s.uid, s.served_at as at from public.serves s where not s.test
    union all
    select a.uid, (extract(epoch from a.day::date) * 1000)::bigint from public.activity_daily a
    union all
    select m.uid, m.first_at from public.milestones m
    union all
    select m.uid, m.last_at from public.milestones m where m.last_at <> m.first_at
  ),
  people as (
    select u.uid, u.created_at, l.last_seen
      from public.users u
      left join (select x.uid, max(x.at) as last_seen from seen_all x group by x.uid) l on l.uid = u.uid
     where u.status = 'active'
  ),
  devs as (select * from people where last_seen is not null),
  -- A sighting at least a day after the account was made is somebody who came back.
  seen as (
    select x.uid, x.at, coalesce(x.at >= p.created_at + (select d from k), false) as is_return
      from seen_all x
      left join people p on p.uid = x.uid
     where x.at > p_now - 30 * (select d from k)
  ),
  shown as (
    select r.created_at as at from public.receipts r where r.cost_micros > 0 and r.outcome <> 'click'
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
    select (select today from k) - (7 * w + 6) * (select d from k) as start_ms
      from generate_series(0, 5) as w
  ),
  recent as (select uid from devs where created_at > p_now - 30 * (select d from k)),
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
    'joined7d',    (select count(*) from devs where created_at > p_now - 7 * (select d from k)),
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
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', days.day,
        'active',    (select count(distinct uid) from seen
                       where at >= days.start_ms and at < days.start_ms + (select d from k)),
        'returning', (select count(distinct uid) from seen
                       where is_return and at >= days.start_ms and at < days.start_ms + (select d from k)),
        'joined',    (select count(*) from devs
                       where created_at >= days.start_ms and created_at < days.start_ms + (select d from k)),
        'adsShown',  (select count(*) from shown
                       where at >= days.start_ms and at < days.start_ms + (select d from k))
      ) order by days.day), '[]'::jsonb)
      from days
    ),
    'cohorts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'weekStart', to_char(to_timestamp(weeks.start_ms / 1000.0) at time zone 'UTC', 'YYYY-MM-DD'),
        'joined', (select count(*) from devs
                    where created_at >= weeks.start_ms and created_at < weeks.start_ms + 7 * (select d from k)),
        'back1d', (select count(*) from devs
                    where created_at >= weeks.start_ms and created_at < weeks.start_ms + 7 * (select d from k)
                      and last_seen >= created_at + (select d from k)),
        'back7d', (select count(*) from devs
                    where created_at >= weeks.start_ms and created_at < weeks.start_ms + 7 * (select d from k)
                      and last_seen >= created_at + 7 * (select d from k))
      ) order by weeks.start_ms), '[]'::jsonb)
      from weeks
    ),
    'funnel', jsonb_build_object(
      'base', (select count(*) from recent),
      'steps', (
        select jsonb_agg(jsonb_build_object(
          'name', names.name,
          'accounts', (select count(distinct m.uid)
                         from public.milestones m
                         join recent r on r.uid = m.uid
                        where m.name = names.name)
        ) order by names.ord)
        from names
      )
    )
  );
$$;

revoke all on function public.growth_stats(bigint) from public, anon, authenticated;
grant execute on function public.growth_stats(bigint) to service_role;
