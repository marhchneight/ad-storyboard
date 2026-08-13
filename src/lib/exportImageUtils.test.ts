import { describe, it, expect } from 'vitest';
import { fitImageContain, readIntrinsicImageDimensions } from './exportImageUtils';

// Constructs a byte buffer with a real PNG signature and a minimal IHDR chunk carrying the
// given width/height — our parser only reads those fixed-offset bytes, so this doesn't need a
// real compressed pixel payload to exercise readIntrinsicImageDimensions deterministically.
function fakePngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 0x0d], 8); // chunk length (unused by our parser)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  bytes[16] = (width >>> 24) & 0xff; bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff; bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff; bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff; bytes[23] = height & 0xff;
  return bytes;
}

// Minimal baseline JPEG: SOI, then an SOF0 segment carrying height/width, nothing else needed.
function fakeJpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(19);
  bytes[0] = 0xff; bytes[1] = 0xd8; // SOI
  bytes[2] = 0xff; bytes[3] = 0xc0; // SOF0 marker
  const segmentLength = 17; // length field + precision + height(2) + width(2) + 1 component(3)
  bytes[4] = (segmentLength >> 8) & 0xff; bytes[5] = segmentLength & 0xff;
  bytes[6] = 8; // precision
  bytes[7] = (height >> 8) & 0xff; bytes[8] = height & 0xff;
  bytes[9] = (width >> 8) & 0xff; bytes[10] = width & 0xff;
  bytes[11] = 1; // number of components
  return bytes;
}

// Minimal WEBP VP8X (extended format) header carrying explicit width-1/height-1.
function fakeWebpVp8xBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const w1 = width - 1, h1 = height - 1;
  bytes[24] = w1 & 0xff; bytes[25] = (w1 >> 8) & 0xff; bytes[26] = (w1 >> 16) & 0xff;
  bytes[27] = h1 & 0xff; bytes[28] = (h1 >> 8) & 0xff; bytes[29] = (h1 >> 16) & 0xff;
  return bytes;
}

describe('readIntrinsicImageDimensions', () => {
  it('reads a 1:1 (1000x1000) PNG', () => {
    const dims = readIntrinsicImageDimensions(fakePngBytes(1000, 1000));
    expect(dims).toEqual({ width: 1000, height: 1000, ratio: 1 });
  });

  it('reads a 16:9 (1600x900) PNG', () => {
    const dims = readIntrinsicImageDimensions(fakePngBytes(1600, 900));
    expect(dims?.width).toBe(1600);
    expect(dims?.height).toBe(900);
    expect(dims?.ratio).toBeCloseTo(16 / 9, 5);
  });

  it('reads a 9:16 (900x1600) PNG', () => {
    const dims = readIntrinsicImageDimensions(fakePngBytes(900, 1600));
    expect(dims?.ratio).toBeCloseTo(9 / 16, 5);
  });

  it('reads a 1536x1024 PNG (gpt-image-1 landscape size) as exactly 1.5', () => {
    const dims = readIntrinsicImageDimensions(fakePngBytes(1536, 1024));
    expect(dims?.ratio).toBe(1.5);
  });

  it('reads dimensions from a JPEG SOF0 segment', () => {
    const dims = readIntrinsicImageDimensions(fakeJpegBytes(1600, 900));
    expect(dims?.width).toBe(1600);
    expect(dims?.height).toBe(900);
    expect(dims?.ratio).toBeCloseTo(16 / 9, 5);
  });

  it('reads dimensions from a WEBP VP8X header', () => {
    const dims = readIntrinsicImageDimensions(fakeWebpVp8xBytes(1024, 1024));
    expect(dims).toEqual({ width: 1024, height: 1024, ratio: 1 });
  });

  it('returns null for unrecognized bytes', () => {
    expect(readIntrinsicImageDimensions(new TextEncoder().encode('not an image'))).toBeNull();
  });

  it('returns null for a truncated buffer', () => {
    expect(readIntrinsicImageDimensions(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe('fitImageContain', () => {
  it('preserves a 1:1 source ratio', () => {
    const fit = fitImageContain(1000, 1000, 400, 800);
    expect(fit.width / fit.height).toBeCloseTo(1, 5);
  });

  it('preserves a 16:9 source ratio even inside a tall (9:16) box', () => {
    const fit = fitImageContain(1600, 900, 300, 900);
    expect(Math.abs(1600 / 900 - fit.width / fit.height)).toBeLessThan(0.001);
  });

  it('preserves a 9:16 source ratio even inside a wide (16:9) box', () => {
    const fit = fitImageContain(900, 1600, 900, 300);
    expect(Math.abs(900 / 1600 - fit.width / fit.height)).toBeLessThan(0.001);
  });

  it('preserves a 1536x1024 (1.5) source ratio', () => {
    const fit = fitImageContain(1536, 1024, 500, 500);
    expect(fit.width / fit.height).toBeCloseTo(1.5, 5);
  });

  it('never exceeds the given max box on either axis', () => {
    const fit = fitImageContain(1600, 900, 300, 300);
    expect(fit.width).toBeLessThanOrEqual(300 + 1e-9);
    expect(fit.height).toBeLessThanOrEqual(300 + 1e-9);
  });

  it('scales up a tiny source to fill the box (never leaves it needlessly small)', () => {
    const fit = fitImageContain(1, 1, 200, 200);
    expect(fit.width).toBeCloseTo(200, 5);
    expect(fit.height).toBeCloseTo(200, 5);
  });

  it('returns a zero size for degenerate (non-positive) inputs rather than throwing', () => {
    expect(fitImageContain(0, 100, 200, 200)).toEqual({ width: 0, height: 0 });
    expect(fitImageContain(100, 100, 0, 200)).toEqual({ width: 0, height: 0 });
  });

  for (const [w, h] of [[1600, 900], [900, 1600], [1536, 1024], [1024, 1536], [1, 1]] as const) {
    it(`round-trips the exact source ratio for ${w}x${h} across various box sizes`, () => {
      for (const [maxW, maxH] of [[100, 100], [500, 200], [200, 500], [50, 900]] as const) {
        const fit = fitImageContain(w, h, maxW, maxH);
        expect(Math.abs(w / h - fit.width / fit.height)).toBeLessThan(0.001);
      }
    });
  }
});
