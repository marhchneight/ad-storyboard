export type StoryboardStyle = 'sketch' | 'animation' | 'live_action';
export type GenerationStatus = 'idle' | 'generating' | 'done' | 'failed';

export interface Project {
  id: string;
  user_id: string;
  title: string;
  style: StoryboardStyle;
  overall_prompt: string;
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
  created_at: string;
  updated_at: string;
}
