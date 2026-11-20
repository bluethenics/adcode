-- Ad earnings into AI credits, in one transaction.
--
-- Somebody with withdrawable ad earnings (public.balances.available_micros) can move some of
-- them into their AI credit wallet (public.model_wallet_balances). One call to
-- convert_earnings_to_credits does all of it or none of it:
--
--   1. an earnings ledger entry of kind 'credit_conversion' (negative),
--   2. balances.available_micros falls by the amount,
--   3. model_wallet_balances.balance_micros rises by the credit,
--   4. a model_wallet_ledger line of kind 'earnings',
--   5. an earnings_conversions row: the audit record, with both balances before and after.
--
-- Idempotent on (uid, request_id): the editor picks the id once per confirmation, so a
-- double click or a retry after a lost response finds the first row and moves nothing.
-- The rate and the limits come from the service (services/api/src/earningsConversion.ts);
-- the table's checks repeat the ceilings so a bug there still cannot mint an unbounded sum.

alter table public.ledger_entries drop constraint if exists ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check check (kind in (
  'impression', 'click', 'reversal', 'adjustment',
  'withdrawal_requested', 'withdrawal_paid', 'withdrawal_failed',
  'referral', 'contribution', 'credit_conversion'
));

create table public.earnings_conversions (
  uid                         text   not null references public.users(uid),
  request_id                  uuid   not null,
  earnings_micros             bigint not null check (earnings_micros > 0 and earnings_micros <= 1000000000),
  credit_micros               bigint not null check (credit_micros > 0 and credit_micros <= 1000000000),
  ledger_entry_id             text   not null unique,
  available_before_micros     bigint not null,
  available_after_micros      bigint not null,
  credit_balance_before_micros bigint not null,
  credit_balance_after_micros bigint not null,
  created_at                  bigint not null,
  primary key (uid, request_id)
);
create index earnings_conversions_day on public.earnings_conversions (uid, created_at desc);

-- Service role only, and append-only even for it: an audit row that can be edited is not one.
alter table public.earnings_conversions enable row level security;
alter table public.earnings_conversions force row level security;
revoke all on public.earnings_conversions from anon, authenticated;
grant select, insert on public.earnings_conversions to service_role;

create function public.convert_earnings_to_credits(
  p_uid text,
  p_request uuid,
  p_earnings bigint,
  p_credit bigint,
  p_daily_cap bigint,
  p_day_start bigint,
  p_now bigint,
  p_entry_id text,
  p_description text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_previous public.earnings_conversions;
  v_today bigint;
  v_available bigint;
  v_credit_before bigint;
begin
  if p_earnings <= 0 or p_credit <= 0 or p_earnings > 1000000000 or p_credit > 1000000000 then
    raise exception 'conversion amount out of range';
  end if;

  -- The same per-account lock reserve_withdrawal takes, so a payout request and a
  -- conversion can never both spend the same dollar.
  perform pg_advisory_xact_lock(hashtextextended(p_uid, 0));

  select * into v_previous from public.earnings_conversions where uid = p_uid and request_id = p_request;
  if found then
    if v_previous.earnings_micros <> p_earnings then
      return jsonb_build_object('status', 'conflict');
    end if;
    return jsonb_build_object(
      'status', 'replayed',
      'earningsMicros', v_previous.earnings_micros::text,
      'creditMicros', v_previous.credit_micros::text,
      'createdAt', v_previous.created_at,
      'availableMicros', coalesce((select available_micros from public.balances where uid = p_uid), 0)::text,
      'creditBalanceMicros', coalesce((select balance_micros from public.model_wallet_balances where uid = p_uid), 0)::text
    );
  end if;

  select coalesce(sum(earnings_micros), 0) into v_today
  from public.earnings_conversions where uid = p_uid and created_at >= p_day_start;
  if v_today + p_earnings > p_daily_cap then
    return jsonb_build_object('status', 'daily-cap', 'convertedTodayMicros', v_today::text);
  end if;

  select available_micros into v_available from public.balances where uid = p_uid for update;
  if coalesce(v_available, 0) < p_earnings then
    return jsonb_build_object('status', 'insufficient-funds', 'availableMicros', coalesce(v_available, 0)::text);
  end if;

  insert into public.ledger_entries (entry_id, uid, kind, micros, ref_id, created_at, description)
  values (p_entry_id, p_uid, 'credit_conversion', -p_earnings, p_request::text, p_now, p_description);

  update public.balances set available_micros = available_micros - p_earnings where uid = p_uid;

  insert into public.model_wallet_balances (uid) values (p_uid) on conflict do nothing;
  select balance_micros into v_credit_before from public.model_wallet_balances where uid = p_uid for update;
  update public.model_wallet_balances set balance_micros = balance_micros + p_credit where uid = p_uid;

  insert into public.model_wallet_ledger (uid, delta_micros, kind, ref, model, estimated, created_at)
  values (p_uid, p_credit, 'earnings', p_uid || ':' || p_request::text, '', false, p_now);

  insert into public.earnings_conversions (
    uid, request_id, earnings_micros, credit_micros, ledger_entry_id,
    available_before_micros, available_after_micros,
    credit_balance_before_micros, credit_balance_after_micros, created_at
  ) values (
    p_uid, p_request, p_earnings, p_credit, p_entry_id,
    v_available, v_available - p_earnings,
    v_credit_before, v_credit_before + p_credit, p_now
  );

  return jsonb_build_object(
    'status', 'converted',
    'earningsMicros', p_earnings::text,
    'creditMicros', p_credit::text,
    'createdAt', p_now,
    'availableMicros', (v_available - p_earnings)::text,
    'creditBalanceMicros', (v_credit_before + p_credit)::text
  );
end;
$$;

revoke all on function public.convert_earnings_to_credits(text, uuid, bigint, bigint, bigint, bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function public.convert_earnings_to_credits(text, uuid, bigint, bigint, bigint, bigint, bigint, text, text) to service_role;
