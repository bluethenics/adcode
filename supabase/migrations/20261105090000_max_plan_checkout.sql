-- Max and Unlimited checkouts were refused by the checkout guard, which still listed only the
-- three plans it was written for. The claim raised, and the API answered with its generic 503
-- ("Included AI is temporarily unavailable"). The subscription webhook already accepts all five.

alter table public.ai_plan_checkouts drop constraint if exists ai_plan_checkouts_plan_check;
alter table public.ai_plan_checkouts add constraint ai_plan_checkouts_plan_check
  check (plan in ('weekly','monthly','pro','max','unlimited'));

create or replace function public.claim_ai_plan_checkout(p_uid text, p_plan text, p_country text, p_order text, p_now bigint)
returns jsonb language plpgsql set search_path = pg_catalog, public, pg_temp as $function$
declare current public.ai_plan_checkouts%rowtype; claimed boolean := false;
begin
  if p_uid is null or p_uid='*' or p_plan not in ('weekly','monthly','pro','max','unlimited') or p_country !~ '^[A-Z]{2}$'
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
$function$;
