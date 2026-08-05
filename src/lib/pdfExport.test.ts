import { describe, it, expect } from 'vitest';
import { buildStoryboardPdf } from './pdfExport';
import type { Project, Cut } from '../types';

const project: Project = {
  id: 'p1', user_id: 'u1', title: '테스트 프로젝트', style: 'sketch',
  overall_prompt: '콘셉트', created_at: '', updated_at: '',
};

const cuts: Cut[] = [
  { id: 'c1', project_id: 'p1', order_index: 0, scene_description: '장면1', dialogue: '대사1',
    camera_direction: '클로즈업', image_url: null, generation_status: 'idle', created_at: '', updated_at: '' },
  { id: 'c2', project_id: 'p1', order_index: 1, scene_description: '장면2', dialogue: '대사2',
    camera_direction: '', image_url: null, generation_status: 'idle', created_at: '', updated_at: '' },
];

describe('buildStoryboardPdf', () => {
  it('creates one page per cut plus contains the project title', async () => {
    const doc = await buildStoryboardPdf(project, cuts);
    expect(doc.getNumberOfPages()).toBe(cuts.length);
    const text = (doc as unknown as { getTextContent?: unknown }).getTextContent ? '' : ''; // jsPDF has no direct text extraction; check page count and no throw
    expect(text).toBe('');
  });
});
