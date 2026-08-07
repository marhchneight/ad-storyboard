alter table projects
  add column if not exists brief jsonb not null default '{}'::jsonb,
  add column if not exists creative_direction text not null default '';

alter table cuts
  add column if not exists duration_seconds numeric,
  add column if not exists shot_size text not null default '',
  add column if not exists lens text not null default '',
  add column if not exists angle text not null default '',
  add column if not exists movement text not null default '',
  add column if not exists composition text not null default '',
  add column if not exists action text not null default '',
  add column if not exists lighting text not null default '',
  add column if not exists mood text not null default '',
  add column if not exists location text not null default '',
  add column if not exists props text not null default '',
  add column if not exists sfx text not null default '',
  add column if not exists transition text not null default '',
  add column if not exists purpose text not null default '';
