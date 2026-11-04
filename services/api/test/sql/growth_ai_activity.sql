-- Run on a migrated database. All fixture rows are rolled back.
begin;
do $$
declare
  prefix text := 'growth-ai-regression-' || txid_current()::text;
  cutoff bigint := (extract(epoch from timestamp '2000-03-01 12:00:00') * 1000)::bigint;
  report jsonb;
  coverage jsonb;
begin
  insert into public.users (uid, status, created_at)
  select prefix || suffix, 'active', cutoff - 10 * 86400000::bigint
    from unnest(array['-ai', '-probe', '-rejected']) suffix;

  insert into public.ai_model_requests
    (id, uid, model_id, model_name, provider, upstream_model, started_at,
     provider_started_at, outcome, source, streamed, tools_offered,
     context_window, requested_output, estimated_input)
  select gen_random_uuid(), prefix || suffix, 'growth-test', 'Growth test', 'tagflow',
         'growth-test', cutoff - age_ms,
         case when result = 'rejected' then null else cutoff - age_ms end,
         result, origin, true, false, 131072, 1024, 100
    from (values
      ('-ai', 5 * 86400000::bigint, 'success', 'chat'),
      ('-ai', 3600000::bigint, 'success', 'chat'),
      ('-ai', 1800000::bigint, 'provider_error', 'agent'),
      ('-probe', 3600000::bigint, 'success', 'admin-test'),
      ('-rejected', 3600000::bigint, 'rejected', 'chat')
    ) fixtures(suffix, age_ms, result, origin);

  assert (select count(*) from public.growth_sightings() where uid = prefix || '-ai') = 3,
    'AI activity keeps the first and last call on each UTC day';
  assert not exists (select 1 from public.growth_sightings() where uid in (prefix || '-probe', prefix || '-rejected')),
    'admin probes and pre-provider rejections never create developer activity';

  report := public.growth_stats(cutoff);
  coverage := report->'measurement';
  assert (select (value->>'active')::int from jsonb_array_elements(report->'daily') where value->>'day' = '2000-03-01') = 1,
    'AI-only developer is active once on the UTC day';
  assert (select (value->>'returning')::int from jsonb_array_elements(report->'daily') where value->>'day' = '2000-03-01') = 1,
    'AI-only return is retained';
  assert (coverage->>'aiActive1d')::int = 1 and (coverage->>'aiOnlyActive1d')::int = 1,
    'coverage identifies the AI-only account';
  assert (coverage->>'aiRequests1d')::int = 3 and (coverage->>'aiSuccesses1d')::int = 1
     and (coverage->>'aiProviderErrors1d')::int = 1 and (coverage->>'aiRejected1d')::int = 1,
    'coverage includes rejected attempts, separates provider errors and excludes admin probes';
end;
$$;
rollback;
