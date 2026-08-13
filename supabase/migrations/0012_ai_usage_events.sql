-- Minimal AI usage log — the foundation for future per-user billing and
-- daily quotas. Records who/what/when/status only: no prompt text, no API
-- keys, no other sensitive payload. No RLS policies: only the edge
-- functions' service-role key writes/reads this, same deny-all pattern as
-- trend_cache.
create table ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  status text not null check (status in ('success', 'failed', 'rate_limited', 'quota_exceeded')),
  project_id uuid references projects(id) on delete set null,
  cut_id uuid references cuts(id) on delete set null,
  created_at timestamptz not null default now()
);

create index ai_usage_events_user_operation_created_idx
  on ai_usage_events (user_id, operation, created_at desc);

alter table ai_usage_events enable row level security;
