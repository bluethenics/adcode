-- Model providers applying to have their models offered in ADCode (services/api/src/providerApplications.ts).
create table public.provider_applications (
  id uuid primary key,
  company text not null check (length(company) between 1 and 120),
  contact_name text not null check (length(contact_name) between 1 and 120),
  email text not null check (length(email) between 3 and 254),
  website text not null check (length(website) <= 300),
  models jsonb not null,
  api_base text not null default '' check (length(api_base) <= 300),
  offers jsonb not null,
  pricing text not null default '' check (length(pricing) <= 300),
  message text not null default '' check (length(message) <= 2000),
  status text not null default 'new' check (status in ('new', 'contacted', 'accepted', 'declined')),
  note text not null default '' check (length(note) <= 1000),
  received_at bigint not null
);
create index provider_applications_received_idx on public.provider_applications (received_at desc);
alter table public.provider_applications enable row level security;
revoke all on public.provider_applications from anon, authenticated;
grant select, insert, update on public.provider_applications to service_role;
