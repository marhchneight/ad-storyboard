export type StoryboardStyle = 'sketch' | 'animation' | 'live_action';
export type GenerationStatus = 'idle' | 'generating' | 'done' | 'failed';
export type Platform = 'Instagram Reels' | 'TikTok' | 'YouTube' | 'TVC' | 'Digital Ad' | 'Brand Film';
export type Duration = '6s' | '15s' | '30s' | '60s' | 'Custom';

export interface CreativeBrief {
  product?: string;
  objective?: string;
  targetAudience?: string;
  keyMessage?: string;
  platform?: Platform;
  duration?: Duration;
  mood?: string;
  visualKeywords?: string;
  reference?: string;
  conceptDescription?: string;
}

export interface Project {
  id: string;
  user_id: string;
  title: string;
  style: StoryboardStyle;
  overall_prompt: string;
  brief: CreativeBrief;
  creative_direction: string;
  created_at: string;
  updated_at: string;
}

export interface Cut {
  id: string;
  project_id: string;
  order_index: number;
  scene_description: string;
  dialogue: string;
  camera_direction: string;
  image_url: string | null;
  generation_status: GenerationStatus;
  duration_seconds: number | null;
  shot_size: string;
  lens: string;
  angle: string;
  movement: string;
  composition: string;
  action: string;
  lighting: string;
  mood: string;
  location: string;
  props: string;
  sfx: string;
  transition: string;
  purpose: string;
  created_at: string;
  updated_at: string;
}
