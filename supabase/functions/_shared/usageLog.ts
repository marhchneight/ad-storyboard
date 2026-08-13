// Best-effort AI usage logging into `ai_usage_events` (migration 0012) — a
// minimal foundation for future per-user billing/quota features. Never
// throws and never blocks the response: a logging failure must not affect
// the actual AI operation's outcome. Records no prompt text, no API keys,
// no other sensitive payload — only who/what/when/status.

export type AiUsageStatus = 'success' | 'failed' | 'rate_limited' | 'quota_exceeded';

export interface AiUsageEvent {
  userId: string;
  operation: string;
  status: AiUsageStatus;
  projectId?: string | null;
  cutId?: string | null;
}

export interface InsertingClient {
  from(table: string): {
    insert(row: Record<string, unknown>): Promise<{ error: unknown }>;
  };
}

export async function logAiUsage(supabase: InsertingClient, event: AiUsageEvent): Promise<void> {
  try {
    const { error } = await supabase.from('ai_usage_events').insert({
      user_id: event.userId,
      operation: event.operation,
      status: event.status,
      project_id: event.projectId ?? null,
      cut_id: event.cutId ?? null,
    });
    if (error) console.error('[usageLog] insert error:', error);
  } catch (err) {
    console.error('[usageLog] unexpected error:', err);
  }
}
