-- Retention tracking: who stops coming back, and what went wrong just before.
--
-- The desktop app (2.6.3 and later, only while Help improve ADCode is on) sends fixed event
-- names - first launch, signed in, first project, first AI message, first working turn,
-- first applied edit, preview, each active day - and friction: failed turns with a fixed
-- error word, CLI agent failures (the OpenCode silent stop among them), limit screens,
-- "No API key", sign-in dead ends, slow first answers, cancelled turns, crashes, renderer
-- crashes, failed updates, and how each session ended. Each event is a name, an optional
-- code from a fixed list, an optional duration and a time. No column here can hold a
-- prompt, a path, a file, code or chat text; `services/api/src/retention.ts` refuses
-- anything that is not in its lists before it reaches this table.
--
--   retention_events        raw events, kept 90 days (purged by the hourly job)
--   retention_daily         per account per UTC day: event count and counts by name/code
--   retention_users         one row per account: first/last time of every event, counts,
--                           last error, last session, version and a likely churn reason
--   retention_report_cache  the admin page's summary for 3/7/14/30 silent days
--
-- The rules - churn reason, furthest step, cohorts, funnel, friction ranking - are
-- specified in `packages/retention/src/rules.ts`; `packages/retention/test/sqlParity.test.ts`
-- runs this file in PGlite and fails if the two give different answers.
--
-- Summary-first, like the model reports (20261104170000_fast_model_reports.sql): the hourly
-- job folds only events it has not seen (a watermark on the event id) into the per-account
-- rows, then rebuilds the summaries from those rows. The page reads one cached row; the
-- churned list and a timeline are index lookups.

create table if not exists public.retention_events (
  id          bigint generated always as identity primary key,
  uid         text    not null,
  name        text    not null check (name ~ '^[a-z_]{1,32}$'),
  code        text    check (code is null or code ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  ms          integer check (ms is null or (ms >= 0 and ms <= 86400000)),
  at          bigint  not null,
  received_at bigint  not null
);
create index if not exists retention_events_uid_at_idx on public.retention_events (uid, at desc, id desc);
create index if not exists retention_events_received_idx on public.retention_events (received_at);

create table if not exists public.retention_daily (
  uid    text    not null,
  day    date    not null,
  events integer not null default 0 check (events >= 0),
  counts jsonb   not null default '{}'::jsonb,
  primary key (uid, day)
);
create index if not exists retention_daily_day_idx on public.retention_daily (day);

create table if not exists public.retention_users (
  uid               text    primary key,
  first_seen_at     bigint  not null,
  last_seen_at      bigint  not null,
  active_days       integer not null default 0,
  first             jsonb   not null default '{}'::jsonb,
  last              jsonb   not null default '{}'::jsonb,
  counts            jsonb   not null default '{}'::jsonb,
  last_error_name   text,
  last_error_code   text,
  last_error_at     bigint,
  last_session_code text,
  last_session_ms   integer,
  last_session_at   bigint,
  version           text,
  version_at        bigint,
  churn_reason      text    not null default 'faded',
  updated_at        bigint  not null
);
create index if not exists retention_users_last_seen_idx on public.retention_users (last_seen_at desc);
create index if not exists retention_users_reason_idx on public.retention_users (churn_reason, last_seen_at desc);

create table if not exists public.retention_rollup_state (
  id            boolean primary key default true check (id),
  last_event_id bigint  not null default 0,
  rolled_at     bigint
);
insert into public.retention_rollup_state (id) values (true) on conflict (id) do nothing;

create table if not exists public.retention_report_cache (
  silent_days integer primary key,
  built_at    bigint  not null,
  report      jsonb   not null
);

do $$
declare t text;
begin
  foreach t in array array['retention_events', 'retention_daily', 'retention_users', 'retention_rollup_state', 'retention_report_cache'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- One flush from one account, in the order the editor sent it (the id keeps that order,
-- which is how ties on `at` are broken later).
create or replace function public.record_retention_events(p_uid text, p_now bigint, p_items jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with ins as (
    insert into public.retention_events (uid, name, code, ms, at, received_at)
    select p_uid, t.item ->> 'name', nullif(t.item ->> 'code', ''), (t.item ->> 'ms')::integer, (t.item ->> 'at')::bigint, p_now
      from jsonb_array_elements(p_items) with ordinality as t(item, ord)
     order by t.ord
    returning 1
  )
  select count(*)::integer from ins;
$$;

-- jsonb maps of numbers, merged key by key.
create or replace function public.retention_jsonb_least(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.key, s.v), '{}'::jsonb)
    from (select e.key, min(e.value::bigint) as v
            from (select key, value from jsonb_each_text(coalesce(a, '{}'::jsonb))
                  union all select key, value from jsonb_each_text(coalesce(b, '{}'::jsonb))) e
           group by e.key) s;
$$;

create or replace function public.retention_jsonb_greatest(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.key, s.v), '{}'::jsonb)
    from (select e.key, max(e.value::bigint) as v
            from (select key, value from jsonb_each_text(coalesce(a, '{}'::jsonb))
                  union all select key, value from jsonb_each_text(coalesce(b, '{}'::jsonb))) e
           group by e.key) s;
$$;

create or replace function public.retention_jsonb_sum(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.key, s.v), '{}'::jsonb)
    from (select e.key, sum(e.value::bigint) as v
            from (select key, value from jsonb_each_text(coalesce(a, '{}'::jsonb))
                  union all select key, value from jsonb_each_text(coalesce(b, '{}'::jsonb))) e
           group by e.key) s;
$$;

-- `churnReason` in packages/retention/src/rules.ts. Same order, same windows.
create or replace function public.retention_churn_reason(
  p_first jsonb, p_last jsonb, p_last_seen bigint, p_active_days integer, p_session_code text, p_session_at bigint
) returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_session_code = 'unclean' and p_session_at >= p_last_seen - 86400000, false)
      or coalesce((p_last ->> 'crash')::bigint >= p_last_seen - 86400000, false)
      or coalesce((p_last ->> 'renderer_gone')::bigint >= p_last_seen - 86400000, false) then 'crashed'
    when coalesce((p_last ->> 'limit_reached')::bigint >= p_last_seen - 86400000, false) then 'hit_limit'
    when (p_first ? 'sign_in_needed' or p_first ? 'sign_in_failed') and not p_first ? 'signed_in' and not p_first ? 'ai_turn_ok' then 'sign_in_dead_end'
    when p_first ? 'no_api_key' and not p_first ? 'ai_turn_ok' then 'no_api_key'
    when (p_first ? 'turn_failed' or p_first ? 'cli_failed') and not p_first ? 'ai_turn_ok' then 'first_turn_failed'
    when coalesce((p_last ->> 'turn_failed')::bigint >= p_last_seen - 86400000, false)
      or coalesce((p_last ->> 'cli_failed')::bigint >= p_last_seen - 86400000, false) then 'ai_failing'
    when coalesce((p_last ->> 'update_failed')::bigint >= p_last_seen - 86400000, false) then 'update_failed'
    when coalesce((p_last ->> 'slow_first_answer')::bigint >= p_last_seen - 86400000, false) then 'slow_answers'
    when coalesce((p_last ->> 'turn_cancelled')::bigint >= p_last_seen - 86400000, false) then 'gave_up_waiting'
    when not p_first ? 'project_opened' then 'no_project'
    when not p_first ? 'ai_message' then 'no_ai_message'
    when not p_first ? 'edit_applied' and p_active_days <= 2 then 'no_edit'
    else 'faded'
  end;
$$;

-- `furthestStep`: the last funnel step reached, in funnel order.
create or replace function public.retention_furthest_step(p_first jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_first ? 'preview_opened' then 'preview_opened'
    when p_first ? 'edit_applied' then 'edit_applied'
    when p_first ? 'ai_turn_ok' then 'ai_turn_ok'
    when p_first ? 'ai_message' then 'ai_message'
    when p_first ? 'project_opened' then 'project_opened'
    when p_first ? 'signed_in' then 'signed_in'
    when p_first ? 'first_launch' then 'first_launch'
    else null
  end;
$$;

-- Folds up to p_batch unseen events into retention_daily and retention_users, and returns
-- how many it folded. Only events received five minutes or more ago: an identity value is
-- handed out before its insert commits, so the newest ids can still be filling in behind a
-- later one, and the watermark must not jump past them.
create or replace function public.retention_rollup(p_now bigint, p_batch integer default 200000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from  bigint;
  v_to    bigint;
  v_stop  bigint;
  v_count integer;
begin
  select last_event_id into v_from from public.retention_rollup_state where id for update;
  select max(b.id) into v_to from (
    select e.id from public.retention_events e where e.id > v_from order by e.id limit p_batch
  ) b;
  if v_to is null then
    update public.retention_rollup_state set rolled_at = p_now where id;
    return 0;
  end if;
  select min(e.id) - 1 into v_stop from public.retention_events e
   where e.id > v_from and e.id <= v_to and e.received_at > p_now - 300000;
  if v_stop is not null then v_to := v_stop; end if;
  if v_to <= v_from then
    update public.retention_rollup_state set rolled_at = p_now where id;
    return 0;
  end if;

  -- Per account per UTC day.
  with b as (
    select e.uid, date '1970-01-01' + (e.at / 86400000)::integer as day, e.name, e.code
      from public.retention_events e where e.id > v_from and e.id <= v_to
  ),
  keys as (
    select uid, day, name as k from b
    union all
    select uid, day, name || ':' || code from b where code is not null
  ),
  per_day as (
    select uid, day, jsonb_object_agg(k, n) as counts
      from (select uid, day, k, count(*) as n from keys group by uid, day, k) x
     group by uid, day
  ),
  ev as (select uid, day, count(*)::integer as events from b group by uid, day)
  insert into public.retention_daily as d (uid, day, events, counts)
  select ev.uid, ev.day, ev.events, per_day.counts from ev join per_day using (uid, day)
  on conflict (uid, day) do update set
    events = d.events + excluded.events,
    counts = public.retention_jsonb_sum(d.counts, excluded.counts);

  -- Per account.
  with b as (
    select e.id, e.uid, e.name, e.code, e.ms, e.at
      from public.retention_events e where e.id > v_from and e.id <= v_to
  ),
  span as (select uid, min(at) as first_seen, max(at) as last_seen, count(*)::integer as n from b group by uid),
  times as (
    select uid, jsonb_object_agg(name, f) as first, jsonb_object_agg(name, l) as last
      from (select uid, name, min(at) as f, max(at) as l from b group by uid, name) x
     group by uid
  ),
  cnt as (
    select uid, jsonb_object_agg(k, n) as counts
      from (select uid, k, count(*) as n
              from (select uid, name as k from b union all select uid, name || ':' || code from b where code is not null) y
             group by uid, k) x
     group by uid
  ),
  err as (
    select distinct on (uid) uid, name, code, at from b
     where name in ('turn_failed', 'cli_failed', 'no_api_key', 'sign_in_failed', 'crash', 'renderer_gone', 'update_failed')
     order by uid, at desc, id desc
  ),
  sess as (select distinct on (uid) uid, code, ms, at from b where name = 'session_end' order by uid, at desc, id desc),
  ver as (select distinct on (uid) uid, code, at from b where name = 'session_start' order by uid, at desc, id desc)
  insert into public.retention_users as u (
    uid, first_seen_at, last_seen_at, active_days, first, last, counts,
    last_error_name, last_error_code, last_error_at, last_session_code, last_session_ms, last_session_at,
    version, version_at, churn_reason, updated_at
  )
  select span.uid, span.first_seen, span.last_seen, 0, times.first, times.last, cnt.counts,
         err.name, err.code, err.at, sess.code, sess.ms, sess.at, ver.code, ver.at, 'faded', p_now
    from span
    join times using (uid)
    join cnt using (uid)
    left join err using (uid)
    left join sess using (uid)
    left join ver using (uid)
  on conflict (uid) do update set
    first_seen_at = least(u.first_seen_at, excluded.first_seen_at),
    last_seen_at  = greatest(u.last_seen_at, excluded.last_seen_at),
    first  = public.retention_jsonb_least(u.first, excluded.first),
    last   = public.retention_jsonb_greatest(u.last, excluded.last),
    counts = public.retention_jsonb_sum(u.counts, excluded.counts),
    last_error_name = case when excluded.last_error_at is not null and (u.last_error_at is null or excluded.last_error_at >= u.last_error_at) then excluded.last_error_name else u.last_error_name end,
    last_error_code = case when excluded.last_error_at is not null and (u.last_error_at is null or excluded.last_error_at >= u.last_error_at) then excluded.last_error_code else u.last_error_code end,
    last_error_at   = case when excluded.last_error_at is not null and (u.last_error_at is null or excluded.last_error_at >= u.last_error_at) then excluded.last_error_at else u.last_error_at end,
    last_session_code = case when excluded.last_session_at is not null and (u.last_session_at is null or excluded.last_session_at >= u.last_session_at) then excluded.last_session_code else u.last_session_code end,
    last_session_ms   = case when excluded.last_session_at is not null and (u.last_session_at is null or excluded.last_session_at >= u.last_session_at) then excluded.last_session_ms else u.last_session_ms end,
    last_session_at   = case when excluded.last_session_at is not null and (u.last_session_at is null or excluded.last_session_at >= u.last_session_at) then excluded.last_session_at else u.last_session_at end,
    version    = case when excluded.version_at is not null and (u.version_at is null or excluded.version_at >= u.version_at) then excluded.version else u.version end,
    version_at = case when excluded.version_at is not null and (u.version_at is null or excluded.version_at >= u.version_at) then excluded.version_at else u.version_at end,
    updated_at = p_now;

  -- Active days and the likely reason, for the accounts this batch touched.
  update public.retention_users u set
    active_days  = d.n,
    churn_reason = public.retention_churn_reason(u.first, u.last, u.last_seen_at, d.n, u.last_session_code, u.last_session_at)
    from (select r.uid, count(*)::integer as n from public.retention_daily r
           where r.uid in (select distinct e.uid from public.retention_events e where e.id > v_from and e.id <= v_to)
           group by r.uid) d
   where u.uid = d.uid;

  select count(*)::integer into v_count from public.retention_events e where e.id > v_from and e.id <= v_to;
  update public.retention_rollup_state set last_event_id = v_to, rolled_at = p_now where id;
  return v_count;
end;
$$;

-- `summarize` in packages/retention/src/rules.ts, from the per-account rows.
create or replace function public.retention_build_summary(p_now bigint, p_silent integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  k as (select 86400000::bigint as d, p_now / 86400000 as now_day),
  pool as (select u.* from public.retention_users u, k where u.last_seen_at >= p_now - 90 * k.d),
  churned as (select p.* from pool p, k where p_now - p.last_seen_at >= p_silent * k.d),
  inst as (
    select u.uid, u.first, u.last_seen_at,
           (u.first ->> 'first_launch')::bigint as launched_at,
           (u.first ->> 'first_launch')::bigint / 86400000 as first_day,
           u.last_seen_at / 86400000 as last_day
      from public.retention_users u where u.first ? 'first_launch'
  ),
  weeks as (
    select g as idx, (k.now_day - (k.now_day + 3) % 7) - (11 - g) * 7 as week
      from generate_series(0, 11) as g, k
  ),
  cohorts as (
    select w.idx, jsonb_build_object(
      'weekStart', to_char(date '1970-01-01' + w.week::integer, 'YYYY-MM-DD'),
      'users', count(i.uid),
      'd1',  jsonb_build_object('eligible', count(i.uid) filter (where k.now_day - i.first_day >= 1),
                                'retained', count(i.uid) filter (where k.now_day - i.first_day >= 1 and i.last_day - i.first_day >= 1)),
      'd7',  jsonb_build_object('eligible', count(i.uid) filter (where k.now_day - i.first_day >= 7),
                                'retained', count(i.uid) filter (where k.now_day - i.first_day >= 7 and i.last_day - i.first_day >= 7)),
      'd30', jsonb_build_object('eligible', count(i.uid) filter (where k.now_day - i.first_day >= 30),
                                'retained', count(i.uid) filter (where k.now_day - i.first_day >= 30 and i.last_day - i.first_day >= 30))
    ) as row
      from weeks w cross join k
      left join inst i on i.first_day - (i.first_day + 3) % 7 = w.week
     group by w.idx, w.week
  ),
  recent_inst as (select i.* from inst i, k where i.launched_at >= p_now - 90 * k.d),
  steps as (
    select s.step, s.ord, (select count(*) from recent_inst r where r.first ? s.step) as users
      from unnest(array['first_launch', 'signed_in', 'project_opened', 'ai_message', 'ai_turn_ok', 'edit_applied', 'preview_opened']) with ordinality as s(step, ord)
    union all
    select 'returned_day1', 8, (select count(*) from recent_inst r where r.last_day - r.first_day >= 1)
    union all
    select 'returned_day7', 9, (select count(*) from recent_inst r where r.last_day - r.first_day >= 7)
  ),
  reasons as (
    select r.reason, r.ord, (select count(*) from churned c where c.churn_reason = r.reason) as users
      from unnest(array['crashed', 'hit_limit', 'sign_in_dead_end', 'no_api_key', 'first_turn_failed', 'ai_failing',
                        'update_failed', 'slow_answers', 'gave_up_waiting', 'no_project', 'no_ai_message', 'no_edit', 'faded'])
           with ordinality as r(reason, ord)
  ),
  friction as (
    select f.name, f.ord,
           (select count(*) from churned c where coalesce((c.counts ->> f.name)::bigint, 0) > 0) as churned,
           (select count(*) from pool p where coalesce((p.counts ->> f.name)::bigint, 0) > 0) as users,
           (select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'churned', t.n) order by t.n desc, t.code collate "C"), '[]'::jsonb)
              from (select substr(e.key, length(f.name) + 2) as code, count(*) as n
                      from churned c, jsonb_each_text(c.counts) e
                     where starts_with(e.key, f.name || ':') and e.value::bigint > 0
                     group by 1
                     order by count(*) desc, substr(e.key, length(f.name) + 2) collate "C"
                     limit 3) t) as top_codes
      from unnest(array['turn_failed', 'cli_failed', 'limit_reached', 'no_api_key', 'sign_in_needed', 'sign_in_failed',
                        'slow_first_answer', 'turn_cancelled', 'crash', 'renderer_gone', 'update_failed'])
           with ordinality as f(name, ord)
  )
  select jsonb_build_object(
    'silentDays', p_silent,
    'totals', jsonb_build_object(
      'users',       (select count(*) from pool),
      'newInstalls', (select count(*) from pool where first ? 'first_launch'),
      'active1d',    (select count(*) from public.retention_users, k where last_seen_at > p_now - k.d),
      'active7d',    (select count(*) from public.retention_users, k where last_seen_at > p_now - 7 * k.d),
      'active30d',   (select count(*) from public.retention_users, k where last_seen_at > p_now - 30 * k.d),
      'churned',     (select count(*) from churned)
    ),
    'cohorts', (select jsonb_agg(row order by idx) from cohorts),
    'funnel', jsonb_build_object(
      'base',  (select count(*) from recent_inst),
      'steps', (select jsonb_agg(jsonb_build_object('step', step, 'users', users) order by ord) from steps)
    ),
    'reasons', (select jsonb_agg(jsonb_build_object('reason', reason, 'users', users) order by users desc, ord) from reasons),
    'friction', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'churned', churned, 'users', users, 'topCodes', top_codes)
                                           order by churned desc, users desc, ord), '[]'::jsonb)
                   from friction where users > 0)
  );
$$;

-- The hourly job: fold new events, drop what is past its keeping time, rebuild summaries.
create or replace function public.refresh_retention(p_now bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now    bigint := coalesce(p_now, (extract(epoch from now()) * 1000)::bigint);
  v_rolled integer := 0;
  v_step   integer;
  v_days   integer;
begin
  loop
    v_step := public.retention_rollup(v_now);
    v_rolled := v_rolled + v_step;
    exit when v_step = 0;
  end loop;
  -- Raw events: 90 days at most. Daily rows: about thirteen months, for year-on-year cohorts.
  delete from public.retention_events where received_at < v_now - 90 * 86400000::bigint;
  delete from public.retention_daily where day < date '1970-01-01' + ((v_now / 86400000) - 400)::integer;
  foreach v_days in array array[3, 7, 14, 30] loop
    insert into public.retention_report_cache (silent_days, built_at, report)
    values (v_days, v_now, public.retention_build_summary(v_now, v_days))
    on conflict (silent_days) do update set built_at = excluded.built_at, report = excluded.report;
  end loop;
  return jsonb_build_object('rolled', v_rolled, 'builtAt', v_now);
end;
$$;

create or replace function public.read_retention_summary(p_silent integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select c.report || jsonb_build_object('builtAt', c.built_at)
    from public.retention_report_cache c where c.silent_days = p_silent;
$$;

-- One account as the admin page shows it.
create or replace function public.retention_user_json(u public.retention_users)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'uid', u.uid,
    'firstSeenAt', u.first_seen_at,
    'lastSeenAt', u.last_seen_at,
    'activeDays', u.active_days,
    'newInstall', u.first ? 'first_launch',
    'furthestStep', public.retention_furthest_step(u.first),
    'reason', u.churn_reason,
    'lastError', case when u.last_error_at is null then null else jsonb_build_object('name', u.last_error_name, 'code', u.last_error_code, 'at', u.last_error_at) end,
    'lastSession', case when u.last_session_at is null then null else jsonb_build_object('code', u.last_session_code, 'ms', u.last_session_ms, 'at', u.last_session_at) end,
    'version', u.version
  );
$$;

-- Churned accounts, most recently lost first: silent p_silent days, seen in the last 90.
create or replace function public.read_retention_churned(p_now bigint, p_silent integer, p_reason text, p_offset integer, p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select u.* from public.retention_users u
     where u.last_seen_at >= p_now - 90 * 86400000::bigint
       and u.last_seen_at <= p_now - p_silent * 86400000::bigint
       and (p_reason is null or u.churn_reason = p_reason)
  )
  select jsonb_build_object(
    'total', (select count(*) from c),
    'users', coalesce((select jsonb_agg(public.retention_user_json(x) order by x.last_seen_at desc, x.uid)
                         from (select * from c order by last_seen_at desc, uid offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 200)) x), '[]'::jsonb)
  );
$$;

-- One account's timeline: its row, up to 90 days of daily counts and its last 500 events.
create or replace function public.read_retention_user(p_uid text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user', (select public.retention_user_json(u) || jsonb_build_object('counts', u.counts) from public.retention_users u where u.uid = p_uid),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'events', d.events, 'counts', d.counts) order by d.day desc)
                         from (select * from public.retention_daily where uid = p_uid order by day desc limit 90) d), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('name', e.name, 'code', e.code, 'ms', e.ms, 'at', e.at) order by e.at desc, e.id desc)
                          from (select * from public.retention_events where uid = p_uid order by at desc, id desc limit 500) e), '[]'::jsonb)
  );
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.record_retention_events(text, bigint, jsonb)',
    'public.retention_rollup(bigint, integer)',
    'public.retention_build_summary(bigint, integer)',
    'public.refresh_retention(bigint)',
    'public.read_retention_summary(integer)',
    'public.read_retention_churned(bigint, integer, text, integer, integer)',
    'public.read_retention_user(text)',
    'public.retention_jsonb_least(jsonb, jsonb)',
    'public.retention_jsonb_greatest(jsonb, jsonb)',
    'public.retention_jsonb_sum(jsonb, jsonb)',
    'public.retention_churn_reason(jsonb, jsonb, bigint, integer, text, bigint)',
    'public.retention_furthest_step(jsonb)',
    'public.retention_user_json(public.retention_users)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- pg_cron is already enabled (20260913090100_website_analytics_retention.sql).
select cron.unschedule(jobid) from cron.job where jobname = 'retention-rollup';
select cron.schedule('retention-rollup', '17 * * * *', $job$set statement_timeout = '30min'; select public.refresh_retention()$job$);
