-- Who is an administrator.
--
-- Admin used to be a Firebase custom claim, which meant the only way to appoint one was a
-- Google Cloud Shell command, and the only way to build a screen for it was to hand the
-- Worker a service-account private key so it could sign its own Identity Toolkit calls.
-- That is a second key with total authority over every account, to solve a problem a table
-- solves for nothing: `authenticate()` already reads this database on every request to
-- check whether the caller is banned, so reading one more row costs nothing measurable.
--
-- Keyed by **email**, not uid, for two reasons. A person appointing an administrator knows
-- their email address and does not know their Firebase uid. And an admin can be appointed
-- before they have ever signed in, which a uid-keyed table cannot express.
--
-- The address is stored lowercased. `authenticate()` lowercases before it compares, so a
-- row inserted in mixed case would silently never match.
create table if not exists public.admins (
  email     text   primary key check (email = lower(email)),
  added_by  text   not null,
  added_at  bigint not null
);

create index if not exists admins_added_idx on public.admins (added_at desc);

do $$
begin
  execute 'alter table public.admins enable row level security';
  execute 'alter table public.admins force row level security';
  execute 'revoke all on public.admins from anon, authenticated';
end $$;

-- The founding administrator.
--
-- `added_by` is 'setup' rather than a uid because nobody appointed them - the row is how
-- the first one comes into existence at all. Every other row records who granted it.
insert into public.admins (email, added_by, added_at)
values ('bluethenics01@gmail.com', 'setup', 0)
on conflict (email) do nothing;
