import { jsPDF } from 'jspdf';
import type { Project, Cut } from '../types';
import { downloadBlob } from './download';
import { LAYOUT_PRESETS, paginateCuts } from './storyboardLayout';
import { loadCutImage, fitImageContain } from './exportImageUtils';

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

// Layout constants (pt, unit: 'pt' doc). Tuned for a 5-cuts-per-page overview grid rather than
// the old one-page-per-cut layout.
const MARGIN = 40;
const HEADER_HEIGHT = 36;
const GAP = 14;
const BADGE_HEIGHT = 14;
const SMALL_GAP = 4;
// Upper bound on how much of each cell's post-badge height the image may use — the image's
// actual rendered height is then derived from its own real aspect ratio (via fitImageContain)
// and is very often smaller than this cap, handing the leftover space to the text below rather
// than leaving a blank letterboxed gap around the image itself.
const MAX_IMAGE_AREA_SHARE = 0.75;

function drawBox(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFillColor(245, 245, 245);
  doc.setDrawColor(210, 210, 210);
  doc.rect(x, y, w, h, 'FD');
  doc.setDrawColor(0, 0, 0);
}

function drawPlaceholder(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFontSize(9);
  doc.setTextColor(150);
  const text = '이미지 없음';
  const textWidth = doc.getTextWidth(text);
  doc.text(text, x + Math.max(0, (w - textWidth) / 2), y + h / 2);
  doc.setTextColor(0);
}

// Draws `text` wrapped within maxWidth, truncated (with an ellipsis on the last visible line)
// so it never exceeds maxHeight — jsPDF has no auto-clip, so overflow must be computed manually.
// Returns the actual height used.
function drawWrappedText(
  doc: jsPDF, text: string, x: number, y: number, maxWidth: number, maxHeight: number, fontSize: number,
): number {
  doc.setFontSize(fontSize);
  const lineHeight = fontSize * 1.15;
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  const lines = doc.splitTextToSize(text || '-', maxWidth) as string[];
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length > 0) {
    const last = visible[visible.length - 1];
    visible[visible.length - 1] = last.length > 1 ? `${last.slice(0, -1)}…` : '…';
  }
  if (visible.length > 0) doc.text(visible, x, y, { maxWidth });
  return visible.length * lineHeight;
}

// Embeds a cut's image at its own real aspect ratio, scaled (never cropped/stretched) to fit
// within (maxWidth, maxHeight) — the rendered rect's size comes entirely from the image's own
// intrinsic pixel dimensions (via loadCutImage/fitImageContain), never from project.aspect_ratio
// or any fixed box shape. Draws a bordered "이미지 없음" placeholder, sized like a typical image
// for this project (aspect_ratio used only as a layout hint here, never forced onto a real
// image), if there's no image_url or the fetch/decode fails. Returns the actual rendered height,
// so the caller can place the text below it flush against the real image bottom instead of a
// fixed-height box.
async function drawCutImage(
  doc: jsPDF, cut: Cut, x: number, y: number, maxWidth: number, maxHeight: number, placeholderAspect: number,
): Promise<number> {
  const loaded = cut.image_url ? await loadCutImage(cut.image_url) : null;

  if (loaded) {
    const fit = fitImageContain(loaded.width, loaded.height, maxWidth, maxHeight);
    const offsetX = x + (maxWidth - fit.width) / 2;
    const format = loaded.mimeType === 'image/jpeg' ? 'JPEG' : loaded.mimeType === 'image/webp' ? 'WEBP' : 'PNG';
    doc.addImage(loaded.dataUrl, format, offsetX, y, fit.width, fit.height);
    return fit.height;
  }

  const fit = fitImageContain(placeholderAspect, 1, maxWidth, maxHeight);
  const offsetX = x + (maxWidth - fit.width) / 2;
  drawBox(doc, offsetX, y, fit.width, fit.height);
  drawPlaceholder(doc, offsetX, y, fit.width, fit.height);
  return fit.height;
}

export async function buildStoryboardPdf(project: Project, cuts: Cut[]): Promise<jsPDF> {
  const preset = LAYOUT_PRESETS[project.aspect_ratio] ?? LAYOUT_PRESETS['1:1'];
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: preset.orientation === 'landscape' ? 'l' : 'p' });
  await registerKoreanFont(doc);

  const pages = paginateCuts(cuts, preset.cellsPerPage);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const rows = Math.ceil(preset.cellsPerPage / preset.columns);

  const contentX = MARGIN;
  const contentY = MARGIN + HEADER_HEIGHT;
  const contentWidth = pageWidth - MARGIN * 2;
  const contentHeight = pageHeight - HEADER_HEIGHT - MARGIN * 2;
  const cellWidth = (contentWidth - (preset.columns - 1) * GAP) / preset.columns;
  const cellHeight = (contentHeight - (rows - 1) * GAP) / rows;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    if (pageIndex > 0) doc.addPage();

    doc.setFontSize(16);
    doc.setTextColor(0);
    doc.text(project.title, MARGIN, MARGIN + 12);

    const pageCuts = pages[pageIndex];
    for (let j = 0; j < pageCuts.length; j++) {
      const cut = pageCuts[j];
      const globalIndex = pageIndex * preset.cellsPerPage + j;
      const col = j % preset.columns;
      const row = Math.floor(j / preset.columns);
      const cellX = contentX + col * (cellWidth + GAP);
      const cellY = contentY + row * (cellHeight + GAP);

      doc.setFontSize(10);
      doc.setTextColor(0);
      doc.text(`컷 ${globalIndex + 1}`, cellX, cellY + 10);

      const imageBoxY = cellY + BADGE_HEIGHT;
      const remaining = cellHeight - BADGE_HEIGHT;
      const maxImageHeight = remaining * MAX_IMAGE_AREA_SHARE;

      const renderedImageHeight = await drawCutImage(
        doc, cut, cellX, imageBoxY, cellWidth, maxImageHeight, preset.imageAspect,
      );

      const textBoxY = imageBoxY + renderedImageHeight + SMALL_GAP;
      const textBoxHeight = remaining - renderedImageHeight - SMALL_GAP;

      const sceneHeight = textBoxHeight * 0.55;
      const dialogueHeight = textBoxHeight - sceneHeight - 2;
      const usedScene = drawWrappedText(
        doc, `장면: ${cut.scene_description || '-'}`, cellX, textBoxY + 9, cellWidth, sceneHeight, 8,
      );
      drawWrappedText(
        doc, `카피: ${cut.dialogue || '-'}`, cellX, textBoxY + usedScene + 9 + 2, cellWidth, dialogueHeight, 8,
      );
    }
  }

  return doc;
}

export async function downloadCutImage(cut: Cut, index: number): Promise<void> {
  if (!cut.image_url) return;
  const res = await fetch(cut.image_url);
  const blob = await res.blob();
  downloadBlob(blob, `cut-${index + 1}.png`);
}
