import type { StoryboardStyle } from '../types';

const STYLE_MODIFIERS: Record<StoryboardStyle, string> = {
  sketch: 'black and white pencil sketch storyboard style, rough hand-drawn line art',
  animation: 'flat 2D animation illustration style, vibrant colors, cartoon character design',
  live_action: 'photorealistic cinematic film still, realistic lighting, live action',
};

export function composeImagePrompt(
  style: StoryboardStyle,
  overallPrompt: string,
  cut: { scene_description: string; camera_direction: string }
): string {
  const parts = [
    STYLE_MODIFIERS[style],
    overallPrompt.trim(),
    cut.scene_description.trim(),
    cut.camera_direction.trim(),
  ].filter((part) => part.length > 0);

  return parts.join(', ');
}
