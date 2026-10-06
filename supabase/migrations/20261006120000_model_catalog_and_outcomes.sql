-- The model list, curated from the admin panel, and how each model does for real people.
--
-- Asked for on 2026-10-04: "if new models come up I want to update them from the admin
-- panel", "all AI models must be working" and "need more analysis tracking to improve the
-- app and web". This migration adds:
--
--   1. `model_catalog` - one row: the admin panel's curation of the model list (which model
--      each provider starts on, featured, hidden, notes, models to add before models.dev
--      lists them). Every editor reads it on launch through GET /v1/models/overrides.
--      `services/api/src/modelCatalog.ts` validates it before it is written.
--   2. `model_outcomes` - per day, provider, model and outcome: how many assistant turns
--      ended that way and how long they took in total. Counts only - no account, prompt,
--      file, key or model output; the table has no column that could hold one. The admin
--      panel's Models page reads it as "how often does this model work".
--   3. `website_events.placement` - which button on a page an event came from ("hero",
--      "closing", "sticky"), so each download button is measured on its own.
--
-- Additive only: nothing existing is altered beyond one new column with a default, so the
-- running web build keeps working before and after this is applied.

create table if not exists public.model_catalog (
  id          integer primary key check (id = 1),
  overrides   jsonb   not null default '{}'::jsonb,
  updated_at  bigint  not null default 0,
  updated_by  text    not null default ''
);

create table if not exists public.model_outcomes (
  day       date    not null,
  provider  text    not null check (provider ~ '^[a-z0-9._-]{1,40}$'),
  model     text    not null check (char_length(model) between 1 and 200),
  outcome   text    not null check (outcome ~ '^[a-z_]{1,24}$'),
  count     integer not null default 0 check (count >= 0),
  total_ms  bigint  not null default 0 check (total_ms >= 0),
  primary key (day, provider, model, outcome)
);

create index if not exists model_outcomes_day_idx on public.model_outcomes (day);

do $$
declare
  t text;
begin
  foreach t in array array['model_catalog', 'model_outcomes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- One flush from one editor. Grouped first, so a batch naming one model and outcome twice is
-- one row (ON CONFLICT cannot touch a row twice in one statement), and the counts add
-- whichever of two concurrent flushes lands second. Each turn's time is capped at an hour.
create or replace function public.record_model_outcomes(p_items jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.model_outcomes as o (day, provider, model, outcome, count, total_ms)
  select (item->>'day')::date,
         item->>'provider',
         item->>'model',
         item->>'outcome',
         count(*)::integer,
         sum(greatest(0::bigint, least((item->>'ms')::bigint, 3600000::bigint)))::bigint
    from jsonb_array_elements(p_items) as item
   group by 1, 2, 3, 4
  on conflict (day, provider, model, outcome) do update set
    count    = o.count + excluded.count,
    total_ms = o.total_ms + excluded.total_ms;
$$;

revoke all on function public.record_model_outcomes(jsonb) from public, anon, authenticated;
grant execute on function public.record_model_outcomes(jsonb) to service_role;

alter table public.website_events
  add column if not exists placement text not null default '' check (length(placement) <= 40);
