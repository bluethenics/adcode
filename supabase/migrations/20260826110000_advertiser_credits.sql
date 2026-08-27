create table if not exists public.advertiser_credit_orders (
  order_id text primary key,
  advertiser_id text not null references public.advertisers(advertiser_id),
  amount_micros bigint not null check (amount_micros > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  billing_country text not null,
  customer_email text not null,
  status text not null check (status in (
    'pending','checkout_created','paid','partially_reversed','reversed','disputed',
    'cancelled','failed','review_required'
  )),
  provider_session_id text unique,
  checkout_url text,
  provider_payment_id text unique,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists public.advertiser_credit_entries (
  entry_id text primary key,
  advertiser_id text not null references public.advertisers(advertiser_id),
  order_id text not null references public.advertiser_credit_orders(order_id),
  kind text not null,
  amount_micros bigint not null,
  provider_object_id text not null,
  created_at bigint not null,
  unique (kind, provider_object_id)
);

create table if not exists public.provider_events (
  webhook_id text primary key,
  event_type text not null,
  provider_object_id text not null,
  order_id text,
  status text not null,
  received_at bigint not null,
  unique (event_type, provider_object_id)
);

create or replace function public.apply_advertiser_credit_event(
  p_webhook_id text,
  p_event_type text,
  p_provider_object_id text,
  p_payment_id text,
  p_order_id text,
  p_session_id text,
  p_amount_micros bigint,
  p_currency text,
  p_received_at bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.advertiser_credit_orders%rowtype;
  v_advertiser public.advertisers%rowtype;
  v_inserted integer;
  v_delta bigint := 0;
  v_removed bigint := 0;
  v_funded bigint;
begin
  insert into public.provider_events (
    webhook_id, event_type, provider_object_id, order_id, status, received_at
  ) values (
    p_webhook_id, p_event_type, p_provider_object_id, p_order_id, 'processing', p_received_at
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('applied', false, 'reason', 'duplicate');
  end if;

  if p_event_type = 'purchase' then
    select * into v_order from public.advertiser_credit_orders
      where order_id = p_order_id for update;
  else
    select * into v_order from public.advertiser_credit_orders
      where provider_payment_id = p_payment_id for update;
  end if;

  if not found then
    update public.provider_events set status = 'ignored' where webhook_id = p_webhook_id;
    return jsonb_build_object('applied', false, 'reason', 'ignored');
  end if;

  select * into v_advertiser from public.advertisers
    where advertiser_id = v_order.advertiser_id for update;
  if not found then
    update public.provider_events set status = 'ignored' where webhook_id = p_webhook_id;
    return jsonb_build_object('applied', false, 'reason', 'ignored');
  end if;

  if p_event_type = 'purchase' then
    if v_order.status <> 'checkout_created'
       or v_order.amount_micros <> p_amount_micros
       or v_order.currency <> p_currency
       or v_order.provider_session_id <> p_session_id then
      update public.advertiser_credit_orders
        set status = 'review_required', updated_at = p_received_at
        where order_id = v_order.order_id;
      update public.provider_events set status = 'review_required' where webhook_id = p_webhook_id;
      return jsonb_build_object('applied', false, 'reason', 'review_required');
    end if;

    update public.advertisers
      set funded_micros = funded_micros + v_order.amount_micros
      where advertiser_id = v_order.advertiser_id;
    update public.advertiser_credit_orders
      set status = 'paid', provider_payment_id = p_payment_id, updated_at = p_received_at
      where order_id = v_order.order_id;
    insert into public.advertiser_credit_entries (
      entry_id, advertiser_id, order_id, kind, amount_micros, provider_object_id, created_at
    ) values (
      p_webhook_id, v_order.advertiser_id, v_order.order_id, 'purchase',
      v_order.amount_micros, p_provider_object_id, p_received_at
    );
  elsif p_event_type in ('refund', 'dispute-opened') then
    v_removed := least(p_amount_micros, greatest(v_advertiser.funded_micros, 0));
    v_delta := -v_removed;
    update public.advertisers
      set funded_micros = funded_micros + v_delta
      where advertiser_id = v_order.advertiser_id;
    insert into public.advertiser_credit_entries (
      entry_id, advertiser_id, order_id, kind, amount_micros, provider_object_id, created_at
    ) values (
      p_webhook_id, v_order.advertiser_id, v_order.order_id, p_event_type,
      v_delta, p_provider_object_id, p_received_at
    );
  elsif p_event_type = 'dispute-release' then
    select greatest(-amount_micros, 0) into v_delta
      from public.advertiser_credit_entries
      where kind = 'dispute-opened' and provider_object_id = p_provider_object_id;
    v_delta := coalesce(v_delta, 0);
    update public.advertisers
      set funded_micros = funded_micros + v_delta
      where advertiser_id = v_order.advertiser_id;
    insert into public.advertiser_credit_entries (
      entry_id, advertiser_id, order_id, kind, amount_micros, provider_object_id, created_at
    ) values (
      p_webhook_id, v_order.advertiser_id, v_order.order_id, p_event_type,
      v_delta, p_provider_object_id, p_received_at
    );
  end if;

  select funded_micros into v_funded from public.advertisers
    where advertiser_id = v_order.advertiser_id;
  if v_funded < v_advertiser.reserved_micros then
    update public.advertisers set status = 'suspended'
      where advertiser_id = v_order.advertiser_id;
    update public.campaigns set status = 'paused'
      where advertiser_id = v_order.advertiser_id and status = 'active';
  end if;

  if p_event_type = 'dispute-opened' then
    update public.advertiser_credit_orders set status = 'disputed', updated_at = p_received_at
      where order_id = v_order.order_id;
  elsif p_event_type <> 'purchase' then
    update public.advertiser_credit_orders
      set status = case
        when v_funded = 0 then 'reversed'
        when v_funded < amount_micros then 'partially_reversed'
        else 'paid'
      end,
      updated_at = p_received_at
      where order_id = v_order.order_id;
  end if;

  update public.provider_events set status = 'applied', order_id = v_order.order_id
    where webhook_id = p_webhook_id;
  return jsonb_build_object(
    'applied', true, 'reason', 'applied', 'advertiserId', v_order.advertiser_id
  );
end;
$$;

create or replace function public.transition_campaign_commitment(
  p_advertiser_id text,
  p_campaign_id text,
  p_next text,
  p_spent_micros bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_advertiser public.advertisers%rowtype;
  v_campaign public.campaigns%rowtype;
  v_remaining bigint;
  v_reserved bigint;
begin
  select * into v_advertiser from public.advertisers
    where advertiser_id = p_advertiser_id for update;
  select * into v_campaign from public.campaigns
    where campaign_id = p_campaign_id and advertiser_id = p_advertiser_id for update;
  if not found or v_advertiser.advertiser_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;
  if v_campaign.status = 'ended' then
    return jsonb_build_object('ok', false, 'reason', 'invalid-state');
  end if;
  if v_campaign.status = p_next then
    return jsonb_build_object('ok', true);
  end if;

  v_remaining := greatest(v_campaign.budget_micros - p_spent_micros, 0);
  if p_next = 'active' then
    if v_remaining > v_advertiser.funded_micros - v_advertiser.reserved_micros then
      return jsonb_build_object('ok', false, 'reason', 'insufficient-funds');
    end if;
    v_reserved := v_advertiser.reserved_micros + v_remaining;
  else
    v_reserved := greatest(v_advertiser.reserved_micros - v_remaining, 0);
  end if;

  update public.advertisers set reserved_micros = v_reserved
    where advertiser_id = p_advertiser_id;
  update public.campaigns set status = p_next where campaign_id = p_campaign_id;
  return jsonb_build_object('ok', true);
end;
$$;

alter table public.advertiser_credit_orders enable row level security;
alter table public.advertiser_credit_orders force row level security;
alter table public.advertiser_credit_entries enable row level security;
alter table public.advertiser_credit_entries force row level security;
alter table public.provider_events enable row level security;
alter table public.provider_events force row level security;
revoke all on public.advertiser_credit_orders, public.advertiser_credit_entries, public.provider_events
  from anon, authenticated;
revoke all on function public.apply_advertiser_credit_event(
  text,text,text,text,text,text,bigint,text,bigint
) from anon, authenticated;
revoke all on function public.transition_campaign_commitment(text,text,text,bigint)
  from anon, authenticated;
