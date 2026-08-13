import PptxGenJS from 'pptxgenjs';
import type { AspectRatio, Project, Cut } from '../types';
import { LAYOUT_PRESETS, paginateCuts } from './storyboardLayout';
import { loadCutImage, fitImageContain } from './exportImageUtils';

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
// Upper bound on how much of each cell's post-badge height the image may use — the image's
// actual rendered height is then derived from its own real aspect ratio (via fitImageContain)
// and is very often smaller than this cap, handing the leftover space to the text below rather
// than leaving a blank letterboxed gap around the image itself.
const MAX_IMAGE_AREA_SHARE = 0.75;
const PLACEHOLDER_FILL = 'F5F5F5';
const PLACEHOLDER_LINE = 'D2D2D2';

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

// Embeds a cut's image at its own real aspect ratio, scaled (never cropped/stretched) to fit
// within (maxWidth, maxHeight) — the rendered rect's size comes entirely from the image's own
// intrinsic pixel dimensions (via loadCutImage/fitImageContain), never from project.aspect_ratio
// or any fixed box shape. (pptxgenjs's own `sizing: { type: 'contain' }` would otherwise letterbox
// the image inside whatever box it's given — here the box IS the fit rect, so that letterboxing
// never has anything to do.) Draws a bordered "이미지 없음" placeholder, sized like a typical
// image for this project (aspect_ratio used only as a layout hint here, never forced onto a real
// image), if there's no image_url or the fetch/decode fails. Returns the actual rendered height,
// so the caller can place the text below it flush against the real image bottom instead of a
// fixed-height box.
async function addCutImage(
  slide: PptxGenJS.Slide, pptx: PptxGenJS, cut: Cut, x: number, y: number, maxWidth: number, maxHeight: number,
  placeholderAspect: number,
): Promise<number> {
  const loaded = cut.image_url ? await loadCutImage(cut.image_url) : null;

  if (loaded) {
    const fit = fitImageContain(loaded.width, loaded.height, maxWidth, maxHeight);
    const offsetX = x + (maxWidth - fit.width) / 2;
    slide.addImage({
      data: loaded.dataUrl,
      x: offsetX, y, w: fit.width, h: fit.height,
      sizing: { type: 'contain', w: fit.width, h: fit.height },
    });
    return fit.height;
  }

  const fit = fitImageContain(placeholderAspect, 1, maxWidth, maxHeight);
  const offsetX = x + (maxWidth - fit.width) / 2;
  drawPlaceholderBox(slide, pptx, offsetX, y, fit.width, fit.height);
  slide.addText('이미지 없음', {
    x: offsetX, y, w: fit.width, h: fit.height, align: 'center', valign: 'middle',
    fontSize: 9, color: '999999', fontFace: KOREAN_FONT_FACE,
  });
  return fit.height;
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
      const maxImageHeight = remaining * MAX_IMAGE_AREA_SHARE;

      const renderedImageHeight = await addCutImage(
        slide, pptx, cut, cellX, imageBoxY, cellWidth, maxImageHeight, preset.imageAspect,
      );

      const textBoxY = imageBoxY + renderedImageHeight + SMALL_GAP;
      const textBoxHeight = remaining - renderedImageHeight - SMALL_GAP;

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
