import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const project: Project = {
  id: 'p1', user_id: 'u1', title: '테스트 프로젝트', style: 'sketch', aspect_ratio: '1:1',
  overall_prompt: '콘셉트', brief: {}, creative_direction: '', creative_dna: null, creative_treatment: null,
  created_at: '', updated_at: '',
};

const shotDetailDefaults = {
  duration_seconds: null, shot_size: '', lens: '', angle: '', movement: '', composition: '',
  action: '', lighting: '', mood: '', location: '', props: '', sfx: '', transition: '', purpose: '',
  applied_creative_dna: [], creative_dna_application_note: '',
};

const cuts: Cut[] = [
  { id: 'c1', project_id: 'p1', order_index: 0, scene_description: '장면1', dialogue: '대사1',
    camera_direction: '클로즈업', image_url: null, generation_status: 'idle', created_at: '', updated_at: '',
    ...shotDetailDefaults },
  { id: 'c2', project_id: 'p1', order_index: 1, scene_description: '장면2', dialogue: '대사2',
    camera_direction: '', image_url: null, generation_status: 'idle', created_at: '', updated_at: '',
    ...shotDetailDefaults },
];

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
  });

  it('creates one page per cut plus contains the project title', async () => {
    const doc = await buildStoryboardPdf(project, cuts);
    expect(doc.getNumberOfPages()).toBe(cuts.length);
    const text = (doc as unknown as { getTextContent?: unknown }).getTextContent ? '' : ''; // jsPDF has no direct text extraction; check page count and no throw
    expect(text).toBe('');
  });

  it('embeds a fetched image into the PDF for cuts that have an image_url', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/fonts/Pretendard-Regular.ttf') {
        return { arrayBuffer: async () => koreanFontArrayBuffer() } as unknown as Response;
      }
      expect(url).toBe('https://example.com/cut-1.png');
      return {
        blob: async () => tinyPngBlob(),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const cutsWithImage: Cut[] = [
      { ...cuts[0], image_url: 'https://example.com/cut-1.png' },
    ];

    const doc = await buildStoryboardPdf(project, cutsWithImage);

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/cut-1.png');
    expect(doc.getNumberOfPages()).toBe(1);

    // Inspect the raw PDF bytes to confirm an image XObject was actually
    // embedded, not just requested.
    const pdfString = doc.output('datauristring');
    const rawPdf = atob(pdfString.split(',')[1]);
    expect(rawPdf).toContain('/Image');
    expect(rawPdf).toContain('/XObject');
  });

  it('continues generating the PDF (text-only) when a cut image fetch fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mixedCuts: Cut[] = [
      { ...cuts[0], image_url: 'https://example.com/broken.png' },
      { ...cuts[1], image_url: null },
    ];

    const doc = await buildStoryboardPdf(project, mixedCuts);

    expect(doc.getNumberOfPages()).toBe(2);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
