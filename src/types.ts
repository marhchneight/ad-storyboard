export type StoryboardStyle = 'sketch' | 'animation' | 'live_action';
export type AspectRatio = '1:1' | '9:16' | '16:9';
export type GenerationStatus = 'idle' | 'generating' | 'done' | 'failed';
export type Platform = 'Instagram Reels' | 'TikTok' | 'YouTube' | 'TVC' | 'Digital Ad' | 'Brand Film';
export type Duration = '6s' | '15s' | '30s' | '60s' | 'Custom';
export type SceneCountMode = 'manual' | 'duration';
export type TargetDurationSeconds = 15 | 30 | 60;

/** A trend-aware, storyboard-ready ad idea suggestion shown as a clickable chip. */
export interface CreativeExample {
  id: string;
  text: string;
  /** Free-form creative-direction label (e.g. "숏폼/SNS형") — not shown in the UI today. */
  category?: string;
  /** Short tags naming which trend signal(s) this idea draws on — reserved for a future "why this idea" surface. */
  trendSignals?: string[];
  market?: 'KR' | 'GLOBAL' | 'MIXED';
}

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
  /** Brand Intelligence context from the "제품" tab, carried through so storyboard generation keeps the same brand understanding. */
  brandContext?: BrandAnalysis;
  /** Public URL of a user-uploaded real product photo (see upload-product-reference), used as a visual-consistency reference for storyboard/image generation. */
  productReferenceImageUrl?: string;
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

  // Storyboard-application guidance per section — actionable suggestions for
  // translating the observation above into actual directing choices, not a
  // restatement of the observation. Added after the fields above, so absent
  // on projects analyzed before this existed; UI must treat every field
  // below as optional and never assume it's present.
  cameraApplication?: string[];
  cameraApplicationKo?: string[];
  lightingApplication?: string[];
  lightingApplicationKo?: string[];
  compositionApplication?: string[];
  compositionApplicationKo?: string[];
  editRhythmApplication?: string[];
  editRhythmApplicationKo?: string[];
  colorMoodApplication?: string[];
  colorMoodApplicationKo?: string[];
  creativePrinciplesApplication?: string[];
  creativePrinciplesApplicationKo?: string[];

  /** True when editRhythmDna describes AI-inferred/suggested pacing rather than an observed sequence — always true today, since analysis only ever sees a single still image or a text description, never real footage. */
  editRhythmInferred?: boolean;

  /** 3-5 representative hex colors, when the AI can identify them from an actual analyzed image with reasonable confidence — never present for a text-description reference. */
  dominantColors?: string[];

  /** How the product (if any) is framed/positioned in the reference — empty array when no product is visible; never fabricated. */
  productTreatment?: string[];
  productTreatmentKo?: string[];
  productTreatmentApplication?: string[];
  productTreatmentApplicationKo?: string[];
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
  /** Short "why this fits the brand" note, grounded in the brand analysis — absent when generated without one. */
  reason?: string;
}

export interface BrandIntelligence {
  brandName: string;
  category: string;
  primaryProducts: string[];
  purchaseSituation: string;
  usageContext: string;
  consumerContext: string;
  valuePropositions: string[];
  positioning: string;
  distributionChannels: string;
  distinctiveAssets: string[];
  brandTone: string;
  /** Widely-known, safe-to-state facts about the brand. */
  confirmedFacts: string[];
  /** Plausible but unverified inferences — never presented to the model/user as confirmed fact. */
  reasonableInferences: string[];
}

export interface CategoryContext {
  categoryTrends: string[];
  overusedPatterns: string[];
  opportunityAreas: string[];
}

export interface TrendContext {
  /** False when no external search was available — every field below is then intentionally empty, not fabricated. */
  recentDataAvailable: boolean;
  recentCampaigns: string[];
  recentProducts: string[];
  currentBrandMessage: string;
  recentContentStyle: string;
  recentRepositioning: string;
  categoryAdTrends: string[];
}

export interface BrandAnalysis {
  brandIntelligence: BrandIntelligence;
  categoryContext: CategoryContext;
  trendContext: TrendContext;
  creativeOpportunities: string[];
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

/** How boldly Director's Room / storyboard generation should express the chosen idea. */
export type CreativeRisk = 'safe' | 'balanced' | 'creative' | 'bold';

export type CreativeDnaUsageLevel = 'active' | 'partial' | 'reinterpreted';

/** Qualitative (never a fabricated percentage) read on how much a directing option draws on Creative DNA. */
export interface DirectingReferenceDnaUsage {
  level: CreativeDnaUsageLevel;
  summaryKo: string;
}

/** One Director's Room directing approach — a specific way to shoot/pace/frame the already-decided idea. */
export interface DirectingOption {
  id: string;
  titleKo: string;
  summaryKo: string;
  visualApproach: string;
  cameraApproach: string;
  editRhythm: string;
  mood: string;
  keyTechniques: string[];
  creativeRiskLevel: CreativeRisk;
  /** Present only when a Creative DNA reference was available for this project. */
  referenceDnaUsage: DirectingReferenceDnaUsage | null;
  /** Present only when Brand Intelligence context was available for this project. */
  brandFitReason: string | null;
}

/** The advertising role one cut plays in the overall flow (attention/product/benefit/cta/...). Not a fixed enum — AI names the type it needs. */
export interface SceneRole {
  type: string;
  labelKo: string;
  reasonKo: string;
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
  /** The Director's Room direction the user picked, if they went through it — null when skipped or on older projects. */
  selected_directing_direction: DirectingOption | null;
  creative_risk: CreativeRisk | null;
  /** Persistent character/product/location entity definitions, populated by ai-director at creation and enriched (referenceImageUrl) by generate-image / a user-uploaded product photo. Null on projects created via the legacy manual-cut-count flow. */
  visual_bible: VisualBible | null;
  created_at: string;
  updated_at: string;
}

/** Persistent character/product/location entity ids this cut references (see Project.visual_bible). */
export interface CutEntityRefs {
  characters: string[];
  products: string[];
  location: string | null;
}

/** A persistent character/product/location entity definition inside Project.visual_bible. Only the fields the frontend actually reads are declared — the AI-facing shapes (ai-director/generate-image) carry additional descriptive fields not needed here. */
export interface VisualBibleProductEntity {
  id: string;
  label: string;
  type?: string;
  shape?: string;
  color?: string;
  material?: string;
  packaging?: string;
  labelDetails?: string;
  relativeSize?: string;
  distinctiveDetails?: string;
  /** Set once a reference image (user-uploaded or auto-locked from the first generated cut) exists for this entity. */
  referenceImageUrl?: string | null;
}

export interface VisualBibleCharacterEntity {
  id: string;
  label: string;
  referenceImageUrl?: string | null;
}

export interface VisualBibleLocationEntity {
  id: string;
  label: string;
  referenceImageUrl?: string | null;
}

export interface VisualBible {
  globalStyle: string;
  characters: VisualBibleCharacterEntity[];
  products: VisualBibleProductEntity[];
  locations: VisualBibleLocationEntity[];
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
  // English-only prompt actually sent to image generation — see ai-director's
  // language policy. Defaults to '' at the DB level for rows saved before
  // this field existed.
  image_prompt: string;
  // Which persistent visual-bible entities (if any) this cut references.
  entity_refs: CutEntityRefs;
  // Which Creative DNA elements (if any) genuinely influenced this scene, and
  // a short Korean note on how. Defaults to []/'' at the DB level, so these
  // are always present (never undefined) even on rows saved before this
  // field existed — no DNA was ever "applied" to those, which is correct.
  applied_creative_dna: AppliedCreativeDnaTag[];
  creative_dna_application_note: string;
  // What advertising role this cut plays (attention/product/benefit/cta/...).
  // Nullable — absent on rows created before this existed, or via the
  // legacy manual-cut-count flow, which never assigns one.
  scene_role: SceneRole | null;
  created_at: string;
  updated_at: string;
}
