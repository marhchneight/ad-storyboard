// Daily (rolling 24h) usage quota, currently applied to image generation
// only. Built on the `ai_usage_events` log (migration 0012) so the same
// data doubles as the foundation for future billing.
//
// Takes the Supabase client as a parameter (dependency injection), no
// Deno-specific import, unit-testable in Vitest with a mock client.

/** Single place to tune the daily image-generation quota. */
export const DAILY_IMAGE_GENERATION_QUOTA = 60;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface QuotaResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface FilterBuilder extends PromiseLike<{ count: number | null; error: unknown }> {
  eq(column: string, value: unknown): FilterBuilder;
  gte(column: string, value: unknown): FilterBuilder;
}

export interface CountingClient {
  from(table: string): {
    select(columns: string, opts: { count: 'exact'; head: true }): FilterBuilder;
  };
}

/**
 * Fails open (allows the request) if the count query itself errors, so a
 * transient DB issue never blocks image generation outright — the rate
 * limiter and per-request cost remain the primary guardrails.
 */
export async function checkDailyImageQuota(
  supabase: CountingClient,
  userId: string,
  quota: number = DAILY_IMAGE_GENERATION_QUOTA
): Promise<QuotaResult> {
  const since = new Date(Date.now() - ONE_DAY_MS).toISOString();
  const { count, error } = await supabase
    .from('ai_usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('operation', 'generate_image')
    .eq('status', 'success')
    .gte('created_at', since);

  if (error) {
    console.error('[quota] count query error, failing open:', error);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const used = count ?? 0;
  if (used >= quota) {
    return { allowed: false, retryAfterSeconds: 24 * 60 * 60 };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}
