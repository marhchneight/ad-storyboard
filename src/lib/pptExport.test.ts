import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';
import { buildStoryboardPptx } from './pptExport';
import type { Project, Cut } from '../types';

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

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function tinyPngBlob(): Blob {
  const bytes = Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

// Builds a genuinely decodable grayscale PNG at the given pixel dimensions (real IDAT data, not
// just an IHDR stub) so pptxgenjs can actually embed it — needed to prove the export renders at
// the image's REAL aspect ratio, not project.aspect_ratio, for non-square dimensions.
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

// Extracts the rendered picture frame's width/height (EMU) from a slide's XML, so tests can
// assert the actual embedded aspect ratio without relying on internal pptxgenjs call spies.
function extractPicExtRatio(slideXml: string): number | null {
  const picMatch = /<p:pic>[\s\S]*?<\/p:pic>/.exec(slideXml);
  if (!picMatch) return null;
  const extMatch = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(picMatch[0]);
  if (!extMatch) return null;
  return Number(extMatch[1]) / Number(extMatch[2]);
}

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

// pptx files are zip archives; loading the generated buffer back with jszip (already a project
// dependency) lets us assert real structural facts (slide count, embedded media) instead of just
// "it didn't throw".
async function loadSlideEntries(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const mediaNames = Object.keys(zip.files).filter((name) => name.startsWith('ppt/media/') && !zip.files[name].dir);
  return { slideNames, mediaNames, zip };
}

describe('buildStoryboardPptx', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('produces a valid pptx (zip) with one slide per page of up to 5 cuts', async () => {
    const pptx = await buildStoryboardPptx(makeProject(), makeCuts(3));
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const { slideNames } = await loadSlideEntries(buffer);
    expect(slideNames.length).toBe(1);
  });

  it('starts a new slide once a project has more than 5 cuts (9 cuts -> 2 slides)', async () => {
    const pptx = await buildStoryboardPptx(makeProject(), makeCuts(9));
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const { slideNames } = await loadSlideEntries(buffer);
    expect(slideNames.length).toBe(2);
  });

  it('never throws and still produces a slide when there are zero cuts', async () => {
    const pptx = await buildStoryboardPptx(makeProject(), []);
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const { slideNames } = await loadSlideEntries(buffer);
    expect(slideNames.length).toBe(1);
  });

  it('embeds a fetched cut image as slide media (contain-fit, via pptxgenjs sizing)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://example.com/cut-1.png');
      return { ok: true, blob: async () => tinyPngBlob() } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const cutsWithImage = [makeCut({ id: 'c1', order_index: 0, image_url: 'https://example.com/cut-1.png' })];
    const pptx = await buildStoryboardPptx(makeProject(), cutsWithImage);
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/cut-1.png');
    const { mediaNames } = await loadSlideEntries(buffer);
    expect(mediaNames.length).toBeGreaterThan(0);
  });

  it('still generates a slide (placeholder, no throw) for a cut with no image_url', async () => {
    const pptx = await buildStoryboardPptx(makeProject(), [makeCut({ id: 'c1', order_index: 0, image_url: null })]);
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const { slideNames, mediaNames } = await loadSlideEntries(buffer);
    expect(slideNames.length).toBe(1);
    expect(mediaNames.length).toBe(0);
  });

  it('continues generating the pptx when a cut image fetch fails, falling back to a placeholder', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mixedCuts = [
      makeCut({ id: 'c1', order_index: 0, image_url: 'https://example.com/broken.png' }),
      makeCut({ id: 'c2', order_index: 1, image_url: null }),
    ];
    const pptx = await buildStoryboardPptx(makeProject(), mixedCuts);
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const { slideNames } = await loadSlideEntries(buffer);

    expect(slideNames.length).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('uses a wide layout for 16:9 and a tall layout for 9:16', async () => {
    const widePptx = await buildStoryboardPptx(makeProject({ aspect_ratio: '16:9' }), makeCuts(1));
    expect(widePptx.presLayout.width).toBeGreaterThan(widePptx.presLayout.height);

    const tallPptx = await buildStoryboardPptx(makeProject({ aspect_ratio: '9:16' }), makeCuts(1));
    expect(tallPptx.presLayout.height).toBeGreaterThan(tallPptx.presLayout.width);
  });

  it('renders a 1:1 real image at 1:1 even inside a 9:16 project (source dimensions win, not project.aspect_ratio)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => realPngBlob(1024, 1024) } as unknown as Response)));

    const cuts = [makeCut({ id: 'c1', order_index: 0, image_url: 'https://example.com/square.png' })];
    const pptx = await buildStoryboardPptx(makeProject({ aspect_ratio: '9:16' }), cuts);
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const { zip } = await loadSlideEntries(buffer);
    const slideXml = await zip.files['ppt/slides/slide1.xml'].async('text');

    const ratio = extractPicExtRatio(slideXml);
    expect(ratio).not.toBeNull();
    expect(Math.abs((ratio as number) - 1)).toBeLessThan(0.01);
  });

  it('renders a 16:9 real image at 16:9 even inside a 9:16 project (never stretched into a tall frame)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => realPngBlob(1536, 864) } as unknown as Response)));

    const cuts = [makeCut({ id: 'c1', order_index: 0, image_url: 'https://example.com/wide.png' })];
    const pptx = await buildStoryboardPptx(makeProject({ aspect_ratio: '9:16' }), cuts);
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const { zip } = await loadSlideEntries(buffer);
    const slideXml = await zip.files['ppt/slides/slide1.xml'].async('text');

    const ratio = extractPicExtRatio(slideXml);
    expect(ratio).not.toBeNull();
    expect(Math.abs((ratio as number) - 1536 / 864)).toBeLessThan(0.01);
  });

  it('renders a 9:16 real image at 9:16 even inside a 16:9 project', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => realPngBlob(864, 1536) } as unknown as Response)));

    const cuts = [makeCut({ id: 'c1', order_index: 0, image_url: 'https://example.com/tall.png' })];
    const pptx = await buildStoryboardPptx(makeProject({ aspect_ratio: '16:9' }), cuts);
    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const { zip } = await loadSlideEntries(buffer);
    const slideXml = await zip.files['ppt/slides/slide1.xml'].async('text');

    const ratio = extractPicExtRatio(slideXml);
    expect(ratio).not.toBeNull();
    expect(Math.abs((ratio as number) - 864 / 1536)).toBeLessThan(0.01);
  });
});
