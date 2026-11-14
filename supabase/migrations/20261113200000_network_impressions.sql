-- Zeekend cards counted in the admin's "Ads shown" (services/api/src/networkImpressions.ts).
--
-- The sponsored page reports each Zeekend impression when Zeekend counts it. One row per
-- slot: Zeekend bills a slot's impression once, so a slot reported twice counts once. Only the
-- API (service role) reads or writes; nothing here is money.

create table public.network_impressions (
  slot_id text primary key check (slot_id ~ '^slot_[A-Za-z0-9_-]{4,64}$'),
  network text not null check (network in ('zeekend')),
  layout text not null check (layout in ('reply', 'notification', 'banner')),
  at_ms bigint not null
);
create index network_impressions_at_idx on public.network_impressions (at_ms);

create function public.record_network_impression(p_slot_id text, p_network text, p_layout text, p_at bigint)
returns boolean language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  inserted integer;
begin
  insert into public.network_impressions (slot_id, network, layout, at_ms)
  values (p_slot_id, p_network, p_layout, p_at)
  on conflict (slot_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;

-- Totals, and per UTC day for the last 30 days, as the admin's growth series lays them out.
create function public.network_impression_summary(p_now bigint)
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
    ), '[]'::jsonb)
  );
$$;

alter table public.network_impressions enable row level security;
revoke all on public.network_impressions from public, anon, authenticated;
grant select, insert, update, delete on public.network_impressions to service_role;
revoke all on function public.record_network_impression(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_network_impression(text, text, text, bigint) to service_role;
revoke all on function public.network_impression_summary(bigint) from public, anon, authenticated;
grant execute on function public.network_impression_summary(bigint) to service_role;
