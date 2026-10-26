-- AI plans: Dodo subscriptions, gifts and boosts (one account or '*' for everyone), promo codes and
-- Pro invites. Rules: services/api/src/aiPlans.ts; spec docs/superpowers/specs/2026-10-24-ai-plans-design.md.
-- Additive: nothing existing changes. Every lookup the relay makes is by an indexed uid.
begin;

set local lock_timeout = '5s';

create table public.ai_subscriptions (
  provider_subscription_id text primary key,
  uid text not null,
  plan text not null check (plan in ('weekly', 'monthly', 'pro')),
  customer_id text,
  status text not null,
  ends_at bigint not null,
  cancel_at_period_end boolean not null default false,
  updated_at bigint not null
);
create index ai_subscriptions_uid on public.ai_subscriptions (uid, ends_at desc);

create table public.ai_plan_gifts (
  id uuid primary key default gen_random_uuid(),
  uid text not null,
  plan text not null check (plan in ('weekly', 'monthly', 'pro')),
  starts_at bigint not null,
  ends_at bigint not null,
  source text not null check (source in ('admin', 'promo')),
  ref text not null default '',
  created_at bigint not null
);
create index ai_plan_gifts_uid on public.ai_plan_gifts (uid, ends_at desc);

create table public.ai_boosts (
  id uuid primary key default gen_random_uuid(),
  uid text not null,
  weekly_tokens bigint not null check (weekly_tokens > 0),
  starts_at bigint not null,
  ends_at bigint not null,
  created_by text not null,
  note text not null default '' check (length(note) <= 500)
);
create index ai_boosts_uid on public.ai_boosts (uid, ends_at desc);

create table public.ai_promo_codes (
  code text primary key check (code ~ '^[A-Z0-9]{3,24}$'),
  kind text not null check (kind in ('tokens', 'plan')),
  tokens bigint check (tokens is null or tokens > 0),
  plan text check (plan is null or plan in ('weekly', 'monthly', 'pro')),
  days int check (days is null or days between 1 and 366),
  max_redemptions int not null check (max_redemptions > 0),
  redemptions int not null default 0,
  expires_at bigint not null,
  created_by text not null,
  created_at bigint not null,
  check ((kind = 'tokens' and tokens is not null) or (kind = 'plan' and plan is not null and days is not null))
);
create table public.ai_promo_redemptions (
  code text not null references public.ai_promo_codes (code),
  uid text not null,
  redeemed_at bigint not null,
  primary key (code, uid)
);

create table public.ai_invites (
  code text primary key,
  inviter text not null unique,
  uses int not null default 0,
  max_uses int not null default 2
);
create table public.ai_invitees (
  invitee text primary key,
  inviter text not null,
  code text not null references public.ai_invites (code),
  rewarded boolean not null default false,
  joined_at bigint not null
);

alter table public.ai_subscriptions enable row level security;
alter table public.ai_plan_gifts enable row level security;
alter table public.ai_boosts enable row level security;
alter table public.ai_promo_codes enable row level security;
alter table public.ai_promo_redemptions enable row level security;
alter table public.ai_invites enable row level security;
alter table public.ai_invitees enable row level security;
revoke all on public.ai_subscriptions, public.ai_plan_gifts, public.ai_boosts, public.ai_promo_codes,
  public.ai_promo_redemptions, public.ai_invites, public.ai_invitees from anon, authenticated;
grant all on public.ai_subscriptions, public.ai_plan_gifts, public.ai_boosts, public.ai_promo_codes,
  public.ai_promo_redemptions, public.ai_invites, public.ai_invitees to service_role;

-- The account's best live plan (its own subscriptions and gifts, and everyone's gifts) and best boost.
create or replace function public.ai_plan_state(p_uid text, p_now bigint)
returns table(plan text, ends_at bigint, source text, boost_tokens bigint)
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  with live as (
    select s.plan, s.ends_at, 'subscription'::text source from public.ai_subscriptions s where s.uid = p_uid and s.ends_at > p_now
    union all
    select g.plan, g.ends_at, 'gift'::text from public.ai_plan_gifts g where g.uid in (p_uid, '*') and g.starts_at <= p_now and g.ends_at > p_now
  ), best as (
    select * from live order by case live.plan when 'pro' then 3 when 'monthly' then 2 else 1 end desc, live.ends_at desc limit 1
  )
  select (select best.plan from best), (select best.ends_at from best), (select best.source from best),
    coalesce((select max(b.weekly_tokens) from public.ai_boosts b where b.uid in (p_uid, '*') and b.starts_at <= p_now and b.ends_at > p_now), 0)::bigint
$$;

-- A Dodo subscription event, applied once. Access lasts until the paid period ends; on_hold,
-- failed and expired end it now. An invitee's first active subscription rewards both accounts once.
create or replace function public.apply_ai_subscription_event(
  p_webhook text, p_type text, p_subscription text, p_uid text, p_plan text, p_customer text,
  p_status text, p_period_end bigint, p_cancel boolean, p_now bigint
) returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare inv public.ai_invitees%rowtype; ends bigint;
begin
  insert into public.provider_events(webhook_id, event_type, provider_object_id, order_id, status, received_at)
    values (p_webhook, 'ai-sub-' || p_type, p_subscription || ':' || p_webhook, null,
      case when p_uid is null or p_plan is null then 'review_required' else 'applied' end, p_now)
    on conflict do nothing;
  if not found then return 'duplicate'; end if;
  if p_uid is null or p_plan is null then return 'review'; end if;
  ends := case when p_type in ('on_hold', 'failed', 'expired') then p_now else coalesce(nullif(p_period_end, 0), p_now) end;
  insert into public.ai_subscriptions as s (provider_subscription_id, uid, plan, customer_id, status, ends_at, cancel_at_period_end, updated_at)
    values (p_subscription, p_uid, p_plan, p_customer, p_status, ends, p_cancel, p_now)
    on conflict (provider_subscription_id) do update set uid = excluded.uid, plan = excluded.plan,
      customer_id = coalesce(excluded.customer_id, s.customer_id), status = excluded.status, ends_at = excluded.ends_at,
      cancel_at_period_end = excluded.cancel_at_period_end, updated_at = excluded.updated_at;
  if p_type = 'active' then
    select * into inv from public.ai_invitees where invitee = p_uid for update;
    if found and not inv.rewarded then
      update public.ai_invitees set rewarded = true where invitee = p_uid;
      perform public.grant_ai_tokens(p_uid, 4000000, 'invite', 'invite:' || p_uid, p_now);
      perform public.grant_ai_tokens(inv.inviter, 4000000, 'invite', 'invite:' || p_uid, p_now);
    end if;
  end if;
  return 'applied';
end
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
    perform public.grant_ai_tokens(p_uid, p.tokens, 'promo', 'promo:' || p_code, p_now);
    return 'tokens';
  end if;
  insert into public.ai_plan_gifts(uid, plan, starts_at, ends_at, source, ref, created_at)
    values (p_uid, p.plan, p_now, p_now + p.days::bigint * 86400000, 'promo', p_code, p_now);
  return 'plan';
end
$$;

-- A live Pro subscriber's invite code, made on first ask.
create or replace function public.ai_invite_for(p_uid text, p_now bigint)
returns table(code text, uses int, max_uses int)
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if not exists (select 1 from public.ai_subscriptions s where s.uid = p_uid and s.plan = 'pro' and s.ends_at > p_now) then return; end if;
  insert into public.ai_invites(code, inviter) values ('INV' || upper(substr(md5(p_uid || clock_timestamp()::text), 1, 8)), p_uid)
    on conflict (inviter) do nothing;
  return query select i.code, i.uses, i.max_uses from public.ai_invites i where i.inviter = p_uid;
end
$$;

create or replace function public.redeem_ai_invite(p_code text, p_uid text, p_now bigint)
returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare i public.ai_invites%rowtype;
begin
  select * into i from public.ai_invites where code = p_code for update;
  if not found then return 'unknown'; end if;
  if i.inviter = p_uid then return 'own-code'; end if;
  if exists (select 1 from public.ai_invitees where invitee = p_uid) then return 'already'; end if;
  if exists (select 1 from public.ai_subscriptions s where s.uid = p_uid and s.ends_at > p_now) then return 'has-plan'; end if;
  if i.uses >= i.max_uses then return 'used-up'; end if;
  update public.ai_invites set uses = uses + 1 where code = p_code;
  insert into public.ai_invitees(invitee, inviter, code, joined_at) values (p_uid, i.inviter, p_code, p_now);
  return 'joined';
end
$$;

-- A fresh free week: refused while a request holds tokens in the current one.
create or replace function public.reset_ai_week(p_uid text)
returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare w public.ai_credit_windows%rowtype;
begin
  select * into w from public.ai_credit_windows where uid = p_uid and kind = 'paid_week' for update;
  if not found then return 'none'; end if;
  if w.reserved_millicredits > 0 then return 'busy'; end if;
  delete from public.ai_credit_windows where uid = p_uid and kind = 'paid_week';
  return 'reset';
end
$$;

-- Live subscriptions by plan; a weekly plan's monthly revenue is 52 weeks over 12 months.
create or replace function public.ai_subscription_summary(p_now bigint)
returns table(plan text, active bigint, mrr_cents bigint)
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  select s.plan, count(*)::bigint,
    (count(*) * case s.plan when 'weekly' then 1300 when 'monthly' then 900 else 1900 end)::bigint
  from public.ai_subscriptions s where s.ends_at > p_now group by s.plan
  order by case s.plan when 'weekly' then 1 when 'monthly' then 2 else 3 end
$$;

revoke all on function public.ai_plan_state(text, bigint) from public, anon, authenticated;
revoke all on function public.apply_ai_subscription_event(text, text, text, text, text, text, text, bigint, boolean, bigint) from public, anon, authenticated;
revoke all on function public.redeem_ai_promo(text, text, bigint) from public, anon, authenticated;
revoke all on function public.ai_invite_for(text, bigint) from public, anon, authenticated;
revoke all on function public.redeem_ai_invite(text, text, bigint) from public, anon, authenticated;
revoke all on function public.reset_ai_week(text) from public, anon, authenticated;
revoke all on function public.ai_subscription_summary(bigint) from public, anon, authenticated;
grant execute on function public.ai_plan_state(text, bigint) to service_role;
grant execute on function public.apply_ai_subscription_event(text, text, text, text, text, text, text, bigint, boolean, bigint) to service_role;
grant execute on function public.redeem_ai_promo(text, text, bigint) to service_role;
grant execute on function public.ai_invite_for(text, bigint) to service_role;
grant execute on function public.redeem_ai_invite(text, text, bigint) to service_role;
grant execute on function public.reset_ai_week(text) to service_role;
grant execute on function public.ai_subscription_summary(bigint) to service_role;

commit;
