import type { AspectRatio, Cut } from '../types';

/** Structural grid shape shared by the PDF and PPTX renderers — unit-agnostic (each renderer
 * converts columns/orientation into its own pt/inch page geometry). */
export interface LayoutPreset {
  columns: number;
  cellsPerPage: number;
  orientation: 'landscape' | 'portrait';
  /** Reference/layout hint ONLY — used for page orientation/column count and as the fallback
   * shape for the "이미지 없음" placeholder when a cut has no real image to measure. Never used
   * to size, crop, or stretch an actual image: real images are always sized from their own
   * intrinsic pixel dimensions (see exportImageUtils.ts), regardless of this value. */
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
