alter table cuts
  add column if not exists image_prompt text not null default '';
