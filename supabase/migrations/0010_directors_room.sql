-- Director's Room: the directing approach a user picked (if any) for this
-- project, plus how bold they asked the AI to be. Both nullable — existing
-- projects (and the legacy /projects/new flow, which never goes through
-- Director's Room) simply have null here, which every reader treats as
-- "no established directing context" rather than an error.
alter table projects
  add column if not exists selected_directing_direction jsonb,
  add column if not exists creative_risk text;

-- Which advertising role a cut plays (attention/product/benefit/proof/...).
-- Nullable/absent-safe for the same reason: rows created before this existed,
-- or via the legacy manual "AI 없이 직접 컷 개수 지정" flow, just have none.
alter table cuts
  add column if not exists scene_role jsonb;
