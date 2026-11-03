-- Expanded subscription catalogue. Deploy with the matching API; no changes to paid periods.
begin;
set local lock_timeout='5s';
alter table public.ai_subscriptions drop constraint ai_subscriptions_plan_check;
alter table public.ai_subscriptions add constraint ai_subscriptions_plan_check check(plan is null or plan in ('weekly','monthly','pro','max','unlimited'));
alter table public.ai_plan_gifts drop constraint ai_plan_gifts_plan_check;
alter table public.ai_plan_gifts add constraint ai_plan_gifts_plan_check check(plan is null or plan in ('weekly','monthly','pro','max','unlimited'));
alter table public.ai_promo_codes drop constraint ai_promo_codes_plan_check;
alter table public.ai_promo_codes add constraint ai_promo_codes_plan_check check(plan is null or plan in ('weekly','monthly','pro','max','unlimited'));
do $expanded$ declare r record; definition text; begin
for r in select oid from pg_proc where pronamespace='public'::regnamespace and proname in ('apply_ai_subscription_event','apply_ai_subscription_event_v2','ai_plan_state','ai_plan_state_v2') loop
definition:=pg_get_functiondef(r.oid);
definition:=replace(definition,'(''weekly'',''monthly'',''pro'')','(''weekly'',''monthly'',''pro'',''max'',''unlimited'')');
definition:=replace(definition,'(''weekly'', ''monthly'', ''pro'')','(''weekly'', ''monthly'', ''pro'', ''max'', ''unlimited'')');
definition:=replace(definition,'case live.plan when ''pro'' then 3','case live.plan when ''unlimited'' then 5 when ''max'' then 4 when ''pro'' then 3');
execute definition;
end loop; end $expanded$;
create or replace function public.ai_subscription_summary(p_now bigint) returns table(plan text,active bigint,mrr_cents bigint) language sql stable set search_path=pg_catalog,public,pg_temp as $summary$
select s.plan,count(*)::bigint,(count(*) * case s.plan when 'weekly' then 1300 when 'monthly' then 900 when 'pro' then 2900 when 'max' then 9900 else 29900 end)::bigint from public.ai_subscriptions s where s.ends_at>p_now group by s.plan order by case s.plan when 'weekly' then 1 when 'monthly' then 2 when 'pro' then 3 when 'max' then 4 else 5 end
$summary$;
create or replace function public.reserve_ai_fair_use(
  p_id uuid, p_uid text, p_day date, p_minute bigint, p_tokens bigint, p_cost bigint,
  p_requests_limit bigint, p_tokens_limit bigint, p_cost_limit bigint, p_rpm bigint,
  p_now bigint, p_credits bigint, p_session_limit bigint, p_weekly_limit bigint, p_session_ms bigint, p_metered boolean,
  p_paid boolean, p_free_weekly bigint
) returns text language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  w public.ai_credit_windows%rowtype;
  b public.ai_token_balances%rowtype;
  free_left bigint; free_hold bigint := 0; paid_hold bigint := 0; result text;
begin
  if p_paid then
    if p_free_weekly < 0 or p_tokens < 0 then raise exception 'Invalid paid hold'; end if;
    -- Locks in settle_included_ai's order - the day's usage row, the credit windows, then the
    -- paid week and the balance - so a request starting while another finishes can never wait on
    -- it in a cycle. reserve_unlimited_ai takes the first two again below; this transaction
    -- already holds them.
    insert into public.tagflow_usage(uid, day) values (p_uid, p_day) on conflict do nothing;
    perform 1 from public.tagflow_usage where uid = p_uid and day = p_day for update;
    if p_metered then
      perform pg_advisory_xact_lock(hashtext('ai_credit_windows:' || p_uid));
      perform 1 from public.ai_credit_windows where uid = p_uid and kind in ('session', 'week') order by kind for update;
    end if;
    -- One account's paid holds take turns, so two requests never both spend the same token.
    perform pg_advisory_xact_lock(hashtext('ai_tokens:' || p_uid));
    select * into w from public.ai_credit_windows where uid = p_uid and kind = 'cost_day' for update;
    if not found or w.ends_at <= p_now then
      w.uid := p_uid; w.kind := 'cost_day'; w.started_at := p_now; w.ends_at := p_now + 86400000;
      w.used_millicredits := 0; w.reserved_millicredits := 0;
    end if;
    insert into public.ai_token_balances(uid) values (p_uid) on conflict do nothing;
    select * into b from public.ai_token_balances where uid = p_uid for update;
    free_left := greatest(0, p_free_weekly - w.used_millicredits - w.reserved_millicredits);
    if free_left <= 0 or p_tokens > free_left then return 'paid-limit'; end if;
    free_hold := least(p_tokens, free_left);
    paid_hold := p_tokens - free_hold;
  end if;
  result := public.reserve_unlimited_ai(p_id, p_uid, p_day, p_minute, p_tokens, p_cost, p_requests_limit, p_tokens_limit, p_cost_limit, p_rpm,
    p_now, p_credits, p_session_limit, p_weekly_limit, p_session_ms, p_metered);
  if result <> 'ok' or not p_paid then return result; end if;
  insert into public.ai_credit_windows as cw (uid, kind, started_at, ends_at, used_millicredits, reserved_millicredits)
    values (p_uid, 'cost_day', w.started_at, w.ends_at, w.used_millicredits, w.reserved_millicredits + free_hold)
    on conflict (uid, kind) do update set started_at = excluded.started_at, ends_at = excluded.ends_at,
      used_millicredits = excluded.used_millicredits, reserved_millicredits = excluded.reserved_millicredits;
  update public.ai_token_balances set reserved = reserved + paid_hold, updated_at = p_now where uid = p_uid;
  update public.tagflow_reservations set free_tokens = free_hold, paid_tokens = paid_hold, paid_week_started_at = w.started_at, paid_window_kind = 'cost_day' where id = p_id;
  return 'ok';
end
$$;


do $permissions$ declare r record; begin for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname='reserve_ai_fair_use' loop execute format('revoke all on function %s from public, anon, authenticated',r.signature); execute format('grant execute on function %s to service_role',r.signature); end loop; end $permissions$;
commit;
