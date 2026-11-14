-- Plans on sale again (13 November 2026): Builder $19 ($190 a year), Pro $39 ($390), Max $149
-- ($1,490). Plan ids are unchanged, so the plan constraints are too; a yearly subscription is the
-- same plan with a year-long period. Wallet top-ups accept any whole-dollar amount from $5 to $1,000.
begin;
set local lock_timeout='5s';

-- Was price_cents in (1000,2000,5000,10000). Mirrors isWalletAmount in services/api/src/modelWallet.ts.
alter table public.model_wallet_orders drop constraint if exists model_wallet_orders_price_cents_check;
alter table public.model_wallet_orders add constraint model_wallet_orders_price_cents_check
  check (price_cents between 500 and 100000 and price_cents % 100 = 0);

-- MRR at the price each subscription was sold at. Periods sold at $9/$29/$59 all end by 8 December
-- (renewals were cancelled on 6 November). A period ending more than 40 days out is yearly: no
-- monthly period is that long, and it counts a twelfth of the yearly price.
create or replace function public.ai_subscription_summary(p_now bigint) returns table(plan text,active bigint,mrr_cents bigint) language sql stable set search_path=pg_catalog,public,pg_temp as $summary$
select s.plan, count(*)::bigint, sum(
  case
    when s.ends_at <= 1796688000000 then case s.plan when 'weekly' then 1300 when 'monthly' then 900 when 'pro' then 2900 when 'max' then 5900 else 29900 end
    when s.ends_at > p_now + 40::bigint*86400000 then case s.plan when 'monthly' then 19000 when 'pro' then 39000 when 'max' then 149000 else 0 end / 12
    else case s.plan when 'weekly' then 1300 when 'monthly' then 1900 when 'pro' then 3900 when 'max' then 14900 else 29900 end
  end)::bigint
from public.ai_subscriptions s where s.ends_at>p_now group by s.plan
order by case s.plan when 'weekly' then 1 when 'monthly' then 2 when 'pro' then 3 when 'max' then 4 else 5 end
$summary$;
commit;
