begin;
set local lock_timeout = '5s';

create table public.ad_network_settings (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,39}$'),
  config jsonb not null check (config->>'id' = id),
  updated_by text not null,
  updated_at bigint not null
);
create table public.ad_network_credentials (
  id text primary key references public.ad_network_settings(id),
  encrypted_key jsonb not null check (encrypted_key->>'version' = '1')
);
create table public.ad_network_deliveries (
  id text primary key,
  network_id text not null references public.ad_network_settings(id),
  uid text not null references public.users(uid),
  creative_id text not null unique,
  provider_creative_id text not null,
  served_at bigint not null,
  expires_at bigint not null check (expires_at > served_at),
  view_payout_micros bigint not null check (view_payout_micros between 0 and 10000000),
  click_payout_micros bigint not null check (click_payout_micros between 0 and 10000000),
  logo_light_url text not null,
  logo_dark_url text not null
);
create index ad_network_deliveries_uid_creative on public.ad_network_deliveries(uid, creative_id);
create table public.ad_network_events (
  delivery_id text not null references public.ad_network_deliveries(id),
  event text not null check (event in ('impression','click')),
  network_id text not null references public.ad_network_settings(id),
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  created_at bigint not null,
  primary key (delivery_id,event),
  unique (network_id,provider_event_id)
);

-- The caller has already confirmed the event through the provider's authenticated endpoint.
-- Only the service role may call this. A client never chooses an amount, recipient or ledger entry.
create function public.settle_ad_network_event(p_delivery text,p_event text,p_provider_event text,p_now bigint)
returns boolean language plpgsql set search_path = pg_catalog,public,pg_temp as $$
declare d public.ad_network_deliveries; amount bigint; inserted integer;
begin
  if p_event not in ('impression','click') or length(p_provider_event) not between 1 and 200 then return false; end if;
  select * into d from public.ad_network_deliveries where id=p_delivery for update;
  if not found then return false; end if;
  insert into public.ad_network_events(delivery_id,event,network_id,provider_event_id,created_at)
  values(d.id,p_event,d.network_id,p_provider_event,p_now) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then return false; end if;
  amount:=case when p_event='click' then d.click_payout_micros else d.view_payout_micros end;
  perform public.append_entry_and_update_balance(
    'ane_'||d.id||'_'||p_event,d.uid,p_event,amount,d.id,p_now,
    case when p_event='click' then 'Click' else 'View' end||' from ad network '||d.network_id,
    null,null,null,null,amount,amount,0
  );
  return true;
end;
$$;

alter table public.ad_network_settings enable row level security;
alter table public.ad_network_credentials enable row level security;
alter table public.ad_network_deliveries enable row level security;
alter table public.ad_network_events enable row level security;
revoke all on public.ad_network_settings,public.ad_network_credentials,public.ad_network_deliveries,public.ad_network_events from public,anon,authenticated;
grant select,insert,update,delete on public.ad_network_settings,public.ad_network_credentials,public.ad_network_deliveries,public.ad_network_events to service_role;
revoke all on function public.settle_ad_network_event(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.settle_ad_network_event(text,text,text,bigint) to service_role;
commit;
