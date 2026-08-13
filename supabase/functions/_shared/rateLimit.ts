// Server-side, per-user rate limiting backed by Postgres (see migration
// 0013_rate_limiting.sql) so limits are enforced consistently across every
// Edge Function instance — not an in-memory Map, which would reset per
// instance and not be shared across concurrent invocations.
//
// Takes the Supabase client as a parameter (dependency injection) instead
// of constructing one, so this module has no Deno-specific import and can
// be unit-tested with a mock client in Vitest.

export type RateLimitBucket = 'image_generation' | 'expensive_ai' | 'lightweight_ai';

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

/** Single place to tune every rate limit. Fixed-window per user+bucket. */
export const RATE_LIMIT_BUCKETS: Record<RateLimitBucket, RateLimitRule> = {
  image_generation: { limit: 15, windowSeconds: 900 }, // 15 requests / 15 min
  expensive_ai: { limit: 20, windowSeconds: 900 }, // 20 requests / 15 min
  lightweight_ai: { limit: 40, windowSeconds: 900 }, // 40 requests / 15 min
};

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

/**
 * Checks and atomically increments the caller's usage counter for `bucket`
 * via the `check_and_increment_rate_limit` Postgres function. Fails open
 * (allows the request) if the RPC itself errors, so a rate-limiter outage
 * never blocks legitimate use — the AI call itself remains the real gate.
 */
export async function checkRateLimit(
  supabase: RpcClient,
  userId: string,
  bucket: RateLimitBucket
): Promise<RateLimitResult> {
  const rule = RATE_LIMIT_BUCKETS[bucket];
  const { data, error } = await supabase.rpc('check_and_increment_rate_limit', {
    p_user_id: userId,
    p_bucket: bucket,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });

  if (error) {
    console.error('[rateLimit] RPC error, failing open:', error);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    console.error('[rateLimit] RPC returned no row, failing open');
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: Boolean(row.allowed),
    retryAfterSeconds: Number(row.retry_after_seconds ?? 0),
  };
}
