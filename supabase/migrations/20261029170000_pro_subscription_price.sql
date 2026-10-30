-- Catalogue revenue estimate follows the new $29/month Pro plan.
-- Dodo's product price must also be updated before new Pro checkouts are enabled.
-- Honour the old 60M Weekly promise through the current paid period.
-- Renewals receive the new catalogue allowance after this temporary boost expires.
insert into public.ai_boosts (uid, weekly_tokens, starts_at, ends_at, created_by, note)
select s.uid, 60000000, (extract(epoch from now()) * 1000)::bigint, max(s.ends_at),
  'subscription-release-2026-10-29', 'Preserve existing Weekly allowance until its paid period ends'
from public.ai_subscriptions s
where s.plan = 'weekly' and s.ends_at > (extract(epoch from now()) * 1000)::bigint
  and not exists (select 1 from public.ai_boosts b where b.uid = s.uid and b.note = 'Preserve existing Weekly allowance until its paid period ends')
group by s.uid;

create or replace function public.ai_subscription_summary(p_now bigint)
returns table(plan text, active bigint, mrr_cents bigint)
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  select s.plan, count(*)::bigint,
    (count(*) * case s.plan when 'weekly' then 1300 when 'monthly' then 900 else 2900 end)::bigint
  from public.ai_subscriptions s where s.ends_at > p_now group by s.plan
  order by case s.plan when 'weekly' then 1 when 'monthly' then 2 else 3 end
$$;
