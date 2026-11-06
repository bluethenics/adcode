-- Models a provider submits on /providers/models to go live after an administrator approves
-- (services/api/src/providerModels.ts). The API key is AES-GCM encrypted by the Worker before it
-- arrives here and is set to null as soon as the submission is approved or declined.
create table public.provider_model_submissions (
  id uuid primary key,
  company text not null check (length(company) between 1 and 120),
  contact_name text not null check (length(contact_name) between 1 and 120),
  email text not null check (length(email) between 3 and 254),
  website text not null check (length(website) <= 300),
  api_base text not null check (length(api_base) between 9 and 300),
  authentication text not null default 'bearer' check (authentication in ('bearer', 'x-api-key')),
  billing text not null check (billing in ('wallet', 'included')),
  models jsonb not null check (jsonb_typeof(models) = 'array' and jsonb_array_length(models) between 1 and 20),
  message text not null default '' check (length(message) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  note text not null default '' check (length(note) <= 1000),
  key_hint text not null default '' check (length(key_hint) <= 16),
  encrypted_key jsonb,
  received_at bigint not null,
  decided_at bigint,
  decided_by text not null default '' check (length(decided_by) <= 128),
  provider_id text not null default '' check (length(provider_id) <= 80),
  check (status = 'pending' or encrypted_key is null)
);
create index provider_model_submissions_received_idx on public.provider_model_submissions (received_at desc);
alter table public.provider_model_submissions enable row level security;
alter table public.provider_model_submissions force row level security;
revoke all on public.provider_model_submissions from anon, authenticated;
grant select, insert, update on public.provider_model_submissions to service_role;
