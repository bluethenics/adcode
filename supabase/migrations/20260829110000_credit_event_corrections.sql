-- Corrections to the advertiser credit event handler.
--
-- Three faults, all in the branches that run when money goes back rather than in:
--
--   1. An order's status was recomputed from the advertiser's *total* `funded_micros`
--      compared against that one order's `amount_micros`. Those are different quantities.
--      An advertiser with three $100 orders who fully refunded one was left with $200
--      funded, `200 < 100` was false, and the refunded order stayed marked `paid`. In the
--      other direction a small partial refund against a nearly-spent balance could mark an
--      untouched order `reversed`. Status is now a fold over that order's own entries.
--
--   2. `dispute-final` (Dodo's `dispute.accepted` / `dispute.lost`) matched no branch, so
--      it wrote no entry and fell into the trailing status recompute - which landed on
--      `paid`. The event meaning "the chargeback was lost" marked the order as a
--      successful payment. It now has its own branch and settles the order as `reversed`.
--
--   3. A refund was clamped only by the advertiser's whole balance, so a refund event
--      whose amount exceeded the order it resolved to - a provider bug, a minor-unit
--      mismatch, a partial refund matched to the wrong payment - emptied the account
--      instead of being refused. It is now clamped to what the order itself can still
--      absorb, and an over-large one is flagged for review rather than silently applied.
--
-- The purchase branch is unchanged: it was already strict about amount, currency, session
-- and status, and it is the branch that has actually settled a live payment.

create or replace function public.apply_advertiser_credit_event(
  p_webhook_id text,
  p_event_type text,
  p_provider_object_id text,
  p_payment_id text,
  p_order_id text,
  p_session_id text,
  p_amount_micros bigint,
  p_currency text,
  p_received_at bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.advertiser_credit_orders%rowtype;
  v_advertiser public.advertisers%rowtype;
  v_inserted integer;
  v_delta bigint := 0;
  v_removed bigint := 0;
  v_absorbable bigint;
  v_order_net bigint;
  v_funded bigint;
  v_reserved bigint;
  v_event_status text := 'applied';
begin
  insert into public.provider_events (
    webhook_id, event_type, provider_object_id, order_id, status, received_at
  ) values (
    p_webhook_id, p_event_type, p_provider_object_id, p_order_id, 'processing', p_received_at
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('applied', false, 'reason', 'duplicate');
  end if;

  if p_event_type = 'purchase' then
    select * into v_order from public.advertiser_credit_orders
      where order_id = p_order_id for update;
  else
    select * into v_order from public.advertiser_credit_orders
      where provider_payment_id = p_payment_id for update;
  end if;

  if not found then
    update public.provider_events set status = 'ignored' where webhook_id = p_webhook_id;
    return jsonb_build_object('applied', false, 'reason', 'ignored');
  end if;

  select * into v_advertiser from public.advertisers
    where advertiser_id = v_order.advertiser_id for update;
  if not found then
    update public.provider_events set status = 'ignored' where webhook_id = p_webhook_id;
    return jsonb_build_object('applied', false, 'reason', 'ignored');
  end if;

  -- What this order still counts for, as a fold over its own entries. A purchase is
  -- positive, a reversal negative, a dispute release positive again.
  select coalesce(sum(amount_micros), 0) into v_order_net
    from public.advertiser_credit_entries where order_id = v_order.order_id;

  if p_event_type = 'purchase' then
    if v_order.status <> 'checkout_created'
       or v_order.amount_micros <> p_amount_micros
       or v_order.currency <> p_currency
       or v_order.provider_session_id <> p_session_id then
      update public.advertiser_credit_orders
        set status = 'review_required', updated_at = p_received_at
        where order_id = v_order.order_id;
      update public.provider_events set status = 'review_required' where webhook_id = p_webhook_id;
      return jsonb_build_object('applied', false, 'reason', 'review_required');
    end if;

    update public.advertisers
      set funded_micros = funded_micros + v_order.amount_micros
      where advertiser_id = v_order.advertiser_id;
    update public.advertiser_credit_orders
      set status = 'paid', provider_payment_id = p_payment_id, updated_at = p_received_at
      where order_id = v_order.order_id;
    insert into public.advertiser_credit_entries (
      entry_id, advertiser_id, order_id, kind, amount_micros, provider_object_id, created_at
    ) values (
      p_webhook_id, v_order.advertiser_id, v_order.order_id, 'purchase',
      v_order.amount_micros, p_provider_object_id, p_received_at
    );

  elsif p_event_type in ('refund', 'dispute-opened') then
    -- Two ceilings, and the order's is the one that was missing. A refund can never take
    -- back more than this order still holds, however much the event claims.
    v_absorbable := greatest(v_order_net, 0);
    v_removed := least(p_amount_micros, v_absorbable, greatest(v_advertiser.funded_micros, 0));
    if p_amount_micros > v_absorbable then
      -- Applied at the clamped figure, but a human needs to look: the provider asked to
      -- reverse more than this order was ever worth.
      v_event_status := 'review_required';
    end if;
    v_delta := -v_removed;
    update public.advertisers
      set funded_micros = funded_micros + v_delta
      where advertiser_id = v_order.advertiser_id;
    insert into public.advertiser_credit_entries (
      entry_id, advertiser_id, order_id, kind, amount_micros, provider_object_id, created_at
    ) values (
      p_webhook_id, v_order.advertiser_id, v_order.order_id, p_event_type,
      v_delta, p_provider_object_id, p_received_at
    );

  elsif p_event_type = 'dispute-release' then
    -- The dispute was won or withdrawn: give back exactly what opening it took.
    select coalesce(greatest(-amount_micros, 0), 0) into v_delta
      from public.advertiser_credit_entries
      where kind = 'dispute-opened' and provider_object_id = p_provider_object_id;
    v_delta := coalesce(v_delta, 0);
    update public.advertisers
      set funded_micros = funded_micros + v_delta
      where advertiser_id = v_order.advertiser_id;
    insert into public.advertiser_credit_entries (
      entry_id, advertiser_id, order_id, kind, amount_micros, provider_object_id, created_at
    ) values (
      p_webhook_id, v_order.advertiser_id, v_order.order_id, p_event_type,
      v_delta, p_provider_object_id, p_received_at
    );

  elsif p_event_type = 'dispute-final' then
    -- The chargeback was lost or accepted. The money left when the dispute opened, so
    -- nothing moves here - but the event is recorded so the order's history explains
    -- itself, and the order settles as reversed rather than drifting back to paid.
    insert into public.advertiser_credit_entries (
      entry_id, advertiser_id, order_id, kind, amount_micros, provider_object_id, created_at
    ) values (
      p_webhook_id, v_order.advertiser_id, v_order.order_id, 'dispute-final',
      0, p_provider_object_id, p_received_at
    );
  end if;

  select funded_micros, reserved_micros into v_funded, v_reserved
    from public.advertisers where advertiser_id = v_order.advertiser_id;
  if v_funded < v_reserved then
    update public.advertisers set status = 'suspended'
      where advertiser_id = v_order.advertiser_id;
    update public.campaigns set status = 'paused'
      where advertiser_id = v_order.advertiser_id and status = 'active';
  end if;

  if p_event_type <> 'purchase' then
    -- Recomputed from this order's own entries, including the one just written.
    select coalesce(sum(amount_micros), 0) into v_order_net
      from public.advertiser_credit_entries where order_id = v_order.order_id;

    update public.advertiser_credit_orders
      set status = case
        when p_event_type = 'dispute-opened' then 'disputed'
        when p_event_type = 'dispute-final' then 'reversed'
        when v_order_net <= 0 then 'reversed'
        when v_order_net < v_order.amount_micros then 'partially_reversed'
        else 'paid'
      end,
      updated_at = p_received_at
      where order_id = v_order.order_id;
  end if;

  update public.provider_events set status = v_event_status, order_id = v_order.order_id
    where webhook_id = p_webhook_id;
  return jsonb_build_object(
    'applied', true, 'reason', 'applied', 'advertiserId', v_order.advertiser_id
  );
end;
$$;

revoke all on function public.apply_advertiser_credit_event(
  text,text,text,text,text,text,bigint,text,bigint
) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reconciliation: does funded_micros agree with the credit entries behind it?
-- ---------------------------------------------------------------------------
--
-- "The webhook is the only path that raises funded_micros" was a convention honoured
-- everywhere in the code and enforced nowhere, and live data already broke it - one
-- advertiser held $100 with no credit entry and no funding row behind it. A check
-- constraint cannot express this (the sum lives in another table), so it is a function
-- somebody can run, and the returned rows are the discrepancies.
--
-- Rows returned means something moved funded_micros that was not a provider event.
create or replace function public.reconcile_advertiser_credits()
returns table (
  advertiser_id text,
  name text,
  funded_micros bigint,
  entries_micros bigint,
  difference_micros bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.advertiser_id,
    a.name,
    a.funded_micros,
    coalesce(e.total, 0) as entries_micros,
    a.funded_micros - coalesce(e.total, 0) as difference_micros
  from public.advertisers a
  left join (
    select advertiser_id, sum(amount_micros) as total
    from public.advertiser_credit_entries
    group by advertiser_id
  ) e on e.advertiser_id = a.advertiser_id
  where a.funded_micros <> coalesce(e.total, 0)
  order by abs(a.funded_micros - coalesce(e.total, 0)) desc;
$$;

revoke all on function public.reconcile_advertiser_credits() from anon, authenticated;
