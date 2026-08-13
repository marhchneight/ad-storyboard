import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { buildStoryboardPptx } from './pptExport';
import type { Project, Cut } from '../types';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1', user_id: 'u1', title: '테스트 프로젝트', style: 'sketch', aspect_ratio: '1:1',
    overall_prompt: '콘셉트', brief: {}, creative_direction: '', creative_dna: null, creative_treatment: null,
    selected_directing_direction: null, creative_risk: null,
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
});
