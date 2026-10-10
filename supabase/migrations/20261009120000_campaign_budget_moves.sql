-- Move unspent budget from one of an advertiser's campaigns to another.
--
-- The rule is `planBudgetMove` in services/api/src/campaignBudget.ts, and this applies it
-- line for line: only unspent budget moves, the destination stays under the budget
-- ceiling, and the reservation follows the money - an active campaign's unspent budget
-- is held out of the advertiser's available credits, a paused one's is not.
--
-- Every row the decision reads is locked first, so a move serializes with activation,
-- pausing and settlement:
--   - the advertiser, exactly as transition_campaign_commitment locks it;
--   - both campaigns, in campaign_id order, so two opposite moves cannot deadlock;
--   - the source's campaign_spend row, created if it is missing. settle_receipt upserts
--     that row, so a receipt settling mid-move either waits for the move or is counted
--     by it - it can never leave the source budget below its spend.

create or replace function public.move_campaign_budget(
  p_advertiser_id text,
  p_from_campaign_id text,
  p_to_campaign_id text,
  p_amount_micros bigint,
  p_max_budget_micros bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_advertiser public.advertisers%rowtype;
  v_from public.campaigns%rowtype;
  v_to public.campaigns%rowtype;
  v_spent bigint;
  v_held bigint;
begin
  if p_from_campaign_id = p_to_campaign_id or coalesce(p_amount_micros, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid-state');
  end if;

  select * into v_advertiser from public.advertisers
    where advertiser_id = p_advertiser_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;

  -- Rows are locked above the sort, so this takes the two locks in id order.
  perform 1 from public.campaigns
    where campaign_id in (p_from_campaign_id, p_to_campaign_id)
    order by campaign_id
    for update;

  select * into v_from from public.campaigns
    where campaign_id = p_from_campaign_id and advertiser_id = p_advertiser_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;
  select * into v_to from public.campaigns
    where campaign_id = p_to_campaign_id and advertiser_id = p_advertiser_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;
  -- An ended campaign has already given its unspent budget back, and cannot take more.
  if v_from.status = 'ended' or v_to.status = 'ended' then
    return jsonb_build_object('ok', false, 'reason', 'invalid-state');
  end if;

  insert into public.campaign_spend (campaign_id, spent_micros)
    values (p_from_campaign_id, 0)
    on conflict (campaign_id) do nothing;
  select spent_micros into v_spent from public.campaign_spend
    where campaign_id = p_from_campaign_id for update;

  if p_amount_micros > v_from.budget_micros - coalesce(v_spent, 0) then
    return jsonb_build_object('ok', false, 'reason', 'exceeds-unspent');
  end if;
  if v_to.budget_micros + p_amount_micros > p_max_budget_micros then
    return jsonb_build_object('ok', false, 'reason', 'budget-limit');
  end if;

  -- Only an increase in what is held needs covering; active to active is neutral.
  v_held := (case when v_to.status = 'active' then p_amount_micros else 0 end)
          - (case when v_from.status = 'active' then p_amount_micros else 0 end);
  if v_held > 0 and v_held > v_advertiser.funded_micros - v_advertiser.reserved_micros then
    return jsonb_build_object('ok', false, 'reason', 'insufficient-funds');
  end if;

  update public.advertisers
    set reserved_micros = greatest(v_advertiser.reserved_micros + v_held, 0)
    where advertiser_id = p_advertiser_id;
  update public.campaigns set budget_micros = budget_micros - p_amount_micros
    where campaign_id = p_from_campaign_id;
  update public.campaigns set budget_micros = budget_micros + p_amount_micros
    where campaign_id = p_to_campaign_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Supabase grants new functions to `anon` and `authenticated` by default. This one moves
-- money between commitments, so only the service, which has already checked ownership,
-- may call it.
revoke all on function public.move_campaign_budget(text, text, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.move_campaign_budget(text, text, text, bigint, bigint) to service_role;
