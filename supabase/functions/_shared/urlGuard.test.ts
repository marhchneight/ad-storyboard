import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchReferenceImageSafely, isDisallowedIPv4, isDisallowedHost } from './urlGuard';

afterEach(() => {
  vi.restoreAllMocks();
});

function imageResponse(bytes = new Uint8Array([1, 2, 3]), contentType = 'image/png') {
  return new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
}

describe('isDisallowedHost / isDisallowedIPv4 (pure classification)', () => {
  it('flags localhost', () => expect(isDisallowedHost('localhost')).toBe(true));
  it('flags loopback IP', () => expect(isDisallowedIPv4('127.0.0.1')).toBe(true));
  it('flags a private-network IP', () => expect(isDisallowedIPv4('10.1.2.3')).toBe(true));
  it('flags the cloud metadata IP', () => expect(isDisallowedIPv4('169.254.169.254')).toBe(true));
  it('allows a normal public host', () => expect(isDisallowedHost('example.com')).toBe(false));
});

describe('fetchReferenceImageSafely', () => {
  it('rejects a non-https URL without calling fetch (non-image reference class)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await fetchReferenceImageSafely('http://example.com/img.png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('scheme_not_allowed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a localhost URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await fetchReferenceImageSafely('https://localhost/img.png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('host_not_allowed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a private-network IP URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await fetchReferenceImageSafely('https://10.0.0.5/img.png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('host_not_allowed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects the cloud metadata address', async () => {
    const result = await fetchReferenceImageSafely('https://169.254.169.254/latest/meta-data/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('host_not_allowed');
  });

  it('rejects a non-image content-type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    );
    const result = await fetchReferenceImageSafely('https://example.com/not-an-image');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_an_image');
  });

  it('rejects an oversized reference image via Content-Length', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(9 * 1024 * 1024) },
      })
    );
    const result = await fetchReferenceImageSafely('https://example.com/huge.png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_large');
  });

  it('accepts a valid https image response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(imageResponse());
    const result = await fetchReferenceImageSafely('https://example.com/img.png');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contentType).toBe('image/png');
  });

  it('re-validates the target after following a redirect, rejecting one that points at a private IP', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://10.0.0.5/img.png' } })
    );
    const result = await fetchReferenceImageSafely('https://example.com/redirect-me');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('host_not_allowed');
  });

  it('gives up after too many redirects', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(null, { status: 302, headers: { location: 'https://example.com/next' } })
    );
    const result = await fetchReferenceImageSafely('https://example.com/start');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_many_redirects');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});
