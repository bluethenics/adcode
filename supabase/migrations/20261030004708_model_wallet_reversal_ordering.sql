-- Signed provider events may arrive before the payment or in reversed dispute order.
create table public.model_wallet_pending_events (
  webhook_id text primary key,
  payment_id text not null,
  event_type text not null,
  amount_micros bigint not null,
  created_at bigint not null
);
create index model_wallet_pending_payment on public.model_wallet_pending_events(payment_id);
alter table public.model_wallet_pending_events enable row level security;
alter table public.model_wallet_pending_events force row level security;
revoke all on public.model_wallet_pending_events from public,anon,authenticated;
grant all on public.model_wallet_pending_events to service_role;
create or replace function public.apply_model_wallet_event(p_type text,p_webhook text,p_order text,p_payment text,p_session text,p_amount bigint,p_now bigint,p_tax bigint default 0) returns text
language plpgsql set search_path = '' as $$
declare o public.model_wallet_orders; total bigint; delta bigint:=0; v_result text:='review'; kind text; queued record;
begin
 if p_type='purchase' then select * into o from public.model_wallet_orders where order_id=p_order for update;
 else select * into o from public.model_wallet_orders where payment_id=p_payment for update; end if;
 if not found then
  if p_type in ('refund','dispute-opened','dispute-release') then
   insert into public.model_wallet_pending_events(webhook_id,payment_id,event_type,amount_micros,created_at) values(p_webhook,p_payment,p_type,p_amount,p_now) on conflict do nothing;
  end if;
  return 'not-ai-tokens';
 end if;
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
  if o.status='disputed' or (p_webhook like 'wallet-dispute-opened:%' and exists(select 1 from public.model_wallet_events where webhook_id=replace(p_webhook,'wallet-dispute-opened:','wallet-dispute-release:'))) then v_result:='duplicate';
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
 if p_type='purchase' and v_result='credited' then
  for queued in select * from public.model_wallet_pending_events where payment_id=p_payment order by created_at,webhook_id for update loop
   delete from public.model_wallet_pending_events where webhook_id=queued.webhook_id;
   perform public.apply_model_wallet_event(queued.event_type,queued.webhook_id,'',p_payment,null,queued.amount_micros,queued.created_at,0);
  end loop;
 end if;
 return v_result;
end $$;

