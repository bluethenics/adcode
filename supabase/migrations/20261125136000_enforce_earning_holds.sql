-- APPLIED to production on 2026-11-25 (apply_migration "enforce_earning_holds"), verified in a rolled-back test. See the header below.
-- Enforce earning holds (2026-11-25, Zeekend dispute: docs/zeekend-dispute-2026-11-25).
--
-- Money the owner has placed on hold (public.earning_holds, migration 20261125135000) cannot be
-- converted to AI credits or withdrawn. The check lives in the two functions that move money, so it
-- holds for every client version and whatever the service does: convert_earnings_to_credits and
-- reserve_withdrawal. Both are the existing functions, byte for byte, plus one check after the
-- balance row is locked: what the account may spend is available minus its active holds, never
-- below zero.
--
-- A refused conversion or withdrawal answers 'insufficient-funds', the answer every client already
-- understands, with availableMicros set to what is spendable, so the convertible figure the person
-- sees is the real one. Nothing is debited, no ledger row is written, and releasing the hold
-- (public.release_earning_hold) restores the account exactly.
begin;

create or replace function public.convert_earnings_to_credits(
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
  v_spendable bigint;
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
  -- Held earnings are not the account's to convert: only what is left after every active hold.
  v_spendable := greatest(
    coalesce(v_available, 0)
    - coalesce((select sum(held_micros) from public.earning_holds where uid = p_uid and released_at is null), 0),
    0);
  if v_spendable < p_earnings then
    return jsonb_build_object('status', 'insufficient-funds', 'availableMicros', v_spendable::text);
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

create or replace function public.reserve_withdrawal(
  p_withdrawal jsonb,
  p_entry jsonb,
  p_available_delta bigint,
  p_lifetime_delta bigint,
  p_pending_delta bigint
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := p_withdrawal->>'uid';
  v_amount bigint := (p_withdrawal->>'amount_micros')::bigint;
  v_available bigint;
  v_spendable bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid, 0));

  if exists (
    select 1 from public.withdrawals
    where uid = v_uid and status in ('requested', 'approved')
  ) then
    return 'in-flight';
  end if;

  select available_micros into v_available from public.balances where uid = v_uid for update;
  -- Held earnings cannot be withdrawn: only what is left after every active hold.
  v_spendable := greatest(
    coalesce(v_available, 0)
    - coalesce((select sum(held_micros) from public.earning_holds where uid = v_uid and released_at is null), 0),
    0);
  if v_spendable < v_amount then return 'insufficient-funds'; end if;

  insert into public.withdrawals (
    withdrawal_id,uid,amount_micros,status,method,legal_name,country,currency,email,bank_details,
    destination_version,destination_nonce,destination_ciphertext,destination_tag,destination_mask,
    destination_key_id,
    created_at,decided_at,decided_by,provider_ref,note,payment_evidence
  ) values (
    p_withdrawal->>'withdrawal_id',v_uid,v_amount,p_withdrawal->>'status',p_withdrawal->>'method',
    p_withdrawal->>'legal_name',p_withdrawal->>'country',p_withdrawal->>'currency',
    nullif(p_withdrawal->>'email',''),nullif(p_withdrawal->>'bank_details',''),
    (p_withdrawal->>'destination_version')::integer,p_withdrawal->>'destination_nonce',
    p_withdrawal->>'destination_ciphertext',p_withdrawal->>'destination_tag',p_withdrawal->>'destination_mask',
    nullif(p_withdrawal->>'destination_key_id',''),
    (p_withdrawal->>'created_at')::bigint,null,null,null,null,null
  );

  insert into public.ledger_entries (
    entry_id,uid,kind,micros,ref_id,created_at,description,reason,admin_uid,provider_ref,currency
  ) values (
    p_entry->>'entry_id',p_entry->>'uid',p_entry->>'kind',(p_entry->>'micros')::bigint,
    nullif(p_entry->>'ref_id',''),(p_entry->>'created_at')::bigint,p_entry->>'description',
    nullif(p_entry->>'reason',''),nullif(p_entry->>'admin_uid',''),
    nullif(p_entry->>'provider_ref',''),nullif(p_entry->>'currency','')
  );

  insert into public.balances (uid,available_micros,lifetime_micros,pending_withdrawal_micros)
  values (v_uid,p_available_delta,p_lifetime_delta,p_pending_delta)
  on conflict (uid) do update set
    available_micros = public.balances.available_micros + excluded.available_micros,
    lifetime_micros = public.balances.lifetime_micros + excluded.lifetime_micros,
    pending_withdrawal_micros = public.balances.pending_withdrawal_micros + excluded.pending_withdrawal_micros;

  return 'created';
end;
$$;

commit;

-- Rollback: re-run the two function bodies from 20261119120000_earnings_to_credits.sql and
-- 20260829100000_payout_rpc_evidence_fix.sql. Or leave them: with no active hold they behave as before.
