import JSZip from 'jszip';
import type { Cut, Project } from '../types';
import { detectImageMime } from './imageMime';

const FILENAME_UNSAFE = /[\\/:*?"<>|]/g;

function sanitizeFilename(name: string): string {
  return name.replace(FILENAME_UNSAFE, '_').trim();
}

export interface ImagesZipResult {
  blob: Blob | null;
  succeededCount: number;
  failedSceneNumbers: number[];
}

// Reuses the same fetch-the-stored-image approach as the individual
// download button (downloadCutImage in pdfExport.ts) — no re-encoding, the
// original file bytes from storage go straight into the zip.
export async function buildImagesZip(
  cuts: Cut[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImagesZipResult> {
  const withImages = cuts
    .map((cut, i) => ({ cut, sceneNumber: i + 1 }))
    .filter((entry): entry is { cut: Cut & { image_url: string }; sceneNumber: number } => !!entry.cut.image_url);

  if (withImages.length === 0) {
    return { blob: null, succeededCount: 0, failedSceneNumbers: [] };
  }

  const zip = new JSZip();
  const failedSceneNumbers: number[] = [];
  const padWidth = Math.max(2, String(cuts.length).length);

  let done = 0;
  for (const { cut, sceneNumber } of withImages) {
    try {
      const res = await fetch(cut.image_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const { extension } = detectImageMime(blob, cut.image_url);
      zip.file(`${String(sceneNumber).padStart(padWidth, '0')}.${extension}`, await blob.arrayBuffer());
    } catch (err) {
      console.warn(`Failed to fetch image for cut ${sceneNumber}:`, err);
      failedSceneNumbers.push(sceneNumber);
    } finally {
      done += 1;
      onProgress?.(done, withImages.length);
    }
  }

  const succeededCount = withImages.length - failedSceneNumbers.length;
  if (succeededCount === 0) {
    return { blob: null, succeededCount: 0, failedSceneNumbers };
  }

  // Generate as arraybuffer (not JSZip's 'blob' type) and wrap in a native
  // Blob ourselves — jszip's browser-only Blob support detection is
  // unreliable across environments (breaks under vitest/Node), whereas a
  // real Blob works everywhere.
  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  const blob = new Blob([arrayBuffer], { type: 'application/zip' });
  return { blob, succeededCount, failedSceneNumbers };
}

export function buildImagesZipFilename(project: Project): string {
  const base = sanitizeFilename(project.title || '');
  return base ? `${base}_이미지.zip` : 'storyboard_images.zip';
}
