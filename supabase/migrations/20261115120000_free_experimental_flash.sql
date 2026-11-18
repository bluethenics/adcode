-- Free experiment: DeepSeek V4.1 Flash Uncensored (the default included model) draws no credits
-- from anyone's daily allowance while its explicit zero credit rate is published.
--
-- The rate used to be ignored under cost-v1 accounting: the relay charged the provider's
-- input/output prices instead, so the default model spent a free account's whole day in a few
-- steps. The relay now treats an explicit zero rate as free (paidTokens.isFreeModel).
begin;
set local lock_timeout='5s';

update public.tagflow_config c
set config = jsonb_set(c.config, '{models}', (
      select jsonb_agg(
        case when m->>'id' = 'deepseek-v4.1-flash-unc' then m || '{"creditRate":0}'::jsonb else m end
        order by ord)
      from jsonb_array_elements(c.config->'models') with ordinality as offered(m, ord)
    )),
    updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint,
    updated_by = 'free-deepseek-flash-experiment-2026-11-15'
where c.id = 1
  and exists (
    select 1 from jsonb_array_elements(c.config->'models') as offered(m)
    where m->>'id' = 'deepseek-v4.1-flash-unc'
  );

commit;
