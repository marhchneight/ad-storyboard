import type { AspectRatio, Cut } from '../types';

/** Structural grid shape shared by the PDF and PPTX renderers — unit-agnostic (each renderer
 * converts columns/orientation into its own pt/inch page geometry). */
export interface LayoutPreset {
  columns: number;
  cellsPerPage: number;
  orientation: 'landscape' | 'portrait';
  /** Informs cell proportions only — actual images are always contain-fit to their own real
   * aspect ratio, never stretched/cropped to this. */
  imageAspect: number;
}

export const CELLS_PER_PAGE = 5;

export const LAYOUT_PRESETS: Record<AspectRatio, LayoutPreset> = {
  '16:9': { columns: 2, cellsPerPage: CELLS_PER_PAGE, orientation: 'landscape', imageAspect: 16 / 9 },
  '9:16': { columns: 5, cellsPerPage: CELLS_PER_PAGE, orientation: 'portrait', imageAspect: 9 / 16 },
  '1:1': { columns: 3, cellsPerPage: CELLS_PER_PAGE, orientation: 'portrait', imageAspect: 1 },
};

/** Splits cuts into fixed-size page chunks in their given (already order_index-sorted) order. */
export function paginateCuts(cuts: Cut[], cellsPerPage: number = CELLS_PER_PAGE): Cut[][] {
  const pages: Cut[][] = [];
  for (let i = 0; i < cuts.length; i += cellsPerPage) {
    pages.push(cuts.slice(i, i + cellsPerPage));
  }
  return pages.length > 0 ? pages : [[]];
}

/** Computes a contain-fit rect (no crop, no stretch) for an image of `imgW`x`imgH` inside a
 * `boxW`x`boxH` box, centered — the shared math behind PDF's manual placement (PPTX gets this
 * for free from pptxgenjs's own `sizing: 'contain'`, but the same formula still applies there
 * conceptually). */
export function containFit(imgW: number, imgH: number, boxW: number, boxH: number) {
  if (imgW <= 0 || imgH <= 0) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}
