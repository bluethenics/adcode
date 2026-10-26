-- Status alerts for anybody, from the status page, with no ADCode account (services/api/src/statusAlerts.ts).
--
--   * status_subscribers - an address and the lists it joined: `models` (the service emails when an
--     included model degrades or fails, and when it is back to normal) and `incidents` (the incident
--     updates an administrator emails). Double opt-in: an address is `pending` and receives exactly one
--     kind of email - the confirmation - until its owner clicks it.
--   * status_model_watch - each included model's running daily counts at the last check and what
--     subscribers were last told, so the next check judges only the turns since.
--   * status_alerts / status_alert_jobs - the queue, shaped like email_announcements and its jobs.
--
-- Alerts wait for the same email_settings switch and postal address as every bulk ADCode email, and
-- honour the same bounce and complaint suppressions. Their daily cap and the confirmation cap are
-- settings, because both depend on the Resend plan: raise them with one UPDATE when the plan grows.
begin;

alter table public.email_settings
  add column if not exists status_alert_daily_limit integer not null default 40 check (status_alert_daily_limit between 0 and 100000),
  add column if not exists status_confirm_daily_limit integer not null default 30 check (status_confirm_daily_limit between 0 and 100000);

alter table public.email_daily_budget
  add column if not exists alerts_claimed integer not null default 0;

create table if not exists public.status_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and length(email) between 3 and 254),
  state text not null default 'pending' check (state in ('pending','active','unsubscribed')),
  models boolean not null default false,
  incidents boolean not null default false,
  -- What the newest confirmation email will switch on when clicked.
  pending_models boolean not null default false,
  pending_incidents boolean not null default false,
  confirm_token uuid,
  manage_token uuid not null default gen_random_uuid() unique,
  confirm_sent_at bigint,
  confirm_day date,
  confirm_sends integer not null default 0,
  confirm_provider_id text,
  created_at bigint not null,
  confirmed_at bigint,
  unsubscribed_at bigint
);
create unique index if not exists status_subscribers_confirm_idx on public.status_subscribers(confirm_token) where confirm_token is not null;
create index if not exists status_subscribers_provider_idx on public.status_subscribers(confirm_provider_id) where confirm_provider_id is not null;
create index if not exists status_subscribers_confirm_day_idx on public.status_subscribers(confirm_day);

create table if not exists public.status_model_watch (
  model_key text primary key check (length(model_key) between 1 and 300),
  name text not null,
  day text not null,
  turns bigint not null default 0,
  errors bigint not null default 0,
  notified text not null default 'operational' check (notified in ('operational','degraded','outage')),
  good_streak integer not null default 0,
  changed_at bigint,
  checked_at bigint not null
);

create table if not exists public.status_alerts (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in ('models','incidents')),
  ref text not null check (length(ref) between 1 and 400),
  subject text not null check (length(subject) between 1 and 200),
  payload jsonb not null,
  created_at bigint not null,
  unique (topic, ref)
);

create table if not exists public.status_alert_jobs (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.status_alerts(id) on delete cascade,
  subscriber_id uuid not null references public.status_subscribers(id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','cancelled','failed')),
  due_at bigint not null default 0,
  attempts integer not null default 0,
  first_attempt_at bigint,
  lease_until bigint,
  provider_id text,
  sent_at bigint,
  delivered_at bigint,
  last_error text,
  unique (alert_id, subscriber_id)
);
create index if not exists status_alert_jobs_due_idx on public.status_alert_jobs(due_at) where status in ('pending','sending');
create index if not exists status_alert_jobs_provider_idx on public.status_alert_jobs(provider_id) where provider_id is not null;
create index if not exists status_alert_jobs_subscriber_idx on public.status_alert_jobs(subscriber_id);

alter table public.status_subscribers enable row level security;
alter table public.status_subscribers force row level security;
alter table public.status_model_watch enable row level security;
alter table public.status_model_watch force row level security;
alter table public.status_alerts enable row level security;
alter table public.status_alerts force row level security;
alter table public.status_alert_jobs enable row level security;
alter table public.status_alert_jobs force row level security;
revoke all on public.status_subscribers, public.status_model_watch, public.status_alerts, public.status_alert_jobs from public, anon, authenticated;
grant all on public.status_subscribers, public.status_model_watch, public.status_alerts, public.status_alert_jobs to service_role;

-- Asks for a confirmation email. Returns whether to send one, and the token it carries. Says no -
-- silently, the form answers the same either way - when the address bounced or complained, when it
-- was sent one in the last two minutes, after five today, or past the day's confirmation budget.
-- An address already on a list goes through the same confirmation to change its lists, so nobody
-- can change another person's choices by typing their address.
create or replace function public.status_subscribe(p_email text, p_models boolean, p_incidents boolean, p_now bigint)
returns table(send boolean, confirm_token uuid)
language plpgsql security invoker set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_day date := (to_timestamp(p_now/1000.0) at time zone 'UTC')::date;
  v_row public.status_subscribers;
  v_today integer;
  v_limit integer;
begin
  if not (p_models or p_incidents) then raise exception 'no-topic'; end if;
  if length(v_email) < 3 or length(v_email) > 254 or position('@' in v_email) < 2 then raise exception 'invalid-email'; end if;
  if exists(select 1 from public.email_suppressions s where s.email=v_email and s.reason in ('bounce','complaint')) then
    return query select false, null::uuid; return;
  end if;
  perform pg_advisory_xact_lock(726314812);
  select coalesce(status_confirm_daily_limit, 30) into v_limit from public.email_settings where singleton;
  select coalesce(sum(s.confirm_sends), 0) into v_today from public.status_subscribers s where s.confirm_day=v_day;
  insert into public.status_subscribers(email, created_at) values(v_email, p_now) on conflict (email) do nothing;
  select * into v_row from public.status_subscribers s where s.email=v_email for update;
  if v_row.confirm_day is distinct from v_day then v_row.confirm_sends := 0; end if;
  if (v_row.confirm_sent_at is not null and v_row.confirm_sent_at > p_now - 120000)
     or v_row.confirm_sends >= 5 or v_today >= coalesce(v_limit, 30) then
    return query select false, null::uuid; return;
  end if;
  update public.status_subscribers s set
    pending_models=p_models, pending_incidents=p_incidents,
    -- One link per week: a newer request keeps the earlier email's link working.
    confirm_token=case when s.confirm_token is not null and s.confirm_sent_at > p_now - 604800000 then s.confirm_token else gen_random_uuid() end,
    confirm_sent_at=p_now, confirm_day=v_day, confirm_sends=v_row.confirm_sends + 1
    where s.id=v_row.id
    returning s.confirm_token into v_row.confirm_token;
  return query select true, v_row.confirm_token;
end $$;

-- The provider id of the confirmation, so a bounce on it suppresses the address like any other send.
create or replace function public.status_record_confirmation(p_email text, p_provider_id text)
returns void language sql security invoker set search_path = '' as $$
  update public.status_subscribers set confirm_provider_id=p_provider_id where email=lower(trim(p_email));
$$;

create or replace function public.status_confirm(p_token uuid, p_now bigint)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_row public.status_subscribers;
begin
  select * into v_row from public.status_subscribers where confirm_token=p_token for update;
  if v_row.id is null then return 'invalid'; end if;
  if exists(select 1 from public.email_suppressions s where s.email=v_row.email and s.reason in ('bounce','complaint')) then return 'invalid'; end if;
  if v_row.confirm_sent_at is null or v_row.confirm_sent_at < p_now - 604800000 then return 'expired'; end if;
  update public.status_subscribers set state='active', models=pending_models, incidents=pending_incidents,
    confirm_token=null, confirmed_at=p_now, unsubscribed_at=null
    where id=v_row.id;
  -- Leaving a list cancels anything still queued for it.
  update public.status_alert_jobs j set status='cancelled', lease_until=null
    from public.status_alerts a
    where a.id=j.alert_id and j.subscriber_id=v_row.id and j.status in ('pending','sending')
      and ((a.topic='models' and not v_row.pending_models) or (a.topic='incidents' and not v_row.pending_incidents));
  return 'confirmed';
end $$;

create or replace function public.status_unsubscribe(p_token uuid, p_now bigint)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  update public.status_subscribers set state='unsubscribed', models=false, incidents=false, confirm_token=null, unsubscribed_at=p_now
    where manage_token=p_token returning id into v_id;
  if v_id is null then return false; end if;
  update public.status_alert_jobs set status='cancelled', lease_until=null
    where subscriber_id=v_id and status in ('pending','sending');
  return true;
end $$;

-- Queues one alert for every active subscriber of its topic. Idempotent per topic and ref (-1).
create or replace function public.status_queue_alert(p_topic text, p_ref text, p_subject text, p_payload jsonb, p_now bigint)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_count integer;
begin
  insert into public.status_alerts(topic, ref, subject, payload, created_at)
    values(p_topic, p_ref, p_subject, p_payload, p_now)
    on conflict (topic, ref) do nothing returning id into v_id;
  if v_id is null then return -1; end if;
  insert into public.status_alert_jobs(alert_id, subscriber_id, email, due_at)
    select v_id, s.id, s.email, p_now from public.status_subscribers s
    where s.state='active' and case p_topic when 'models' then s.models when 'incidents' then s.incidents else false end
      and not exists(select 1 from public.email_suppressions x where x.email=s.email and x.reason in ('bounce','complaint'))
    on conflict (alert_id, subscriber_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Claims due alerts under the sending switch and the alerts' own daily cap. An alert older than six
-- hours is dropped rather than sent: "this model is failing" is useless the next morning.
create or replace function public.status_claim_alerts(p_now bigint, p_limit integer default 10)
returns table(id uuid, email text, attempts integer, topic text, subject text, payload jsonb, manage_token uuid)
language plpgsql security invoker set search_path = '' as $$
declare v_day date := (to_timestamp(p_now/1000.0) at time zone 'UTC')::date;
  v_count integer; v_limit integer; v_cap integer;
begin
  perform pg_advisory_xact_lock(726314813);
  select status_alert_daily_limit into v_cap from public.email_settings where singleton and enabled and length(trim(postal_address))>=10;
  if v_cap is null then return; end if;
  insert into public.email_daily_budget(day) values(v_day) on conflict do nothing;
  select alerts_claimed into v_count from public.email_daily_budget where day=v_day for update;
  v_limit := least(greatest(p_limit,0), 10, greatest(v_cap - v_count, 0));
  update public.status_alert_jobs j set status='failed', last_error='stale'
    from public.status_alerts a
    where a.id=j.alert_id and j.status in ('pending','sending') and a.created_at < p_now - 21600000;
  return query
    with candidates as (
      select j.id from public.status_alert_jobs j
      join public.status_alerts a on a.id=j.alert_id
      join public.status_subscribers s on s.id=j.subscriber_id
      where j.due_at<=p_now and j.attempts<5
        and (j.status='pending' or (j.status='sending' and j.lease_until<p_now))
        and s.state='active' and s.email=j.email
        and case a.topic when 'models' then s.models when 'incidents' then s.incidents else false end
        and not exists(select 1 from public.email_suppressions x where x.email=j.email and x.reason in ('bounce','complaint'))
      order by a.created_at, j.id for update of j skip locked limit v_limit
    ), claimed as (
      update public.status_alert_jobs j set status='sending', attempts=j.attempts+1,
        first_attempt_at=coalesce(j.first_attempt_at,p_now), lease_until=p_now+600000
        from candidates c where j.id=c.id returning j.*
    )
    select c.id, c.email, c.attempts, a.topic, a.subject, a.payload, s.manage_token
    from claimed c join public.status_alerts a on a.id=c.alert_id
    join public.status_subscribers s on s.id=c.subscriber_id;
  get diagnostics v_count = row_count;
  update public.email_daily_budget set alerts_claimed=alerts_claimed+v_count where day=v_day;
end $$;

create or replace function public.status_finish_alert(p_id uuid, p_provider_id text, p_retry boolean, p_code text, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_provider_id is not null then
    update public.status_alert_jobs set status='sent', provider_id=p_provider_id, sent_at=p_now, lease_until=null, last_error=null where id=p_id;
  else
    update public.status_alert_jobs set
      status=case when p_retry and attempts<5 then 'pending' else 'failed' end,
      lease_until=null, last_error=p_code, due_at=p_now+least(1800000, 60000*(2^attempts)::bigint)
      where id=p_id and status='sending';
  end if;
end $$;

-- Webhook events now also find status alerts and confirmations. A bounce or complaint suppresses the
-- address for every kind of ADCode email and takes it off the status lists.
create or replace function public.email_apply_event(p_id text,p_type text,p_provider_id text,p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_email text; v_reason text;
begin
  insert into public.email_webhook_events(id,received_at,provider_id,kind)
    values(p_id,p_now,p_provider_id,p_type) on conflict do nothing;
  if exists(select 1 from public.email_webhook_events where id=p_id and processed) then return; end if;
  v_email := coalesce(
    (select email from public.email_jobs where provider_id=p_provider_id limit 1),
    (select email from public.email_announcement_jobs where provider_id=p_provider_id limit 1),
    (select email from public.report_replies where provider_id=p_provider_id limit 1),
    (select email from public.status_alert_jobs where provider_id=p_provider_id limit 1),
    (select email from public.status_subscribers where confirm_provider_id=p_provider_id limit 1));
  if v_email is null then return; end if;
  if p_type='email.delivered' then
    update public.email_jobs set delivered_at=p_now where provider_id=p_provider_id;
    update public.email_announcement_jobs set delivered_at=p_now where provider_id=p_provider_id;
    update public.report_replies set delivered_at=p_now where provider_id=p_provider_id;
    update public.status_alert_jobs set delivered_at=p_now where provider_id=p_provider_id;
  elsif p_type in ('email.bounced','email.complained') then
    v_reason := case when p_type='email.complained' then 'complaint' else 'bounce' end;
    insert into public.email_suppressions values(v_email,v_reason,p_now)
      on conflict(email) do update set reason=excluded.reason;
    update public.email_preferences set subscribed=false,status_updates=false,status_consent_at=null,model_updates=false,model_consent_at=null where email=v_email;
    update public.email_jobs set status='cancelled',lease_until=null
      where email=v_email and status in ('pending','sending');
    update public.email_announcement_jobs set status='cancelled',lease_until=null
      where email=v_email and status in ('pending','sending');
    update public.status_subscribers set state='unsubscribed',models=false,incidents=false,confirm_token=null,unsubscribed_at=p_now
      where email=v_email;
    update public.status_alert_jobs set status='cancelled',lease_until=null
      where email=v_email and status in ('pending','sending');
  end if;
  update public.email_webhook_events set processed=true where id=p_id;
end $$;

revoke execute on function public.status_subscribe(text,boolean,boolean,bigint),
  public.status_record_confirmation(text,text),
  public.status_confirm(uuid,bigint),
  public.status_unsubscribe(uuid,bigint),
  public.status_queue_alert(text,text,text,jsonb,bigint),
  public.status_claim_alerts(bigint,integer),
  public.status_finish_alert(uuid,text,boolean,text,bigint),
  public.email_apply_event(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.status_subscribe(text,boolean,boolean,bigint),
  public.status_record_confirmation(text,text),
  public.status_confirm(uuid,bigint),
  public.status_unsubscribe(uuid,bigint),
  public.status_queue_alert(text,text,text,jsonb,bigint),
  public.status_claim_alerts(bigint,integer),
  public.status_finish_alert(uuid,text,boolean,text,bigint),
  public.email_apply_event(text,text,text,bigint) to service_role;

commit;
