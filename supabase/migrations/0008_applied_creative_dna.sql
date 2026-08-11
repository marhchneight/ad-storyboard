alter table cuts
  add column if not exists applied_creative_dna jsonb not null default '[]'::jsonb,
  add column if not exists creative_dna_application_note text not null default '';
