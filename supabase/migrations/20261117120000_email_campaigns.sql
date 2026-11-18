-- Admin email campaigns: one message, a total cap and a daily cap, sent through Resend by the
-- same 15-minute schedule as every other bulk email.
--
-- The database owns every rule that keeps this safe, so no client can talk it out of them:
--   * only verified, active accounts with an address, never one that unsubscribed, bounced or
--     complained (email_suppressions), and never one already sent this campaign;
--   * an audience of "everyone" or only "subscribed" (said yes to product updates);
--   * the daily cap is paced across the UTC day, so 50 a day goes out about two an hour rather
--     than fifty in the first quarter hour - kinder to the sender's reputation;
--   * one campaign email per address per three days, across all campaigns;
--   * nothing at all while email_settings is switched off or has no postal address.

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  subject text not null check (length(trim(subject)) between 1 and 160),
  preheader text not null default '' check (length(preheader) <= 200),
  heading text not null check (length(trim(heading)) between 1 and 160),
  body text not null check (length(trim(body)) between 1 and 8000),
  cta_label text check (cta_label is null or length(trim(cta_label)) between 1 and 60),
  cta_url text check (cta_url is null or (cta_url ~ '^https://' and length(cta_url) <= 500)),
  audience text not null default 'everyone' check (audience in ('everyone','subscribed')),
  inactive_days integer check (inactive_days is null or inactive_days between 1 and 3650),
  total_limit integer not null check (total_limit between 1 and 100000),
  daily_limit integer not null check (daily_limit between 1 and 5000),
  status text not null default 'draft' check (status in ('draft','running','paused','completed','cancelled')),
  created_by text not null,
  created_at bigint not null,
  updated_at bigint not null,
  started_at bigint,
  finished_at bigint,
  finish_reason text
);
create index email_campaigns_status_idx on public.email_campaigns(status);

create table public.email_campaign_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  uid text not null references public.users(uid) on delete cascade,
  email text not null check (email = lower(email)),
  day date not null,
  status text not null default 'sending' check (status in ('sending','pending','sent','failed','cancelled')),
  attempts integer not null default 1,
  claimed_at bigint not null,
  lease_until bigint,
  provider_id text unique,
  sent_at bigint,
  delivered_at bigint,
  opened_at bigint,
  clicked_at bigint,
  bounced_at bigint,
  complained_at bigint,
  last_error text,
  unique (campaign_id, email)
);
create index email_campaign_sends_campaign_idx on public.email_campaign_sends(campaign_id, status);
create index email_campaign_sends_day_idx on public.email_campaign_sends(campaign_id, day);
create index email_campaign_sends_email_idx on public.email_campaign_sends(email, claimed_at);
create index email_campaign_sends_uid_idx on public.email_campaign_sends(uid);
-- Activity lookups by account, for "inactive for N days" and "came back".
create index if not exists activity_daily_uid_updated_idx on public.activity_daily(uid, updated_at);

alter table public.email_campaigns enable row level security;
alter table public.email_campaigns force row level security;
alter table public.email_campaign_sends enable row level security;
alter table public.email_campaign_sends force row level security;
revoke all on public.email_campaigns, public.email_campaign_sends from public, anon, authenticated;
grant all on public.email_campaigns, public.email_campaign_sends to service_role;

/* Who a campaign may reach right now. Shared by the claim and the audience estimate. */
create function public.email_campaign_candidates(p_audience text, p_inactive_days integer, p_now bigint)
returns table(uid text, email text, created_at bigint)
language sql stable security invoker set search_path = '' as $$
  select distinct on (lower(u.email)) u.uid, lower(u.email), u.created_at
  from public.users u
  where u.status = 'active' and u.email_verified and u.email is not null
    and not exists(select 1 from public.email_suppressions s where s.email = lower(u.email))
    and (p_audience = 'everyone' or exists(
      select 1 from public.email_preferences p
      where p.uid = u.uid and p.subscribed and p.consent_at is not null and p.email = lower(u.email)))
    and (p_inactive_days is null or not exists(
      select 1 from public.activity_daily a
      where a.uid = u.uid and a.updated_at > p_now - p_inactive_days::bigint * 86400000))
  order by lower(u.email), u.created_at desc;
$$;

create function public.email_campaign_audience(p_audience text, p_inactive_days integer, p_now bigint)
returns bigint language sql stable security invoker set search_path = '' as $$
  select count(*) from public.email_campaign_candidates(p_audience, p_inactive_days, p_now);
$$;

create function public.email_campaign_claim(p_now bigint, p_limit integer default 20)
returns table(id uuid, campaign_id uuid, uid text, email text, attempts integer, unsubscribe_token uuid, display_name text)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_day date := (to_timestamp(p_now / 1000.0) at time zone 'UTC')::date;
  v_seconds numeric := extract(epoch from (to_timestamp(p_now / 1000.0) at time zone 'UTC') - v_day::timestamp);
  v_left integer := least(greatest(p_limit, 0), 50);
  v_ids uuid[] := '{}';
  v_batch uuid[];
  c record;
  v_today integer; v_used integer; v_open integer; v_paced integer; v_room integer;
begin
  perform pg_advisory_xact_lock(726314812);
  if not exists(select 1 from public.email_settings where enabled and length(trim(postal_address)) >= 10) then return; end if;

  -- Resend keeps an idempotency key for 24 hours; an older ambiguous send is not retried blind.
  update public.email_campaign_sends s set status = 'failed', lease_until = null, last_error = 'retry-window-expired'
    where s.status in ('sending','pending') and s.claimed_at < p_now - 82800000;

  for c in select * from public.email_campaigns e where e.status = 'running' order by e.started_at, e.id loop
    exit when v_left <= 0;

    -- Retries first: they were counted on the day they were claimed.
    with due as (
      select s.id from public.email_campaign_sends s
      where s.campaign_id = c.id and s.attempts < 4
        and ((s.status = 'pending' and coalesce(s.lease_until, 0) <= p_now) or (s.status = 'sending' and s.lease_until < p_now))
      order by s.claimed_at limit v_left for update skip locked
    ), retried as (
      update public.email_campaign_sends s set status = 'sending', attempts = s.attempts + 1, lease_until = p_now + 600000
        from due where s.id = due.id returning s.id
    )
    select coalesce(array_agg(retried.id), '{}') into v_batch from retried;
    v_ids := v_ids || v_batch;
    v_left := v_left - coalesce(array_length(v_batch, 1), 0);

    select count(*) filter (where s.day = v_day),
           count(*) filter (where s.status in ('sending','pending','sent')),
           count(*) filter (where s.status in ('sending','pending'))
      into v_today, v_used, v_open
      from public.email_campaign_sends s where s.campaign_id = c.id;

    -- Paced: by this point in the UTC day, at most this share of the daily cap.
    v_paced := least(c.daily_limit, ceil(c.daily_limit * least(1, (v_seconds + 900) / 86400.0))::integer);
    v_room := least(v_paced - v_today, c.total_limit - v_used, v_left);

    if v_room > 0 then
      with picked as (
        select k.uid, k.email from public.email_campaign_candidates(c.audience, c.inactive_days, p_now) k
        where not exists(select 1 from public.email_campaign_sends x where x.campaign_id = c.id and x.email = k.email)
          and not exists(select 1 from public.email_campaign_sends x where x.email = k.email and x.claimed_at > p_now - 259200000)
        order by k.created_at desc
        limit v_room
      ), inserted as (
        insert into public.email_campaign_sends(campaign_id, uid, email, day, status, attempts, claimed_at, lease_until)
          select c.id, picked.uid, picked.email, v_day, 'sending', 1, p_now, p_now + 600000 from picked
          on conflict do nothing returning email_campaign_sends.id
      )
      select coalesce(array_agg(inserted.id), '{}') into v_batch from inserted;
      v_ids := v_ids || v_batch;
      v_left := v_left - coalesce(array_length(v_batch, 1), 0);
      v_used := v_used + coalesce(array_length(v_batch, 1), 0);
      v_open := v_open + coalesce(array_length(v_batch, 1), 0);

      -- Nobody left to ask, and nothing in flight: the campaign has reached everyone it can.
      if coalesce(array_length(v_batch, 1), 0) = 0 and v_open = 0 then
        update public.email_campaigns set status = 'completed', finished_at = p_now, finish_reason = 'audience-exhausted', updated_at = p_now where email_campaigns.id = c.id;
      end if;
    end if;

    if v_used >= c.total_limit and v_open = 0 then
      update public.email_campaigns set status = 'completed', finished_at = p_now, finish_reason = 'total-reached', updated_at = p_now
        where email_campaigns.id = c.id and status = 'running';
    end if;
  end loop;

  if coalesce(array_length(v_ids, 1), 0) = 0 then return; end if;

  -- Every recipient needs an unsubscribe link; an account that never chose gets a row that
  -- records no consent (subscribed stays false) just to hold its token.
  insert into public.email_preferences(uid, email, subscribed, last_active_at)
    select s.uid, s.email, false, p_now from public.email_campaign_sends s where s.id = any(v_ids)
    -- An address that changed since its last choice: that consent was for the old address.
    on conflict (uid) do update set subscribed = false, email = excluded.email
    where public.email_preferences.email <> excluded.email;

  return query
    select s.id, s.campaign_id, s.uid, s.email, s.attempts, p.unsubscribe_token, u.display_name
    from public.email_campaign_sends s
    join public.email_preferences p on p.uid = s.uid
    join public.users u on u.uid = s.uid
    where s.id = any(v_ids);
end $$;

create function public.email_campaign_finish(p_id uuid, p_provider_id text, p_retry boolean, p_code text, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_provider_id is not null then
    update public.email_campaign_sends set status = 'sent', provider_id = p_provider_id, sent_at = p_now, lease_until = null, last_error = null
      where id = p_id;
    perform public.email_reconcile(p_provider_id);
  else
    update public.email_campaign_sends set
        status = case when p_retry and attempts < 4 then 'pending' else 'failed' end,
        lease_until = case when p_retry and attempts < 4 then p_now + least(3600000, 60000 * (2 ^ attempts))::bigint else null end,
        last_error = p_code
      where id = p_id and status = 'sending';
  end if;
end $$;

/* Pausing keeps queued retries for later; cancelling drops them. */
create function public.email_campaign_set_status(p_id uuid, p_status text, p_now bigint)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_current text;
begin
  select status into v_current from public.email_campaigns where id = p_id for update;
  if v_current is null then return 'not-found'; end if;
  if v_current in ('completed','cancelled') then return 'finished'; end if;
  if p_status = 'running' then
    if v_current not in ('draft','paused') then return 'unchanged'; end if;
    update public.email_campaigns set status = 'running', started_at = coalesce(started_at, p_now), updated_at = p_now where id = p_id;
  elsif p_status = 'paused' then
    if v_current <> 'running' then return 'unchanged'; end if;
    update public.email_campaigns set status = 'paused', updated_at = p_now where id = p_id;
  elsif p_status = 'cancelled' then
    update public.email_campaigns set status = 'cancelled', finished_at = p_now, finish_reason = 'cancelled', updated_at = p_now where id = p_id;
    update public.email_campaign_sends set status = 'cancelled', lease_until = null where campaign_id = p_id and status = 'pending';
  else
    return 'bad-status';
  end if;
  return 'ok';
end $$;

create function public.email_campaign_stats(p_ids uuid[], p_now bigint)
returns table(campaign_id uuid, queued bigint, sent bigint, failed bigint, delivered bigint, opened bigint, clicked bigint,
  bounced bigint, complained bigint, returned bigint, today bigint, last_sent_at bigint)
language sql stable security invoker set search_path = '' as $$
  select s.campaign_id,
    count(*) filter (where s.status in ('sending','pending')),
    count(*) filter (where s.status = 'sent'),
    count(*) filter (where s.status = 'failed'),
    count(*) filter (where s.delivered_at is not null),
    count(*) filter (where s.opened_at is not null),
    count(*) filter (where s.clicked_at is not null),
    count(*) filter (where s.bounced_at is not null),
    count(*) filter (where s.complained_at is not null),
    count(*) filter (where s.status = 'sent' and exists(
      select 1 from public.activity_daily a where a.uid = s.uid and a.updated_at > s.sent_at)),
    count(*) filter (where s.day = (to_timestamp(p_now / 1000.0) at time zone 'UTC')::date),
    max(s.sent_at)
  from public.email_campaign_sends s where s.campaign_id = any(p_ids)
  group by s.campaign_id;
$$;

-- Webhooks: the earlier chain handles return emails and receipts; campaign sends are added here.
alter function public.email_apply_event(text,text,text,bigint) rename to email_apply_event_before_campaigns;
create function public.email_apply_event(p_id text, p_type text, p_provider_id text, p_now bigint)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_email text;
begin
  if exists(select 1 from public.email_webhook_events where id = p_id and processed) then return; end if;
  perform public.email_apply_event_before_campaigns(p_id, p_type, p_provider_id, p_now);
  select email into v_email from public.email_campaign_sends where provider_id = p_provider_id;
  if v_email is null then return; end if;
  if p_type = 'email.delivered' then
    update public.email_campaign_sends set delivered_at = coalesce(delivered_at, p_now) where provider_id = p_provider_id;
  elsif p_type = 'email.opened' then
    update public.email_campaign_sends set opened_at = coalesce(opened_at, p_now) where provider_id = p_provider_id;
  elsif p_type = 'email.clicked' then
    update public.email_campaign_sends set clicked_at = coalesce(clicked_at, p_now), opened_at = coalesce(opened_at, p_now) where provider_id = p_provider_id;
  elsif p_type in ('email.bounced','email.complained') then
    update public.email_campaign_sends set
      bounced_at = case when p_type = 'email.bounced' then coalesce(bounced_at, p_now) else bounced_at end,
      complained_at = case when p_type = 'email.complained' then coalesce(complained_at, p_now) else complained_at end
      where provider_id = p_provider_id;
    insert into public.email_suppressions values(v_email, case when p_type = 'email.complained' then 'complaint' else 'bounce' end, p_now)
      on conflict(email) do update set reason = excluded.reason;
    update public.email_preferences set subscribed = false, status_updates = false, status_consent_at = null,
      model_updates = false, model_consent_at = null where email = v_email;
    update public.email_campaign_sends set status = 'cancelled', lease_until = null where email = v_email and status in ('pending','sending');
  end if;
  update public.email_webhook_events set processed = true where id = p_id;
end $$;

revoke execute on function public.email_apply_event_before_campaigns(text,text,text,bigint),
  public.email_apply_event(text,text,text,bigint),
  public.email_campaign_candidates(text,integer,bigint), public.email_campaign_audience(text,integer,bigint),
  public.email_campaign_claim(bigint,integer), public.email_campaign_finish(uuid,text,boolean,text,bigint),
  public.email_campaign_set_status(uuid,text,bigint), public.email_campaign_stats(uuid[],bigint)
  from public, anon, authenticated;
grant execute on function public.email_apply_event_before_campaigns(text,text,text,bigint),
  public.email_apply_event(text,text,text,bigint),
  public.email_campaign_candidates(text,integer,bigint), public.email_campaign_audience(text,integer,bigint),
  public.email_campaign_claim(bigint,integer), public.email_campaign_finish(uuid,text,boolean,text,bigint),
  public.email_campaign_set_status(uuid,text,bigint), public.email_campaign_stats(uuid[],bigint)
  to service_role;
