-- Run retention inside Postgres so it does not depend on website traffic.
create extension if not exists pg_cron with schema pg_catalog;

-- A named schedule is updated in place if this statement is run again.
select cron.schedule(
  'website-analytics-retention',
  '17 3 * * *',
  'select public.purge_website_analytics();'
);
