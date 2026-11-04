-- Dollar credits are independent of all existing included-token balances and subscriptions.
create table public.model_wallet_balances (
 uid text primary key references public.users(uid), balance_micros bigint not null default 0,
 reserved_micros bigint not null default 0 check (reserved_micros >= 0)
);
create table public.model_wallet_orders (
 order_id text primary key check (order_id like 'aiw_%'), uid text not null references public.users(uid),
 price_cents integer not null check (price_cents in (1000,2000,5000,10000)),
 status text not null default 'pending' check (status in ('pending','paid','refunded','disputed')),
 checkout_session text unique, payment_id text unique, paid_gross_micros bigint,
 refunded_micros bigint not null default 0 check (refunded_micros >= 0),
 disputed_micros bigint not null default 0 check (disputed_micros >= 0), created_at bigint not null
);
create index model_wallet_orders_uid on public.model_wallet_orders(uid,created_at desc);
create table public.model_wallet_holds (
 id uuid primary key, uid text not null references public.users(uid), model text not null,
 held_micros bigint not null check (held_micros > 0), charged_micros bigint,
 created_at bigint not null, settled_at bigint
);
create index model_wallet_holds_uid on public.model_wallet_holds(uid,created_at) where settled_at is null;
create table public.model_wallet_ledger (
 id uuid primary key default gen_random_uuid(), uid text not null references public.users(uid),
 delta_micros bigint not null, kind text not null, ref text not null, model text not null default '',
 estimated boolean not null default false, created_at bigint not null,
 unique(kind,ref)
);
create index model_wallet_ledger_uid on public.model_wallet_ledger(uid,created_at desc);
create table public.model_wallet_events (webhook_id text primary key, order_id text not null, result text not null, created_at bigint not null);

-- These functions are available only to the authenticated server's service role. Browser clients
-- cannot select a UID, mint credit or settle their own usage. No SECURITY DEFINER bypass.
do $$ declare t text; begin
 foreach t in array array['model_wallet_balances','model_wallet_orders','model_wallet_holds','model_wallet_ledger','model_wallet_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.expire_model_wallet_holds(p_uid text,p_now bigint) returns void
language plpgsql set search_path = '' as $$
declare released bigint;
begin
 insert into public.model_wallet_balances(uid) values(p_uid) on conflict do nothing;
 perform 1 from public.model_wallet_balances where uid=p_uid for update;
 with expired as (
  update public.model_wallet_holds set settled_at=p_now,charged_micros=0
   where uid=p_uid and settled_at is null and created_at < p_now-1800000 returning held_micros
 ) select coalesce(sum(held_micros),0) into released from expired;
 update public.model_wallet_balances set reserved_micros=reserved_micros-released where uid=p_uid;
end $$;

create function public.model_wallet_view(p_uid text,p_now bigint) returns jsonb
language plpgsql set search_path = '' as $$
declare b public.model_wallet_balances;
begin
 perform public.expire_model_wallet_holds(p_uid,p_now);
 select * into b from public.model_wallet_balances where uid=p_uid;
 return jsonb_build_object('balanceMicros',b.balance_micros,'reservedMicros',b.reserved_micros,
  'availableMicros',greatest(0,b.balance_micros-b.reserved_micros),
  'orders',coalesce((select jsonb_agg(jsonb_build_object('orderId',o.order_id,'priceCents',o.price_cents,'status',o.status,'createdAt',o.created_at) order by o.created_at desc) from (select * from public.model_wallet_orders where uid=p_uid order by created_at desc limit 100) o),'[]'::jsonb),
  'activity',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'deltaMicros',l.delta_micros,'kind',l.kind,'model',l.model,'createdAt',l.created_at,'estimated',l.estimated) order by l.created_at desc) from (select * from public.model_wallet_ledger where uid=p_uid order by created_at desc limit 100) l),'[]'::jsonb));
end $$;

create function public.create_model_wallet_order(p_order text,p_uid text,p_cents integer,p_now bigint) returns boolean
language plpgsql set search_path = '' as $$
begin
 -- Serializes checkout creation per account, including before any wallet balance exists.
 perform pg_advisory_xact_lock(hashtextextended('wallet-checkout:'||p_uid,0));
 if (select count(*) from public.model_wallet_orders where uid=p_uid and created_at>p_now-600000)>=5 then return false; end if;
 insert into public.model_wallet_orders(order_id,uid,price_cents,created_at) values(p_order,p_uid,p_cents,p_now);
 return true;
end $$;

create function public.reserve_model_wallet(p_id uuid,p_uid text,p_model text,p_micros bigint,p_now bigint) returns boolean
language plpgsql set search_path = '' as $$
declare b public.model_wallet_balances;
begin
 if p_micros<=0 or p_micros>100000000 then return false; end if;
 perform public.expire_model_wallet_holds(p_uid,p_now);
 select * into b from public.model_wallet_balances where uid=p_uid for update;
 if b.balance_micros-b.reserved_micros<p_micros then return false; end if;
 insert into public.model_wallet_holds(id,uid,model,held_micros,created_at) values(p_id,p_uid,p_model,p_micros,p_now);
 update public.model_wallet_balances set reserved_micros=reserved_micros+p_micros where uid=p_uid;
 return true;
end $$;

create function public.settle_model_wallet(p_id uuid,p_micros bigint,p_estimated boolean,p_now bigint) returns void
language plpgsql set search_path = '' as $$
declare h public.model_wallet_holds; charged bigint;
begin
 select * into h from public.model_wallet_holds where id=p_id;
 if not found then return; end if;
 -- Balance first in every hold mutation, preventing reserve/settle deadlocks.
 perform 1 from public.model_wallet_balances where uid=h.uid for update;
 select * into h from public.model_wallet_holds where id=p_id for update;
 if h.settled_at is not null then return; end if;
 charged:=greatest(0,least(p_micros,h.held_micros));
 update public.model_wallet_balances set balance_micros=balance_micros-charged,reserved_micros=reserved_micros-h.held_micros where uid=h.uid;
 update public.model_wallet_holds set settled_at=p_now,charged_micros=charged where id=p_id;
 if charged>0 then insert into public.model_wallet_ledger(uid,delta_micros,kind,ref,model,estimated,created_at) values(h.uid,-charged,'usage',p_id::text,h.model,p_estimated,p_now); end if;
end $$;

create function public.apply_model_wallet_event(p_type text,p_webhook text,p_order text,p_payment text,p_session text,p_amount bigint,p_now bigint,p_tax bigint default 0) returns text
language plpgsql set search_path = '' as $$
declare o public.model_wallet_orders; total bigint; delta bigint:=0; v_result text:='review'; kind text;
begin
 if p_type='purchase' then select * into o from public.model_wallet_orders where order_id=p_order for update;
 else select * into o from public.model_wallet_orders where payment_id=p_payment for update; end if;
 if not found then return 'not-ai-tokens'; end if;
 insert into public.model_wallet_events(webhook_id,order_id,result,created_at) values(p_webhook,o.order_id,'review',p_now) on conflict do nothing;
 if not found then return 'duplicate'; end if;
 total:=o.price_cents::bigint*10000;
 if p_type='purchase' then
  if o.status<>'pending' then v_result:=case when o.payment_id=p_payment then 'duplicate' else 'review' end;
  elsif p_tax>=0 and p_amount-p_tax=total and o.checkout_session is not null and o.checkout_session=p_session and p_payment is not null and length(p_payment)>0
    and not exists(select 1 from public.model_wallet_orders where payment_id=p_payment) then
   update public.model_wallet_orders set status='paid',payment_id=p_payment,paid_gross_micros=p_amount where order_id=o.order_id;
   delta:=total; v_result:='credited'; kind:='purchase';
  end if;
 elsif p_type='dispute-release' then
  if o.status='disputed' then
   delta:=o.disputed_micros; v_result:='credited'; kind:='dispute-release';
   update public.model_wallet_orders set disputed_micros=0,status=case when refunded_micros=total then 'refunded' else 'paid' end where order_id=o.order_id;
  else v_result:='duplicate'; end if;
 elsif p_type='dispute-opened' then
  if o.status='disputed' then v_result:='duplicate';
  else
   delta:=-(total-o.refunded_micros); v_result:='refunded'; kind:='dispute';
   update public.model_wallet_orders set status='disputed',disputed_micros=-delta where order_id=o.order_id;
  end if;
 elsif p_type='refund' and o.status<>'disputed' and p_amount>0 then
  delta:=-least(ceil(p_amount::numeric*total/coalesce(o.paid_gross_micros,total))::bigint,total-o.refunded_micros); v_result:=case when delta=0 then 'duplicate' else 'refunded' end; kind:='refund';
  update public.model_wallet_orders set refunded_micros=refunded_micros-delta,status=case when refunded_micros-delta=total then 'refunded' else 'paid' end where order_id=o.order_id;
 end if;
 if delta<>0 then
  insert into public.model_wallet_balances(uid) values(o.uid) on conflict do nothing;
  update public.model_wallet_balances set balance_micros=balance_micros+delta where uid=o.uid;
  insert into public.model_wallet_ledger(uid,delta_micros,kind,ref,created_at) values(o.uid,delta,kind,p_webhook,p_now);
 end if;
 update public.model_wallet_events set result=v_result where webhook_id=p_webhook;
 return v_result;
end $$;

do $$ declare signature text; begin
 foreach signature in array array[
 'expire_model_wallet_holds(text,bigint)','model_wallet_view(text,bigint)',
 'create_model_wallet_order(text,text,integer,bigint)','reserve_model_wallet(uuid,text,text,bigint,bigint)',
 'settle_model_wallet(uuid,bigint,boolean,bigint)','apply_model_wallet_event(text,text,text,text,text,bigint,bigint,bigint)'] loop
  execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
  execute 'grant execute on function public.'||signature||' to service_role';
 end loop;
end $$;
