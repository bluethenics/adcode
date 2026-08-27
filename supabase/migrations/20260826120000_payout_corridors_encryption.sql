create table if not exists public.payout_corridors (
  country text not null check (country ~ '^[A-Z]{2}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  enabled boolean not null default false,
  required_fields jsonb not null default '[]'::jsonb,
  source_note text not null,
  verified_at bigint,
  updated_at bigint not null,
  updated_by text not null,
  primary key (country, currency)
);

alter table public.payout_profiles
  add column if not exists destination_version integer,
  add column if not exists destination_nonce text,
  add column if not exists destination_ciphertext text,
  add column if not exists destination_tag text,
  add column if not exists destination_mask text;

alter table public.withdrawals
  add column if not exists destination_version integer,
  add column if not exists destination_nonce text,
  add column if not exists destination_ciphertext text,
  add column if not exists destination_tag text,
  add column if not exists destination_mask text;

alter table public.payout_corridors enable row level security;
alter table public.payout_corridors force row level security;
revoke all on public.payout_corridors from anon, authenticated;

insert into public.payout_corridors (
  country,currency,enabled,required_fields,source_note,verified_at,updated_at,updated_by
) values
  ('IN','INR',false,'["accountNumber","ifsc","bankName"]',
   'Verify this recipient route in the India Wise account before enabling.',null,0,'setup'),
  ('US','USD',false,'["accountNumber","routingNumber","bankName","address"]',
   'Verify this recipient route in the India Wise account before enabling.',null,0,'setup'),
  ('GB','GBP',false,'["accountNumber","sortCode","bankName"]',
   'Verify this recipient route in the India Wise account before enabling.',null,0,'setup'),
  ('DE','EUR',false,'["iban","bic","bankName"]',
   'Representative EUR corridor; verify destination country in Wise before enabling.',null,0,'setup')
on conflict (country,currency) do nothing;
