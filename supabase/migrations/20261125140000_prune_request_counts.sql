-- Prune public.request_counts (security audit 2026-11-25, docs/security/AD-EARNINGS-AUDIT-2026-11-25.md).
--
-- Every rate limit, per-minute card pace and per-day card cap in the API is a row here
-- (bump_request_count), and nothing ever deleted them: by 2026-11-25 the table held 1.33 million
-- rows (244 MB) back to 2026-08-24. The unauthenticated routes (/v1/sponsored/impression, the
-- Imprezia relay) add a row per address per minute, so anybody can make it grow, and the free
-- plan's disk is the thing it eats. A counter is only read within its own window (a minute, or a
-- UTC day for the card caps), so anything older than three days is dead weight.
--
-- NOT applied by the change that added it. The first run deletes the backlog in one statement;
-- run it in a quiet hour (`select public.prune_request_counts();`), then the cron keeps it small.
begin;

create or replace function public.prune_request_counts() returns bigint
language plpgsql security definer set search_path = '' as $$
declare removed bigint;
begin
  delete from public.request_counts
  where window_start < (extract(epoch from now() - interval '3 days') * 1000)::bigint;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.prune_request_counts() from public, anon, authenticated;
grant execute on function public.prune_request_counts() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'request-counts-prune';
select cron.schedule('request-counts-prune', '43 3 * * *', $job$set statement_timeout = '10min'; select public.prune_request_counts()$job$);

commit;
