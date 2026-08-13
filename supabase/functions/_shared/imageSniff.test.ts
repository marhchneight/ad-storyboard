import { describe, it, expect } from 'vitest';
import { sniffImageType } from './imageSniff';

describe('sniffImageType', () => {
  it('detects a valid PNG signature', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageType(bytes)).toBe('png');
  });

  it('detects a valid JPEG signature', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(sniffImageType(bytes)).toBe('jpeg');
  });

  it('detects a valid WEBP signature', () => {
    // "RIFF" + 4 size bytes + "WEBP"
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(sniffImageType(bytes)).toBe('webp');
  });

  it('rejects a RIFF file that is not WEBP (e.g. WAV)', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, // "WAVE" not "WEBP"
    ]);
    expect(sniffImageType(bytes)).toBeNull();
  });

  it('rejects a plain-text file renamed to .png', () => {
    const bytes = new TextEncoder().encode('this is not an image, just text');
    expect(sniffImageType(bytes)).toBeNull();
  });

  it('rejects truncated bytes that are too short to match any signature', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it('rejects an empty buffer', () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });

  it('rejects a GIF (not in the supported allowlist)', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
    expect(sniffImageType(bytes)).toBeNull();
  });
});
