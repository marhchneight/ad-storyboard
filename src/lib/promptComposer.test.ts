import { describe, it, expect } from 'vitest';
import { composeImagePrompt } from './promptComposer';

describe('composeImagePrompt', () => {
  it('combines style modifier, overall prompt, scene description, and camera direction', () => {
    const result = composeImagePrompt('sketch', '30초 스니커즈 광고, 도시 배경', {
      scene_description: '주인공이 신발끈을 묶는다',
      camera_direction: '클로즈업',
    });
    expect(result).toContain('pencil sketch');
    expect(result).toContain('30초 스니커즈 광고, 도시 배경');
    expect(result).toContain('주인공이 신발끈을 묶는다');
    expect(result).toContain('클로즈업');
  });

  it('omits empty camera_direction without leaving stray separators', () => {
    const result = composeImagePrompt('live_action', '전체 콘셉트', {
      scene_description: '장면 설명',
      camera_direction: '',
    });
    expect(result).not.toMatch(/,\s*,/);
    expect(result).not.toMatch(/,\s*$/);
  });
});
