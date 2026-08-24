-- ADCode core schema.
--
-- This is the whole database. It is safe to run more than once: every statement is
-- guarded, so pasting it into the Supabase SQL Editor a second time changes nothing.
--
-- Three conventions run through the file, and breaking any of them breaks something
-- quiet and expensive:
--
--  1. **Money is `bigint` micros, never a float.** A micro is a millionth of a unit of
--     currency. Floating point cannot represent a tenth exactly, so money in `double
--     precision` is money that drifts. Reads must cast these columns to text - see the
--     note on `*_micros` in `services/api/adapters/supabaseStore.ts`.
--
--  2. **Timestamps are `bigint` epoch milliseconds, not `timestamptz`.** This deviates
--     from the usual Postgres advice on purpose. The application's `Clock` port is
--     `now(): number` and every comparison in the service is millisecond arithmetic;
--     storing `timestamptz` would put a lossy conversion on both sides of every read and
--     write to buy a timezone that the domain has no concept of.
--
--  3. **Row Level Security is on, forced, and has no policies.** That is not an
--     oversight - it is the same posture as the Firestore rules this replaces. Every
--     write goes through `services/api` using the service_role key, which bypasses RLS.
--     A policy here would be a second, weaker way into the ledger, so there isn't one.
--     `anon` and `authenticated` are additionally stripped of table privileges below,
--     so a leaked publishable key reaches nothing at all.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.users (
  uid         text primary key,
  status      text   not null default 'active' check (status in ('active', 'banned')),
  created_at  bigint not null,
  linked_at   bigint
);

create table if not exists public.advertisers (
  advertiser_id    text primary key,
  name             text   not null,
  owner_uids       text[] not null default '{}',
  status           text   not null default 'active' check (status in ('active', 'suspended')),
  -- Only ever increased by a settled payment.
  funded_micros    bigint not null default 0 check (funded_micros >= 0),
  -- Committed to active campaign budgets, so two campaigns cannot spend the same dollar.
  reserved_micros  bigint not null default 0 check (reserved_micros >= 0),
  created_at       bigint not null
);

create table if not exists public.campaigns (
  campaign_id    text primary key,
  advertiser_id  text   not null references public.advertisers (advertiser_id) on delete cascade,
  name           text   not null,
  created_at     bigint not null,
  cpm_micros     bigint not null check (cpm_micros >= 0),
  budget_micros  bigint not null check (budget_micros >= 0),
  target_tags    text[] not null default '{}',
  status         text   not null default 'active' check (status in ('active', 'paused', 'ended'))
);

create table if not exists public.creatives (
  creative_id  text primary key,
  campaign_id  text not null references public.campaigns (campaign_id) on delete cascade,
  advertiser   text not null,
  headline     text not null,
  body         text,
  click_url    text not null,
  logo_light   text not null,
  logo_dark    text not null,
  status       text not null default 'pending' check (status in ('approved', 'pending', 'rejected'))
);

create table if not exists public.serves (
  serve_id     text primary key,
  uid          text    not null,
  creative_id  text    not null,
  campaign_id  text    not null,
  served_at    bigint  not null,
  expires_at   bigint  not null,
  -- An admin test serve. Its receipt is recorded but bills nobody.
  test         boolean not null default false
);

create table if not exists public.receipts (
  receipt_id       text primary key,
  uid              text   not null,
  creative_id      text   not null,
  campaign_id      text   not null,
  outcome          text   not null,
  credited_micros  bigint not null,
  cost_micros      bigint not null
);

-- Append-only. Nothing here is ever updated or deleted: a correction is a new entry that
-- references the one it corrects. The revoke at the bottom of this file is what makes
-- that structural rather than a promise.
create table if not exists public.ledger_entries (
  entry_id     text primary key,
  uid          text   not null,
  kind         text   not null check (kind in (
                 'impression', 'click', 'reversal', 'adjustment',
                 'withdrawal_requested', 'withdrawal_paid', 'withdrawal_failed')),
  -- Signed: credits positive, debits negative.
  micros       bigint not null,
  ref_id       text,
  created_at   bigint not null,
  description  text   not null,
  reason       text,
  admin_uid    text,
  provider_ref text,
  currency     text
);

-- A cache of the fold over `ledger_entries`. Where the two disagree, the entries win.
create table if not exists public.balances (
  uid                        text primary key,
  available_micros           bigint not null default 0,
  lifetime_micros            bigint not null default 0,
  pending_withdrawal_micros  bigint not null default 0
);

create table if not exists public.campaign_spend (
  campaign_id   text primary key,
  spent_micros  bigint not null default 0
);

create table if not exists public.request_counts (
  uid           text   not null,
  window_start  bigint not null,
  count         integer not null default 0,
  primary key (uid, window_start)
);

-- Keyed by the payment provider's event id, which is what makes crediting idempotent:
-- providers retry, and a retry that credits twice is money invented.
create table if not exists public.fundings (
  event_id       text primary key,
  payment_id     text   not null,
  advertiser_id  text   not null,
  amount_micros  bigint not null,
  currency       text   not null,
  at             bigint not null
);

create table if not exists public.reports (
  report_id    text primary key,
  uid          text   not null,
  kind         text   not null,
  title        text   not null,
  body         text   not null,
  app_version  text   not null,
  platform     text   not null,
  status       text   not null default 'open' check (status in ('open', 'triaged', 'closed')),
  created_at   bigint not null
);

create table if not exists public.notices (
  notice_id   text    primary key,
  severity    text    not null check (severity in ('info', 'warning')),
  title       text    not null,
  body        text    not null,
  -- False retracts it without deleting the record, so the history stays.
  active      boolean not null default true,
  author_uid  text    not null,
  created_at  bigint  not null
);

create table if not exists public.posts (
  slug          text primary key,
  title         text    not null,
  description   text    not null default '',
  body          text    not null default '',
  status        text    not null default 'draft' check (status in ('draft', 'published')),
  surface       text    not null default 'blog' check (surface in ('blog', 'docs', 'both')),
  section       text    not null default '',
  -- `order` is reserved in SQL; the record field is `order`.
  order_index   integer not null default 0,
  related       text[]  not null default '{}',
  author_uid    text    not null,
  published_at  bigint,
  updated_at    bigint  not null,
  -- Both listings sort by "when this was last meaningfully dated": the publish time when
  -- there is one, the edit time while it is still a draft. Generated and stored so the
  -- sort is a plain indexed column rather than an expression the query planner has to
  -- recompute for every row, and so the API can express the order at all.
  sort_at       bigint  generated always as (coalesce(published_at, updated_at)) stored
);

create table if not exists public.releases (
  version       text primary key,
  title         text    not null,
  body          text    not null default '',
  highlights    text[]  not null default '{}',
  -- Whether this release is worth interrupting anybody about.
  announce      boolean not null default false,
  critical      boolean not null default false,
  status        text    not null default 'draft' check (status in ('draft', 'published')),
  authored_by   text    not null default 'human' check (authored_by in ('human', 'agent')),
  author_uid    text    not null,
  published_at  bigint,
  updated_at    bigint  not null,
  sort_at       bigint  generated always as (coalesce(published_at, updated_at)) stored
);

-- Single-use: one queued creative per uid, cleared when taken.
create table if not exists public.test_serves (
  uid          text primary key,
  creative_id  text not null
);

-- Exactly one row, ever. The check constraint is what guarantees it.
create table if not exists public.serving_config (
  id                   integer primary key default 1 check (id = 1),
  kill_switch          boolean not null default false,
  min_interval_ms      integer,
  daily_cap            integer,
  default_cpm_micros   bigint  not null default 8000000,
  rev_share_percent    bigint  not null default 50 check (rev_share_percent between 0 and 100),
  spend_shard_count    integer not null default 4,
  serve_ttl_ms         integer not null default 600000,
  rate_window_ms       integer not null default 60000,
  requests_per_window  integer not null default 120
);

create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  admin_uid    text   not null,
  action       text   not null,
  subject_uid  text   not null,
  at           bigint not null
);

-- ---------------------------------------------------------------------------
-- Indexes
--
-- Postgres does not index a foreign key column for you, and every one of these backs a
-- query the service actually makes. The composite ones are ordered to match the sort the
-- paginators use, so the index satisfies the ORDER BY instead of feeding a sort node.
-- ---------------------------------------------------------------------------

create index if not exists campaigns_advertiser_idx  on public.campaigns (advertiser_id, created_at desc);
create index if not exists campaigns_active_idx      on public.campaigns (status) where status = 'active';
create index if not exists campaigns_tags_idx        on public.campaigns using gin (target_tags);

create index if not exists creatives_campaign_idx    on public.creatives (campaign_id);
create index if not exists creatives_status_idx      on public.creatives (status);

create index if not exists serves_campaign_idx       on public.serves (campaign_id);
create index if not exists serves_lookup_idx         on public.serves (uid, creative_id, expires_at desc);

create index if not exists receipts_campaign_idx     on public.receipts (campaign_id);

create index if not exists ledger_uid_idx            on public.ledger_entries (uid, created_at desc, entry_id desc);

create index if not exists fundings_advertiser_idx   on public.fundings (advertiser_id, at desc);

create index if not exists reports_recent_idx        on public.reports (created_at desc, report_id desc);
create index if not exists users_recent_idx          on public.users (created_at desc, uid);
create index if not exists advertisers_recent_idx    on public.advertisers (created_at desc);

create index if not exists posts_published_idx       on public.posts (status, sort_at desc);
create index if not exists releases_published_idx    on public.releases (status, sort_at desc);
create index if not exists notices_active_idx        on public.notices (created_at desc);

-- ---------------------------------------------------------------------------
-- Atomic operations
--
-- PostgREST cannot express a multi-statement transaction, and four of these operations
-- are money-critical. A function body is one transaction, so each of these is atomic
-- against a concurrent caller - which a read-then-write from the application is not.
--
-- Note what is deliberately NOT here: the balance arithmetic. `applyEntry` in
-- `services/api/src/ledger.ts` is the single source of truth for what an entry does to a
-- balance, and it is tested hard. Reimplementing that fold in PL/pgSQL would create a
-- second definition of how money moves, and the day they disagree is a day nobody
-- notices. So the caller computes the three deltas and this function only applies them
-- atomically.
-- ---------------------------------------------------------------------------

create or replace function public.append_entry_and_update_balance(
  p_entry_id        text,
  p_uid             text,
  p_kind            text,
  p_micros          bigint,
  p_ref_id          text,
  p_created_at      bigint,
  p_description     text,
  p_reason          text,
  p_admin_uid       text,
  p_provider_ref    text,
  p_currency        text,
  p_available_delta bigint,
  p_lifetime_delta  bigint,
  p_pending_delta   bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A duplicate entry id raises unique_violation, which the adapter turns back into the
  -- error the in-memory store throws. Appending the same earning twice is the exact bug
  -- this guards.
  insert into public.ledger_entries (
    entry_id, uid, kind, micros, ref_id, created_at, description,
    reason, admin_uid, provider_ref, currency
  ) values (
    p_entry_id, p_uid, p_kind, p_micros, p_ref_id, p_created_at, p_description,
    p_reason, p_admin_uid, p_provider_ref, p_currency
  );

  insert into public.balances (uid, available_micros, lifetime_micros, pending_withdrawal_micros)
  values (p_uid, p_available_delta, p_lifetime_delta, p_pending_delta)
  on conflict (uid) do update set
    available_micros          = public.balances.available_micros + excluded.available_micros,
    lifetime_micros           = public.balances.lifetime_micros + excluded.lifetime_micros,
    pending_withdrawal_micros = public.balances.pending_withdrawal_micros + excluded.pending_withdrawal_micros;
end;
$$;

-- True when created, false when the id already existed. The idempotency gate: clients
-- retry receipt submission, and a retry that pays twice is money invented.
create or replace function public.create_receipt_if_absent(
  p_receipt_id      text,
  p_uid             text,
  p_creative_id     text,
  p_campaign_id     text,
  p_outcome         text,
  p_credited_micros bigint,
  p_cost_micros     bigint
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  insert into public.receipts (
    receipt_id, uid, creative_id, campaign_id, outcome, credited_micros, cost_micros
  ) values (
    p_receipt_id, p_uid, p_creative_id, p_campaign_id, p_outcome, p_credited_micros, p_cost_micros
  )
  on conflict (receipt_id) do nothing;

  get diagnostics inserted = row_count;
  return inserted > 0;
end;
$$;

create or replace function public.record_funding_if_absent(
  p_event_id      text,
  p_payment_id    text,
  p_advertiser_id text,
  p_amount_micros bigint,
  p_currency      text,
  p_at            bigint
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  insert into public.fundings (event_id, payment_id, advertiser_id, amount_micros, currency, at)
  values (p_event_id, p_payment_id, p_advertiser_id, p_amount_micros, p_currency, p_at)
  on conflict (event_id) do nothing;

  get diagnostics inserted = row_count;
  return inserted > 0;
end;
$$;

create or replace function public.add_spend(p_campaign_id text, p_micros bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.campaign_spend (campaign_id, spent_micros)
  values (p_campaign_id, p_micros)
  on conflict (campaign_id) do update set
    spent_micros = public.campaign_spend.spent_micros + excluded.spent_micros;
$$;

-- Increments this uid's counter for the window and returns the new count. Read-then-write
-- from the application would let two concurrent requests both read 99 and both write 100,
-- which is how a rate limit stops limiting.
create or replace function public.bump_request_count(p_uid text, p_window_start bigint)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.request_counts (uid, window_start, count)
  values (p_uid, p_window_start, 1)
  on conflict (uid, window_start) do update set
    count = public.request_counts.count + 1
  returning count;
$$;

-- Returns and clears any queued test serve, so a test cannot repeat forever.
create or replace function public.take_test_serve(p_uid text)
returns text
language sql
security definer
set search_path = ''
as $$
  delete from public.test_serves where uid = p_uid returning creative_id;
$$;

-- ---------------------------------------------------------------------------
-- Reads that must not become N+1
--
-- These exist because the naive version pulls whole tables across the wire and folds
-- them in JavaScript. That is fine for the in-memory store used by tests and ruinous
-- against a real database with real row counts.
-- ---------------------------------------------------------------------------

create or replace function public.stats_for_campaign(p_campaign_id text)
returns table (serves bigint, impressions bigint, clicks bigint, spent_micros text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.serves s where s.campaign_id = p_campaign_id),
    (select count(*) from public.receipts r where r.campaign_id = p_campaign_id and r.outcome <> 'click'),
    (select count(*) from public.receipts r where r.campaign_id = p_campaign_id and r.outcome = 'click'),
    (select coalesce(sum(r.cost_micros), 0)::text from public.receipts r where r.campaign_id = p_campaign_id);
$$;

-- An untargeted campaign matches everyone; that is how a house ad reaches a user whose
-- tags we have not seen before.
create or replace function public.active_campaigns_for(p_tags text[])
returns setof public.campaigns
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.campaigns
  where status = 'active'
    and (cardinality(target_tags) = 0 or target_tags && p_tags);
$$;

-- Keyset pagination. The cursor is the last row's id; the function looks up that row's
-- sort key and continues strictly after it. OFFSET would re-scan every skipped row and
-- would also skip or repeat rows when something is inserted mid-listing.
create or replace function public.list_entries_page(p_uid text, p_limit integer, p_cursor text)
returns setof public.ledger_entries
language sql
stable
security definer
set search_path = ''
as $$
  with anchor as (
    select created_at, entry_id from public.ledger_entries where entry_id = p_cursor
  )
  select e.* from public.ledger_entries e
  where e.uid = p_uid
    and (
      p_cursor is null
      or (e.created_at, e.entry_id) < (select created_at, entry_id from anchor)
    )
  order by e.created_at desc, e.entry_id desc
  limit p_limit;
$$;

create or replace function public.list_reports_page(p_limit integer, p_cursor text)
returns setof public.reports
language sql
stable
security definer
set search_path = ''
as $$
  with anchor as (
    select created_at, report_id from public.reports where report_id = p_cursor
  )
  select r.* from public.reports r
  where p_cursor is null
     or (r.created_at, r.report_id) < (select created_at, report_id from anchor)
  order by r.created_at desc, r.report_id desc
  limit p_limit;
$$;

-- Users sort newest-first but tie-break on uid ascending, matching the in-memory store.
-- A mixed sort direction cannot use a row-value comparison, so the tie is spelled out.
create or replace function public.list_users_page(p_limit integer, p_cursor text)
returns setof public.users
language sql
stable
security definer
set search_path = ''
as $$
  with anchor as (
    select created_at, uid from public.users where uid = p_cursor
  )
  select u.* from public.users u
  where p_cursor is null
     or u.created_at < (select created_at from anchor)
     or (u.created_at = (select created_at from anchor) and u.uid > (select uid from anchor))
  order by u.created_at desc, u.uid asc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Lockdown
--
-- RLS on and forced, with no policies, denies every role that is subject to it. Only
-- service_role - which bypasses RLS and lives exclusively in the API's server-side
-- environment - can reach any of this.
--
-- The revoke is belt and braces for the same goal: Supabase grants `anon` and
-- `authenticated` table privileges by default, and this takes them back. If the
-- publishable key ever leaks it reaches nothing, because there is nothing to reach.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'advertisers', 'campaigns', 'creatives', 'serves', 'receipts',
    'ledger_entries', 'balances', 'campaign_spend', 'request_counts', 'fundings',
    'reports', 'notices', 'posts', 'releases', 'test_serves', 'serving_config', 'audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on all functions in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed
--
-- The one config row. `do nothing` on conflict so re-running this file never resets a
-- rate that has been tuned in production - which is the entire reason the defaults live
-- in a row and not in the code.
-- ---------------------------------------------------------------------------

insert into public.serving_config (id, min_interval_ms, daily_cap)
values (1, 300000, 12)
on conflict (id) do nothing;
