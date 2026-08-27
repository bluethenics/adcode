update public.withdrawals set status = 'requested' where status = 'pending';
alter table public.withdrawals drop constraint if exists withdrawals_status_check;
alter table public.withdrawals add constraint withdrawals_status_check
  check (status in ('requested','approved','paid','rejected','failed','cancelled'));

alter table public.withdrawals
  add column if not exists payment_evidence jsonb;

drop index if exists public.withdrawals_pending_idx;
create index if not exists withdrawals_review_idx
  on public.withdrawals (created_at desc, withdrawal_id desc)
  where status in ('requested','approved');
