import PptxGenJS from 'pptxgenjs';
import type { AspectRatio, Project, Cut } from '../types';
import { detectImageMime } from './imageMime';
import { LAYOUT_PRESETS, paginateCuts } from './storyboardLayout';

const KOREAN_FONT_FACE = 'Pretendard';

// Slide sizes (inches) per aspect ratio — mirrors the PDF's per-preset page orientation, using
// standard widescreen dimensions for 16:9 and their portrait/square equivalents for the others.
const PPTX_PAGE_SIZE_IN: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 13.333, height: 7.5 },
  '9:16': { width: 7.5, height: 13.333 },
  '1:1': { width: 10, height: 10 },
};

// Layout constants (inches) — same structural proportions as pdfExport.ts's pt-based constants.
const MARGIN = 0.4;
const HEADER_HEIGHT = 0.4;
const GAP = 0.15;
const BADGE_HEIGHT = 0.2;
const SMALL_GAP = 0.06;
const IMAGE_BOX_RATIO = 0.62;
const PLACEHOLDER_FILL = 'F5F5F5';
const PLACEHOLDER_LINE = 'D2D2D2';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// pptxgenjs's `fit: 'shrink'` is only applied by PowerPoint after the user edits/resizes the
// text box — it does not shrink text at generation time — so long text must still be capped
// here to avoid visually overflowing its box on first open. There's no text-measurement API
// available in this (non-DOM-canvas) context, so this uses an approximate average-character-
// width heuristic (wide enough to comfortably fit mixed Korean/Latin text) rather than exact
// glyph metrics.
function truncateToFit(text: string, boxWidthIn: number, boxHeightIn: number, fontSizePt: number): string {
  const raw = text || '-';
  const avgCharWidthIn = (fontSizePt * 0.62) / 72;
  const lineHeightIn = (fontSizePt * 1.3) / 72;
  const charsPerLine = Math.max(4, Math.floor(boxWidthIn / avgCharWidthIn));
  const maxLines = Math.max(1, Math.floor(boxHeightIn / lineHeightIn));
  const maxChars = charsPerLine * maxLines;
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, Math.max(0, maxChars - 1))}…`;
}

function drawPlaceholderBox(slide: PptxGenJS.Slide, pptx: PptxGenJS, x: number, y: number, w: number, h: number) {
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: PLACEHOLDER_FILL },
    line: { color: PLACEHOLDER_LINE, width: 1 },
  });
}

async function addCutImage(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, cut: Cut, x: number, y: number, w: number, h: number,
): Promise<void> {
  drawPlaceholderBox(slide, pptx, x, y, w, h);

  if (!cut.image_url) {
    slide.addText('이미지 없음', {
      x, y, w, h, align: 'center', valign: 'middle', fontSize: 9, color: '999999', fontFace: KOREAN_FONT_FACE,
    });
    return;
  }

  try {
    const res = await fetch(cut.image_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const { mimeType } = detectImageMime(blob, cut.image_url);
    const dataUrl = await blobToDataUrl(blob);

    // pptxgenjs's own `sizing: { type: 'contain' }` decodes the image and contain-fits it
    // within the given box (centered, no crop/stretch) — no manual aspect-ratio math needed
    // here (unlike jsPDF, which has no equivalent and requires computing it by hand).
    slide.addImage({
      data: dataUrl,
      x, y, w, h,
      sizing: { type: 'contain', w, h },
    });
    void mimeType; // format is read directly from the data URI by pptxgenjs; kept for parity/clarity
  } catch (err) {
    console.warn('Failed to embed image for a cut:', err);
    slide.addText('이미지 없음', {
      x, y, w, h, align: 'center', valign: 'middle', fontSize: 9, color: '999999', fontFace: KOREAN_FONT_FACE,
    });
  }
}

export async function buildStoryboardPptx(project: Project, cuts: Cut[]): Promise<PptxGenJS> {
  const preset = LAYOUT_PRESETS[project.aspect_ratio] ?? LAYOUT_PRESETS['1:1'];
  const pageSize = PPTX_PAGE_SIZE_IN[project.aspect_ratio] ?? PPTX_PAGE_SIZE_IN['1:1'];

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'STORYBOARD', width: pageSize.width, height: pageSize.height });
  pptx.layout = 'STORYBOARD';

  const pages = paginateCuts(cuts, preset.cellsPerPage);
  const rows = Math.ceil(preset.cellsPerPage / preset.columns);

  const contentX = MARGIN;
  const contentY = MARGIN + HEADER_HEIGHT;
  const contentWidth = pageSize.width - MARGIN * 2;
  const contentHeight = pageSize.height - HEADER_HEIGHT - MARGIN * 2;
  const cellWidth = (contentWidth - (preset.columns - 1) * GAP) / preset.columns;
  const cellHeight = (contentHeight - (rows - 1) * GAP) / rows;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const slide = pptx.addSlide();
    slide.addText(project.title, {
      x: MARGIN, y: MARGIN, w: contentWidth, h: HEADER_HEIGHT,
      fontSize: 16, bold: true, fontFace: KOREAN_FONT_FACE, valign: 'middle',
    });

    const pageCuts = pages[pageIndex];
    for (let j = 0; j < pageCuts.length; j++) {
      const cut = pageCuts[j];
      const globalIndex = pageIndex * preset.cellsPerPage + j;
      const col = j % preset.columns;
      const row = Math.floor(j / preset.columns);
      const cellX = contentX + col * (cellWidth + GAP);
      const cellY = contentY + row * (cellHeight + GAP);

      slide.addText(`컷 ${globalIndex + 1}`, {
        x: cellX, y: cellY, w: cellWidth, h: BADGE_HEIGHT,
        fontSize: 10, bold: true, fontFace: KOREAN_FONT_FACE,
      });

      const imageBoxY = cellY + BADGE_HEIGHT;
      const remaining = cellHeight - BADGE_HEIGHT;
      const imageBoxHeight = remaining * IMAGE_BOX_RATIO;
      const textBoxY = imageBoxY + imageBoxHeight + SMALL_GAP;
      const textBoxHeight = remaining - imageBoxHeight - SMALL_GAP;

      await addCutImage(slide, pptx, cut, cellX, imageBoxY, cellWidth, imageBoxHeight);

      const sceneHeight = textBoxHeight * 0.55;
      const dialogueHeight = textBoxHeight - sceneHeight - 0.02;
      const fontSize = 8;

      slide.addText(truncateToFit(`장면: ${cut.scene_description || '-'}`, cellWidth, sceneHeight, fontSize), {
        x: cellX, y: textBoxY, w: cellWidth, h: sceneHeight,
        fontSize, fontFace: KOREAN_FONT_FACE, valign: 'top', fit: 'shrink',
      });
      slide.addText(
        truncateToFit(`카피: ${cut.dialogue || '-'}`, cellWidth, dialogueHeight, fontSize),
        {
          x: cellX, y: textBoxY + sceneHeight + 0.02, w: cellWidth, h: dialogueHeight,
          fontSize, fontFace: KOREAN_FONT_FACE, valign: 'top', fit: 'shrink',
        },
      );
    }
  }

  return pptx;
}
