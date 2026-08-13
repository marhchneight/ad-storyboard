// SSRF-hardened fetch for `generate-image`'s reference-image URLs.
//
// `referenceImageUrl` values are currently only ever written by
// `generate-image` itself (self-uploaded Supabase Storage URLs), but
// `projects.visual_bible` is a plain jsonb column an owner can freely
// rewrite via a direct table update, so a crafted URL could still reach
// this fetch. This module defends the fetch itself rather than trusting
// the value's origin.
//
// Uses only the global `fetch`/`AbortSignal`/`URL` runtime APIs (present
// in both Deno and modern Node), so it is unit-testable in Vitest by
// mocking `globalThis.fetch`.

export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 8000;
export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export type FetchResult =
  | { ok: true; blob: Blob; contentType: string }
  | { ok: false; reason: string };

function isIPv4Literal(host: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** Blocks loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, and reserved ranges. */
export function isDisallowedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** Blocks loopback (::1), unique-local (fc00::/7), and link-local (fe80::/10). */
export function isDisallowedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.split(':').pop() ?? '';
    if (v4.includes('.')) return isDisallowedIPv4(v4);
  }
  return false;
}

/** Blocks localhost-ish and internal/metadata hostnames, and any disallowed literal IP. */
export function isDisallowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '0.0.0.0') return true;
  if (host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (host === 'metadata.google.internal' || host === 'metadata') return true;

  if (isIPv4Literal(host)) return isDisallowedIPv4(host);

  const stripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (stripped.includes(':')) return isDisallowedIPv6(stripped);

  return false;
}

function isDisallowedPort(url: URL): boolean {
  return url.port !== '' && url.port !== '443';
}

function validateFetchTarget(urlStr: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'scheme_not_allowed' };
  if (isDisallowedPort(parsed)) return { ok: false, reason: 'port_not_allowed' };
  if (isDisallowedHost(parsed.hostname)) return { ok: false, reason: 'host_not_allowed' };
  return { ok: true, url: parsed };
}

/**
 * Fetches a reference image with SSRF hardening: https-only, blocks
 * localhost/private/link-local/CGNAT/cloud-metadata hosts and non-default
 * ports, manually follows redirects (re-validating every hop, up to
 * MAX_REDIRECTS), times out, caps the download at MAX_DOWNLOAD_BYTES even
 * without a trustworthy Content-Length, and only accepts an
 * `image/*` Content-Type.
 *
 * Known residual risk (Phase 1, documented — not resolved here): a
 * domain-name host that passes the string check but resolves via DNS to a
 * blocked IP (DNS rebinding) is not caught, since this only validates
 * hostnames/literal IPs, not the IP actually connected to at fetch time.
 */
export async function fetchReferenceImageSafely(url: string): Promise<FetchResult> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = validateFetchTarget(currentUrl);
    if (!target.ok) return { ok: false, reason: target.reason };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(target.url.toString(), { redirect: 'manual', signal: controller.signal });
    } catch {
      return { ok: false, reason: 'fetch_failed' };
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, reason: 'redirect_without_location' };
      try {
        currentUrl = new URL(location, target.url).toString();
      } catch {
        return { ok: false, reason: 'invalid_redirect_url' };
      }
      continue;
    }

    if (!res.ok) return { ok: false, reason: `http_${res.status}` };

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return { ok: false, reason: 'not_an_image' };
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_DOWNLOAD_BYTES) {
      return { ok: false, reason: 'too_large' };
    }

    if (!res.body) return { ok: false, reason: 'empty_body' };

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }

    return { ok: true, blob: new Blob(chunks, { type: contentType }), contentType };
  }

  return { ok: false, reason: 'too_many_redirects' };
}
