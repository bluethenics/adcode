-- Include content-free app experience events in the existing first-day admin funnel.
begin;
set local lock_timeout = '5s';
do $$
declare definition text; updated text;
begin
  select pg_get_functiondef(oid) into definition from pg_proc
    where pronamespace = 'public'::regnamespace and proname = 'growth_stats';
  if definition is null then raise exception 'growth_stats is missing'; end if;
  updated := replace(definition, '''turn_failed'', ''preview_opened''',
    '''turn_failed'', ''preview_opened'', ''discord_opened'', ''collab_opened'', ''collab_hosted'', ''collab_joined'', ''collab_failed'', ''ai_retry_wait'', ''ai_limit_wait'', ''ai_stream_interrupted'', ''ai_turn_cancelled''');
  if updated = definition then raise exception 'growth_stats event catalogue differs from expected source'; end if;
  execute updated;
end $$;
commit;
