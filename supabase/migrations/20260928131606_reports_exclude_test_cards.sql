-- Admin test cards are not views anybody bought.
--
-- A test serve settles as a receipt with cost_micros = 0 (receipts.ts keeps the row so a
-- replayed test receipt can never become a paid one). `public_stats` already leaves those
-- rows out; the advertiser's own reports did not, so every delivery test an admin ran showed
-- up on the portal as a "verified view" costing $0.00 - views and spend that could not agree.
--
-- Same rule as `public_stats`, and as the in-memory and Firestore stores: cost_micros > 0.

create or replace function public.stats_for_campaign(p_campaign_id text)
returns table (serves bigint, impressions bigint, clicks bigint, spent_micros text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.serves s where s.campaign_id = p_campaign_id),
    (select count(*) from public.receipts r
      where r.campaign_id = p_campaign_id and r.cost_micros > 0 and r.outcome <> 'click'),
    (select count(*) from public.receipts r
      where r.campaign_id = p_campaign_id and r.cost_micros > 0 and r.outcome = 'click'),
    (select coalesce(sum(r.cost_micros), 0)::text from public.receipts r
      where r.campaign_id = p_campaign_id and r.cost_micros > 0);
$$;

create or replace function public.series_for_advertiser(p_advertiser_id text, p_since bigint)
returns table (day text, campaign_id text, impressions bigint, clicks bigint, spent_micros text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    to_char(to_timestamp(r.created_at / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') as day,
    r.campaign_id,
    count(*) filter (where r.outcome <> 'click')          as impressions,
    count(*) filter (where r.outcome = 'click')           as clicks,
    coalesce(sum(r.cost_micros), 0)::text                 as spent_micros
  from public.receipts r
  join public.campaigns c on c.campaign_id = r.campaign_id
  where c.advertiser_id = p_advertiser_id
    and r.created_at >= p_since
    and r.cost_micros > 0
  group by 1, 2
  order by 1 asc, 2 asc;
$$;
