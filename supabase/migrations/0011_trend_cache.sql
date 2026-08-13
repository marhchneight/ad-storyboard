-- Caches raw trend-research snippets (e.g. from a web-search API) so the
-- idea-recommendations edge function doesn't re-run external research on
-- every request — only when the cached entry is older than its TTL.
-- No RLS policies: only the edge function's service-role key touches this
-- table, which bypasses RLS entirely, so no anon/authenticated access is
-- granted here on purpose.
create table trend_cache (
  id text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table trend_cache enable row level security;
