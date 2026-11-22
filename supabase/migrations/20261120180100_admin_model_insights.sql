-- Admin model insights: a daily rollup of ai_model_requests, kept fresh by pg_cron, and the
-- read functions behind Admin > Analytics (AI models) and Admin > ADCode models.
--
-- Why a rollup. ai_model_requests held 1.39M rows (1 GB) on 20 Nov 2026, about 45k a day with
-- peaks of 250k, against 256 MB of shared buffers. Reports built straight from it took 2-77 s
-- and once timed out at 825k rows (20261104170000_fast_model_reports.sql). Every figure the
-- Models page shows can be added up from one row per model per UTC day, except three:
--
--   * Users over a range are not the sum of daily users. ai_model_daily_users keeps one row per
--     model, day and account (39k rows for the first 41 days), so a distinct count over any range
--     is exact and cheap.
--   * Percentiles do not add up either. first_token_hist is a 64-bucket histogram of time to first
--     token (successful responses only, as in the provider reports): bucket 0 is under 50 ms and
--     bucket i covers [50 * 1.2^(i-1), 50 * 1.2^i) ms, so a median or p90 read back from merged
--     histograms is within 10% of the exact value.
--   * Error codes are their own small table, ai_model_daily_errors.
--
-- Revenue is what paid (wallet) models charged, from model_wallet_ledger usage rows, which name the
-- ADCode model id but not its provider. Included models are paid for by plans and have no per-model
-- revenue; the page says so instead of inventing an allocation.
--
-- Refreshed every 10 minutes for today and yesterday (requests finish after they start, so
-- yesterday's last outcomes land after midnight). The backfill at the end covers every day that
-- has requests. Admin tests (source = 'admin-test') are excluded everywhere, as in the reports.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20min';

create table if not exists public.ai_model_daily (
  day date not null,
  provider text not null,
  model_id text not null,
  upstream_model text not null,
  model_name text not null default '',
  requests bigint not null default 0,
  provider_calls bigint not null default 0,
  successes bigint not null default 0,
  provider_errors bigint not null default 0,
  relay_errors bigint not null default 0,
  rejected bigint not null default 0,
  cancelled bigint not null default 0,
  unfinished bigint not null default 0,
  users integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  -- Input tokens of the requests whose cached count was recorded: the denominator of the cached
  -- share, so rows from before cached_input_tokens existed do not read as "0% cached".
  cache_measured_input_tokens bigint not null default 0,
  cost_micros bigint not null default 0,
  estimated_requests bigint not null default 0,
  first_token_hist integer[] not null default '{}',
  built_at bigint not null,
  primary key (day, provider, model_id, upstream_model)
);

create table if not exists public.ai_model_daily_users (
  day date not null,
  provider text not null,
  model_id text not null,
  upstream_model text not null,
  uid text not null,
  requests integer not null,
  primary key (day, provider, model_id, upstream_model, uid)
);
create index if not exists ai_model_daily_users_model on public.ai_model_daily_users (provider, model_id, upstream_model, day);

create table if not exists public.ai_model_daily_errors (
  day date not null,
  provider text not null,
  model_id text not null,
  upstream_model text not null,
  outcome text not null,
  error_code text not null,
  -- -1 when no upstream response arrived.
  upstream_status integer not null,
  requests bigint not null,
  primary key (day, provider, model_id, upstream_model, outcome, error_code, upstream_status)
);

create table if not exists public.ai_model_daily_revenue (
  day date not null,
  model_id text not null,
  revenue_micros bigint not null,
  charges bigint not null,
  primary key (day, model_id)
);

create table if not exists public.ai_model_daily_state (
  id integer primary key check (id = 1),
  refreshed_at bigint not null,
  refresh_ms integer not null default 0
);

create index if not exists model_wallet_ledger_usage_time on public.model_wallet_ledger (created_at) where kind = 'usage';

do $rls$
declare t text;
begin
  foreach t in array array['ai_model_daily', 'ai_model_daily_users', 'ai_model_daily_errors', 'ai_model_daily_revenue', 'ai_model_daily_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    -- The API reads these and may ask for a rebuild of today (refresh_ai_model_daily_recent).
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end
$rls$;

-- The histogram bucket of one time-to-first-token sample (see the header).
create or replace function public.ai_first_token_bucket(p_ms bigint)
returns integer language sql immutable parallel safe set search_path to 'public' as $bucket$
  select case
    when p_ms is null then null
    when p_ms < 50 then 0
    else least(63, 1 + floor(ln(p_ms / 50.0) / ln(1.2))::integer)
  end
$bucket$;

-- Rebuilds one UTC day of the rollup. Idempotent; safe to run while requests arrive.
create or replace function public.refresh_ai_model_daily(p_day date)
returns integer language plpgsql set search_path to 'public' set work_mem to '128MB' as $refresh$
declare
  v_from bigint := (extract(epoch from (p_day::timestamp at time zone 'UTC')) * 1000)::bigint;
  v_to bigint := (extract(epoch from (p_day::timestamp at time zone 'UTC')) * 1000)::bigint + 86400000;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_rows integer;
begin
  -- Two refreshes of the same day (cron and an admin's "rebuild") wait for each other.
  perform pg_advisory_xact_lock(hashtext('ai_model_daily'), p_day - date '2000-01-01');

  delete from public.ai_model_daily where day = p_day;
  delete from public.ai_model_daily_users where day = p_day;
  delete from public.ai_model_daily_errors where day = p_day;
  delete from public.ai_model_daily_revenue where day = p_day;

  insert into public.ai_model_daily_users (day, provider, model_id, upstream_model, uid, requests)
  select p_day, provider, model_id, upstream_model, uid, count(*)
  from public.ai_model_requests
  where started_at >= v_from and started_at < v_to and source <> 'admin-test'
  group by provider, model_id, upstream_model, uid;

  insert into public.ai_model_daily_errors (day, provider, model_id, upstream_model, outcome, error_code, upstream_status, requests)
  select p_day, provider, model_id, upstream_model, outcome, error_code, coalesce(upstream_status, -1), count(*)
  from public.ai_model_requests
  where started_at >= v_from and started_at < v_to and source <> 'admin-test' and error_code is not null
  group by provider, model_id, upstream_model, outcome, error_code, coalesce(upstream_status, -1);

  with r as materialized (
    select provider, model_id, upstream_model, model_name, started_at, uid, outcome, provider_started_at,
      input_tokens, output_tokens, cached_input_tokens, cost_micros, estimated, first_token_ms
    from public.ai_model_requests
    where started_at >= v_from and started_at < v_to and source <> 'admin-test'
  ), h as (
    select provider, model_id, upstream_model, public.ai_first_token_bucket(first_token_ms) as b, count(*)::integer as c
    from r where outcome = 'success' and first_token_ms is not null
    group by 1, 2, 3, 4
  ), hk as (
    select distinct provider, model_id, upstream_model from h
  ), ha as (
    select hk.provider, hk.model_id, hk.upstream_model, array_agg(coalesce(h.c, 0) order by s.b) as hist
    from hk cross join generate_series(0, 63) as s(b)
    left join h on h.provider = hk.provider and h.model_id = hk.model_id and h.upstream_model = hk.upstream_model and h.b = s.b
    group by hk.provider, hk.model_id, hk.upstream_model
  ), m as (
    select provider, model_id, upstream_model,
      (array_agg(model_name order by started_at desc))[1] as model_name,
      count(*) as requests,
      count(*) filter (where provider_started_at is not null) as provider_calls,
      count(*) filter (where outcome = 'success') as successes,
      count(*) filter (where outcome = 'provider_error') as provider_errors,
      count(*) filter (where outcome = 'relay_error') as relay_errors,
      count(*) filter (where outcome = 'rejected') as rejected,
      count(*) filter (where outcome = 'cancelled') as cancelled,
      count(*) filter (where outcome = 'pending') as unfinished,
      count(distinct uid)::integer as users,
      coalesce(sum(input_tokens), 0) as input_tokens,
      coalesce(sum(output_tokens), 0) as output_tokens,
      coalesce(sum(cached_input_tokens), 0) as cached_input_tokens,
      coalesce(sum(input_tokens) filter (where cached_input_tokens is not null), 0) as cache_measured_input_tokens,
      coalesce(sum(cost_micros), 0) as cost_micros,
      count(*) filter (where estimated and outcome <> 'pending' and provider_started_at is not null) as estimated_requests
    from r
    group by provider, model_id, upstream_model
  )
  insert into public.ai_model_daily (day, provider, model_id, upstream_model, model_name, requests, provider_calls, successes,
    provider_errors, relay_errors, rejected, cancelled, unfinished, users, input_tokens, output_tokens, cached_input_tokens,
    cache_measured_input_tokens, cost_micros, estimated_requests, first_token_hist, built_at)
  select p_day, m.provider, m.model_id, m.upstream_model, m.model_name, m.requests, m.provider_calls, m.successes,
    m.provider_errors, m.relay_errors, m.rejected, m.cancelled, m.unfinished, m.users, m.input_tokens, m.output_tokens,
    m.cached_input_tokens, m.cache_measured_input_tokens, m.cost_micros, m.estimated_requests, coalesce(ha.hist, '{}'), v_now
  from m left join ha on ha.provider = m.provider and ha.model_id = m.model_id and ha.upstream_model = m.upstream_model;
  get diagnostics v_rows = row_count;

  insert into public.ai_model_daily_revenue (day, model_id, revenue_micros, charges)
  select p_day, model, -sum(delta_micros), count(*)
  from public.model_wallet_ledger
  where kind = 'usage' and model is not null and created_at >= v_from and created_at < v_to
  group by model
  having sum(delta_micros) <> 0;

  return v_rows;
end
$refresh$;

-- What pg_cron runs: today and yesterday, then the time it finished.
create or replace function public.refresh_ai_model_daily_recent()
returns void language plpgsql set search_path to 'public' as $recent$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_started timestamptz := clock_timestamp();
begin
  perform public.refresh_ai_model_daily(v_today - 1);
  perform public.refresh_ai_model_daily(v_today);
  insert into public.ai_model_daily_state (id, refreshed_at, refresh_ms)
  values (1, (extract(epoch from clock_timestamp()) * 1000)::bigint, (extract(epoch from clock_timestamp() - v_started) * 1000)::integer)
  on conflict (id) do update set refreshed_at = excluded.refreshed_at, refresh_ms = excluded.refresh_ms;
end
$recent$;

-- Every model's totals for a range of UTC days, and the same for the window of equal length just
-- before it. Days are inclusive. Reads only the rollup, so a 93-day range costs milliseconds.
create or replace function public.read_ai_model_insights(p_from date, p_to date)
returns jsonb language sql stable set search_path to 'public' as $insights$
with bounds as (
  select p_from as f, p_to as t, p_from - (p_to - p_from + 1) as pf, p_from - 1 as pt
), cur as (
  select d.* from public.ai_model_daily d, bounds b where d.day between b.f and b.t
), prev as (
  select d.* from public.ai_model_daily d, bounds b where d.day between b.pf and b.pt
), agg as (
  select provider, model_id, upstream_model,
    (array_agg(model_name order by day desc))[1] as model_name,
    sum(requests) as requests, sum(provider_calls) as provider_calls, sum(successes) as successes,
    sum(provider_errors) as provider_errors, sum(relay_errors) as relay_errors, sum(rejected) as rejected,
    sum(cancelled) as cancelled, sum(unfinished) as unfinished, sum(input_tokens) as input_tokens,
    sum(output_tokens) as output_tokens, sum(cached_input_tokens) as cached_input_tokens,
    sum(cache_measured_input_tokens) as cache_measured_input_tokens, sum(cost_micros) as cost_micros,
    sum(estimated_requests) as estimated_requests, min(day) as first_day, max(day) as last_day
  from cur group by provider, model_id, upstream_model
), pagg as (
  select provider, model_id, upstream_model, (array_agg(model_name order by day desc))[1] as model_name,
    sum(requests) as requests, sum(successes) as successes, sum(provider_errors) as provider_errors,
    sum(cancelled) as cancelled, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
    sum(cost_micros) as cost_micros
  from prev group by provider, model_id, upstream_model
), hist as (
  select c.provider, c.model_id, c.upstream_model, u.i, sum(u.v) as v
  from cur c cross join lateral unnest(c.first_token_hist) with ordinality as u(v, i)
  group by c.provider, c.model_id, c.upstream_model, u.i
), hist_arr as (
  select provider, model_id, upstream_model, array_agg(v order by i) as hist from hist group by provider, model_id, upstream_model
), cur_users as (
  select provider, model_id, upstream_model, count(distinct uid) as users
  from public.ai_model_daily_users u, bounds b where u.day between b.f and b.t
  group by provider, model_id, upstream_model
), prev_users as (
  select provider, model_id, upstream_model, count(distinct uid) as users
  from public.ai_model_daily_users u, bounds b where u.day between b.pf and b.pt
  group by provider, model_id, upstream_model
), keys as (
  select provider, model_id, upstream_model from agg union select provider, model_id, upstream_model from pagg
), ranked as (
  -- Wallet revenue names a model id only; it is credited to that id's busiest identity.
  select k.*, row_number() over (partition by k.model_id order by coalesce(a.requests, 0) desc, coalesce(p.requests, 0) desc, k.provider, k.upstream_model) as rn
  from keys k
  left join agg a on a.provider = k.provider and a.model_id = k.model_id and a.upstream_model = k.upstream_model
  left join pagg p on p.provider = k.provider and p.model_id = k.model_id and p.upstream_model = k.upstream_model
), rev as (
  select model_id, sum(revenue_micros) as revenue, sum(charges) as charges
  from public.ai_model_daily_revenue r, bounds b where r.day between b.f and b.t group by model_id
), prev_rev as (
  select model_id, sum(revenue_micros) as revenue
  from public.ai_model_daily_revenue r, bounds b where r.day between b.pf and b.pt group by model_id
), daily as (
  select day, sum(requests) as requests, sum(successes) as successes, sum(provider_errors) as provider_errors,
    sum(relay_errors) as relay_errors, sum(rejected) as rejected, sum(cancelled) as cancelled,
    sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
    sum(cached_input_tokens) as cached_input_tokens, sum(cache_measured_input_tokens) as cache_measured_input_tokens,
    sum(cost_micros) as cost_micros
  from cur group by day
), daily_users as (
  select day, count(distinct uid) as users from public.ai_model_daily_users u, bounds b where u.day between b.f and b.t group by day
), daily_rev as (
  select day, sum(revenue_micros) as revenue from public.ai_model_daily_revenue r, bounds b where r.day between b.f and b.t group by day
)
select jsonb_build_object(
  'refreshedAt', (select refreshed_at from public.ai_model_daily_state where id = 1),
  'coverageFrom', (select min(day) from public.ai_model_daily),
  'users', (select count(distinct uid) from public.ai_model_daily_users u, bounds b where u.day between b.f and b.t),
  'previousUsers', (select count(distinct uid) from public.ai_model_daily_users u, bounds b where u.day between b.pf and b.pt),
  'models', coalesce((select jsonb_agg(jsonb_build_object(
      'provider', k.provider, 'modelId', k.model_id, 'upstreamModel', k.upstream_model,
      'modelName', coalesce(a.model_name, p.model_name, k.model_id),
      'firstDay', a.first_day, 'lastDay', a.last_day,
      'current', jsonb_build_object(
        'requests', coalesce(a.requests, 0), 'providerCalls', coalesce(a.provider_calls, 0), 'successes', coalesce(a.successes, 0),
        'providerErrors', coalesce(a.provider_errors, 0), 'relayErrors', coalesce(a.relay_errors, 0), 'rejected', coalesce(a.rejected, 0),
        'cancelled', coalesce(a.cancelled, 0), 'unfinished', coalesce(a.unfinished, 0), 'users', coalesce(cu.users, 0),
        'inputTokens', coalesce(a.input_tokens, 0), 'outputTokens', coalesce(a.output_tokens, 0),
        'cachedInputTokens', coalesce(a.cached_input_tokens, 0), 'cacheMeasuredInputTokens', coalesce(a.cache_measured_input_tokens, 0),
        'costMicros', coalesce(a.cost_micros, 0), 'estimatedRequests', coalesce(a.estimated_requests, 0),
        'revenueMicros', case when k.rn = 1 then coalesce(rv.revenue, 0) else 0 end,
        'walletCharges', case when k.rn = 1 then coalesce(rv.charges, 0) else 0 end,
        'firstTokenHistogram', coalesce(to_jsonb(h.hist), '[]'::jsonb)),
      'previous', jsonb_build_object(
        'requests', coalesce(p.requests, 0), 'successes', coalesce(p.successes, 0), 'providerErrors', coalesce(p.provider_errors, 0),
        'cancelled', coalesce(p.cancelled, 0), 'users', coalesce(pu.users, 0), 'inputTokens', coalesce(p.input_tokens, 0),
        'outputTokens', coalesce(p.output_tokens, 0), 'costMicros', coalesce(p.cost_micros, 0),
        'revenueMicros', case when k.rn = 1 then coalesce(pr.revenue, 0) else 0 end)
    ) order by coalesce(a.requests, 0) desc, k.model_id)
    from ranked k
    left join agg a on a.provider = k.provider and a.model_id = k.model_id and a.upstream_model = k.upstream_model
    left join pagg p on p.provider = k.provider and p.model_id = k.model_id and p.upstream_model = k.upstream_model
    left join hist_arr h on h.provider = k.provider and h.model_id = k.model_id and h.upstream_model = k.upstream_model
    left join cur_users cu on cu.provider = k.provider and cu.model_id = k.model_id and cu.upstream_model = k.upstream_model
    left join prev_users pu on pu.provider = k.provider and pu.model_id = k.model_id and pu.upstream_model = k.upstream_model
    left join rev rv on rv.model_id = k.model_id
    left join prev_rev pr on pr.model_id = k.model_id), '[]'::jsonb),
  'daily', coalesce((select jsonb_agg(jsonb_build_object(
      'day', d.day, 'requests', d.requests, 'successes', d.successes, 'providerErrors', d.provider_errors,
      'relayErrors', d.relay_errors, 'rejected', d.rejected, 'cancelled', d.cancelled, 'users', coalesce(du.users, 0),
      'inputTokens', d.input_tokens, 'outputTokens', d.output_tokens, 'cachedInputTokens', d.cached_input_tokens,
      'cacheMeasuredInputTokens', d.cache_measured_input_tokens, 'costMicros', d.cost_micros,
      'revenueMicros', coalesce(dr.revenue, 0)) order by d.day)
    from daily d left join daily_users du on du.day = d.day left join daily_rev dr on dr.day = d.day), '[]'::jsonb)
);
$insights$;

-- One model: its day-by-day figures (each day with its own histogram, for a time-to-first-token
-- trend), its error codes, distinct users, and the previous window's totals.
create or replace function public.read_ai_model_insight(p_from date, p_to date, p_provider text, p_model text, p_upstream text)
returns jsonb language sql stable set search_path to 'public' as $one$
with bounds as (
  select p_from as f, p_to as t, p_from - (p_to - p_from + 1) as pf, p_from - 1 as pt
), d as (
  select x.* from public.ai_model_daily x, bounds b
  where x.provider = p_provider and x.model_id = p_model and x.upstream_model = p_upstream and x.day between b.pf and b.t
), rev as (
  select r.day, r.revenue_micros, r.charges from public.ai_model_daily_revenue r, bounds b where r.model_id = p_model and r.day between b.pf and b.t
), e as (
  select outcome, error_code, upstream_status, sum(requests) as requests, min(x.day) as first_day, max(x.day) as last_day
  from public.ai_model_daily_errors x, bounds b
  where x.provider = p_provider and x.model_id = p_model and x.upstream_model = p_upstream and x.day between b.f and b.t
  group by outcome, error_code, upstream_status
)
select jsonb_build_object(
  'refreshedAt', (select refreshed_at from public.ai_model_daily_state where id = 1),
  'coverageFrom', (select min(day) from public.ai_model_daily),
  'modelName', (select model_name from d order by day desc limit 1),
  'users', (select count(distinct uid) from public.ai_model_daily_users u, bounds b
    where u.provider = p_provider and u.model_id = p_model and u.upstream_model = p_upstream and u.day between b.f and b.t),
  'previousUsers', (select count(distinct uid) from public.ai_model_daily_users u, bounds b
    where u.provider = p_provider and u.model_id = p_model and u.upstream_model = p_upstream and u.day between b.pf and b.pt),
  'daily', coalesce((select jsonb_agg(jsonb_build_object(
      'day', d.day, 'requests', d.requests, 'providerCalls', d.provider_calls, 'successes', d.successes,
      'providerErrors', d.provider_errors, 'relayErrors', d.relay_errors, 'rejected', d.rejected, 'cancelled', d.cancelled,
      'unfinished', d.unfinished, 'users', d.users, 'inputTokens', d.input_tokens, 'outputTokens', d.output_tokens,
      'cachedInputTokens', d.cached_input_tokens, 'cacheMeasuredInputTokens', d.cache_measured_input_tokens,
      'costMicros', d.cost_micros, 'estimatedRequests', d.estimated_requests,
      'revenueMicros', coalesce(r.revenue_micros, 0), 'walletCharges', coalesce(r.charges, 0),
      'firstTokenHistogram', to_jsonb(d.first_token_hist)) order by d.day)
    from d cross join bounds b left join rev r on r.day = d.day where d.day between b.f and b.t), '[]'::jsonb),
  'previousDaily', coalesce((select jsonb_agg(jsonb_build_object(
      'day', d.day, 'requests', d.requests, 'successes', d.successes, 'providerErrors', d.provider_errors, 'cancelled', d.cancelled,
      'inputTokens', d.input_tokens, 'outputTokens', d.output_tokens, 'costMicros', d.cost_micros,
      'firstTokenHistogram', to_jsonb(d.first_token_hist)) order by d.day)
    from d, bounds b where d.day between b.pf and b.pt), '[]'::jsonb),
  'previousRevenueMicros', coalesce((select sum(r.revenue_micros) from rev r, bounds b where r.day between b.pf and b.pt), 0),
  'errors', coalesce((select jsonb_agg(jsonb_build_object(
      'outcome', e.outcome, 'code', e.error_code, 'upstreamStatus', case when e.upstream_status < 0 then null else e.upstream_status end,
      'requests', e.requests, 'firstDay', e.first_day, 'lastDay', e.last_day) order by e.requests desc, e.error_code)
    from (select * from e order by requests desc, error_code limit 25) e), '[]'::jsonb)
);
$one$;

-- Website analytics in one pass over the period's events, without the 20,000-event cap the old
-- report read had (56,212 events in the 30 days to 20 Nov 2026, so its 30- and 90-day figures
-- were partial). Same rules as summarizeWebsiteEvents in services/api/src/websiteAnalytics.ts;
-- rankings come back raw (top 500) because traffic sources are merged into channels in
-- TypeScript, by the same regular expressions that merge them everywhere else.
create or replace function public.read_website_analytics_summary(p_start bigint, p_end bigint)
returns jsonb language sql stable set search_path to 'public' set work_mem to '64MB' as $web$
with e as materialized (
  select session, name, path, source, campaign, device, value, coalesce(placement, '') as placement,
    coalesce(occurred_at, received_at) as at
  from public.website_events
  -- occurred_at is at most a day before received_at, so the index on received_at bounds the scan.
  where received_at >= p_start and received_at < p_end + 86400000
    and coalesce(occurred_at, received_at) >= p_start and coalesce(occurred_at, received_at) < p_end
), v as (
  select * from e where name = 'page_view'
), viewed as (
  select distinct session from v
), install_first as (
  select session, min(at) as t from e where name = 'page_view' group by session
), install_done as (
  select session, max(at) as t from e where name in ('install_copy', 'download_click') group by session
), adv_first as (
  select session, min(at) as t from e
  where name = 'advertise_click' or (name = 'page_view' and path in ('/portal', '/portal/campaigns/new')) group by session
), adv_done as (
  select session, max(at) as t from e where name = 'campaign_created' group by session
), pages_first as (
  select session, min(at) as t from e where name = 'page_view' and path in ('/versions', '/docs/installing-adcode') group by session
), ranked as (
  select 'pages' as k, path as label, count(*) as n from v group by path
  union all select 'sources', source, count(*) from v group by source
  union all select 'campaigns', campaign, count(*) from v group by campaign
  union all select 'devices', device, count(*) from v group by device
  union all select 'events', name, count(*) from e
    where name not in ('page_view', 'engagement', 'LCP', 'CLS', 'INP', 'FCP', 'TTFB') group by name
  union all select 'placements', placement, count(*) from e
    where name in ('download_click', 'install_copy', 'send_to_desktop') group by placement
  union all select 'invitePages', source, count(*) from v where path ~ '^/i/[^/]+/?$' group by source
), top as (
  select k, label, n, row_number() over (partition by k order by n desc, label) as rn from ranked
)
select jsonb_build_object(
  'totalEvents', (select count(*) from e),
  'pageViews', (select count(*) from v),
  'sessions', (select count(*) from viewed),
  'installSessions', (select count(distinct x.session) from e x join viewed using (session) where x.name in ('install_copy', 'download_click')),
  'errorCount', (select count(*) from e where name = 'js_error'),
  'engagementMs', (select coalesce(sum(value), 0) from e where name = 'engagement'),
  'daily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'views', views, 'sessions', sessions) order by day) from (
      select to_char(to_timestamp(at / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) as views, count(distinct session) as sessions
      from v group by 1) dd), '[]'::jsonb),
  'funnels', jsonb_build_object(
    'install', jsonb_build_array((select count(*) from install_first),
      (select count(*) from install_first f join install_done d using (session) where d.t >= f.t)),
    'advertiser', jsonb_build_array((select count(*) from adv_first),
      (select count(*) from adv_first f join adv_done d using (session) where d.t >= f.t)),
    'installPages', jsonb_build_array((select count(*) from pages_first),
      (select count(*) from pages_first f join install_done d using (session) where d.t >= f.t))),
  'rankings', coalesce((select jsonb_object_agg(k, items) from (
      select k, jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc, label) as items
      from top where rn <= 500 group by k) r), '{}'::jsonb),
  'metrics', (select jsonb_agg(jsonb_build_object('name', m.name, 'samples', coalesce(s.samples, 0), 'p75', s.p75) order by m.ord)
    from unnest(array['LCP', 'CLS', 'INP', 'FCP', 'TTFB']) with ordinality as m(name, ord)
    left join (select name, count(*) as samples, percentile_disc(0.75) within group (order by value) as p75
      from e where name in ('LCP', 'CLS', 'INP', 'FCP', 'TTFB') group by name) s on s.name = m.name)
);
$web$;

revoke all on function public.ai_first_token_bucket(bigint) from public, anon, authenticated;
revoke all on function public.refresh_ai_model_daily(date) from public, anon, authenticated;
revoke all on function public.refresh_ai_model_daily_recent() from public, anon, authenticated;
revoke all on function public.read_ai_model_insights(date, date) from public, anon, authenticated;
revoke all on function public.read_ai_model_insight(date, date, text, text, text) from public, anon, authenticated;
revoke all on function public.read_website_analytics_summary(bigint, bigint) from public, anon, authenticated;
grant execute on function public.ai_first_token_bucket(bigint) to service_role;
grant execute on function public.refresh_ai_model_daily(date) to service_role;
grant execute on function public.refresh_ai_model_daily_recent() to service_role;
grant execute on function public.read_ai_model_insights(date, date) to service_role;
grant execute on function public.read_ai_model_insight(date, date, text, text, text) to service_role;
grant execute on function public.read_website_analytics_summary(bigint, bigint) to service_role;

-- Backfill every day that has requests, then the state row.
do $backfill$
declare
  v_first date := (select (to_timestamp(min(started_at) / 1000.0) at time zone 'UTC')::date from public.ai_model_requests);
  v_day date;
begin
  if v_first is not null then
    for v_day in select generate_series(v_first, (now() at time zone 'UTC')::date, interval '1 day')::date loop
      perform public.refresh_ai_model_daily(v_day);
    end loop;
  end if;
end
$backfill$;
select public.refresh_ai_model_daily_recent();

select cron.unschedule(jobid) from cron.job where jobname = 'ai-model-daily';
select cron.schedule('ai-model-daily', '*/10 * * * *', $job$set statement_timeout = '5min'; select public.refresh_ai_model_daily_recent()$job$);
commit;
