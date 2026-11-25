-- APPLIED to production on 2026-11-25 via apply_migration "zeekend_review_hold", on the owner's instruction to hold all Zeekend earnings.
-- Written for the Zeekend dispute (docs/zeekend-dispute-2026-11-25). The hold is enforced by 20261125136000_enforce_earning_holds.sql.
--
-- Zeekend review hold: marks the earnings Zeekend cards credited as HELD. Held money stays in
-- balances.available_micros - nothing is debited, no ledger line is written, lifetime totals do
-- not move - but it cannot be converted to AI credits or withdrawn until an administrator
-- releases it. Releasing is one call and restores the account exactly as it was.
--
-- Why not reuse public.earning_reviews (earningReview.ts)?
--   * That table is not in production yet (to_regclass('public.earning_reviews') is null on
--     production on 2026-11-25; migration 20261124120000 was never applied), so
--     depending on it would drag an unrelated, unreviewed feature into this change.
--   * It holds a WHOLE ACCOUNT: no new earnings and no spending of anything. Here an account
--     may own money that has nothing to do with Zeekend (referrals, earlier Adcode ads), and
--     freezing that is unfair and unnecessary. This table holds a DOLLAR AMOUNT.
-- The service-side check is shaped like earningsHeld()/isHeld() so it slots into the same
-- three places (earningsConversionRoutes.ts, withdrawals.ts x2); see ADMIN-API-DESIGN.md.
begin;

create table public.earning_holds (
  uid              text   not null references public.users(uid),
  reason           text   not null default 'zeekend-review' check (reason ~ '^[a-z][a-z0-9-]{1,39}$'),
  -- Zeekend-sourced earnings credited to this account, summed from the ledger when the hold was placed.
  source_micros    bigint not null check (source_micros >= 0),
  -- What is actually frozen: never more than the balance that was available at that moment,
  -- so an account that already converted some of it is not left with a negative spendable sum.
  held_micros      bigint not null check (held_micros >= 0 and held_micros <= source_micros),
  -- Zeekend-sourced money the account had already converted or withdrawn: reported, not recoverable by a hold.
  already_spent_micros bigint not null check (already_spent_micros >= 0),
  placed_at        bigint not null,
  placed_by        text   not null,
  released_at      bigint,
  released_by      text,
  note             text   check (note is null or length(note) <= 500),
  primary key (uid, reason),
  check ((released_at is null) = (released_by is null))
);
create index earning_holds_active on public.earning_holds (reason) where released_at is null;

alter table public.earning_holds enable row level security;
alter table public.earning_holds force row level security;
revoke all on public.earning_holds from public, anon, authenticated;
grant select, insert, update on public.earning_holds to service_role;   -- no delete: a hold's history stays

-- What the account may convert or withdraw: available minus every active hold, never below zero.
create function public.spendable_micros(p_uid text) returns bigint
language sql stable set search_path = '' as $$
  select greatest(
    coalesce((select available_micros from public.balances where uid = p_uid), 0)
    - coalesce((select sum(held_micros) from public.earning_holds where uid = p_uid and released_at is null), 0),
    0)
$$;

-- Places the hold on every account that earned from the network, in one transaction. Idempotent
-- (an account already held for this reason is skipped), reads the ledger and writes only this table.
-- Zeekend credits are the 'impression'/'click' ledger entries whose ref_id is a Zeekend delivery
-- (settle_ad_network_event writes entry ids 'ane_<delivery>_<event>', ref_id = the delivery id).
create function public.place_zeekend_hold(p_admin text, p_now bigint, p_note text default null, p_reason text default 'zeekend-review')
returns jsonb language plpgsql set search_path = '' as $$
declare v_accounts integer; v_held bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('earning_holds:' || p_reason, 0));
  with src as (
    select d.uid, sum(l.micros) as micros
    from public.ledger_entries l
    join public.ad_network_deliveries d on d.id = l.ref_id and d.network_id = 'zeekend'
    where l.kind in ('impression', 'click') and l.entry_id like 'ane\_%' and l.uid = d.uid
    group by d.uid
  ), ins as (
    insert into public.earning_holds (uid, reason, source_micros, held_micros, already_spent_micros, placed_at, placed_by, note)
    select s.uid, p_reason, s.micros,
           least(s.micros, coalesce(b.available_micros, 0)),
           s.micros - least(s.micros, coalesce(b.available_micros, 0)),
           p_now, p_admin, p_note
    from src s left join public.balances b on b.uid = s.uid
    where s.micros > 0
    on conflict (uid, reason) do nothing
    returning held_micros
  )
  select count(*), coalesce(sum(held_micros), 0) into v_accounts, v_held from ins;
  return jsonb_build_object('accounts', v_accounts, 'heldMicros', v_held);
end $$;

-- Releases one account (p_uid) or all (p_uid null). Nothing else changes; the money was never moved.
create function public.release_earning_hold(p_admin text, p_now bigint, p_uid text default null, p_reason text default 'zeekend-review')
returns integer language plpgsql set search_path = '' as $$
declare v_n integer;
begin
  update public.earning_holds set released_at = p_now, released_by = p_admin
  where reason = p_reason and released_at is null and (p_uid is null or uid = p_uid);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.spendable_micros(text), public.place_zeekend_hold(text, bigint, text, text),
  public.release_earning_hold(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.spendable_micros(text), public.place_zeekend_hold(text, bigint, text, text),
  public.release_earning_hold(text, bigint, text, text) to service_role;

commit;

-- Rollback of the whole thing (only if nothing was ever held, otherwise release first and keep the history):
--   drop function public.release_earning_hold(text, bigint, text, text);
--   drop function public.place_zeekend_hold(text, bigint, text, text);
--   drop function public.spendable_micros(text);
--   drop table public.earning_holds;
--
-- NOT ENFORCED HERE: public.convert_earnings_to_credits (20261119120000) and reserve_withdrawal
-- (20260826140000) do not read this table, so until the service checks spendable_micros() before
-- calling them the hold is only a record. See ADMIN-API-DESIGN.md for the enforcement points and why
-- the RPCs themselves should also be amended in a follow-up migration (not drafted: it replaces
-- money-moving functions and needs its own review).
