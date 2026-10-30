-- AI requests prove editor use even when the client never flushes activity or ads.
-- Aggregate first and last per UTC day so every day remains visible without adding
-- hundreds of thousands of individual calls to each growth calculation.
create or replace function public.growth_sightings()
returns table(uid text, at bigint)
language sql stable security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
  with ai_days as materialized (
    select r.uid, r.started_at / 86400000 as utc_day,
           min(r.started_at) as first_at, max(r.started_at) as last_at
      from public.ai_model_requests r
     where r.source <> 'admin-test' and r.provider_started_at is not null
     group by r.uid, r.started_at / 86400000
  )
  select s.uid, s.served_at from public.serves s where not s.test
  union all
  select a.uid,
         least(greatest(coalesce(a.first_at, a.updated_at), x.start_ms), x.start_ms + 86400000 - 1)
    from public.activity_daily a
    cross join lateral (select (extract(epoch from a.day::date) * 1000)::bigint as start_ms) x
  union all
  select a.uid, a.updated_at from public.activity_daily a
  union all
  select m.uid, m.first_at from public.milestones m
  union all
  select m.uid, m.last_at from public.milestones m where m.last_at <> m.first_at
  union all
  select d.uid, d.first_at from public.milestone_days d
  union all
  select d.uid, d.last_at from public.milestone_days d where d.last_at <> d.first_at
  union all
  select a.uid, t.at from ai_days a
    cross join lateral (select a.first_at as at union all select a.last_at where a.last_at <> a.first_at) t;
$$;

revoke all on function public.growth_sightings() from public, anon, authenticated;
grant execute on function public.growth_sightings() to service_role;
