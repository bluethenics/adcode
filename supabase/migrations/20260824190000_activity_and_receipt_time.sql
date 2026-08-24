-- Two things the dashboards could not show without them.
--
-- 1. `receipts` recorded what happened but never *when*. Every advertiser number the
--    portal showed was therefore a lifetime total: you could see that a campaign had
--    41,000 views and not whether they arrived last Tuesday or over three months. A
--    timestamp is the whole difference between a number and a trend.
--
-- 2. Nothing recorded how the editor was actually used. `activity_daily` is where the
--    desktop app reports what a day of work looked like - characters typed by hand
--    against characters the AI agent wrote - so a developer can see the split rather
--    than guess at it.

-- ---------------------------------------------------------------------------
-- When a receipt happened
-- ---------------------------------------------------------------------------

alter table public.receipts add column if not exists created_at bigint not null default 0;

-- Backfill. Existing rows have no recorded time, and leaving them at 0 would put every
-- historical view on 1 January 1970 - a chart with one spike at the origin is worse than
-- one that starts late. The campaign's creation time is the earliest moment the receipt
-- could honestly have occurred, so that is what they get. `where created_at = 0` makes
-- this safe to re-run and keeps it away from rows written after this migration.
update public.receipts r
   set created_at = c.created_at
  from public.campaigns c
 where c.campaign_id = r.campaign_id
   and r.created_at = 0;

-- Backs the per-day rollup below: the range filter and the group-by both ride this.
create index if not exists receipts_campaign_time_idx on public.receipts (campaign_id, created_at);

-- The idempotency gate, now recording when. Replacing the function rather than adding a
-- second one keeps a single definition of "create this receipt exactly once" - two would
-- eventually disagree, and the disagreement would be money.
create or replace function public.create_receipt_if_absent(
  p_receipt_id      text,
  p_uid             text,
  p_creative_id     text,
  p_campaign_id     text,
  p_outcome         text,
  p_credited_micros bigint,
  p_cost_micros     bigint,
  p_created_at      bigint
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
    p_receipt_id, p_uid, p_creative_id, p_campaign_id, p_outcome, p_credited_micros,
    p_cost_micros, p_created_at
  )
  on conflict (receipt_id) do nothing;

  get diagnostics inserted = row_count;
  return inserted > 0;
end;
$$;

-- The old eight-argument-less signature would otherwise stay callable, and PostgREST
-- resolves an RPC by the argument names it is handed: leaving it in place means a stale
-- caller silently writes receipts with no timestamp again.
drop function if exists public.create_receipt_if_absent(text, text, text, text, text, bigint, bigint);

-- ---------------------------------------------------------------------------
-- What a day of coding looked like
--
-- One row per user per UTC day. The desktop app sends *deltas* rather than totals,
-- because a second window, a crash, or a reinstall all break the "client knows the
-- running total" assumption, and a client that under-reports its total would otherwise
-- move the number backwards. Deltas only ever add.
--
-- Character counts, never content. Nothing here can reconstruct a keystroke, a filename,
-- or a line of code - the privacy page says only tags leave the machine, and that stays
-- true.
-- ---------------------------------------------------------------------------

create table if not exists public.activity_daily (
  uid             text    not null,
  -- 'YYYY-MM-DD', UTC. Text rather than a date so the API, the in-memory store and
  -- Postgres all agree on what a day is without three timezone conversions.
  day             text    not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  -- Characters the person typed, and characters the agent inserted on their behalf.
  manual_chars    bigint  not null default 0 check (manual_chars >= 0),
  agent_chars     bigint  not null default 0 check (agent_chars >= 0),
  -- How many agent edits were accepted, and how many were rejected after review.
  accepted_edits  integer not null default 0 check (accepted_edits >= 0),
  rejected_edits  integer not null default 0 check (rejected_edits >= 0),
  files_touched   integer not null default 0 check (files_touched >= 0),
  -- Milliseconds with the editor focused and something happening.
  active_ms       bigint  not null default 0 check (active_ms >= 0),
  sessions        integer not null default 0 check (sessions >= 0),
  updated_at      bigint  not null,
  primary key (uid, day)
);

create index if not exists activity_recent_idx on public.activity_daily (uid, day desc);

do $$
begin
  execute 'alter table public.activity_daily enable row level security';
  execute 'alter table public.activity_daily force row level security';
  execute 'revoke all on public.activity_daily from anon, authenticated';
end $$;

-- Adds one report's deltas to a day. Upsert-with-addition rather than read-then-write for
-- the same reason `bump_request_count` is a function: two editor windows flushing at once
-- would both read the old row and both write their own delta over it, and the day would
-- record whichever landed second instead of the sum.
create or replace function public.add_activity(
  p_uid            text,
  p_day            text,
  p_manual_chars   bigint,
  p_agent_chars    bigint,
  p_accepted_edits integer,
  p_rejected_edits integer,
  p_files_touched  integer,
  p_active_ms      bigint,
  p_sessions       integer,
  p_updated_at     bigint
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_daily (
    uid, day, manual_chars, agent_chars, accepted_edits, rejected_edits,
    files_touched, active_ms, sessions, updated_at
  ) values (
    p_uid, p_day, p_manual_chars, p_agent_chars, p_accepted_edits, p_rejected_edits,
    p_files_touched, p_active_ms, p_sessions, p_updated_at
  )
  on conflict (uid, day) do update set
    manual_chars   = public.activity_daily.manual_chars   + excluded.manual_chars,
    agent_chars    = public.activity_daily.agent_chars    + excluded.agent_chars,
    accepted_edits = public.activity_daily.accepted_edits + excluded.accepted_edits,
    rejected_edits = public.activity_daily.rejected_edits + excluded.rejected_edits,
    -- Not a sum: a file edited on Monday and again on Monday is one file, and the client
    -- sends the day's distinct count. The larger of the two is the closest honest answer
    -- without storing the filenames, which is exactly what we refuse to store.
    files_touched  = greatest(public.activity_daily.files_touched, excluded.files_touched),
    active_ms      = public.activity_daily.active_ms      + excluded.active_ms,
    sessions       = public.activity_daily.sessions       + excluded.sessions,
    updated_at     = excluded.updated_at;
$$;

-- ---------------------------------------------------------------------------
-- The advertiser's daily rollup
--
-- Aggregated in the database, like `stats_for_campaign` and for the same reason: the
-- alternative ships every receipt row across the wire to be counted in JavaScript.
--
-- Rows come back per campaign per day. The portal sums them for the account-wide line and
-- keeps them split for the per-campaign one, so one query serves both charts.
-- ---------------------------------------------------------------------------

create or replace function public.series_for_advertiser(p_advertiser_id text, p_since bigint)
returns table (day text, campaign_id text, impressions bigint, clicks bigint, spent_micros text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    to_char(to_timestamp(r.created_at / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') as day,
    r.campaign_id,
    count(*) filter (where r.outcome <> 'click')          as impressions,
    count(*) filter (where r.outcome = 'click')           as clicks,
    coalesce(sum(r.cost_micros), 0)::text                 as spent_micros
  from public.receipts r
  join public.campaigns c on c.campaign_id = r.campaign_id
  where c.advertiser_id = p_advertiser_id
    and r.created_at >= p_since
  group by 1, 2
  order by 1 asc, 2 asc;
$$;
