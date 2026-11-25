-- Ad integrity (services/api/src/adIntegrity.ts): server-side guards on partner-card claims and
-- a circuit breaker per ad network, after Zeekend suspended ADCode on 2026-11-25 for cards the
-- app requested on a 30 s timer. NOT applied by the change that added it.
-- Server-only, like every money table: no policy, service_role only.
begin;

-- One row per (account, conversation): when the last claim came, how many 25-35 s gaps in a row
-- led to it, and the claims of the last hour.
create table public.ad_integrity_beats (
  uid text not null,
  conversation text not null check (length(conversation) between 1 and 128),
  last_at bigint not null,
  beat_run integer not null default 0,
  hour_ats bigint[] not null default '{}',
  primary key (uid, conversation)
);
create index ad_integrity_beats_last on public.ad_integrity_beats(last_at);

-- Counters in time buckets: claims, repeats and cap breaches per network per minute, claims per
-- country per 10 s, claims per account per day (network '_account').
create table public.ad_integrity_buckets (
  network text not null,
  kind text not null,
  bucket bigint not null,
  n integer not null default 0,
  primary key (network, kind, bucket)
);

create table public.ad_network_breakers (
  network text primary key,
  open boolean not null,
  reason text,
  opened_at bigint,
  closed_by text,
  closed_at bigint
);

create table public.ad_integrity_alerts (
  id bigint generated always as identity primary key,
  network text not null,
  reason text not null,
  details jsonb not null default '{}',
  at bigint not null
);
create index ad_integrity_alerts_recent on public.ad_integrity_alerts(at desc);

alter table public.ad_integrity_beats enable row level security;
alter table public.ad_integrity_buckets enable row level security;
alter table public.ad_network_breakers enable row level security;
alter table public.ad_integrity_alerts enable row level security;
revoke all on public.ad_integrity_beats, public.ad_integrity_buckets, public.ad_network_breakers, public.ad_integrity_alerts from public, anon, authenticated;
grant all on public.ad_integrity_beats, public.ad_integrity_buckets, public.ad_network_breakers, public.ad_integrity_alerts to service_role;

-- Records a claim and returns its pace; mirrors createMemoryAdIntegrityStore.touch.
create function public.ad_integrity_touch(p_uid text, p_conversation text, p_now bigint) returns jsonb
language plpgsql set search_path = '' as $$
declare
  prior public.ad_integrity_beats;
  gap bigint;
  run integer;
  hour bigint[];
begin
  select * into prior from public.ad_integrity_beats where uid = p_uid and conversation = p_conversation for update;
  if found then gap := p_now - prior.last_at; end if;
  run := case when gap is not null and gap between 25000 and 35000 then prior.beat_run + 1 else 0 end;
  hour := coalesce((select array_agg(a) from unnest(coalesce(prior.hour_ats, '{}')) a where a > p_now - 3600000), '{}') || p_now;
  insert into public.ad_integrity_beats(uid, conversation, last_at, beat_run, hour_ats)
    values (p_uid, p_conversation, p_now, run, hour)
    on conflict (uid, conversation) do update set last_at = excluded.last_at, beat_run = excluded.beat_run, hour_ats = excluded.hour_ats;
  return jsonb_build_object('hourCount', cardinality(hour), 'beatRun', run);
end $$;

create function public.ad_integrity_bump(p_network text, p_kind text, p_bucket bigint) returns integer
language sql set search_path = '' as $$
  insert into public.ad_integrity_buckets(network, kind, bucket, n) values (p_network, p_kind, p_bucket, 1)
  on conflict (network, kind, bucket) do update set n = public.ad_integrity_buckets.n + 1
  returning n
$$;

-- Opens a breaker, writes the alert and an audit_log row; false when it was already open.
create function public.ad_integrity_open_breaker(p_network text, p_reason text, p_details jsonb, p_now bigint) returns boolean
language plpgsql set search_path = '' as $$
declare was_open boolean;
begin
  select open into was_open from public.ad_network_breakers where network = p_network for update;
  if coalesce(was_open, false) then return false; end if;
  insert into public.ad_network_breakers(network, open, reason, opened_at) values (p_network, true, p_reason, p_now)
    on conflict (network) do update set open = true, reason = excluded.reason, opened_at = excluded.opened_at, closed_by = null, closed_at = null;
  insert into public.ad_integrity_alerts(network, reason, details, at) values (p_network, p_reason, coalesce(p_details, '{}'), p_now);
  insert into public.audit_log(admin_uid, action, subject_uid, at) values ('ad-integrity', 'ad-breaker-open:' || p_reason, p_network, p_now);
  return true;
end $$;

revoke all on function public.ad_integrity_touch(text, text, bigint), public.ad_integrity_bump(text, text, bigint), public.ad_integrity_open_breaker(text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.ad_integrity_touch(text, text, bigint), public.ad_integrity_bump(text, text, bigint), public.ad_integrity_open_breaker(text, text, jsonb, bigint) to service_role;

commit;
