-- Preserve provider event order and ownership, require live Pro invitations, and publish
-- exact entitlement boundaries so an isolate cannot prolong an expired boost from cache.
begin;
set local lock_timeout = '5s';

alter table public.ai_subscriptions add column event_at bigint not null default 0;
alter table public.ai_subscriptions add column event_kind text not null default '';
alter table public.ai_subscriptions add column period_end bigint not null default 0;
update public.ai_subscriptions set event_at = updated_at, event_kind = status, period_end = ends_at;

create or replace function public.ai_plan_state_v2(p_uid text, p_now bigint)
returns table(plan text, ends_at bigint, source text, boost_tokens bigint, valid_until bigint)
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  with subscriptions as (
    select s.plan, s.ends_at from public.ai_subscriptions s where s.uid = p_uid and s.ends_at > p_now
  ), gifts as (
    select g.plan, g.starts_at, g.ends_at from public.ai_plan_gifts g where g.uid in (p_uid, '*') and g.ends_at > p_now
  ), boosts as (
    select b.weekly_tokens, b.starts_at, b.ends_at from public.ai_boosts b where b.uid in (p_uid, '*') and b.ends_at > p_now
  ), live as (
    select s.plan, s.ends_at, 'subscription'::text source from subscriptions s
    union all select g.plan, g.ends_at, 'gift'::text from gifts g where g.starts_at <= p_now
  ), best as (
    select * from live order by case live.plan when 'pro' then 3 when 'monthly' then 2 else 1 end desc, live.ends_at desc limit 1
  ), boundaries as (
    select s.ends_at at from subscriptions s
    union all select g.ends_at from gifts g
    union all select g.starts_at from gifts g where g.starts_at > p_now
    union all select b.ends_at from boosts b
    union all select b.starts_at from boosts b where b.starts_at > p_now
  )
  select (select best.plan from best), (select best.ends_at from best), (select best.source from best),
    coalesce((select max(b.weekly_tokens) from boosts b where b.starts_at <= p_now), 0)::bigint,
    (select min(boundaries.at) from boundaries)
$$;

create or replace function public.apply_ai_subscription_event_v2(
  p_webhook text, p_type text, p_subscription text, p_uid text, p_plan text, p_customer text,
  p_status text, p_period_end bigint, p_cancel boolean, p_now bigint, p_occurred_at bigint
) returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  inv public.ai_invitees%rowtype;
  previous public.ai_subscriptions%rowtype;
  ends bigint;
  occurred bigint := coalesce(nullif(p_occurred_at, 0), p_now);
  granting boolean := p_type in ('active', 'renewed', 'plan_changed');
begin
  insert into public.provider_events(webhook_id, event_type, provider_object_id, order_id, status, received_at)
    values (p_webhook, 'ai-sub-' || p_type, p_subscription || ':' || p_webhook, null, 'applied', p_now)
    on conflict do nothing;
  if not found then return 'duplicate'; end if;
  if p_uid is null or p_uid = '*' or p_plan is null or p_plan not in ('weekly','monthly','pro')
      or p_type not in ('active','renewed','plan_changed','on_hold','cancelled','failed','expired')
      or not exists (select 1 from public.users where uid = p_uid)
      or (p_type not in ('on_hold','failed','expired') and coalesce(p_period_end, 0) <= 0) then
    update public.provider_events set status = 'review_required' where webhook_id = p_webhook;
    return 'review';
  end if;
  -- Serialize the first insert too; SELECT FOR UPDATE alone cannot lock a missing row.
  perform pg_advisory_xact_lock(hashtextextended('ai_subscription:' || p_subscription, 0));
  select * into previous from public.ai_subscriptions where provider_subscription_id = p_subscription for update;
  if found then
    if previous.uid <> p_uid or (previous.customer_id is not null and p_customer is not null and previous.customer_id <> p_customer) then
      update public.provider_events set status = 'review_required' where webhook_id = p_webhook;
      return 'review';
    end if;
    -- A late cancellation/renewal must not replace a newer paid period. Without a provider
    -- timestamp, a terminal transition wins over a same-period activation conservatively.
    if occurred < previous.event_at
        or (coalesce(p_period_end,0) > 0 and p_period_end < previous.period_end)
        or (granting and previous.event_kind in ('cancelled','on_hold','failed','expired') and p_period_end <= previous.period_end
          and (p_occurred_at is null or occurred <= previous.event_at)) then
      update public.provider_events set status = 'ignored' where webhook_id = p_webhook;
      return 'applied';
    end if;
  end if;
  ends := case when p_type in ('on_hold','failed','expired') then p_now else p_period_end end;
  insert into public.ai_subscriptions as s (provider_subscription_id, uid, plan, customer_id, status, ends_at, cancel_at_period_end, updated_at, event_at, event_kind, period_end)
    values (p_subscription, p_uid, p_plan, p_customer, p_status, ends, p_cancel, p_now, occurred, p_type, coalesce(nullif(p_period_end,0),previous.period_end,0))
    on conflict (provider_subscription_id) do update set plan = excluded.plan,
      customer_id = coalesce(s.customer_id, excluded.customer_id), status = excluded.status, ends_at = excluded.ends_at,
      cancel_at_period_end = excluded.cancel_at_period_end, updated_at = excluded.updated_at,
      event_at = excluded.event_at, event_kind = excluded.event_kind, period_end = excluded.period_end;
  if p_type = 'active' and ends > p_now then
    perform pg_advisory_xact_lock(hashtextextended('ai_invitee:' || p_uid, 0));
    select * into inv from public.ai_invitees where invitee = p_uid for update;
    if found and not inv.rewarded and exists (
      select 1 from public.ai_subscriptions s where s.uid = inv.inviter and s.plan = 'pro' and s.ends_at > p_now
    ) then
      update public.ai_invitees set rewarded = true where invitee = p_uid;
      -- Stable balance-lock order even if two referral pairs overlap.
      if p_uid < inv.inviter then
        perform public.grant_ai_tokens(p_uid, 4000000, 'invite:' || p_uid, 'Pro invite reward', p_now);
        perform public.grant_ai_tokens(inv.inviter, 4000000, 'invite:' || p_uid, 'Pro invite reward', p_now);
      else
        perform public.grant_ai_tokens(inv.inviter, 4000000, 'invite:' || p_uid, 'Pro invite reward', p_now);
        perform public.grant_ai_tokens(p_uid, 4000000, 'invite:' || p_uid, 'Pro invite reward', p_now);
      end if;
    end if;
  end if;
  return 'applied';
end
$$;

-- Keep old deployed Workers compatible while the new Worker begins supplying event time.
create or replace function public.apply_ai_subscription_event(
  p_webhook text, p_type text, p_subscription text, p_uid text, p_plan text, p_customer text,
  p_status text, p_period_end bigint, p_cancel boolean, p_now bigint
) returns text language sql set search_path = pg_catalog, public, pg_temp as $$
  select public.apply_ai_subscription_event_v2(p_webhook,p_type,p_subscription,p_uid,p_plan,p_customer,p_status,p_period_end,p_cancel,p_now,null)
$$;

create or replace function public.redeem_ai_promo(p_code text, p_uid text, p_now bigint)
returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare p public.ai_promo_codes%rowtype;
begin
  select * into p from public.ai_promo_codes where code = p_code for update;
  if not found then return 'unknown'; end if;
  if p.expires_at <= p_now then return 'expired'; end if;
  if exists (select 1 from public.ai_promo_redemptions where code = p_code and uid = p_uid) then return 'already'; end if;
  if p.redemptions >= p.max_redemptions then return 'used-up'; end if;
  insert into public.ai_promo_redemptions(code, uid, redeemed_at) values (p_code, p_uid, p_now);
  update public.ai_promo_codes set redemptions = redemptions + 1 where code = p_code;
  if p.kind = 'tokens' then
    perform public.grant_ai_tokens(p_uid, p.tokens, 'promo:' || p_code, 'Promo code ' || p_code, p_now);
    return 'tokens';
  end if;
  insert into public.ai_plan_gifts(uid, plan, starts_at, ends_at, source, ref, created_at)
    values (p_uid, p.plan, p_now, p_now + p.days::bigint * 86400000, 'promo', p_code, p_now);
  return 'plan';
end
$$;

create or replace function public.redeem_ai_invite(p_code text, p_uid text, p_now bigint)
returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare i public.ai_invites%rowtype;
begin
  -- Different invite codes racing for the same new account must return 'already', not 500.
  perform pg_advisory_xact_lock(hashtextextended('ai_invitee:' || p_uid, 0));
  select * into i from public.ai_invites where code = p_code for update;
  if not found then return 'unknown'; end if;
  if i.inviter = p_uid then return 'own-code'; end if;
  if not exists (select 1 from public.ai_subscriptions s where s.uid = i.inviter and s.plan = 'pro' and s.ends_at > p_now) then return 'unknown'; end if;
  if exists (select 1 from public.ai_invitees where invitee = p_uid) then return 'already'; end if;
  if exists (select 1 from public.ai_subscriptions s where s.uid = p_uid) then return 'has-plan'; end if;
  if i.uses >= i.max_uses then return 'used-up'; end if;
  update public.ai_invites set uses = uses + 1 where code = p_code;
  insert into public.ai_invitees(invitee, inviter, code, joined_at) values (p_uid, i.inviter, p_code, p_now);
  return 'joined';
end
$$;

create or replace function public.reset_ai_week(p_uid text)
returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare w public.ai_credit_windows%rowtype;
begin
  -- Same lock as paid holds, including when the paid_week row does not exist yet.
  perform pg_advisory_xact_lock(hashtext('ai_tokens:' || p_uid));
  select * into w from public.ai_credit_windows where uid = p_uid and kind = 'paid_week' for update;
  if not found then return 'none'; end if;
  if w.reserved_millicredits > 0 then return 'busy'; end if;
  delete from public.ai_credit_windows where uid = p_uid and kind = 'paid_week';
  return 'reset';
end
$$;

revoke all on function public.ai_plan_state_v2(text,bigint) from public, anon, authenticated;
revoke all on function public.apply_ai_subscription_event_v2(text,text,text,text,text,text,text,bigint,boolean,bigint,bigint) from public, anon, authenticated;
grant execute on function public.ai_plan_state_v2(text,bigint) to service_role;
grant execute on function public.apply_ai_subscription_event_v2(text,text,text,text,text,text,text,bigint,boolean,bigint,bigint) to service_role;

commit;
