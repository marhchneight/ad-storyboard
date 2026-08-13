import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
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

// Builds a genuinely decodable grayscale PNG at the given pixel dimensions (real IDAT data, not
// just an IHDR stub) so jsPDF can actually embed it — needed to prove the export renders at the
// image's REAL aspect ratio, not project.aspect_ratio, for non-square dimensions.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

function realPngBytes(width: number, height: number): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 0; // color type: grayscale
  const ihdr = pngChunk('IHDR', ihdrData);

  const rowBytes = 1 + width; // 1 filter byte (None) + 1 byte/pixel
  const raw = new Uint8Array(rowBytes * height);
  const compressed = new Uint8Array(deflateSync(Buffer.from(raw)));
  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', new Uint8Array(0));

  const total = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let offset = 0;
  for (const part of [signature, ihdr, idat, iend]) { total.set(part, offset); offset += part.length; }
  return total;
}

function realPngBlob(width: number, height: number): Blob {
  return new Blob([realPngBytes(width, height)], { type: 'image/png' });
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

  it('renders a 1:1 real image at 1:1 even inside a 9:16 project (source dimensions win, not project.aspect_ratio)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/fonts/Pretendard-Regular.ttf') {
        return { arrayBuffer: async () => koreanFontArrayBuffer() } as unknown as Response;
      }
      return { ok: true, blob: async () => realPngBlob(1024, 1024) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const addImageSpy = vi.spyOn(jsPDF.API as unknown as { addImage: (...args: unknown[]) => unknown }, 'addImage');

    const cuts = [makeCut({ id: 'c1', order_index: 0, image_url: 'https://example.com/square.png' })];
    await buildStoryboardPdf(makeProject({ aspect_ratio: '9:16' }), cuts);

    const [, , , , w, h] = addImageSpy.mock.calls[0] as unknown as [unknown, unknown, unknown, unknown, number, number];
    expect(Math.abs(w / h - 1)).toBeLessThan(0.001);
  });

  it('renders a 16:9 real image at 16:9 even inside a 9:16 project (never stretched into a tall frame)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/fonts/Pretendard-Regular.ttf') {
        return { arrayBuffer: async () => koreanFontArrayBuffer() } as unknown as Response;
      }
      return { ok: true, blob: async () => realPngBlob(1536, 864) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const addImageSpy = vi.spyOn(jsPDF.API as unknown as { addImage: (...args: unknown[]) => unknown }, 'addImage');

    const cuts = [makeCut({ id: 'c1', order_index: 0, image_url: 'https://example.com/wide.png' })];
    await buildStoryboardPdf(makeProject({ aspect_ratio: '9:16' }), cuts);

    const [, , , , w, h] = addImageSpy.mock.calls[0] as unknown as [unknown, unknown, unknown, unknown, number, number];
    expect(Math.abs(w / h - 1536 / 864)).toBeLessThan(0.001);
  });

  it('renders a 9:16 real image at 9:16 even inside a 16:9 project', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/fonts/Pretendard-Regular.ttf') {
        return { arrayBuffer: async () => koreanFontArrayBuffer() } as unknown as Response;
      }
      return { ok: true, blob: async () => realPngBlob(864, 1536) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const addImageSpy = vi.spyOn(jsPDF.API as unknown as { addImage: (...args: unknown[]) => unknown }, 'addImage');

    const cuts = [makeCut({ id: 'c1', order_index: 0, image_url: 'https://example.com/tall.png' })];
    await buildStoryboardPdf(makeProject({ aspect_ratio: '16:9' }), cuts);

    const [, , , , w, h] = addImageSpy.mock.calls[0] as unknown as [unknown, unknown, unknown, unknown, number, number];
    expect(Math.abs(w / h - 864 / 1536)).toBeLessThan(0.001);
  });
});
