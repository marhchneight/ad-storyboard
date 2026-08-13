// Content-sniffing for uploaded image bytes — never trust a client-declared
// File.type or filename extension, since both are attacker-controlled.
// Plain, portable TypeScript (no Deno-specific globals) so it can be
// unit-tested with Vitest and imported unmodified from Deno at runtime.

export type SniffedImageType = 'png' | 'jpeg' | 'webp' | null;

export function sniffImageType(bytes: Uint8Array): SniffedImageType {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return 'webp';
  }
  return null;
}

export const IMAGE_TYPE_EXTENSION: Record<Exclude<SniffedImageType, null>, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
};

export const IMAGE_TYPE_MIME: Record<Exclude<SniffedImageType, null>, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
