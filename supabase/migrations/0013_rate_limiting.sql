-- Per-user, fixed-window rate limiting shared across every Edge Function
-- instance (a plain in-memory Map would reset per instance and wouldn't be
-- shared). check_and_increment_rate_limit is a single atomic UPSERT, so
-- concurrent requests from the same user race safely at the database level
-- rather than in application code.
create table rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  request_count int not null default 0,
  primary key (user_id, bucket)
);

alter table rate_limits enable row level security;

create or replace function check_and_increment_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit int,
  p_window_seconds int
) returns table(allowed boolean, remaining int, retry_after_seconds int)
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count int;
begin
  insert into rate_limits (user_id, bucket, window_start, request_count)
  values (p_user_id, p_bucket, v_now, 1)
  on conflict (user_id, bucket) do update
    set request_count = case
          when rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
            then 1
          else rate_limits.request_count + 1
        end,
        window_start = case
          when rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
            then v_now
          else rate_limits.window_start
        end
  returning rate_limits.request_count, rate_limits.window_start into v_count, v_window_start;

  if v_count > p_limit then
    return query select
      false,
      0,
      greatest(0, p_window_seconds - extract(epoch from (v_now - v_window_start))::int);
  else
    return query select true, p_limit - v_count, 0;
  end if;
end;
$$;

-- Only the edge functions' service-role connection may call this — never
-- the anon/authenticated PostgREST roles, which would otherwise be able to
-- inspect or churn their own (or another user's) rate-limit counters.
revoke execute on function check_and_increment_rate_limit(uuid, text, int, int) from public;
grant execute on function check_and_increment_rate_limit(uuid, text, int, int) to service_role;

alter function check_and_increment_rate_limit(uuid, text, int, int) set search_path = public;
