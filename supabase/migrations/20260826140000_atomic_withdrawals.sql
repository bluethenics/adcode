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
    created_at,decided_at,decided_by,provider_ref,note,evidence
  ) values (
    p_withdrawal->>'withdrawal_id',v_uid,v_amount,p_withdrawal->>'status',p_withdrawal->>'method',
    p_withdrawal->>'legal_name',p_withdrawal->>'country',p_withdrawal->>'currency',
    nullif(p_withdrawal->>'email',''),nullif(p_withdrawal->>'bank_details',''),
    (p_withdrawal->>'destination_version')::integer,p_withdrawal->>'destination_nonce',
    p_withdrawal->>'destination_ciphertext',p_withdrawal->>'destination_tag',p_withdrawal->>'destination_mask',
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
    provider_ref=p_provider_ref,note=p_note,evidence=p_evidence
  where withdrawal_id=p_withdrawal_id;
  return true;
end;
$$;

revoke all on function public.transition_withdrawal(
  text,text[],text,bigint,text,text,text,jsonb,jsonb,bigint,bigint,bigint
) from anon, authenticated;
