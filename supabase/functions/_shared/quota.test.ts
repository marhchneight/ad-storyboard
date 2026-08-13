import { describe, it, expect, vi } from 'vitest';
import { checkDailyImageQuota, type CountingClient } from './quota';

function mockClient(count: number | null, error: unknown = null): CountingClient {
  const result = { count, error };
  const builder = {
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    then: <TResult1, TResult2>(
      onfulfilled?: ((value: typeof result) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => builder),
    })),
  };
}

describe('checkDailyImageQuota', () => {
  it('allows the request when under quota', async () => {
    const client = mockClient(10);
    const result = await checkDailyImageQuota(client, 'user-1', 60);
    expect(result.allowed).toBe(true);
  });

  it('rejects the request when quota is exhausted (daily quota exceeded case)', async () => {
    const client = mockClient(60);
    const result = await checkDailyImageQuota(client, 'user-1', 60);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('fails open when the count query errors', async () => {
    const client = mockClient(null, { message: 'db unavailable' });
    const result = await checkDailyImageQuota(client, 'user-1', 60);
    expect(result.allowed).toBe(true);
  });
});
