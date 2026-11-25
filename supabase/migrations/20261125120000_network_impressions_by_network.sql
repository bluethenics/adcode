-- Partner cards from more than one network (services/api/src/networkImpressions.ts, 2026-11-25).
--
-- Imprezia fills sponsored cards beside Zeekend again, each slot going to one network by the
-- shares set in Admin > Ad networks. Its cards are counted here like Zeekend's, so the network
-- column takes any network id rather than only 'zeekend' - the next partner needs no migration -
-- and the summary adds each network's cards in the last day and week, which the admin's
-- traffic split shows beside the shares it set. Nothing here is money.

alter table public.network_impressions drop constraint if exists network_impressions_network_check;
alter table public.network_impressions add constraint network_impressions_network_check
  check (network ~ '^[a-z][a-z0-9-]{1,39}$');
create index if not exists network_impressions_network_at_idx on public.network_impressions (network, at_ms);

-- As before, plus 'byNetwork': { "<network>": { "last1d": n, "last7d": n } } for the last week.
create or replace function public.network_impression_summary(p_now bigint)
returns jsonb language sql stable set search_path = pg_catalog, public, pg_temp as $$
  with k as (select 86400000::bigint as d)
  select jsonb_build_object(
    'total',   (select count(*) from public.network_impressions),
    'last1d',  (select count(*) from public.network_impressions where at_ms > p_now - (select d from k)),
    'last7d',  (select count(*) from public.network_impressions where at_ms > p_now - 7 * (select d from k)),
    'last30d', (select count(*) from public.network_impressions where at_ms > p_now - 30 * (select d from k)),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'count', n) order by day)
      from (
        select to_char(to_timestamp(at_ms / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) as n
        from public.network_impressions
        where at_ms > p_now - 30 * (select d from k)
        group by 1
      ) per_day
    ), '[]'::jsonb),
    'byNetwork', coalesce((
      select jsonb_object_agg(network, jsonb_build_object('last1d', last1d, 'last7d', last7d))
      from (
        select network,
               count(*) filter (where at_ms > p_now - (select d from k)) as last1d,
               count(*) as last7d
        from public.network_impressions
        where at_ms > p_now - 7 * (select d from k)
        group by network
      ) per_network
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.network_impression_summary(bigint) from public, anon, authenticated;
grant execute on function public.network_impression_summary(bigint) to service_role;
