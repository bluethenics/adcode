-- Cached input tokens per model request. The relay already reads them from every provider's
-- usage block (prompt_tokens_details.cached_tokens, or DeepSeek's prompt_cache_hit_tokens) to
-- price wallet requests, then dropped them, so the admin Models page could not say how much of
-- a model's input was served from the provider's cache.
--
-- Nullable with no default: adding it is a catalogue change only, with no table rewrite, so the
-- ACCESS EXCLUSIVE lock lasts milliseconds. NULL means "not recorded" (every row before this
-- migration, and providers that do not report it), which is different from zero. Kept in its
-- own migration so that lock is released before the rollup backfill in the next file starts.
begin;
set local lock_timeout = '5s';
alter table public.ai_model_requests add column if not exists cached_input_tokens bigint;
comment on column public.ai_model_requests.cached_input_tokens is 'Input tokens the provider reported as served from its prompt cache. NULL = not reported.';
commit;
