begin;
set local lock_timeout = '5s';

-- One payable hosted subscription checkout per account across all Worker isolates.
-- Dodo's normal sessions last 24h; the extra hour covers an uncertain/late provider response.
create table public.ai_plan_checkouts (
  uid text primary key references public.users(uid),
  order_id text not null unique,
  plan text not null check (plan in ('weekly','monthly','pro')),
  billing_country text not null check (billing_country ~ '^[A-Z]{2}$'),
  created_at bigint not null,
  expires_at bigint not null check (expires_at > created_at),
  checkout_session text,
  checkout_url text,
  check ((checkout_session is null) = (checkout_url is null))
);
alter table public.ai_plan_checkouts enable row level security;
revoke all on public.ai_plan_checkouts from public,anon,authenticated;
grant select,insert,update,delete on public.ai_plan_checkouts to service_role;

create function public.claim_ai_plan_checkout(p_uid text,p_plan text,p_country text,p_order text,p_now bigint)
returns jsonb language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare current public.ai_plan_checkouts%rowtype; claimed boolean := false;
begin
  if p_uid is null or p_uid='*' or p_plan not in ('weekly','monthly','pro') or p_country !~ '^[A-Z]{2}$'
      or p_order !~ '^aip_[A-Za-z0-9]+$' then raise exception 'invalid plan checkout'; end if;
  -- The advisory lock also serializes an account's first insert when its row does not exist yet.
  perform pg_advisory_xact_lock(hashtextextended('ai_plan_checkout:'||p_uid,0));
  if exists(select 1 from public.ai_subscriptions where uid=p_uid and (ends_at>p_now or status in ('active','pending','on_hold','paused','past_due'))) then
    return jsonb_build_object('status','subscribed');
  end if;
  select * into current from public.ai_plan_checkouts where uid=p_uid for update;
  if not found or current.expires_at<=p_now then
    insert into public.ai_plan_checkouts as c(uid,order_id,plan,billing_country,created_at,expires_at)
      values(p_uid,p_order,p_plan,p_country,p_now,p_now+90000000)
      on conflict(uid) do update set order_id=excluded.order_id,plan=excluded.plan,billing_country=excluded.billing_country,
        created_at=excluded.created_at,expires_at=excluded.expires_at,checkout_session=null,checkout_url=null
      returning * into current;
    claimed := true;
  end if;
  return jsonb_build_object('status',case when claimed then 'claimed' else 'existing' end,'checkout',jsonb_build_object(
    'uid',current.uid,'orderId',current.order_id,'plan',current.plan,'billingCountry',current.billing_country,
    'createdAt',current.created_at,'expiresAt',current.expires_at,'checkoutSession',current.checkout_session,'checkoutUrl',current.checkout_url));
end;
$$;

create function public.complete_ai_plan_checkout(p_uid text,p_order text,p_session text,p_url text,p_now bigint)
returns text language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare current public.ai_plan_checkouts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_plan_checkout:'||p_uid,0));
  select * into current from public.ai_plan_checkouts where uid=p_uid for update;
  if not found or current.order_id<>p_order or current.expires_at<=p_now then return 'missing'; end if;
  if exists(select 1 from public.ai_subscriptions where uid=p_uid and (ends_at>p_now or status in ('active','pending','on_hold','paused','past_due'))) then return 'subscribed'; end if;
  if p_session is null or length(p_session)=0 or p_url is null or p_url !~ '^https://' then raise exception 'invalid checkout session'; end if;
  update public.ai_plan_checkouts set checkout_session=p_session,checkout_url=p_url,
    expires_at=greatest(expires_at,p_now+90000000) where uid=p_uid;
  return 'saved';
end;
$$;
revoke all on function public.claim_ai_plan_checkout(text,text,text,text,bigint),public.complete_ai_plan_checkout(text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.claim_ai_plan_checkout(text,text,text,text,bigint),public.complete_ai_plan_checkout(text,text,text,text,bigint) to service_role;
commit;
