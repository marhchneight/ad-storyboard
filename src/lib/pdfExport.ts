import { jsPDF } from 'jspdf';
import type { Project, Cut } from '../types';
import { downloadBlob } from './download';

const KOREAN_FONT_URL = '/fonts/Pretendard-Regular.ttf';
const KOREAN_FONT_NAME = 'Pretendard';

let cachedKoreanFontBase64: string | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// jsPDF's built-in fonts (Helvetica/Times/Courier) only cover Latin text, so
// Korean renders as blank/garbled glyphs unless a Korean-capable font is
// registered. Loaded on demand (not bundled into the JS chunk) since PDF
// export is an infrequent action and the font file is a few MB.
async function registerKoreanFont(doc: jsPDF): Promise<boolean> {
  try {
    if (!cachedKoreanFontBase64) {
      const res = await fetch(KOREAN_FONT_URL);
      const buffer = await res.arrayBuffer();
      cachedKoreanFontBase64 = arrayBufferToBase64(buffer);
    }
    doc.addFileToVFS(`${KOREAN_FONT_NAME}.ttf`, cachedKoreanFontBase64);
    doc.addFont(`${KOREAN_FONT_NAME}.ttf`, KOREAN_FONT_NAME, 'normal');
    doc.setFont(KOREAN_FONT_NAME);
    return true;
  } catch (err) {
    console.warn('Failed to load Korean font for PDF export, falling back to default font:', err);
    return false;
  }
}

export async function buildStoryboardPdf(project: Project, cuts: Cut[]): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  await registerKoreanFont(doc);

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    if (i > 0) doc.addPage();
    doc.setFontSize(16);
    doc.text(`${project.title} — 컷 ${i + 1}`, 40, 40);

    if (cut.image_url) {
      try {
        const res = await fetch(cut.image_url);
        const blob = await res.blob();
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        doc.addImage(dataUrl, 'PNG', 40, 60, 200, 200);
      } catch (err) {
        console.warn(`Failed to embed image for cut ${i + 1}:`, err);
      }
    }

    doc.setFontSize(11);
    doc.text(`장면 설명: ${cut.scene_description || '-'}`, 40, 280, { maxWidth: 500 });
    doc.text(`카피/멘트: ${cut.dialogue || '-'}`, 40, 320, { maxWidth: 500 });
    doc.text(`카메라 지시문: ${cut.camera_direction || '-'}`, 40, 360, { maxWidth: 500 });
  }

  return doc;
}

export async function downloadCutImage(cut: Cut, index: number): Promise<void> {
  if (!cut.image_url) return;
  const res = await fetch(cut.image_url);
  const blob = await res.blob();
  downloadBlob(blob, `cut-${index + 1}.png`);
}
