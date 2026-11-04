-- Increase AI allowances once. Prices, usage history and model context limits stay intact.
begin;
set local lock_timeout = '5s';

create function pg_temp.increase_ai_limits(value jsonb) returns jsonb language sql as $$
  select value || jsonb_build_object(
    'dailyTokens', least(1000000000, ceil((value->>'dailyTokens')::numeric * 1.1)),
    'dailyCostMicros', least(1000000000, ceil((value->>'dailyCostMicros')::numeric * 1.1)),
    'dailyRequests', least(1000000, ceil((value->>'dailyRequests')::numeric * 1.1)),
    'requestsPerMinute', least(1000, ceil((value->>'requestsPerMinute')::numeric * 1.1)))
$$;
create function pg_temp.increase_ai_credits(value jsonb) returns jsonb language sql as $$
  select value || jsonb_build_object(
    'sessionCredits', least(10000000, ceil((value->>'sessionCredits')::numeric * 1.1)),
    'weeklyCredits', least(10000000, ceil((value->>'weeklyCredits')::numeric * 1.1)))
$$;

update public.tagflow_config set config = jsonb_set(config, '{limits}', pg_temp.increase_ai_limits(config->'limits'));
update public.tagflow_config set config = jsonb_set(config, '{credits}', pg_temp.increase_ai_credits(config->'credits'))
  where jsonb_typeof(config->'credits') = 'object';
update public.tagflow_config set config = jsonb_set(config, '{providers}', (
  select jsonb_agg(case when jsonb_typeof(p->'limits') = 'object' then jsonb_set(p, '{limits}', pg_temp.increase_ai_limits(p->'limits')) else p end order by ordinal)
  from jsonb_array_elements(config->'providers') with ordinality as providers(p, ordinal)))
  where jsonb_array_length(config->'providers') > 0;
update public.tagflow_config set config = jsonb_set(config, '{paid}', (config->'paid') || jsonb_build_object(
  'freeWeeklyTokens', least(10000000000, ceil((config #>> '{paid,freeWeeklyTokens}')::numeric * 1.1)),
  'packs', (select jsonb_agg(p || jsonb_build_object('tokens', least(10000000000, ceil((p->>'tokens')::numeric * 1.1))) order by ordinal)
    from jsonb_array_elements(config #> '{paid,packs}') with ordinality as packs(p, ordinal))))
  where jsonb_typeof(config->'paid') = 'object';
update public.tagflow_config set updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint,
  updated_by = 'allowance-increase-2026-10-29';

update public.tagflow_user_policies set policy = jsonb_set(policy, '{limits}', pg_temp.increase_ai_limits(policy->'limits'))
  where jsonb_typeof(policy->'limits') = 'object';
update public.tagflow_user_policies set policy = jsonb_set(policy, '{credits}', pg_temp.increase_ai_credits(policy->'credits'))
  where jsonb_typeof(policy->'credits') = 'object';
update public.ai_boosts set weekly_tokens = least(10000000000, ceil(weekly_tokens::numeric * 1.1))
  where ends_at > (extract(epoch from clock_timestamp()) * 1000)::bigint;
update public.ai_promo_codes set tokens = least(10000000000, ceil(tokens::numeric * 1.1))
  where kind = 'tokens' and expires_at > (extract(epoch from clock_timestamp()) * 1000)::bigint;

-- Match the server's new invite allowance while keeping payment and gift ledgers intact.
do $$ declare definition text; begin
  select pg_get_functiondef(oid) into definition from pg_proc where pronamespace = 'public'::regnamespace and proname = 'apply_ai_subscription_event_v2';
  execute replace(definition, ', 4000000,', ', 4400000,');
end $$;
commit;
