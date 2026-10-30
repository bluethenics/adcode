-- Run against a migrated test database. Fixtures and any trigger effects are rolled back.
-- A historical window keeps these assertions independent of current traffic.
begin;

do $$
declare
  prefix text := 'growth-daily-regression-' || txid_current()::text;
  today bigint := (extract(epoch from timestamp '2000-02-01 00:00:00') * 1000)::bigint;
  day_ms bigint := 86400000;
begin
  insert into public.users (uid, status, created_at)
  select prefix || suffix, 'active', today - 40 * day_ms
    from unnest(array['-repeat', '-older', '-midnight', '-new']) as suffix;

  insert into public.milestones (uid, name, first_at, last_at) values
    (prefix || '-repeat', 'welcome_shown', today - 29 * day_ms, today),
    (prefix || '-repeat', 'prompt_sent', today - 29 * day_ms, today),
    (prefix || '-older', 'welcome_shown', today - 29 * day_ms - 1, today - 28 * day_ms),
    (prefix || '-midnight', 'welcome_shown', today - 1, today),
    (prefix || '-new', 'welcome_shown', today, today);

  -- The same developer appears through multiple sources and must count only once a day.
  insert into public.milestone_days (uid, day, first_at, last_at) values
    (prefix || '-repeat', '2000-01-03', today - 29 * day_ms, today - 29 * day_ms + 1000);

  insert into public.receipts
    (receipt_id, uid, creative_id, campaign_id, outcome, credited_micros, cost_micros, created_at)
  values
    (prefix || '-before', prefix || '-midnight', prefix, prefix, 'impression', 1, 2, today - 1),
    (prefix || '-after', prefix || '-new', prefix, prefix, 'impression', 1, 2, today),
    (prefix || '-click', prefix || '-new', prefix, prefix, 'click', 1, 2, today),
    (prefix || '-test', prefix || '-new', prefix, prefix, 'impression', 0, 0, today);
end;
$$;

-- Exercise the same role as the API, including its function access restrictions.
set local role service_role;

do $$
declare
  report jsonb := public.growth_stats(
    (extract(epoch from timestamp '2000-02-01 12:00:00') * 1000)::bigint
  );
  row jsonb;
begin
  assert jsonb_array_length(report->'daily') = 30, 'the report must include all 30 UTC days';
  assert report->'daily'->0->>'day' = '2000-01-03', 'the chart must begin 29 days before today';

  select value into strict row from jsonb_array_elements(report->'daily') where value->>'day' = '2000-01-03';
  assert row = '{"day":"2000-01-03","active":1,"returning":0,"joined":1,"adsShown":0}'::jsonb,
    'duplicate sightings must count as one active and one new developer';

  select value into strict row from jsonb_array_elements(report->'daily') where value->>'day' = '2000-01-04';
  assert row = '{"day":"2000-01-04","active":1,"returning":1,"joined":0,"adsShown":0}'::jsonb,
    'a first sighting before the chart must still establish a returning developer';

  select value into strict row from jsonb_array_elements(report->'daily') where value->>'day' = '2000-01-30';
  assert row = '{"day":"2000-01-30","active":0,"returning":0,"joined":0,"adsShown":0}'::jsonb,
    'empty days must remain present with zero counts';

  select value into strict row from jsonb_array_elements(report->'daily') where value->>'day' = '2000-01-31';
  assert row = '{"day":"2000-01-31","active":1,"returning":0,"joined":1,"adsShown":1}'::jsonb,
    'the millisecond before UTC midnight belongs to the previous day';

  select value into strict row from jsonb_array_elements(report->'daily') where value->>'day' = '2000-02-01';
  assert row = '{"day":"2000-02-01","active":3,"returning":1,"joined":1,"adsShown":1}'::jsonb,
    'midnight starts a new day; returning requires 24 hours, and shown excludes clicks and test receipts';
end;
$$;

rollback;
