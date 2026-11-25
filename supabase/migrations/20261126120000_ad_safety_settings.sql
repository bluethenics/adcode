-- Ad safety settings (services/api/src/adSafety.ts, 2026-11-26): the administrator's switches
-- for who may advertise without review and who is paid for partner cards. One row.
--
--   creative_review       'all' | 'new-advertisers' | 'auto'  - whether a newly submitted card waits
--                         for a decision in Admin > Creatives. Default: an advertiser's cards wait
--                         until one of theirs has been approved.
--   cards_need_verified   partner cards pay only accounts with a verified email.
--
-- Server-only, like every money table: no policy, service_role only. The service reads the
-- defaults when this table is missing, so it may be deployed before this runs.
begin;

create table if not exists public.ad_safety_settings (
  id integer primary key default 1 check (id = 1),
  creative_review text not null default 'new-advertisers' check (creative_review in ('auto', 'new-advertisers', 'all')),
  cards_need_verified boolean not null default true,
  updated_at bigint,
  updated_by text
);
insert into public.ad_safety_settings (id) values (1) on conflict (id) do nothing;

alter table public.ad_safety_settings enable row level security;
alter table public.ad_safety_settings force row level security;
revoke all on public.ad_safety_settings from public, anon, authenticated;
grant select, insert, update on public.ad_safety_settings to service_role;

commit;
