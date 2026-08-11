alter table projects
  add column if not exists visual_bible jsonb not null default '{}'::jsonb;

alter table cuts
  add column if not exists entity_refs jsonb not null default
    '{"characters":[],"products":[],"location":null}'::jsonb;
