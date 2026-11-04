-- Three plans on sale: Starter (monthly) $9, Pro $29, Max $59. Max is repriced from $99; nobody
-- had subscribed to it. Weekly and Unlimited stay valid for existing subscriptions, so the plan
-- constraints are unchanged - only the admin MRR summary needs Max's new price.
begin;
set local lock_timeout='5s';
create or replace function public.ai_subscription_summary(p_now bigint) returns table(plan text,active bigint,mrr_cents bigint) language sql stable set search_path=pg_catalog,public,pg_temp as $summary$
select s.plan,count(*)::bigint,(count(*) * case s.plan when 'weekly' then 1300 when 'monthly' then 900 when 'pro' then 2900 when 'max' then 5900 else 29900 end)::bigint from public.ai_subscriptions s where s.ends_at>p_now group by s.plan order by case s.plan when 'weekly' then 1 when 'monthly' then 2 when 'pro' then 3 when 'max' then 4 else 5 end
$summary$;
commit;
