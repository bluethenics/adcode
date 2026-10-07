-- When a website event happened, not when its batch arrived.
--
-- Every event used to be stamped with the server's arrival time, so a batch of twenty got
-- one timestamp between them and two requests that crossed on the network swapped order -
-- which is exactly what a funnel ("visited, then installed") is built from. The browser now
-- sends each event's age in milliseconds at the moment it is sent, and the API stores
-- `occurred_at = received_at - age`: ordered, distinct, and immune to a wrong device clock
-- because only a duration crosses the wire. Older rows have none and fall back to
-- `received_at` in reports.
alter table public.website_events
  add column if not exists occurred_at bigint check (occurred_at is null or occurred_at >= 0);

-- Web Vitals that change during a visit (CLS and INP) are re-sent under the same event id
-- with the newer value, replacing the first. The API's service role needs to update for that.
grant update on public.website_events to service_role;
