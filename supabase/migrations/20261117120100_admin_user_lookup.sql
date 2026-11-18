-- Admin user lookup.
--
-- The users screen used to search only the newest 200 accounts, in the browser. These answer
-- across every account, by uid, address or name, in one round trip each. Needs
-- 20261117120000_email_campaigns.sql first (the profile lists campaign emails).

create function public.admin_user_search(p_q text, p_limit integer default 25)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with q as (
    select trim(p_q) as exact, lower(trim(p_q)) as raw,
      '%' || replace(replace(replace(lower(trim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
      replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as prefix
  ), hits as (
    select u.uid, u.email, u.display_name, u.photo_url, u.status, u.email_verified, u.created_at,
      case
        when u.uid = q.exact then 0
        when lower(u.email) = q.raw then 1
        when u.uid like q.prefix then 2
        when lower(u.email) like q.raw || '%' then 3
        else 4 end as rank
    from public.users u, q
    where length(q.raw) >= 2 and (
      u.uid = q.exact or u.uid like q.prefix
      or lower(u.email) like q.pattern
      or lower(u.display_name) like q.pattern)
    order by rank, u.created_at desc
    limit least(greatest(p_limit, 1), 50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'uid', h.uid, 'email', h.email, 'displayName', h.display_name, 'photoUrl', h.photo_url,
    'status', h.status, 'emailVerified', h.email_verified, 'createdAt', h.created_at,
    'lastActiveAt', (select max(a.updated_at) from public.activity_daily a where a.uid = h.uid)
  ) order by h.rank, h.created_at desc), '[]'::jsonb) from hits h;
$$;

create function public.admin_user_profile(p_uid text, p_now bigint)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_user public.users;
  v_email text;
  v_day date := (to_timestamp(p_now / 1000.0) at time zone 'UTC')::date;
  v_result jsonb;
begin
  select * into v_user from public.users where uid = p_uid;
  if not found then return null; end if;
  v_email := lower(v_user.email);
  select jsonb_build_object(
    'uid', v_user.uid, 'email', v_user.email, 'displayName', v_user.display_name, 'photoUrl', v_user.photo_url,
    'status', v_user.status, 'emailVerified', v_user.email_verified, 'createdAt', v_user.created_at, 'linkedAt', v_user.linked_at,
    'isAdmin', v_email is not null and exists(select 1 from public.admins a where lower(a.email) = v_email),
    'activity', (select jsonb_build_object(
        'lastActiveAt', max(a.updated_at), 'firstSeenAt', min(coalesce(a.first_at, a.updated_at)),
        'daysActive', count(*), 'daysActive30', count(*) filter (where a.day::date > v_day - 30),
        'sessions30', coalesce(sum(a.sessions) filter (where a.day::date > v_day - 30), 0),
        'activeMinutes30', (coalesce(sum(a.active_ms) filter (where a.day::date > v_day - 30), 0) / 60000)::bigint,
        'acceptedEdits30', coalesce(sum(a.accepted_edits) filter (where a.day::date > v_day - 30), 0))
      from public.activity_daily a where a.uid = p_uid),
    'ai', (select jsonb_build_object(
        'requests30', coalesce(sum(t.requests), 0), 'inputTokens30', coalesce(sum(t.input_tokens), 0),
        'outputTokens30', coalesce(sum(t.output_tokens), 0), 'costMicros30', coalesce(sum(t.cost_micros), 0)::text,
        'lastDay', max(t.day))
      from public.tagflow_usage t where t.uid = p_uid and t.day > v_day - 30),
    'subscription', (select jsonb_build_object('plan', s.plan, 'status', s.status, 'endsAt', s.ends_at, 'periodEnd', s.period_end,
        'cancelAtPeriodEnd', s.cancel_at_period_end)
      from public.ai_subscriptions s where s.uid = p_uid order by s.ends_at desc nulls last limit 1),
    'gift', (select jsonb_build_object('plan', g.plan, 'endsAt', g.ends_at, 'source', g.source)
      from public.ai_plan_gifts g where g.uid = p_uid and g.ends_at > p_now order by g.ends_at desc limit 1),
    'wallet', (select jsonb_build_object('balanceMicros', w.balance_micros::text, 'reservedMicros', w.reserved_micros::text)
      from public.model_wallet_balances w where w.uid = p_uid),
    'earnings', (select jsonb_build_object('availableMicros', b.available_micros::text, 'lifetimeMicros', b.lifetime_micros::text,
        'pendingWithdrawalMicros', b.pending_withdrawal_micros::text) from public.balances b where b.uid = p_uid),
    'aiBlocked', coalesce((select (p.policy ->> 'blocked')::boolean from public.tagflow_user_policies p where p.uid = p_uid), false),
    'mail', jsonb_build_object(
      'productUpdates', coalesce((select p.subscribed and p.email = v_email from public.email_preferences p where p.uid = p_uid), false),
      'statusUpdates', coalesce((select p.status_updates and p.email = v_email from public.email_preferences p where p.uid = p_uid), false),
      'modelUpdates', coalesce((select p.model_updates and p.email = v_email from public.email_preferences p where p.uid = p_uid), false),
      'suppressed', (select jsonb_build_object('reason', s.reason, 'at', s.created_at) from public.email_suppressions s where s.email = v_email),
      'campaigns', coalesce((select jsonb_agg(jsonb_build_object('campaign', c.name, 'status', x.status, 'sentAt', x.sent_at,
          'openedAt', x.opened_at, 'clickedAt', x.clicked_at) order by x.claimed_at desc)
        from (select * from public.email_campaign_sends s where s.uid = p_uid order by s.claimed_at desc limit 10) x
        join public.email_campaigns c on c.id = x.campaign_id), '[]'::jsonb)),
    'invitedBy', (select jsonb_build_object('code', a.code, 'referrerUid', a.referrer_uid, 'how', a.how, 'at', a.claimed_at)
      from public.attributions a where a.subject_kind = 'user' and a.subject_id = p_uid limit 1),
    'invited', (select count(*) from public.attributions a where a.referrer_uid = p_uid),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'adminUid', l.admin_uid, 'at', l.at) order by l.at desc)
      from (select * from public.audit_log l where l.subject_uid = p_uid order by l.at desc limit 15) l), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

/* Stop or allow ADCode's bulk email to one person. Only an unsubscribe can be undone here, never a bounce or complaint. */
create function public.admin_set_email_blocked(p_uid text, p_blocked boolean, p_now bigint)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_email text;
begin
  select lower(email) into v_email from public.users where uid = p_uid;
  if v_email is null then return 'no-email'; end if;
  if p_blocked then
    insert into public.email_suppressions values(v_email, 'unsubscribe', p_now) on conflict(email) do nothing;
    update public.email_preferences set subscribed = false where email = v_email;
    update public.email_jobs set status = 'cancelled', lease_until = null where email = v_email and status in ('pending','sending');
    update public.email_campaign_sends set status = 'cancelled', lease_until = null where email = v_email and status = 'pending';
    return 'blocked';
  end if;
  if exists(select 1 from public.email_suppressions where email = v_email and reason in ('bounce','complaint')) then return 'provider-suppressed'; end if;
  delete from public.email_suppressions where email = v_email and reason = 'unsubscribe';
  return 'allowed';
end $$;

revoke execute on function public.admin_user_search(text,integer), public.admin_user_profile(text,bigint),
  public.admin_set_email_blocked(text,boolean,bigint) from public, anon, authenticated;
grant execute on function public.admin_user_search(text,integer), public.admin_user_profile(text,bigint),
  public.admin_set_email_blocked(text,boolean,bigint) to service_role;
