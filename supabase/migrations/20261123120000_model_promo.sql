-- Free model promotion (services/api/src/modelPromo.ts): the first N verified accounts get a fixed
-- amount of free usage on chosen paid models. Its own money, kept apart from purchased credits:
-- it pays only for the promotion's models and is never refunded or converted.
begin;

create table public.model_promo_claims (
  promo_id text not null check (promo_id ~ '^[a-z0-9-]{1,40}$'),
  uid text not null references public.users(uid) on delete cascade,
  granted_micros bigint not null check (granted_micros > 0),
  spent_micros bigint not null default 0 check (spent_micros >= 0),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  created_at bigint not null,
  primary key (promo_id, uid)
);
create table public.model_promo_holds (
  id uuid primary key,
  promo_id text not null,
  uid text not null,
  model text not null,
  held_micros bigint not null check (held_micros > 0),
  charged_micros bigint,
  created_at bigint not null,
  settled_at bigint,
  foreign key (promo_id, uid) references public.model_promo_claims(promo_id, uid) on delete cascade
);
create index model_promo_holds_open on public.model_promo_holds(promo_id, uid, created_at) where settled_at is null;

alter table public.model_promo_claims enable row level security;
alter table public.model_promo_holds enable row level security;
revoke all on public.model_promo_claims, public.model_promo_holds from public, anon, authenticated;
grant all on public.model_promo_claims, public.model_promo_holds to service_role;

-- Holds older than 30 minutes belong to requests that never settled; release them (as the wallet does).
create function public.expire_model_promo_holds(p_promo text, p_uid text, p_now bigint) returns void
language plpgsql set search_path = '' as $$
declare released bigint;
begin
  with gone as (
    update public.model_promo_holds set settled_at = p_now, charged_micros = 0
    where promo_id = p_promo and uid = p_uid and settled_at is null and created_at < p_now - 1800000
    returning held_micros)
  select coalesce(sum(held_micros), 0) into released from gone;
  if released > 0 then
    update public.model_promo_claims set reserved_micros = greatest(0, reserved_micros - released) where promo_id = p_promo and uid = p_uid;
  end if;
end $$;

-- One claim per account per promotion; the pool closes at p_max. The advisory lock serializes
-- claims of one promotion, so two people can never take the last place together.
create function public.claim_model_promo(p_promo text, p_uid text, p_micros bigint, p_max integer, p_now bigint) returns text
language plpgsql set search_path = '' as $$
begin
  if p_micros <= 0 or p_micros > 5000000 or p_max <= 0 then return 'full'; end if;
  perform pg_advisory_xact_lock(hashtextextended('model-promo:' || p_promo, 0));
  if exists (select 1 from public.model_promo_claims where promo_id = p_promo and uid = p_uid) then return 'already'; end if;
  if (select count(*) from public.model_promo_claims where promo_id = p_promo) >= p_max then return 'full'; end if;
  insert into public.model_promo_claims(promo_id, uid, granted_micros, created_at) values (p_promo, p_uid, p_micros, p_now);
  return 'granted';
end $$;

-- Holds up to p_micros of what remains and returns the amount held (0 = nothing left).
create function public.reserve_model_promo(p_id uuid, p_promo text, p_uid text, p_model text, p_micros bigint, p_now bigint) returns bigint
language plpgsql set search_path = '' as $$
declare c public.model_promo_claims; amount bigint;
begin
  if p_micros <= 0 or p_micros > 100000000 then return 0; end if;
  perform public.expire_model_promo_holds(p_promo, p_uid, p_now);
  select * into c from public.model_promo_claims where promo_id = p_promo and uid = p_uid for update;
  if not found then return 0; end if;
  amount := least(p_micros, c.granted_micros - c.spent_micros - c.reserved_micros);
  if amount <= 0 then return 0; end if;
  insert into public.model_promo_holds(id, promo_id, uid, model, held_micros, created_at) values (p_id, p_promo, p_uid, p_model, amount, p_now);
  update public.model_promo_claims set reserved_micros = reserved_micros + amount where promo_id = p_promo and uid = p_uid;
  return amount;
end $$;

create function public.settle_model_promo(p_id uuid, p_micros bigint, p_now bigint) returns void
language plpgsql set search_path = '' as $$
declare h public.model_promo_holds; charged bigint;
begin
  select * into h from public.model_promo_holds where id = p_id;
  if not found then return; end if;
  -- Claim first in every hold mutation, as reserve does, so the two cannot deadlock.
  perform 1 from public.model_promo_claims where promo_id = h.promo_id and uid = h.uid for update;
  select * into h from public.model_promo_holds where id = p_id for update;
  if h.settled_at is not null then return; end if;
  charged := greatest(0, least(p_micros, h.held_micros));
  update public.model_promo_claims set reserved_micros = greatest(0, reserved_micros - h.held_micros), spent_micros = spent_micros + charged
    where promo_id = h.promo_id and uid = h.uid;
  update public.model_promo_holds set settled_at = p_now, charged_micros = charged where id = p_id;
end $$;

create function public.model_promo_view(p_promo text, p_uid text, p_now bigint) returns jsonb
language plpgsql set search_path = '' as $$
declare c public.model_promo_claims;
begin
  perform public.expire_model_promo_holds(p_promo, p_uid, p_now);
  select * into c from public.model_promo_claims where promo_id = p_promo and uid = p_uid;
  if not found then return null; end if;
  return jsonb_build_object('grantedMicros', c.granted_micros, 'spentMicros', c.spent_micros, 'reservedMicros', c.reserved_micros);
end $$;

create function public.model_promo_stats(p_promo text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('claims', count(*), 'spentMicros', coalesce(sum(spent_micros), 0))
  from public.model_promo_claims where promo_id = p_promo;
$$;

revoke all on function public.expire_model_promo_holds(text, text, bigint), public.claim_model_promo(text, text, bigint, integer, bigint),
  public.reserve_model_promo(uuid, text, text, text, bigint, bigint), public.settle_model_promo(uuid, bigint, bigint),
  public.model_promo_view(text, text, bigint), public.model_promo_stats(text) from public, anon, authenticated;
grant execute on function public.expire_model_promo_holds(text, text, bigint), public.claim_model_promo(text, text, bigint, integer, bigint),
  public.reserve_model_promo(uuid, text, text, text, bigint, bigint), public.settle_model_promo(uuid, bigint, bigint),
  public.model_promo_view(text, text, bigint), public.model_promo_stats(text) to service_role;

commit;
