-- Invites: codes, who arrived through which, and the daily share of what they bring in.
--
-- The terms (as people are told them): whoever invites a person gets 10% of the cost of
-- every paid view that person sees, and whoever brings an advertiser gets 5% of what it
-- spends, for 365 days from the claim. Both come out of ADCode's half; the invited
-- person's own share is never touched.
--
--   1. `referral_config` - the terms, and which advertisers are ADCode's own. A table of its
--      own rather than columns on `serving_config` or `advertisers`: those rows are read with
--      fixed column lists on nearly every request, so a web deploy that ran ahead of this
--      migration would have broken serving. Here, a missing migration breaks only invites.
--   2. `ref_codes` - one code per account that asked for one, plus campaign codes the
--      operators make for their own posts (no owner; they earn nobody anything).
--   3. `attributions` - who arrived through which code. One per person or advertiser, ever.
--   4. `referral_shares` - why a referrer was paid what they were, per person per day.
--   5. `settle_referrals` - one UTC day's pay, idempotent per referrer-day; run nightly by
--      pg_cron over the last seven days so a missed night heals itself.
--   6. `referral_summary`, `referral_source_facts`, `referrals_for_user` - the reads.
--
-- `services/api/src/referrals.ts` is the same arithmetic in TypeScript, used by the
-- in-memory store; both were run against the same fixture in a real Postgres before this
-- shipped. Change both or neither.

create table if not exists public.referral_config (
  id                  integer primary key default 1 check (id = 1),
  user_percent        bigint  not null default 10  check (user_percent between 0 and 50),
  advertiser_percent  bigint  not null default 5   check (advertiser_percent between 0 and 50),
  window_days         integer not null default 365 check (window_days between 0 and 1095),
  claim_days          integer not null default 14  check (claim_days between 0 and 60),
  house_advertiser_ids text[] not null default '{}'
);
insert into public.referral_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.ref_codes (
  code        text    primary key check (code ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  -- Null for a campaign code.
  owner_uid   text,
  label       text    not null default '' check (length(label) <= 120),
  active      boolean not null default true,
  show_name   boolean not null default true,
  created_at  bigint  not null
);
-- One code per account: this index, not application code, is what two racing first
-- requests collide on.
create unique index if not exists ref_codes_owner_idx on public.ref_codes (owner_uid) where owner_uid is not null;

create table if not exists public.attributions (
  subject_kind  text   not null check (subject_kind in ('user', 'advertiser')),
  subject_id    text   not null,
  code          text   not null references public.ref_codes (code),
  -- Copied from the code at claim time, so nothing done to the code later changes who earns.
  referrer_uid  text,
  how           text   not null check (how in ('clipboard', 'paste', 'web', 'portal')),
  claimed_at    bigint not null,
  primary key (subject_kind, subject_id)
);
create index if not exists attributions_referrer_idx on public.attributions (referrer_uid) where referrer_uid is not null;
create index if not exists attributions_code_idx on public.attributions (code, claimed_at);

create table if not exists public.referral_shares (
  day           text   not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  referrer_uid  text   not null,
  subject_kind  text   not null check (subject_kind in ('user', 'advertiser')),
  subject_id    text   not null,
  base_micros   bigint not null check (base_micros > 0),
  share_micros  bigint not null check (share_micros > 0),
  primary key (day, referrer_uid, subject_kind, subject_id)
);
create index if not exists referral_shares_subject_idx on public.referral_shares (subject_kind, subject_id);

-- The settlement reads a day of receipts by time.
create index if not exists receipts_created_at_idx on public.receipts (created_at) where cost_micros > 0;

do $$
declare
  t text;
begin
  foreach t in array array['referral_config', 'ref_codes', 'attributions', 'referral_shares'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Invite earnings and thank-you awards are ledger kinds of their own.
alter table public.ledger_entries drop constraint if exists ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check check (kind in (
  'impression', 'click', 'reversal', 'adjustment',
  'withdrawal_requested', 'withdrawal_paid', 'withdrawal_failed',
  'referral', 'contribution'
));

-- Distinct UTC days each of these accounts was seen on: a non-test serve, a day of editor
-- activity, a milestone's first or last time, or a day a milestone was reported on - the same
-- sightings `growth.ts` counts, reduced to days.
create or replace function public.referral_seen_days(p_uids text[])
returns table (uid text, days bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with sighting as (
    select s.uid, s.served_at / 86400000 as d
      from public.serves s where not s.test and s.uid = any(p_uids)
    union
    select a.uid, (extract(epoch from a.day::date) / 86400)::bigint
      from public.activity_daily a where a.uid = any(p_uids)
    union
    select m.uid, m.first_at / 86400000 from public.milestones m where m.uid = any(p_uids)
    union
    select m.uid, m.last_at / 86400000 from public.milestones m where m.uid = any(p_uids)
    union
    -- Every day a milestone was reported on (20261006180000_growth_first_seen.sql).
    select d.uid, (extract(epoch from d.day::date) / 86400)::bigint from public.milestone_days d where d.uid = any(p_uids)
  )
  select sighting.uid, count(distinct sighting.d) from sighting group by sighting.uid;
$$;

-- One UTC day's invite pay. One statement, so the ledger entry, its share rows and the
-- balance land together or not at all; the entry id `referral:<uid>:<day>` is what makes
-- a second run, or two at once, pay nobody twice.
create or replace function public.settle_referrals(p_day text, p_now bigint)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with cfg as (
    select c.user_percent,
           c.advertiser_percent,
           c.window_days::bigint * 86400000 as window_ms,
           c.house_advertiser_ids as house
      from public.referral_config c
     where c.id = 1
  ),
  bounds as (
    select (extract(epoch from p_day::date) * 1000)::bigint as day_start
  ),
  paid as (
    select r.uid, r.cost_micros, r.created_at, c.advertiser_id
      from public.receipts r
      join public.campaigns c on c.campaign_id = r.campaign_id
     cross join bounds b
     cross join cfg
     where r.created_at >= b.day_start
       and r.created_at < b.day_start + 86400000
       and r.cost_micros > 0
       and not (c.advertiser_id = any(cfg.house))
  ),
  -- `sum(bigint)` is numeric in Postgres. Without the cast back, the share below divides as
  -- a decimal and the insert rounds 1699.9 up to 1700 where the TypeScript floors to 1699.
  user_base as (
    select a.referrer_uid, 'user'::text as subject_kind, a.subject_id, sum(p.cost_micros)::bigint as base
      from paid p
      join public.attributions a on a.subject_kind = 'user' and a.subject_id = p.uid
      join public.users viewer on viewer.uid = p.uid and viewer.status = 'active'
      join public.users referrer on referrer.uid = a.referrer_uid and referrer.status = 'active'
     cross join cfg
     where p.created_at >= a.claimed_at
       and p.created_at < a.claimed_at + cfg.window_ms
     group by a.referrer_uid, a.subject_id
  ),
  advertiser_base as (
    select a.referrer_uid, 'advertiser'::text as subject_kind, a.subject_id, sum(p.cost_micros)::bigint as base
      from paid p
      join public.attributions a on a.subject_kind = 'advertiser' and a.subject_id = p.advertiser_id
      join public.users referrer on referrer.uid = a.referrer_uid and referrer.status = 'active'
     cross join cfg
     where p.created_at >= a.claimed_at
       and p.created_at < a.claimed_at + cfg.window_ms
       -- A chargeback means ADCode may never have had the money this would be a cut of.
       and not exists (
         select 1 from public.advertiser_credit_orders o
          where o.advertiser_id = p.advertiser_id
            and o.status in ('disputed', 'reversed', 'partially_reversed', 'review_required')
       )
     group by a.referrer_uid, a.subject_id
  ),
  shares as (
    select b.referrer_uid, b.subject_kind, b.subject_id, b.base,
           b.base * (case when b.subject_kind = 'user' then cfg.user_percent else cfg.advertiser_percent end) / 100 as share
      from (select * from user_base union all select * from advertiser_base) b
     cross join cfg
  ),
  positive as (
    select * from shares where share > 0
  ),
  totals as (
    select p.referrer_uid,
           sum(p.share) as micros,
           count(*) filter (where p.subject_kind = 'user') as people,
           count(*) filter (where p.subject_kind = 'advertiser') as advertisers
      from positive p
     group by p.referrer_uid
  ),
  ins as (
    insert into public.ledger_entries (entry_id, uid, kind, micros, ref_id, created_at, description)
    select 'referral:' || t.referrer_uid || ':' || p_day,
           t.referrer_uid,
           'referral',
           t.micros,
           p_day,
           p_now,
           'Invites on ' || p_day || ': ' || concat_ws(', ',
             case when t.people = 1 then '1 person' when t.people > 1 then t.people || ' people' end,
             case when t.advertisers = 1 then '1 advertiser' when t.advertisers > 1 then t.advertisers || ' advertisers' end)
      from totals t
    on conflict (entry_id) do nothing
    returning uid, micros
  ),
  ins_shares as (
    insert into public.referral_shares (day, referrer_uid, subject_kind, subject_id, base_micros, share_micros)
    select p_day, p.referrer_uid, p.subject_kind, p.subject_id, p.base, p.share
      from positive p
      join ins on ins.uid = p.referrer_uid
    on conflict do nothing
    returning 1
  ),
  bal as (
    insert into public.balances (uid, available_micros, lifetime_micros, pending_withdrawal_micros)
    select ins.uid, ins.micros, ins.micros, 0 from ins
    on conflict (uid) do update set
      available_micros = public.balances.available_micros + excluded.available_micros,
      lifetime_micros  = public.balances.lifetime_micros + excluded.lifetime_micros
    returning 1
  )
  select jsonb_build_object(
    'referrers', (select count(*) from ins),
    'micros', (select coalesce(sum(ins.micros), 0)::text from ins)
  );
$$;

-- The nightly run: the seven UTC days before today, oldest first. Six are normally no-ops;
-- the overlap is what recovers a night the job did not run.
create or replace function public.settle_referrals_recent(p_now bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today    date := (to_timestamp(p_now / 1000.0) at time zone 'UTC')::date;
  v_result   jsonb;
  v_referrers bigint := 0;
  v_micros   bigint := 0;
begin
  for i in reverse 7..1 loop
    v_result := public.settle_referrals(to_char(v_today - i, 'YYYY-MM-DD'), p_now);
    v_referrers := v_referrers + (v_result->>'referrers')::bigint;
    v_micros := v_micros + (v_result->>'micros')::bigint;
  end loop;
  return jsonb_build_object('referrers', v_referrers, 'micros', v_micros::text);
end;
$$;

create or replace function public.referral_summary(p_uid text, p_now bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select a.subject_kind, a.subject_id from public.attributions a where a.referrer_uid = p_uid
  ),
  seen as (
    select * from public.referral_seen_days(array(select m.subject_id from mine m where m.subject_kind = 'user'))
  ),
  earned as (
    select coalesce(sum(e.micros), 0) as total,
           coalesce(sum(e.micros) filter (where e.created_at >= p_now - 30::bigint * 86400000), 0) as last30
      from public.ledger_entries e
     where e.uid = p_uid and e.kind = 'referral'
  )
  select jsonb_build_object(
    'claimed', (select count(*) from mine where subject_kind = 'user'),
    'seen', (select count(*) from seen where days >= 1),
    'cameBack', (select count(*) from seen where days >= 2),
    'advertisers', (select count(*) from mine where subject_kind = 'advertiser'),
    'earnedMicros', (select total::text from earned),
    'last30Micros', (select last30::text from earned)
  );
$$;

-- One row per person or advertiser the Sources report counts: each attribution since
-- `p_since`, and each active account made since then that nobody claimed. Money is
-- measured from the claim on, so a source is credited with what it brought, not with
-- what the person did before anyone knew where they came from.
create or replace function public.referral_source_facts(p_since bigint)
returns table (
  code text, subject_kind text, subject_id text, referrer_uid text, at bigint,
  seen boolean, came_back boolean, gross_micros text, credited_micros text, paid_micros text
)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select coalesce((select c.house_advertiser_ids from public.referral_config c where c.id = 1), '{}'::text[]) as house
  ),
  subjects as (
    select a.code, a.subject_kind, a.subject_id, a.referrer_uid, a.claimed_at as at
      from public.attributions a
     where a.claimed_at >= p_since
    union all
    select null::text, 'user'::text, u.uid, null::text, u.created_at
      from public.users u
     where u.status = 'active'
       and u.created_at >= p_since
       and not exists (
         select 1 from public.attributions a where a.subject_kind = 'user' and a.subject_id = u.uid
       )
  ),
  seen as (
    select * from public.referral_seen_days(array(select s.subject_id from subjects s where s.subject_kind = 'user'))
  ),
  billable as (
    select r.uid, r.cost_micros, r.credited_micros, r.created_at, c.advertiser_id
      from public.receipts r
      join public.campaigns c on c.campaign_id = r.campaign_id
     cross join cfg
     where r.cost_micros > 0
       and not (c.advertiser_id = any(cfg.house))
  ),
  money as (
    select s.subject_kind, s.subject_id, sum(b.cost_micros) as gross, sum(b.credited_micros) as credited
      from subjects s
      join billable b
        on b.created_at >= s.at
       and ((s.subject_kind = 'user' and b.uid = s.subject_id)
         or (s.subject_kind = 'advertiser' and b.advertiser_id = s.subject_id))
     group by s.subject_kind, s.subject_id
  ),
  paid as (
    select rs.subject_kind, rs.subject_id, sum(rs.share_micros) as total
      from public.referral_shares rs
     group by rs.subject_kind, rs.subject_id
  )
  select s.code,
         s.subject_kind,
         s.subject_id,
         s.referrer_uid,
         s.at,
         s.subject_kind = 'user' and coalesce(seen.days, 0) >= 1,
         s.subject_kind = 'user' and coalesce(seen.days, 0) >= 2,
         coalesce(m.gross, 0)::text,
         coalesce(m.credited, 0)::text,
         coalesce(p.total, 0)::text
    from subjects s
    left join seen on s.subject_kind = 'user' and seen.uid = s.subject_id
    left join money m on m.subject_kind = s.subject_kind and m.subject_id = s.subject_id
    left join paid p on p.subject_kind = s.subject_kind and p.subject_id = s.subject_id
   order by s.at, s.subject_id;
$$;

-- Admin: who invited this account, and whom it invited, newest first.
create or replace function public.referrals_for_user(p_uid text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select x.subject_kind as "subjectKind", x.subject_id as "subjectId", x.code,
           x.referrer_uid as "referrerUid", x.how, x.claimed_at as "claimedAt"
      from public.attributions x
  )
  select jsonb_build_object(
    'invitedBy', (select to_jsonb(a) from a where a."subjectKind" = 'user' and a."subjectId" = p_uid),
    'invited', coalesce(
      (select jsonb_agg(to_jsonb(a) order by a."claimedAt" desc, a."subjectId") from a where a."referrerUid" = p_uid),
      '[]'::jsonb)
  );
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'referral_seen_days(text[])',
    'settle_referrals(text, bigint)',
    'settle_referrals_recent(bigint)',
    'referral_summary(text, bigint)',
    'referral_source_facts(bigint)',
    'referrals_for_user(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Nightly, half an hour after midnight UTC. A named schedule is replaced if run again.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'settle-referrals',
  '30 0 * * *',
  'select public.settle_referrals_recent((extract(epoch from now()) * 1000)::bigint);'
);
