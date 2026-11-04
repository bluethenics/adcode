-- Provider reports that finish. read_ai_model_reports_v2 built every model's full report in one
-- statement: it copied 60 days of whole rows, re-scanned that copy about eight times per model,
-- then ran two more per-model functions that each copied the rows again, and an audience query
-- that multiplied every row by seven before counting distinct users. At 825,000 requests (one
-- model alone has 391,000) it hit the statement timeout, so the admin page never loaded.
--
-- Now the page asks for a one-pass summary of every model, and the full report of one model at
-- a time. The single-model report reads the columns it needs once, computes both periods in the
-- same pass, and groups the audience with grouping sets. Same JSON shape as v2's models, so the
-- page and the downloads are unchanged. The old functions stay for older API builds.
begin;
set local lock_timeout = '5s';

create or replace function public.read_ai_model_report_summary(p_from bigint, p_to bigint)
returns jsonb language sql stable set search_path to 'public' as $summary$
with m as (
  select provider, model_id, upstream_model, (array_agg(model_name order by started_at desc))[1] as model_name,
    count(*) as attempts, count(*) filter (where provider_started_at is not null) as provider_calls,
    count(*) filter (where outcome = 'success') as successes, count(*) filter (where outcome = 'provider_error') as provider_errors,
    count(*) filter (where outcome = 'rejected') as rejected, count(distinct uid) as users,
    coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens
  from public.ai_model_requests
  where source <> 'admin-test' and started_at >= p_from and started_at < p_to
  group by provider, model_id, upstream_model
), f as (
  select q.provider, q.model_id, q.upstream_model,
    count(*) filter (where f.rating = 'helpful') as helpful, count(*) filter (where f.rating = 'not-helpful') as not_helpful
  from public.ai_model_feedback f join public.ai_model_requests q on q.id = f.request_id
  where q.source <> 'admin-test' and f.created_at >= p_from and f.created_at < p_to
  group by q.provider, q.model_id, q.upstream_model
)
select jsonb_build_object(
  'collectionStartedAt', (select started_at from public.ai_model_report_collection where id = 1),
  'audienceStartedAt', (select audience_started_at from public.ai_model_report_collection where id = 1),
  'models', coalesce((select jsonb_agg(jsonb_build_object(
      'modelId', m.model_id, 'modelName', m.model_name, 'provider', m.provider, 'upstreamModel', m.upstream_model,
      'current', jsonb_build_object('attempts', m.attempts, 'providerCalls', m.provider_calls, 'successes', m.successes,
        'providerErrors', m.provider_errors, 'rejected', m.rejected, 'activeUsers', m.users,
        'inputTokens', m.input_tokens, 'outputTokens', m.output_tokens,
        'helpful', coalesce(f.helpful, 0), 'notHelpful', coalesce(f.not_helpful, 0))
    ) order by m.attempts desc)
    from m left join f using (provider, model_id, upstream_model)), '[]'::jsonb));
$summary$;

create or replace function public.read_ai_model_report_one(p_from bigint, p_to bigint, p_previous_from bigint, p_provider text, p_model text, p_upstream text)
returns jsonb language sql stable set search_path to 'public' as $one$
with r as materialized (
  select q.uid, q.started_at, q.outcome, q.provider_started_at, q.finished_at, q.input_tokens, q.output_tokens, q.cost_micros,
    q.estimated, q.tools_offered, q.tool_calls, q.streamed, q.finish_reason, q.duration_ms, q.first_token_ms,
    q.error_code, q.upstream_status, q.source, q.model_name, q.country, q.ai_persona, q.use_case, q.platform,
    coalesce(p.role, 'unknown') as role, coalesce(p.experience, 'unknown') as experience, coalesce(p.primary_use, 'unknown') as primary_use,
    case when q.started_at >= p_from then 'current' else 'previous' end as period
  from public.ai_model_requests q left join public.ai_model_audience_profiles p on p.uid = q.uid
  where q.provider = p_provider and q.model_id = p_model and q.upstream_model = p_upstream
    and q.source <> 'admin-test' and q.started_at >= p_previous_from and q.started_at < p_to
), fb as materialized (
  select f.uid, f.rating, f.category, f.comment, f.share_with_provider, f.created_at,
    case when f.created_at >= p_from then 'current' else 'previous' end as period
  from public.ai_model_feedback f join public.ai_model_requests q on q.id = f.request_id
  where q.provider = p_provider and q.model_id = p_model and q.upstream_model = p_upstream
    and q.source <> 'admin-test' and f.created_at >= p_previous_from and f.created_at < p_to
), periods(period, from_at, to_at) as (
  values ('current', p_from, p_to), ('previous', p_previous_from, p_from)
), first_seen as (
  -- A person is new if their first request to this model (ever) falls inside the period.
  select u.uid, (select min(x.started_at) from public.ai_model_requests x where x.provider = p_provider and x.model_id = p_model
    and x.upstream_model = p_upstream and x.uid = u.uid and x.source <> 'admin-test') as first_at
  from (select distinct uid from r) u
), user_counts as (
  select period, uid, count(*) as attempts from r group by period, uid
), users as (
  select uc.period, count(*) as active, count(*) filter (where uc.attempts >= 2) as repeat_users,
    count(*) filter (where fs.first_at >= pr.from_at) as new_users, count(*) filter (where fs.first_at < pr.from_at) as returning_users
  from user_counts uc join first_seen fs using (uid) join periods pr using (period) group by uc.period
), minutes as (
  select period, floor(provider_started_at / 60000.0) as minute, count(*) as requests, sum(input_tokens + output_tokens) as tokens
  from r where provider_started_at is not null group by 1, 2
), peaks as (
  select period, max(requests) as rpm, max(tokens) as tpm from minutes group by period
), intervals as (
  select r.period, r.provider_started_at as start_at, coalesce(r.finished_at, least(pr.to_at, r.provider_started_at + 180000)) as end_at
  from r join periods pr using (period) where r.provider_started_at is not null
), deltas as (
  select period, at, sum(delta) as delta from (
    select period, start_at as at, 1 as delta from intervals where end_at > start_at
    union all select period, end_at as at, -1 as delta from intervals where end_at > start_at
  ) events group by period, at
), concurrency as (
  select period, max(active) as peak from (select period, sum(delta) over (partition by period order by at) as active from deltas) c group by period
), tps as (
  select period, count(*) as samples, percentile_cont(0.5) within group (order by tps) as p50, percentile_cont(0.95) within group (order by tps) as p95
  from (select period, output_tokens * 1000.0 / (duration_ms - first_token_ms) as tps from r where outcome = 'success' and not estimated
    and output_tokens > 0 and first_token_ms is not null and duration_ms > first_token_ms) t group by period
), ratings as (
  select period, count(*) filter (where rating = 'helpful') as helpful, count(*) filter (where rating = 'not-helpful') as not_helpful,
    count(distinct uid) as users from fb group by period
), base as (
  select pr.period, count(r.uid) as attempts, count(r.provider_started_at) as provider_calls,
    count(*) filter (where r.outcome = 'success') as successes, count(*) filter (where r.outcome = 'provider_error') as provider_errors,
    count(*) filter (where r.outcome = 'relay_error') as relay_errors, count(*) filter (where r.outcome = 'rejected') as rejected,
    count(*) filter (where r.outcome = 'cancelled') as cancelled, count(*) filter (where r.outcome = 'pending') as unfinished,
    coalesce(sum(r.input_tokens), 0) as input_tokens, coalesce(sum(r.output_tokens), 0) as output_tokens, coalesce(sum(r.cost_micros), 0) as cost_micros,
    count(*) filter (where r.provider_started_at is not null and r.estimated and r.outcome <> 'pending') as estimated_requests,
    count(*) filter (where r.provider_started_at is not null and r.tools_offered) as tool_requests, coalesce(sum(r.tool_calls), 0) as tool_calls,
    count(*) filter (where r.provider_started_at is not null and r.streamed) as streamed_requests,
    count(*) filter (where r.outcome = 'success' and r.finish_reason = 'length') as output_limit_stops,
    count(*) filter (where r.outcome = 'success' and r.finish_reason = 'refusal') as refusals,
    count(*) filter (where r.outcome = 'success' and r.duration_ms is not null) as latency_samples,
    count(*) filter (where r.outcome = 'success' and r.first_token_ms is not null) as first_token_samples,
    percentile_cont(0.5) within group (order by r.duration_ms) filter (where r.outcome = 'success') as duration_p50,
    percentile_cont(0.95) within group (order by r.duration_ms) filter (where r.outcome = 'success') as duration_p95,
    percentile_cont(0.5) within group (order by r.first_token_ms) filter (where r.outcome = 'success') as first_token_p50,
    percentile_cont(0.95) within group (order by r.first_token_ms) filter (where r.outcome = 'success') as first_token_p95,
    percentile_cont(0.5) within group (order by r.input_tokens) filter (where r.outcome = 'success') as input_p50,
    percentile_cont(0.95) within group (order by r.input_tokens) filter (where r.outcome = 'success') as input_p95,
    percentile_cont(0.5) within group (order by r.output_tokens) filter (where r.outcome = 'success') as output_p50,
    percentile_cont(0.95) within group (order by r.output_tokens) filter (where r.outcome = 'success') as output_p95
  from periods pr left join r using (period) group by pr.period
), metrics as (
  select b.period, jsonb_build_object(
    'attempts', b.attempts, 'providerCalls', b.provider_calls, 'successes', b.successes, 'providerErrors', b.provider_errors,
    'relayErrors', b.relay_errors, 'rejected', b.rejected, 'cancelled', b.cancelled, 'unfinished', b.unfinished,
    'activeUsers', coalesce(u.active, 0), 'repeatUsers', coalesce(u.repeat_users, 0),
    'newUsers', coalesce(u.new_users, 0), 'returningUsers', coalesce(u.returning_users, 0),
    'inputTokens', b.input_tokens, 'outputTokens', b.output_tokens, 'costMicros', b.cost_micros,
    'estimatedRequests', b.estimated_requests, 'toolRequests', b.tool_requests, 'toolCalls', b.tool_calls,
    'streamedRequests', b.streamed_requests, 'outputLimitStops', b.output_limit_stops, 'refusals', b.refusals,
    'peakRpm', coalesce(pk.rpm, 0), 'peakTpm', coalesce(pk.tpm, 0), 'peakConcurrency', coalesce(c.peak, 0),
    'latencySamples', b.latency_samples, 'firstTokenSamples', b.first_token_samples, 'throughputSamples', coalesce(t.samples, 0),
    'durationP50', b.duration_p50, 'durationP95', b.duration_p95, 'firstTokenP50', b.first_token_p50, 'firstTokenP95', b.first_token_p95,
    'inputP50', b.input_p50, 'inputP95', b.input_p95, 'outputP50', b.output_p50, 'outputP95', b.output_p95,
    'outputTpsP50', t.p50, 'outputTpsP95', t.p95,
    'helpful', coalesce(rt.helpful, 0), 'notHelpful', coalesce(rt.not_helpful, 0), 'feedbackUsers', coalesce(rt.users, 0)
  ) as value
  from base b left join users u using (period) left join peaks pk using (period) left join concurrency c using (period)
    left join tps t using (period) left join ratings rt using (period)
), audience as (
  select case when grouping(country) = 0 then 'countries' when grouping(role) = 0 then 'userRoles'
      when grouping(experience) = 0 then 'experienceLevels' when grouping(ai_persona) = 0 then 'aiPersonas'
      when grouping(use_case) = 0 then 'useCases' when grouping(primary_use) = 0 then 'declaredUses' else 'platforms' end as dimension,
    coalesce(country, role, experience, ai_persona, use_case, primary_use, platform) as value,
    count(*) filter (where period = 'current') as requests, count(distinct uid) filter (where period = 'current') as users,
    count(*) filter (where period = 'current' and outcome = 'success') as successes,
    count(*) filter (where period = 'current' and outcome = 'provider_error') as errors,
    coalesce(sum(input_tokens) filter (where period = 'current'), 0) as input_tokens,
    coalesce(sum(output_tokens) filter (where period = 'current'), 0) as output_tokens,
    count(*) filter (where period = 'previous') as previous_requests, count(distinct uid) filter (where period = 'previous') as previous_users
  from r group by grouping sets ((country), (role), (experience), (ai_persona), (use_case), (primary_use), (platform))
), audience_json as (
  select dimension, jsonb_agg(jsonb_build_object('value', value, 'requests', requests, 'activeUsers', users, 'successes', successes,
    'providerErrors', errors, 'inputTokens', input_tokens, 'outputTokens', output_tokens,
    'previousRequests', previous_requests, 'previousActiveUsers', previous_users) order by requests desc, value) as segments
  from audience group by dimension
), current_rows as (
  select * from r where period = 'current'
), report as (
  select jsonb_build_object(
    'modelId', p_model, 'provider', p_provider, 'upstreamModel', p_upstream,
    'modelName', coalesce((select model_name from r order by started_at desc limit 1), p_model),
    'current', (select value from metrics where period = 'current'),
    'previous', (select value from metrics where period = 'previous'),
    'daily', coalesce((
      with days as (
        select to_char(day, 'YYYY-MM-DD') as day from generate_series(
          (to_timestamp(p_from / 1000.0) at time zone 'UTC')::date, (to_timestamp((p_to - 1) / 1000.0) at time zone 'UTC')::date, interval '1 day') day
      ), q as (
        select to_char(to_timestamp(started_at / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) as attempts,
          count(*) filter (where outcome = 'success') as successes, count(*) filter (where outcome = 'provider_error') as provider_errors,
          count(*) filter (where outcome = 'rejected') as rejected, count(distinct uid) as users,
          sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens
        from current_rows group by 1
      ), f as (
        select to_char(to_timestamp(created_at / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') as day,
          count(*) filter (where rating = 'helpful') as helpful, count(*) filter (where rating = 'not-helpful') as not_helpful
        from fb where period = 'current' group by 1
      )
      select jsonb_agg(jsonb_build_object('day', days.day, 'attempts', coalesce(q.attempts, 0), 'successes', coalesce(q.successes, 0),
        'providerErrors', coalesce(q.provider_errors, 0), 'rejected', coalesce(q.rejected, 0), 'activeUsers', coalesce(q.users, 0),
        'inputTokens', coalesce(q.input_tokens, 0), 'outputTokens', coalesce(q.output_tokens, 0),
        'helpful', coalesce(f.helpful, 0), 'notHelpful', coalesce(f.not_helpful, 0)) order by days.day)
      from days left join q using (day) left join f using (day)
    ), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(value order by occurrences desc) from (
      select count(*) as occurrences, jsonb_build_object('outcome', outcome, 'code', error_code, 'upstreamStatus', upstream_status,
        'count', count(*), 'firstAt', min(started_at), 'lastAt', max(started_at)) as value
      from current_rows where error_code is not null group by outcome, error_code, upstream_status
    ) e), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'requests', requests)) from (
      select source, count(*) as requests from current_rows group by source
    ) s), '[]'::jsonb),
    'hourly', coalesce((select jsonb_agg(jsonb_build_object('hour', hour, 'requests', requests) order by hour) from (
      select extract(hour from to_timestamp(provider_started_at / 1000.0) at time zone 'UTC')::integer as hour, count(*) as requests
      from current_rows where provider_started_at is not null group by 1
    ) h), '[]'::jsonb),
    'inputBands', coalesce((select jsonb_agg(jsonb_build_object('band', band, 'requests', requests)) from (
      select case when input_tokens < 8192 then '<8k' when input_tokens < 32768 then '8k–32k' when input_tokens < 65536 then '32k–64k'
        when input_tokens < 131072 then '64k–128k' when input_tokens < 262144 then '128k–256k' else '256k+' end as band, count(*) as requests
      from current_rows where outcome = 'success' group by 1
    ) b), '[]'::jsonb),
    'feedbackCategories', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'helpful', helpful, 'notHelpful', not_helpful)) from (
      select category, count(*) filter (where rating = 'helpful') as helpful, count(*) filter (where rating = 'not-helpful') as not_helpful
      from fb where period = 'current' group by category
    ) c), '[]'::jsonb),
    'sharedComments', coalesce((select jsonb_agg(jsonb_build_object('at', created_at, 'rating', rating, 'category', category, 'comment', comment) order by created_at desc) from (
      select * from fb where period = 'current' and share_with_provider and length(trim(comment)) > 0 order by created_at desc limit 50
    ) s), '[]'::jsonb),
    'sharedCommentCount', (select count(*) from fb where period = 'current' and share_with_provider and length(trim(comment)) > 0),
    'audience', coalesce((select jsonb_object_agg(dimension, segments) from audience_json), '{}'::jsonb)
  ) as value
)
select jsonb_build_object(
  'collectionStartedAt', (select started_at from public.ai_model_report_collection where id = 1),
  'audienceStartedAt', (select audience_started_at from public.ai_model_report_collection where id = 1),
  'models', case when exists (select 1 from r) or exists (select 1 from fb) then jsonb_build_array((select value from report)) else '[]'::jsonb end);
$one$;

-- Server only, like the reports they replace.
revoke all on function public.read_ai_model_report_summary(bigint, bigint) from public, anon, authenticated;
revoke all on function public.read_ai_model_report_one(bigint, bigint, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.read_ai_model_report_summary(bigint, bigint) to service_role;
grant execute on function public.read_ai_model_report_one(bigint, bigint, bigint, text, text, text) to service_role;
commit;

-- ── Applied as later steps on 2026-11-04 (fast_model_reports_memory, fast_model_reports_cache) ─
-- Even one pass is slow here: 600 MB of requests against 256 MB of shared buffers, so a busy
-- model's report takes 20-70 s depending on what is cached. Reports are therefore built ahead of
-- time by pg_cron every three hours (the summary for 7, 30 and 90 days, and every model for 30),
-- kept in ai_model_report_cache, and served from there. Other ranges are built on first request
-- and cached too. The page shows when its figures were built and can force a rebuild.
begin;
set local lock_timeout = '5s';
alter function public.read_ai_model_report_one(bigint, bigint, bigint, text, text, text) set work_mem = '128MB';

-- The latest name per model through the (provider, model_id, upstream_model, started_at) index,
-- instead of sorting every row in the range (26 s at 825k rows).
create or replace function public.read_ai_model_report_summary(p_from bigint, p_to bigint)
returns jsonb language sql stable set search_path to 'public' set work_mem to '128MB' as $summary$
with m as (
  select provider, model_id, upstream_model,
    count(*) as attempts, count(*) filter (where provider_started_at is not null) as provider_calls,
    count(*) filter (where outcome = 'success') as successes, count(*) filter (where outcome = 'provider_error') as provider_errors,
    count(*) filter (where outcome = 'rejected') as rejected, count(distinct uid) as users,
    coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens
  from public.ai_model_requests
  where source <> 'admin-test' and started_at >= p_from and started_at < p_to
  group by provider, model_id, upstream_model
), named as (
  select m.*, (select x.model_name from public.ai_model_requests x where x.provider = m.provider and x.model_id = m.model_id
    and x.upstream_model = m.upstream_model and x.started_at < p_to order by x.started_at desc limit 1) as model_name
  from m
), f as (
  select q.provider, q.model_id, q.upstream_model,
    count(*) filter (where f.rating = 'helpful') as helpful, count(*) filter (where f.rating = 'not-helpful') as not_helpful
  from public.ai_model_feedback f join public.ai_model_requests q on q.id = f.request_id
  where q.source <> 'admin-test' and f.created_at >= p_from and f.created_at < p_to
  group by q.provider, q.model_id, q.upstream_model
)
select jsonb_build_object(
  'collectionStartedAt', (select started_at from public.ai_model_report_collection where id = 1),
  'audienceStartedAt', (select audience_started_at from public.ai_model_report_collection where id = 1),
  'models', coalesce((select jsonb_agg(jsonb_build_object(
      'modelId', n.model_id, 'modelName', n.model_name, 'provider', n.provider, 'upstreamModel', n.upstream_model,
      'current', jsonb_build_object('attempts', n.attempts, 'providerCalls', n.provider_calls, 'successes', n.successes,
        'providerErrors', n.provider_errors, 'rejected', n.rejected, 'activeUsers', n.users,
        'inputTokens', n.input_tokens, 'outputTokens', n.output_tokens,
        'helpful', coalesce(f.helpful, 0), 'notHelpful', coalesce(f.not_helpful, 0))
    ) order by n.attempts desc)
    from named n left join f using (provider, model_id, upstream_model)), '[]'::jsonb));
$summary$;
revoke all on function public.read_ai_model_report_summary(bigint, bigint) from public, anon, authenticated;
grant execute on function public.read_ai_model_report_summary(bigint, bigint) to service_role;

create table if not exists public.ai_model_report_cache (
  key text primary key,
  report jsonb not null,
  built_at bigint not null,
  build_ms integer not null
);
alter table public.ai_model_report_cache enable row level security;
revoke all on table public.ai_model_report_cache from anon, authenticated;

-- Key by the page's own dates: a range ending today has a moving end time, so milliseconds
-- would never hit the cache twice.
create or replace function public.read_ai_model_report_cached(p_from text, p_to text, p_from_at bigint, p_to_at bigint, p_previous_from bigint,
  p_provider text default null, p_model text default null, p_upstream text default null, p_max_age_ms bigint default 10800000)
returns jsonb language plpgsql volatile set search_path to 'public' set work_mem to '128MB' as $cached$
declare
  k text := case when p_model is null then 'summary|' || p_from || '|' || p_to
    else 'model|' || p_provider || '|' || p_model || '|' || p_upstream || '|' || p_from || '|' || p_to end;
  hit record;
  started timestamptz := clock_timestamp();
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  result jsonb;
begin
  select report, built_at into hit from public.ai_model_report_cache where key = k;
  if found and now_ms - hit.built_at <= p_max_age_ms then return hit.report || jsonb_build_object('builtAt', hit.built_at); end if;
  result := case when p_model is null then public.read_ai_model_report_summary(p_from_at, p_to_at)
    else public.read_ai_model_report_one(p_from_at, p_to_at, p_previous_from, p_provider, p_model, p_upstream) end;
  insert into public.ai_model_report_cache(key, report, built_at, build_ms)
    values (k, result, now_ms, round(extract(epoch from clock_timestamp() - started) * 1000))
    on conflict (key) do update set report = excluded.report, built_at = excluded.built_at, build_ms = excluded.build_ms;
  return result || jsonb_build_object('builtAt', now_ms);
end
$cached$;

-- One piece per transaction, so a slow or failing model never holds back the others.
create or replace procedure public.refresh_ai_model_report_cache()
language plpgsql set search_path to 'public' as $refresh$
declare
  days integer;
  today date := (now() at time zone 'UTC')::date;
  first_day date;
  from_at bigint; to_at bigint; previous_from bigint;
  summary jsonb;
  model jsonb;
begin
  foreach days in array array[30, 7, 90] loop
    first_day := today - (days - 1);
    from_at := (extract(epoch from first_day::timestamp) * 1000)::bigint;
    to_at := least((extract(epoch from (today + 1)::timestamp) * 1000)::bigint, (extract(epoch from clock_timestamp()) * 1000)::bigint);
    previous_from := from_at - (to_at - from_at);
    summary := public.read_ai_model_report_cached(first_day::text, today::text, from_at, to_at, previous_from, null, null, null, 0);
    commit;
    if days = 30 then
      for model in select value from jsonb_array_elements(summary -> 'models') loop
        begin
          perform public.read_ai_model_report_cached(first_day::text, today::text, from_at, to_at, previous_from,
            model ->> 'provider', model ->> 'modelId', model ->> 'upstreamModel', 0);
        exception when others then
          raise warning 'model report % failed: %', model ->> 'modelId', sqlerrm;
        end;
        commit;
      end loop;
    end if;
  end loop;
  delete from public.ai_model_report_cache where built_at < (extract(epoch from now()) * 1000)::bigint - 8::bigint * 86400000;
  commit;
end
$refresh$;

revoke all on function public.read_ai_model_report_cached(text, text, bigint, bigint, bigint, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.read_ai_model_report_cached(text, text, bigint, bigint, bigint, text, text, text, bigint) to service_role;
revoke all on procedure public.refresh_ai_model_report_cache() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ai-model-report-cache';
select cron.schedule('ai-model-report-cache', '7 */3 * * *', $job$set statement_timeout = '45min'; call public.refresh_ai_model_report_cache()$job$);
commit;
