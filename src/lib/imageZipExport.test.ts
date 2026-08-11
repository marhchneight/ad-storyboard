import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { buildImagesZip, buildImagesZipFilename } from './imageZipExport';
import type { Project, Cut } from '../types';

const project: Project = {
  id: 'p1', user_id: 'u1', title: '사랑의 레시피', style: 'sketch', aspect_ratio: '1:1',
  overall_prompt: '', brief: {}, creative_direction: '', creative_dna: null, creative_treatment: null,
  created_at: '', updated_at: '',
};

const shotDetailDefaults = {
  duration_seconds: null, shot_size: '', lens: '', angle: '', movement: '', composition: '',
  action: '', lighting: '', mood: '', location: '', props: '', sfx: '', transition: '', purpose: '',
};

function makeCut(overrides: Partial<Cut>): Cut {
  return {
    id: 'c', project_id: 'p1', order_index: 0, scene_description: '', dialogue: '',
    camera_direction: '', image_url: null, generation_status: 'idle', created_at: '', updated_at: '',
    ...shotDetailDefaults,
    ...overrides,
  };
}

function pngBlob(): Blob {
  // A tiny valid 1x1 transparent PNG, base64-encoded.
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

describe('buildImagesZip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('zips exactly the cuts that have an image, using 2-digit zero-padded scene numbers', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => pngBlob() } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);

    const cuts = [
      makeCut({ id: 'c1', image_url: 'https://example.com/1.png' }),
      makeCut({ id: 'c2', image_url: 'https://example.com/2.png' }),
    ];

    const { blob, succeededCount, failedSceneNumbers } = await buildImagesZip(cuts);
    expect(succeededCount).toBe(2);
    expect(failedSceneNumbers).toEqual([]);
    expect(blob).not.toBeNull();

    const zip = await JSZip.loadAsync(await blob!.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['01.png', '02.png']);
  });

  it('keeps the original scene number for images that exist, skipping cuts with no image entirely', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => pngBlob() } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);

    const cuts = [
      makeCut({ id: 'c1', image_url: 'https://example.com/1.png' }), // scene 1
      makeCut({ id: 'c2', image_url: null }),                        // scene 2 - no image
      makeCut({ id: 'c3', image_url: 'https://example.com/3.png' }), // scene 3
    ];

    const { blob, succeededCount } = await buildImagesZip(cuts);
    expect(succeededCount).toBe(2);
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['01.png', '03.png']);
  });

  it('keeps 2-digit padding for an 11-scene storyboard so "11" sorts after "09"/"10"', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => pngBlob() } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);

    const cuts = Array.from({ length: 11 }, (_, i) =>
      makeCut({ id: `c${i}`, image_url: `https://example.com/${i + 1}.png` }));

    const { blob, succeededCount } = await buildImagesZip(cuts);
    expect(succeededCount).toBe(11);
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'].map((n) => `${n}.png`),
    );
  });

  it('widens to 3-digit padding once the storyboard has 100+ scenes', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => pngBlob() } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);

    const cuts = Array.from({ length: 100 }, (_, i) =>
      makeCut({ id: `c${i}`, image_url: i === 99 ? 'https://example.com/100.png' : null }));

    const { blob, succeededCount } = await buildImagesZip(cuts);
    expect(succeededCount).toBe(1);
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(['100.png']);
  });

  it('returns a null blob and no fetch calls when no cut has an image', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const cuts = [makeCut({ image_url: null }), makeCut({ image_url: null })];
    const { blob, succeededCount, failedSceneNumbers } = await buildImagesZip(cuts);

    expect(blob).toBeNull();
    expect(succeededCount).toBe(0);
    expect(failedSceneNumbers).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('continues packaging the images that succeed when one image fetch fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/bad.png') throw new Error('network down');
      return { ok: true, blob: async () => pngBlob() } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const cuts = [
      makeCut({ id: 'c1', image_url: 'https://example.com/good1.png' }),
      makeCut({ id: 'c2', image_url: 'https://example.com/bad.png' }),
      makeCut({ id: 'c3', image_url: 'https://example.com/good2.png' }),
    ];

    const { blob, succeededCount, failedSceneNumbers } = await buildImagesZip(cuts);
    expect(succeededCount).toBe(2);
    expect(failedSceneNumbers).toEqual([2]);
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['01.png', '03.png']);

    warnSpy.mockRestore();
  });

  it('reports progress for each attempted image', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => pngBlob() } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);

    const cuts = [
      makeCut({ id: 'c1', image_url: 'https://example.com/1.png' }),
      makeCut({ id: 'c2', image_url: 'https://example.com/2.png' }),
      makeCut({ id: 'c3', image_url: 'https://example.com/3.png' }),
    ];

    const progressCalls: Array<{ done: number; total: number }> = [];
    await buildImagesZip(cuts, (done, total) => progressCalls.push({ done, total }));

    expect(progressCalls).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });
});

describe('buildImagesZipFilename', () => {
  it('uses the project title with a Korean suffix', () => {
    expect(buildImagesZipFilename(project)).toBe('사랑의 레시피_이미지.zip');
  });

  it('sanitizes filesystem-unsafe characters in the title', () => {
    expect(buildImagesZipFilename({ ...project, title: 'A/B: "Test" <ad>' }))
      .toBe('A_B_ _Test_ _ad__이미지.zip');
  });

  it('falls back to a generic name when the title is empty', () => {
    expect(buildImagesZipFilename({ ...project, title: '' })).toBe('storyboard_images.zip');
  });
});
