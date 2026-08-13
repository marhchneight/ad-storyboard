import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit } from './rateLimit';

function mockClient(data: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) };
}

describe('checkRateLimit', () => {
  it('allows the request when under the limit', async () => {
    const client = mockClient([{ allowed: true, remaining: 5, retry_after_seconds: 0 }]);
    const result = await checkRateLimit(client, 'user-1', 'lightweight_ai');
    expect(result.allowed).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith('check_and_increment_rate_limit', {
      p_user_id: 'user-1',
      p_bucket: 'lightweight_ai',
      p_limit: 40,
      p_window_seconds: 900,
    });
  });

  it('rejects the request when the limit is exceeded (429 case)', async () => {
    const client = mockClient([{ allowed: false, remaining: 0, retry_after_seconds: 42 }]);
    const result = await checkRateLimit(client, 'user-1', 'image_generation');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(42);
  });

  it('fails open when the RPC errors', async () => {
    const client = mockClient(null, { message: 'db unavailable' });
    const result = await checkRateLimit(client, 'user-1', 'expensive_ai');
    expect(result.allowed).toBe(true);
  });

  it('handles a single-row (non-array) response shape', async () => {
    const client = mockClient({ allowed: false, retry_after_seconds: 10 });
    const result = await checkRateLimit(client, 'user-1', 'expensive_ai');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(10);
  });
});
