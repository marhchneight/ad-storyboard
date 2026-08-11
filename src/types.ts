export type StoryboardStyle = 'sketch' | 'animation' | 'live_action';
export type AspectRatio = '1:1' | '9:16' | '16:9';
export type GenerationStatus = 'idle' | 'generating' | 'done' | 'failed';
export type Platform = 'Instagram Reels' | 'TikTok' | 'YouTube' | 'TVC' | 'Digital Ad' | 'Brand Film';
export type Duration = '6s' | '15s' | '30s' | '60s' | 'Custom';
export type SceneCountMode = 'manual' | 'duration';
export type TargetDurationSeconds = 15 | 30 | 60;

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

export interface CreativeDnaScore {
  label: string;
  score: number;
  /** Natural Korean equivalent of `label`, shown in the UI when present. */
  labelKo?: string;
}

export interface CreativeDna {
  visualLanguage: CreativeDnaScore[];
  cameraDna: string[];
  lightingDna: string[];
  compositionDna: string[];
  editRhythmDna: string[];
  colorMood: string[];
  creativePrinciples: string[];
  // Optional Korean display mirrors, same order/length as their English
  // counterparts. Absent on rows saved before localization was added — the
  // UI falls back to English (and lazily backfills these) when missing.
  // The English fields above are the ones used for storyboard generation
  // and must never be replaced by these.
  cameraDnaKo?: string[];
  lightingDnaKo?: string[];
  compositionDnaKo?: string[];
  editRhythmDnaKo?: string[];
  colorMoodKo?: string[];
  creativePrinciplesKo?: string[];
}

export interface CreativeTreatmentApproach {
  duration: number | null;
  estimatedShots: number | null;
  dialogueStyle: string;
  productReveal: string;
  cameraStyle: string;
}

export interface CreativeTreatment {
  title: string;
  concept: string;
  creativeDirection: string;
  visualLanguage: string[];
  approach: CreativeTreatmentApproach;
  creativePrinciples: string[];
}

export interface CreativeConcept {
  title: string;
  concept: string;
}

export type CreativeDnaCategory =
  | 'camera' | 'lighting' | 'composition' | 'editRhythm' | 'colorMood' | 'creativePrinciple';

/** One Creative DNA element actually selected as influencing a specific scene. */
export interface AppliedCreativeDnaTag {
  category: CreativeDnaCategory;
  /** Short English slug the model invents for this element, e.g. "closeUp". */
  key: string;
  /** Natural Korean label shown in the UI, e.g. "클로즈업". */
  labelKo: string;
}

export interface Project {
  id: string;
  user_id: string;
  title: string;
  style: StoryboardStyle;
  aspect_ratio: AspectRatio;
  overall_prompt: string;
  brief: CreativeBrief;
  creative_direction: string;
  creative_dna: CreativeDna | null;
  creative_treatment: CreativeTreatment | null;
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
  // Which Creative DNA elements (if any) genuinely influenced this scene, and
  // a short Korean note on how. Defaults to []/'' at the DB level, so these
  // are always present (never undefined) even on rows saved before this
  // field existed — no DNA was ever "applied" to those, which is correct.
  applied_creative_dna: AppliedCreativeDnaTag[];
  creative_dna_application_note: string;
  created_at: string;
  updated_at: string;
}
