-- Cash out.
--
-- The ledger has had `withdrawal_requested`, `withdrawal_paid` and `withdrawal_failed`
-- since the first migration, with `provider_ref` and `currency` columns and a balance
-- fold that is unit-tested against all three - but nothing raised them, because there was
-- nowhere to record *who* was owed what and where it should go. These two tables are that
-- missing half, which is why cash-out is additive rather than a migration over live money.
--
-- Money still leaves by hand: an admin reads a request, makes a Wise transfer, and comes
-- back to record the reference. Nothing here talks to a payment provider.

-- ---------------------------------------------------------------------------
-- Where somebody wants to be paid
-- ---------------------------------------------------------------------------
--
-- One row per user, overwritten in place. This is a current preference, not a history:
-- the value that mattered for a given payment is copied onto the withdrawal row instead,
-- so editing this can never redirect a transfer already in flight.
create table if not exists public.payout_profiles (
  uid          text primary key,
  -- 'wise-email' sends to the address on their Wise account; 'bank' is ordinary bank
  -- coordinates typed by hand into Wise's recipient form.
  method       text   not null check (method in ('wise-email', 'bank')),
  -- As it appears on the receiving account. A mismatch is what makes a transfer bounce.
  legal_name   text   not null,
  country      text   not null,
  currency     text   not null,
  email        text,
  -- IBAN, account plus routing, account plus sort code - whatever the country uses. Free
  -- text on purpose: this is read by a human about to type it into Wise, and a fixed set
  -- of columns gets some country wrong.
  bank_details text,
  updated_at   bigint not null
);

-- ---------------------------------------------------------------------------
-- A request to be paid
-- ---------------------------------------------------------------------------
--
-- The destination columns are copied from the profile at request time rather than joined,
-- and the duplication is the point - see above.
create table if not exists public.withdrawals (
  withdrawal_id text primary key,
  uid           text   not null,
  amount_micros bigint not null,
  status        text   not null check (status in ('pending', 'paid', 'rejected', 'cancelled')),

  method        text   not null,
  legal_name    text   not null,
  country       text   not null,
  currency      text   not null,
  email         text,
  bank_details  text,

  created_at    bigint not null,
  decided_at    bigint,
  -- The admin who paid or refused it. Null while pending, and on a self-cancellation.
  decided_by    text,
  -- Wise's reference for the transfer, so a query years later can be traced to it.
  provider_ref  text,
  note          text
);

-- The user's own history, newest first.
create index if not exists withdrawals_uid_idx on public.withdrawals (uid, created_at desc, withdrawal_id desc);

-- The admin queue. Partial, because 'pending' is the only status anyone opens the page to
-- look at, and it stays small however many payments have already been made.
create index if not exists withdrawals_pending_idx
  on public.withdrawals (created_at desc, withdrawal_id desc)
  where status = 'pending';

create index if not exists withdrawals_recent_idx on public.withdrawals (created_at desc, withdrawal_id desc);

-- ---------------------------------------------------------------------------
-- Keyset pagination, the same shape `list_reports_page` uses
-- ---------------------------------------------------------------------------
--
-- A cursor is a withdrawal id, and ordering is (created_at desc, withdrawal_id desc) so
-- two requests made in the same millisecond still have a total order. Offset pagination
-- would skip or repeat rows whenever somebody made a request mid-scroll.
create or replace function public.list_withdrawals_page(
  p_limit  integer,
  p_status text,
  p_cursor text
) returns setof public.withdrawals
language sql
stable
security definer
set search_path = ''
as $$
  with anchor as (
    select created_at, withdrawal_id from public.withdrawals where withdrawal_id = p_cursor
  )
  select w.* from public.withdrawals w
   where (p_status is null or w.status = p_status)
     and (
       p_cursor is null
       or (w.created_at, w.withdrawal_id) < (select created_at, withdrawal_id from anchor)
     )
   order by w.created_at desc, w.withdrawal_id desc
   limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Whether the provider says it checked the address
-- ---------------------------------------------------------------------------
--
-- An address nobody confirmed is an address anybody can claim, and a payout to one is a
-- payout to whoever typed it. `authenticate()` writes this from the token's
-- `email_verified` claim on every request where it has changed.
--
-- Defaults to false, which is the correct reading for every row that predates this
-- column: nothing had been checked, because nothing was being asked.
alter table public.users add column if not exists email_verified boolean not null default false;

-- ---------------------------------------------------------------------------
-- Locked down like every other table
-- ---------------------------------------------------------------------------
--
-- The service reaches these with the service_role key, which bypasses RLS. Enabling it
-- with no policies means anon and authenticated reach nothing at all - which matters more
-- here than anywhere else in the schema, because these two tables hold the only bank
-- details the system stores.
do $$
declare
  t text;
begin
  foreach t in array array['payout_profiles', 'withdrawals']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on function public.list_withdrawals_page(integer, text, text) from anon, authenticated;
