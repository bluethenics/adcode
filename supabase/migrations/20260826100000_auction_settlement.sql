-- Auction prices are immutable facts of a serve. Persist them before accepting receipts,
-- then settle the receipt, developer earning, balance, and advertiser spend together.
alter table public.serves
  add column if not exists max_bid_cpm_micros bigint not null default 0,
  add column if not exists clearing_cpm_micros bigint not null default 0,
  add column if not exists cost_micros bigint not null default 0;

alter table public.serving_config
  add column if not exists floor_cpm_micros bigint not null default 3000000,
  add column if not exists auction_increment_cpm_micros bigint not null default 10000;

-- Rows created before this migration used the configured fixed CPM. Preserve that price
-- so queued receipts remain payable after the deployment.
update public.serves
set max_bid_cpm_micros = coalesce((select default_cpm_micros from public.serving_config where id = 1), 8000000),
    clearing_cpm_micros = coalesce((select default_cpm_micros from public.serving_config where id = 1), 8000000),
    cost_micros = coalesce((select default_cpm_micros from public.serving_config where id = 1), 8000000) / 1000;

create or replace function public.settle_receipt(
  p_receipt_id text,
  p_uid text,
  p_creative_id text,
  p_campaign_id text,
  p_outcome text,
  p_credited_micros bigint,
  p_cost_micros bigint,
  p_receipt_created_at bigint,
  p_entry_id text,
  p_entry_kind text,
  p_entry_micros bigint,
  p_entry_ref_id text,
  p_entry_created_at bigint,
  p_entry_description text,
  p_available_delta bigint,
  p_lifetime_delta bigint,
  p_pending_delta bigint
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  insert into public.receipts (
    receipt_id, uid, creative_id, campaign_id, outcome, credited_micros, cost_micros, created_at
  ) values (
    p_receipt_id, p_uid, p_creative_id, p_campaign_id, p_outcome,
    p_credited_micros, p_cost_micros, p_receipt_created_at
  ) on conflict (receipt_id) do nothing;

  get diagnostics inserted = row_count;
  if inserted = 0 then
    return false;
  end if;

  insert into public.ledger_entries (
    entry_id, uid, kind, micros, ref_id, created_at, description
  ) values (
    p_entry_id, p_uid, p_entry_kind, p_entry_micros, p_entry_ref_id,
    p_entry_created_at, p_entry_description
  );

  insert into public.balances (
    uid, available_micros, lifetime_micros, pending_withdrawal_micros
  ) values (
    p_uid, p_available_delta, p_lifetime_delta, p_pending_delta
  ) on conflict (uid) do update set
    available_micros = public.balances.available_micros + excluded.available_micros,
    lifetime_micros = public.balances.lifetime_micros + excluded.lifetime_micros,
    pending_withdrawal_micros = public.balances.pending_withdrawal_micros + excluded.pending_withdrawal_micros;

  insert into public.campaign_spend (campaign_id, spent_micros)
  values (p_campaign_id, p_cost_micros)
  on conflict (campaign_id) do update set
    spent_micros = public.campaign_spend.spent_micros + excluded.spent_micros;

  return true;
end;
$$;

revoke all on function public.settle_receipt(
  text,text,text,text,text,bigint,bigint,bigint,text,text,bigint,text,bigint,text,bigint,bigint,bigint
) from anon, authenticated;
