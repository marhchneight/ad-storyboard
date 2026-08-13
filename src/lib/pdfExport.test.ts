import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';
import { buildStoryboardPdf } from './pdfExport';
import type { Project, Cut } from '../types';

// Real font bytes (not a stub) so jsPDF's TTF parsing succeeds when tests
// stub out `fetch` for the Korean font request in pdfExport.ts.
const koreanFontPath = fileURLToPath(new URL('../../public/fonts/Pretendard-Regular.ttf', import.meta.url));
const koreanFontBuffer = readFileSync(koreanFontPath);
function koreanFontArrayBuffer(): ArrayBuffer {
  return koreanFontBuffer.buffer.slice(
    koreanFontBuffer.byteOffset,
    koreanFontBuffer.byteOffset + koreanFontBuffer.byteLength,
  ) as ArrayBuffer;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1', user_id: 'u1', title: '테스트 프로젝트', style: 'sketch', aspect_ratio: '1:1',
    overall_prompt: '콘셉트', brief: {}, creative_direction: '', creative_dna: null, creative_treatment: null,
    selected_directing_direction: null, creative_risk: null, visual_bible: null,
    created_at: '', updated_at: '',
    ...overrides,
  };
}

const shotDetailDefaults = {
  duration_seconds: null, shot_size: '', lens: '', angle: '', movement: '', composition: '',
  action: '', lighting: '', mood: '', location: '', props: '', sfx: '', transition: '', purpose: '',
  image_prompt: '', entity_refs: { characters: [], products: [], location: null },
  applied_creative_dna: [], creative_dna_application_note: '', scene_role: null,
};

function makeCut(overrides: Partial<Cut> & { id: string; order_index: number }): Cut {
  return {
    project_id: 'p1', scene_description: `장면${overrides.order_index + 1}`, dialogue: `대사${overrides.order_index + 1}`,
    camera_direction: '클로즈업', image_url: null, generation_status: 'idle', created_at: '', updated_at: '',
    ...shotDetailDefaults,
    ...overrides,
  };
}

function makeCuts(count: number): Cut[] {
  return Array.from({ length: count }, (_, i) => makeCut({ id: `c${i + 1}`, order_index: i }));
}

// A tiny valid 1x1 transparent PNG, base64-encoded.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function tinyPngBlob(): Blob {
  const bytes = Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

// Node's test environment (no jsdom) doesn't provide FileReader. Polyfill a
// minimal version backed by Blob.arrayBuffer() so the implementation's
// `new FileReader()` / `readAsDataURL` calls work under vitest.
if (typeof globalThis.FileReader === 'undefined') {
  class NodeFileReader {
    result: string | ArrayBuffer | null = null;
    error: unknown = null;
    onloadend: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL(blob: Blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          const base64 = Buffer.from(buf).toString('base64');
          const type = (blob as { type?: string }).type || 'application/octet-stream';
          this.result = `data:${type};base64,${base64}`;
          this.onloadend?.();
        })
        .catch((err) => {
          this.error = err;
          this.onerror?.();
        });
    }
  }
  // @ts-expect-error - test-only polyfill assignment
  globalThis.FileReader = NodeFileReader;
}

describe('buildStoryboardPdf', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('places up to 5 cuts per page (overview layout), not one page per cut', async () => {
    const doc = await buildStoryboardPdf(makeProject(), makeCuts(3));
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('starts a new page once a project has more than 5 cuts (9 cuts -> 2 pages)', async () => {
    const doc = await buildStoryboardPdf(makeProject(), makeCuts(9));
    expect(doc.getNumberOfPages()).toBe(2);
  });

  it('creates exactly ceil(cutCount/5) pages for a larger storyboard', async () => {
    const doc = await buildStoryboardPdf(makeProject(), makeCuts(12));
    expect(doc.getNumberOfPages()).toBe(3);
  });

  it('never throws and still produces a page when there are zero cuts', async () => {
    const doc = await buildStoryboardPdf(makeProject(), []);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('embeds a fetched image contain-fit (never the old fixed 200x200 box) into the PDF', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/fonts/Pretendard-Regular.ttf') {
        return { arrayBuffer: async () => koreanFontArrayBuffer() } as unknown as Response;
      }
      expect(url).toBe('https://example.com/cut-1.png');
      return { ok: true, blob: async () => tinyPngBlob() } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const addImageSpy = vi.spyOn(jsPDF.API as unknown as { addImage: (...args: unknown[]) => unknown }, 'addImage');

    const cutsWithImage = [makeCut({ id: 'c1', order_index: 0, image_url: 'https://example.com/cut-1.png' })];
    const doc = await buildStoryboardPdf(makeProject(), cutsWithImage);

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/cut-1.png');
    expect(doc.getNumberOfPages()).toBe(1);
    expect(addImageSpy).toHaveBeenCalledTimes(1);

    const [, , x, y, w, h] = addImageSpy.mock.calls[0] as unknown as [unknown, unknown, number, number, number, number];
    // Regression guard: the old implementation always drew a hardcoded 200x200 square,
    // regardless of the image's real (here 1x1, i.e. square) aspect ratio.
    expect(w === 200 && h === 200).toBe(false);
    // The contain-fit rect must stay inside the page (no overflow/crop needed to fit it).
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(pageWidth + 0.01);
    expect(y + h).toBeLessThanOrEqual(pageHeight + 0.01);

    // Inspect the raw PDF bytes to confirm an image XObject was actually embedded.
    const pdfString = doc.output('datauristring');
    const rawPdf = atob(pdfString.split(',')[1]);
    expect(rawPdf).toContain('/Image');
    expect(rawPdf).toContain('/XObject');
  });

  it('draws an "이미지 없음" placeholder (never throws) for a cut with no image_url', async () => {
    const doc = await buildStoryboardPdf(makeProject(), [makeCut({ id: 'c1', order_index: 0, image_url: null })]);
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('continues generating the PDF when a cut image fetch fails, falling back to a placeholder', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mixedCuts = [
      makeCut({ id: 'c1', order_index: 0, image_url: 'https://example.com/broken.png' }),
      makeCut({ id: 'c2', order_index: 1, image_url: null }),
    ];

    const doc = await buildStoryboardPdf(makeProject(), mixedCuts);

    expect(doc.getNumberOfPages()).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('uses a landscape page for a 16:9 project and a portrait page for 9:16/1:1', async () => {
    const landscapeDoc = await buildStoryboardPdf(makeProject({ aspect_ratio: '16:9' }), makeCuts(1));
    expect(landscapeDoc.internal.pageSize.getWidth()).toBeGreaterThan(landscapeDoc.internal.pageSize.getHeight());

    const portraitDoc = await buildStoryboardPdf(makeProject({ aspect_ratio: '9:16' }), makeCuts(1));
    expect(portraitDoc.internal.pageSize.getHeight()).toBeGreaterThan(portraitDoc.internal.pageSize.getWidth());
  });
});
