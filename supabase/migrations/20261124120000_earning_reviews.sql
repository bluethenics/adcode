-- Earnings review (services/api/src/earningReview.ts): accounts that look like ad farming -
-- throwaway inboxes, one mailbox behind several accounts, custom domains shared by several
-- accounts or earning fast, cards claimed faster than a screen shows them - are held until an
-- administrator clears or blocks them. Held: no new card earns, no conversion, no payout.
-- Nothing is taken away. Server-only, like every money table.
begin;

create table public.earning_reviews (
  uid text primary key references public.users(uid) on delete cascade,
  status text not null default 'review' check (status in ('review', 'cleared', 'blocked')),
  reasons text[] not null default '{}',
  email text,
  domain text,
  flagged_at bigint not null,
  decided_at bigint,
  decided_by text,
  note text check (note is null or length(note) <= 500)
);
create index earning_reviews_queue on public.earning_reviews(status, flagged_at desc);
create index earning_reviews_domain on public.earning_reviews(domain) where status = 'review';

-- Domains an administrator vouched for (a company, a university): the custom-domain rules skip them.
create table public.earning_trusted_domains (
  domain text primary key check (domain ~ '^[a-z0-9.-]+\.[a-z0-9-]{2,}$'),
  trusted_by text not null,
  trusted_at bigint not null
);

alter table public.earning_reviews enable row level security;
alter table public.earning_trusted_domains enable row level security;
revoke all on public.earning_reviews, public.earning_trusted_domains from public, anon, authenticated;
grant all on public.earning_reviews, public.earning_trusted_domains to service_role;

-- The domain and folded mailbox of an address, as earningReview.ts emailDomain/mailboxKey
-- compute them: plus tags dropped, and dots dropped at Gmail.
create function public.email_domain(p_email text) returns text
language sql immutable set search_path = '' as $$
  select nullif(split_part(lower(trim(p_email)), '@', 2), '')
$$;

create function public.email_mailbox(p_email text) returns text
language sql immutable set search_path = '' as $$
  select case
    when public.email_domain(p_email) is null then null
    when public.email_domain(p_email) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(trim(p_email)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(lower(trim(p_email)), '@', 1), '+', 1) || '@' || public.email_domain(p_email)
  end
$$;

create index users_email_domain_idx on public.users (public.email_domain(email)) where email is not null;
create index users_email_mailbox_idx on public.users (public.email_mailbox(email)) where email is not null;

-- How many accounts share this address's domain, and its mailbox. Both include the account itself.
create function public.earning_review_signals(p_email text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'domainAccounts', (select count(*) from public.users where email is not null and public.email_domain(email) = public.email_domain(p_email)),
    'mailboxAccounts', (select count(*) from public.users where email is not null and public.email_mailbox(email) = public.email_mailbox(p_email))
  )
$$;

-- In review, or more reasons for an open review. A decision stands unless p_reopen (behaviour).
create function public.flag_earning_review(p_uid text, p_reasons text[], p_email text, p_domain text, p_now bigint, p_reopen boolean)
returns public.earning_reviews
language plpgsql set search_path = '' as $$
declare r public.earning_reviews;
begin
  select * into r from public.earning_reviews where uid = p_uid for update;
  if not found then
    insert into public.earning_reviews(uid, status, reasons, email, domain, flagged_at)
    values (p_uid, 'review', p_reasons, p_email, p_domain, p_now) returning * into r;
    return r;
  end if;
  if r.status <> 'review' and not p_reopen then return r; end if;
  update public.earning_reviews set
    reasons = (select array_agg(distinct x) from unnest(case when r.status = 'review' then r.reasons else '{}'::text[] end || p_reasons) as x),
    email = p_email, domain = p_domain,
    flagged_at = case when r.status = 'review' then r.flagged_at else p_now end,
    status = 'review', decided_at = null, decided_by = null, note = null
  where uid = p_uid returning * into r;
  return r;
end $$;

revoke all on function public.earning_review_signals(text), public.flag_earning_review(text, text[], text, text, bigint, boolean) from public, anon, authenticated;
grant execute on function public.earning_review_signals(text), public.flag_earning_review(text, text[], text, text, bigint, boolean) to service_role;

commit;
