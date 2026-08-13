/** Shared by every export feature that needs to know a fetched cut image's real file type
 * (zip export, PDF embedding, PPTX embedding) — inferred from the blob's MIME type first,
 * falling back to the URL's file extension, defaulting to png. */
export interface ImageMimeInfo {
  extension: 'png' | 'jpg' | 'webp';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

const EXTENSION_TO_INFO: Record<ImageMimeInfo['extension'], ImageMimeInfo> = {
  png: { extension: 'png', mimeType: 'image/png' },
  jpg: { extension: 'jpg', mimeType: 'image/jpeg' },
  webp: { extension: 'webp', mimeType: 'image/webp' },
};

export function detectImageMime(blob: Blob, url: string): ImageMimeInfo {
  if (blob.type === 'image/png') return EXTENSION_TO_INFO.png;
  if (blob.type === 'image/jpeg') return EXTENSION_TO_INFO.jpg;
  if (blob.type === 'image/webp') return EXTENSION_TO_INFO.webp;
  const match = /\.(png|jpe?g|webp)(?:\?|$)/i.exec(url);
  if (match) {
    const ext = match[1].toLowerCase();
    return EXTENSION_TO_INFO[ext === 'jpeg' ? 'jpg' : (ext as ImageMimeInfo['extension'])];
  }
  return EXTENSION_TO_INFO.png;
}
