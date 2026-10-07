-- Growth numbers that mean what their labels say.
--
-- An audit of the admin growth report on 2026-10-06 found:
--
--   * "Came back" was measured from the account's creation. Somebody who signed in on the
--     website and opened the editor for the first time three days later was counted as a
--     returning developer on their very first visit. A developer now joins - and is measured
--     from - the first time they are seen.
--   * A day of editor activity counted from midnight UTC, so yesterday evening's work fell
--     out of "the last 24 hours" hours early. `activity_daily` already kept the latest flush
--     (`updated_at`); it now keeps the first one too (`first_at`), and both are real moments.
--   * Milestones kept only their first and latest time, so a day between the two on which the
--     only sign of somebody was a milestone disappeared from the daily totals.
--     `milestone_days` keeps every day a milestone was reported on.
--   * Retention cohorts were seven-day windows counted back from today, so every report
--     compared a different group of people. They are calendar weeks now, Monday first.
--   * "First session" counted milestones reached on any later day, and listed thirteen
--     milestones as if each were a step after the last. It now counts the first day only -
--     within 24 hours of being first seen - and adds an ordered journey (welcome, prompt,
--     working answer, preview) in which each step needs the one before it.
--   * "Paid to developers" was credited earnings. The report now also returns what was
--     actually paid out (`paidOutMicros`, withdrawals marked paid).
--
-- `services/api/src/growth.ts` is the same definition in TypeScript, and
-- `services/api/test/growth.test.ts` pins its cases. Change both or neither.

-- 1. When each activity day was first reported. Older rows keep null and count from
--    their latest flush, which can only under-count a return, never invent one.
alter table public.activity_daily add column if not exists first_at bigint;

create or replace function public.add_activity(
  p_uid            text,
  p_day            text,
  p_manual_chars   bigint,
  p_agent_chars    bigint,
  p_accepted_edits integer,
  p_rejected_edits integer,
  p_files_touched  integer,
  p_active_ms      bigint,
  p_sessions       integer,
  p_updated_at     bigint
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_daily (
    uid, day, manual_chars, agent_chars, accepted_edits, rejected_edits,
    files_touched, active_ms, sessions, first_at, updated_at
  ) values (
    p_uid, p_day, p_manual_chars, p_agent_chars, p_accepted_edits, p_rejected_edits,
    p_files_touched, p_active_ms, p_sessions, p_updated_at, p_updated_at
  )
  on conflict (uid, day) do update set
    manual_chars   = public.activity_daily.manual_chars   + excluded.manual_chars,
    agent_chars    = public.activity_daily.agent_chars    + excluded.agent_chars,
    accepted_edits = public.activity_daily.accepted_edits + excluded.accepted_edits,
    rejected_edits = public.activity_daily.rejected_edits + excluded.rejected_edits,
    -- Not a sum: a file edited on Monday and again on Monday is one file, and the client
    -- sends the day's distinct count. The larger of the two is the closest honest answer
    -- without storing the filenames, which is exactly what we refuse to store.
    files_touched  = greatest(public.activity_daily.files_touched, excluded.files_touched),
    active_ms      = public.activity_daily.active_ms      + excluded.active_ms,
    sessions       = public.activity_daily.sessions       + excluded.sessions,
    first_at       = coalesce(public.activity_daily.first_at, public.activity_daily.updated_at, excluded.first_at),
    updated_at     = greatest(public.activity_daily.updated_at, excluded.updated_at);
$$;

-- 2. Every UTC day a milestone was reported on, with the first and last time that day.
create table if not exists public.milestone_days (
  uid      text   not null,
  day      text   not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  first_at bigint not null,
  last_at  bigint not null,
  primary key (uid, day)
);

do $$
begin
  execute 'alter table public.milestone_days enable row level security';
  execute 'alter table public.milestone_days force row level security';
  execute 'revoke all on public.milestone_days from anon, authenticated';
end $$;

-- What can be recovered of the past: the first and the latest day of each milestone.
insert into public.milestone_days as d (uid, day, first_at, last_at)
select x.uid, to_char(to_timestamp(x.at / 1000.0) at time zone 'UTC', 'YYYY-MM-DD'), min(x.at), max(x.at)
  from (
    select m.uid, m.first_at as at from public.milestones m
    union all
    select m.uid, m.last_at from public.milestones m
  ) x
 group by x.uid, to_char(to_timestamp(x.at / 1000.0) at time zone 'UTC', 'YYYY-MM-DD')
on conflict (uid, day) do update set
  first_at = least(d.first_at, excluded.first_at),
  last_at  = greatest(d.last_at, excluded.last_at);

-- One flush: the milestones themselves, then the days they happened on. Each statement is
-- grouped first, because ON CONFLICT cannot touch the same row twice in one statement.
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

  insert into public.milestone_days as d (uid, day, first_at, last_at)
  select p_uid,
         to_char(to_timestamp((item->>'at')::bigint / 1000.0) at time zone 'UTC', 'YYYY-MM-DD'),
         min((item->>'at')::bigint),
         max((item->>'at')::bigint)
    from jsonb_array_elements(p_items) as item
   group by to_char(to_timestamp((item->>'at')::bigint / 1000.0) at time zone 'UTC', 'YYYY-MM-DD')
  on conflict (uid, day) do update set
    first_at = least(d.first_at, excluded.first_at),
    last_at  = greatest(d.last_at, excluded.last_at);
$$;

revoke all on function public.record_milestones(text, jsonb) from public, anon, authenticated;
grant execute on function public.record_milestones(text, jsonb) to service_role;

-- 3. Every moment an account was seen - the one definition both functions below read.
--
-- Activity is a day, not a moment: it is placed at the day's first flush (held inside that
-- day, where the work was done) and at its latest flush, which is a real moment the editor
-- was open.
create or replace function public.growth_sightings()
returns table (uid text, at bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.uid, s.served_at from public.serves s where not s.test
  union all
  select a.uid,
         least(greatest(coalesce(a.first_at, a.updated_at), x.start_ms), x.start_ms + 86400000 - 1)
    from public.activity_daily a
    cross join lateral (select (extract(epoch from a.day::date) * 1000)::bigint as start_ms) x
  union all
  select a.uid, a.updated_at from public.activity_daily a
  union all
  select m.uid, m.first_at from public.milestones m
  union all
  select m.uid, m.last_at from public.milestones m where m.last_at <> m.first_at
  union all
  select d.uid, d.first_at from public.milestone_days d
  union all
  select d.uid, d.last_at from public.milestone_days d where d.last_at <> d.first_at;
$$;

revoke all on function public.growth_sightings() from public, anon, authenticated;
grant execute on function public.growth_sightings() to service_role;

-- 4. The public counter: developers, and the ones first seen this week.
create or replace function public.developer_counts(p_now bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  spans as (select x.uid, min(x.at) as first_seen from public.growth_sightings() x group by x.uid),
  dev as (
    select s.first_seen
      from public.users u
      join spans s on s.uid = u.uid
     where u.status = 'active'
  )
  select jsonb_build_object(
    'developers',         (select count(*) from dev),
    'developersThisWeek', (select count(*) from dev where first_seen > p_now - 7 * 86400000::bigint)
  );
$$;

revoke all on function public.developer_counts(bigint) from public, anon, authenticated;
grant execute on function public.developer_counts(bigint) to service_role;

-- 5. The admin numbers.
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
           (extract(epoch from date_trunc('day', to_timestamp(p_now / 1000.0) at time zone 'UTC')) * 1000)::bigint as today,
           -- Monday of this UTC week: cohorts are calendar weeks, the same people every report.
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
  -- A sighting at least a day after the account was first seen is somebody who came back.
  seen as (
    select x.uid, x.at, x.at >= s.first_seen + (select d from k) as is_return
      from seen_all x
      join spans s on s.uid = x.uid
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
    select (select this_week from k) - w * 7 * (select d from k) as start_ms
      from generate_series(0, 5) as w
  ),
  recent as (
    select uid, first_seen, first_seen + (select d from k) as until
      from devs
     where first_seen > p_now - 30 * (select d from k)
  ),
  -- The first day: a milestone counts if its first or latest time falls within a day of the
  -- account being first seen.
  first_day as (
    select m.uid, m.name
      from public.milestones m
      join recent r on r.uid = m.uid
     where m.first_at between r.first_seen and r.until
        or m.last_at between r.first_seen and r.until
  ),
  -- The ordered journey: each step needs a time at or after the step before, inside the day.
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
        'active',    (select count(distinct uid) from seen
                       where at >= days.start_ms and at < days.start_ms + (select d from k)),
        'returning', (select count(distinct uid) from seen
                       where is_return and at >= days.start_ms and at < days.start_ms + (select d from k)),
        'joined',    (select count(*) from devs
                       where first_seen >= days.start_ms and first_seen < days.start_ms + (select d from k)),
        'adsShown',  (select count(*) from shown
                       where at >= days.start_ms and at < days.start_ms + (select d from k))
      ) order by days.day), '[]'::jsonb)
      from days
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
