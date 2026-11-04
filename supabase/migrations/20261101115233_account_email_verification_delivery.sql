begin;
create table public.account_email_proofs (
  uid text primary key references public.users(uid) on delete cascade,
  email text not null,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at bigint not null,
  created_at bigint not null
);
alter table public.account_email_proofs enable row level security;
revoke all on public.account_email_proofs from public,anon,authenticated;
grant all on public.account_email_proofs to service_role;
create function public.issue_account_email_proof(p_uid text,p_email text,p_hash text,p_expires_at bigint,p_now bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_expires_at<=p_now or p_expires_at>p_now+3600000 or not exists(select 1 from public.users where uid=p_uid and lower(email)=p_email and status='active' and email_verified is not true) then return false; end if;
  insert into public.account_email_proofs values(p_uid,p_email,p_hash,p_expires_at,p_now)
  on conflict(uid) do update set email=excluded.email,token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=excluded.created_at;
  return true;
end $$;
create function public.confirm_account_email_proof(p_hash text,p_now bigint)
returns text language plpgsql security definer set search_path='' as $$
declare proof public.account_email_proofs; changed integer;
begin
  select * into proof from public.account_email_proofs where token_hash=p_hash for update;
  if not found then return 'invalid'; end if;
  if proof.expires_at<=p_now then delete from public.account_email_proofs where uid=proof.uid; return 'expired'; end if;
  update public.users set email_verified=true where uid=proof.uid and lower(email)=proof.email and status='active';
  get diagnostics changed=row_count;
  delete from public.account_email_proofs where uid=proof.uid;
  return case when changed=1 then 'verified' else 'changed-account' end;
end $$;
revoke all on function public.issue_account_email_proof(text,text,text,bigint,bigint),public.confirm_account_email_proof(text,bigint) from public,anon,authenticated;
grant execute on function public.issue_account_email_proof(text,text,text,bigint,bigint),public.confirm_account_email_proof(text,bigint) to service_role;
commit;
