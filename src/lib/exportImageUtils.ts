// Shared by pdfExport.ts and pptExport.ts: fetching a cut's image, reading its REAL intrinsic
// pixel dimensions, and computing aspect-preserving (never cropped/stretched) render sizes.
//
// Source of truth for export aspect ratio is always the actual image file's own width/height —
// never project.aspect_ratio, which only exists to pick page orientation/column count (see
// LAYOUT_PRESETS in storyboardLayout.ts). A 1:1 image must render as 1:1 in the PDF/PPT even in
// a 9:16 project.
import { detectImageMime, type ImageMimeInfo } from './imageMime';

export interface ImageDimensions {
  width: number;
  height: number;
  ratio: number;
}

export interface LoadedCutImage extends ImageDimensions {
  dataUrl: string;
  mimeType: ImageMimeInfo['mimeType'];
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

// IHDR chunk (always the first chunk, right after the 8-byte signature) stores width/height as
// two big-endian uint32s at fixed offsets — no need to parse/decompress pixel data.
function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (!isPng) return null;
  const width = readUInt32BE(bytes, 16);
  const height = readUInt32BE(bytes, 20);
  if (width <= 0 || height <= 0) return null;
  return { width, height, ratio: width / height };
}

// Scans JPEG markers for a Start Of Frame segment (SOF0/1/2/3/5/6/7/9/10/11/13/14/15 — every
// SOF variant except the reserved DHT(C4)/JPG(C8)/DAC(CC) codes), which stores height then
// width as big-endian uint16s 5 bytes into the segment.
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset += 1; continue; }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = readUInt16BE(bytes, offset + 5);
      const width = readUInt16BE(bytes, offset + 7);
      if (width <= 0 || height <= 0) return null;
      return { width, height, ratio: width / height };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const segmentLength = readUInt16BE(bytes, offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

// Handles the three WEBP payload kinds: VP8X (extended header, explicit width/height), VP8
// (lossy, dimensions in the frame tag after its start code), and VP8L (lossless, bit-packed
// 14-bit width-1/height-1).
function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!isRiff || !isWebp) return null;
  const fourCC = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (fourCC === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    if (width <= 0 || height <= 0) return null;
    return { width, height, ratio: width / height };
  }

  if (fourCC === 'VP8 ') {
    for (let i = 16; i < bytes.length - 9; i++) {
      if (bytes[i] === 0x9d && bytes[i + 1] === 0x01 && bytes[i + 2] === 0x2a) {
        const width = (bytes[i + 3] | (bytes[i + 4] << 8)) & 0x3fff;
        const height = (bytes[i + 5] | (bytes[i + 6] << 8)) & 0x3fff;
        if (width <= 0 || height <= 0) return null;
        return { width, height, ratio: width / height };
      }
    }
    return null;
  }

  if (fourCC === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    if (width <= 0 || height <= 0) return null;
    return { width, height, ratio: width / height };
  }

  return null;
}

/**
 * Reads an image's real intrinsic pixel dimensions directly from its file bytes (PNG IHDR /
 * JPEG SOF / WEBP VP8 header) — deterministic, works identically in the browser and in Node
 * (unit tests), and never depends on actually decoding/rasterizing the image or on any DOM
 * Image element (so it can't be blocked by canvas/CORS taint restrictions either).
 */
export function readIntrinsicImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return readPngDimensions(bytes) ?? readJpegDimensions(bytes) ?? readWebpDimensions(bytes);
}

/**
 * Fetches a cut's image and reads its true intrinsic dimensions — the single source of truth
 * for export aspect ratio (never project.aspect_ratio). Returns null on any failure (missing
 * URL, network error, unrecognized/corrupt image), so callers fall back to a placeholder.
 */
export async function loadCutImage(url: string): Promise<LoadedCutImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const { mimeType } = detectImageMime(blob, url);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dims = readIntrinsicImageDimensions(bytes);
    if (!dims) throw new Error('이미지 크기를 읽을 수 없습니다.');
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, mimeType, ...dims };
  } catch (err) {
    console.warn('Failed to load image for export:', err);
    return null;
  }
}

/**
 * Scales sourceWidth x sourceHeight to fit entirely within maxWidth x maxHeight, preserving the
 * exact source aspect ratio. Never crops (the whole source always fits inside the result) and
 * never stretches either axis independently (both axes always scale by the same factor).
 */
export function fitImageContain(
  sourceWidth: number, sourceHeight: number, maxWidth: number, maxHeight: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  return { width: sourceWidth * scale, height: sourceHeight * scale };
}
