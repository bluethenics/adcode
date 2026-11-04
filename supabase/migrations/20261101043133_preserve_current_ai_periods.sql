begin;
create table public.ai_legacy_plan_periods(uid text not null,plan text not null,ends_at bigint not null,primary key(uid,plan));
alter table public.ai_legacy_plan_periods enable row level security;
revoke all on public.ai_legacy_plan_periods from public,anon,authenticated; grant all on public.ai_legacy_plan_periods to service_role;
create function public.ai_plan_state_v3(p_uid text,p_now bigint) returns table(plan text,ends_at bigint,source text,boost_tokens bigint,valid_until bigint,legacy_until bigint) language sql stable set search_path=pg_catalog,public,pg_temp as $legacy$
select s.*,coalesce((select max(l.ends_at) from public.ai_legacy_plan_periods l where l.uid=p_uid and l.plan=s.plan and l.ends_at>p_now),0) from public.ai_plan_state_v2(p_uid,p_now) s
$legacy$;
revoke all on function public.ai_plan_state_v3(text,bigint) from public,anon,authenticated;grant execute on function public.ai_plan_state_v3(text,bigint) to service_role;
create or replace function public.reset_ai_week(p_uid text) returns text language plpgsql set search_path=pg_catalog,public,pg_temp as $reset$ begin
perform pg_advisory_xact_lock(hashtext('ai_tokens:'||p_uid));
perform 1 from public.ai_credit_windows where uid=p_uid and kind in ('paid_week','cost_day') order by kind for update;
if not found then return 'none';end if;
if exists(select 1 from public.ai_credit_windows where uid=p_uid and kind in ('paid_week','cost_day') and reserved_millicredits>0) then return 'busy';end if;
delete from public.ai_credit_windows where uid=p_uid and kind in ('paid_week','cost_day');return 'reset';end $reset$;
do $reward$ declare definition text; begin select pg_get_functiondef(oid) into definition from pg_proc where pronamespace='public'::regnamespace and proname='apply_ai_subscription_event_v2'; execute replace(definition, ', 4400000,', ', 1100000,'); end $reward$;
commit;
