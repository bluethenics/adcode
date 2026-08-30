-- Fix: the payout RPCs named a column that does not exist.
--
-- `20260826130000_withdrawal_lifecycle.sql` added `payment_evidence jsonb`.
-- `20260826140000_atomic_withdrawals.sql`, written next, inserted into and updated
-- `evidence`. PL/pgSQL does not resolve column names until the function body runs, so both
-- migrations applied cleanly and the fault only appeared when somebody asked to be paid:
--
--   ERROR:  42703: column "evidence" of relation "withdrawals" does not exist
--
-- Every payout request and every admin decision went through one of these two functions,
-- so the whole cash-out path threw. `withdrawals` had zero rows and `ledger_entries` zero
-- withdrawal entries at the time of this fix - nobody had ever got through.
--
-- Both functions are recreated below with the correct column name.
--
-- They also carry one new column. `destination_key_id` names the encryption key a row was
-- sealed with, so `PAYOUT_ENCRYPTION_KEY` can be rotated without every stored destination
-- becoming undecryptable at the moment the environment variable changes. Rows written
-- before it existed have a null id and are tried against every key in the ring.
alter table public.payout_profiles add column if not exists destination_key_id text;
alter table public.withdrawals add column if not exists destination_key_id text;

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
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid, 0));

  if exists (
    select 1 from public.withdrawals
    where uid = v_uid and status in ('requested', 'approved')
  ) then
    return 'in-flight';
  end if;

  select available_micros into v_available from public.balances where uid = v_uid for update;
  if coalesce(v_available, 0) < v_amount then return 'insufficient-funds'; end if;

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

revoke all on function public.reserve_withdrawal(jsonb,jsonb,bigint,bigint,bigint) from anon, authenticated;

create or replace function public.transition_withdrawal(
  p_withdrawal_id text,
  p_expected_statuses text[],
  p_status text,
  p_decided_at bigint,
  p_decided_by text,
  p_provider_ref text,
  p_note text,
  p_evidence jsonb,
  p_entry jsonb,
  p_available_delta bigint,
  p_lifetime_delta bigint,
  p_pending_delta bigint
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_uid text;
begin
  select status,uid into v_status,v_uid
  from public.withdrawals where withdrawal_id = p_withdrawal_id for update;
  if not found or not (v_status = any(p_expected_statuses)) then return false; end if;

  if p_entry is not null then
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
  end if;

  update public.withdrawals set
    status=p_status,decided_at=p_decided_at,decided_by=p_decided_by,
    provider_ref=p_provider_ref,note=p_note,payment_evidence=p_evidence
  where withdrawal_id=p_withdrawal_id;
  return true;
end;
$$;

revoke all on function public.transition_withdrawal(
  text,text[],text,bigint,text,text,text,jsonb,jsonb,bigint,bigint,bigint
) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- A returned transfer
-- ---------------------------------------------------------------------------
--
-- `paid` used to be terminal, so a Wise transfer that bounced, was recalled, or was
-- rejected by the receiving bank after the reference had been recorded had no route back
-- into the product - and no admin endpoint wrote an `adjustment` entry either, so the only
-- correction was hand-written SQL against the money ledger. `returned` is that route: a
-- distinct terminal state, reached only from `paid`.
--
-- Its ledger entry is an `adjustment`, not a `withdrawal_failed`, and the arithmetic is
-- why. At `paid` the hold has already settled - available fell at request time and pending
-- is back to zero - so `withdrawal_failed`, which adds to available *and* subtracts from
-- pending, would leave the hold negative. An adjustment moves available alone, which is
-- the only thing that needs to move. See `returnWithdrawal` in `withdrawals.ts`.
alter table public.withdrawals drop constraint if exists withdrawals_status_check;
alter table public.withdrawals add constraint withdrawals_status_check
  check (status in ('requested','approved','paid','rejected','failed','cancelled','returned'));
