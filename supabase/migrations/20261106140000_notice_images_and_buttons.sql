-- Notices can carry an https image and up to two link buttons (services/api/src/admin.ts parseNotice).
alter table public.notices
  add column image_url text check (image_url is null or (image_url like 'https://%' and length(image_url) <= 500)),
  add column image_alt text not null default '' check (length(image_alt) <= 200),
  add column buttons jsonb not null default '[]'::jsonb check (jsonb_typeof(buttons) = 'array' and jsonb_array_length(buttons) <= 2);
