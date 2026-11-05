-- Desktop feature use (services/api/src/appUsage.ts): daily totals per fixed name, with no
-- account, project or free text. "Help improve ADCode" in the editor's Settings turns it off.
create table public.app_usage (
  day date not null,
  name text not null check (name ~ '^(cmd|page|event|addon):[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$'),
  uses bigint not null default 0 check (uses >= 0),
  clients integer not null default 0 check (clients >= 0),
  primary key (day, name)
);
alter table public.app_usage enable row level security;
revoke all on public.app_usage from anon, authenticated;
grant select on public.app_usage to service_role;

-- One install's day, added atomically: uses grow by its counts, clients by one per name.
create or replace function public.record_app_usage(p_day date, p_counts jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.app_usage (day, name, uses, clients)
  select p_day, entry.key, entry.value::bigint, 1 from jsonb_each_text(p_counts) as entry
  on conflict (day, name) do update
    set uses = public.app_usage.uses + excluded.uses, clients = public.app_usage.clients + 1;
$$;
revoke all on function public.record_app_usage(date, jsonb) from public, anon, authenticated;
grant execute on function public.record_app_usage(date, jsonb) to service_role;

-- Kept for a year; run daily through Supabase Cron with the website analytics purge.
create or replace function public.purge_app_usage() returns void
language sql security definer set search_path = '' as $$
  delete from public.app_usage where day < (now() - interval '365 days')::date;
$$;
revoke all on function public.purge_app_usage() from public, anon, authenticated;
grant execute on function public.purge_app_usage() to service_role;
