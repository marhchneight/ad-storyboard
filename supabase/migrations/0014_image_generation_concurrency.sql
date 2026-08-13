-- Prevents duplicate concurrent image-generation requests for the same cut
-- (e.g. a double-click or three racing requests) from all reaching OpenAI.
-- claim_image_generation is a single atomic conditional UPDATE, so only one
-- of any number of concurrent callers can win the claim. A stale-after
-- window lets a crashed/timed-out request's cut be reclaimed later instead
-- of being wedged in 'generating' forever.
alter table cuts add column if not exists generation_started_at timestamptz;

create or replace function claim_image_generation(
  p_cut_id uuid,
  p_stale_after_seconds int default 120
) returns boolean
language plpgsql
as $$
declare
  v_updated int;
begin
  update cuts
  set generation_status = 'generating',
      generation_started_at = now()
  where id = p_cut_id
    and (
      generation_status is distinct from 'generating'
      or generation_started_at < now() - make_interval(secs => p_stale_after_seconds)
    );

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke execute on function claim_image_generation(uuid, int) from public;
grant execute on function claim_image_generation(uuid, int) to service_role;

alter function claim_image_generation(uuid, int) set search_path = public;
