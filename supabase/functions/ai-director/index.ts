import { createClient } from 'jsr:@supabase/supabase-js@2';
import { validateString, validateNumber, validateEnum, validateUrl } from '../_shared/validation.ts';
import { sanitizeUpstreamError, sanitizeUnexpectedError } from '../_shared/errors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { logAiUsage } from '../_shared/usageLog.ts';

const DIRECTOR_SYSTEM_ROLE =
  'You are an award-winning commercial film director and creative director specializing in advertising, ' +
  'branded films, fashion films, social commercials, and visual storytelling. You direct real shoots, not ' +
  'mood boards — every instruction you give must be usable by a cinematographer on set.';

const ENTITY_INSTRUCTIONS =
  '먼저 이 광고에 반복 등장하는 visual entity(인물, 제품/사물, 장소)를 파악하세요. 각 entity에는 ' +
  '"character_a", "product_a", "location_a"처럼 프로젝트 내에서 고유한 짧은 id를 부여하고, 이후 모든 샷에서 ' +
  '동일한 id로 참조하세요. 사용자가 명시하지 않은 속성(나이대, 헤어스타일, 의상, 제품 패키지 디자인 등)은 ' +
  '이 시점에 한 번만 합리적으로 결정하고, 이후 절대 다시 임의로 바꾸지 마세요. 실제 스토리상 새로운 인물/제품/' +
  '장소가 필요한 경우에만 새 id를 만드세요. 등장하지 않는 entity는 만들지 마세요. ' +
  'IMPORTANT: even though this instruction is in Korean, every field you write inside "visualBible" itself ' +
  '(labels, descriptions, all attributes) must be written in English — these are internal, model-facing ' +
  'definitions, not shown to the end user. 브리프에 실제 제품 사진이 이미 준비되어 있다고 안내된 경우, 그 ' +
  '제품이 시각적으로 명확히 등장해야 하는 샷(예: 제품 단독 샷, 제품 클로즈업, 사용 장면, 엔드카드/CTA 샷)에는 ' +
  '반드시 해당 product entity id를 "productIds"에 포함하세요. 다만 모든 샷에 억지로 넣지 말고, 그 장면에 실제로 ' +
  '제품이 보이는 경우에만 포함하세요.';

const LANGUAGE_POLICY =
  'Language policy: "concept", "creativeDirection", and every shot field except "imagePrompt" — "visual", ' +
  '"action", "lighting", "mood", "location", "props", "dialogue", "sfx", "transition", "purpose", ' +
  '"shotSize", "lens", "angle", "movement", "composition" — must be written in natural Korean, concise and ' +
  'appropriate for a professional commercial storyboard used on a Korean production set. Do not translate ' +
  'literally from English — write as a Korean production team actually would (e.g. "아이레벨 고정 숏" not ' +
  '"카메라는 눈 높이에 위치하고 정적입니다", "30대 남성이 영양제를 들고 카메라를 바라본다" not a long descriptive ' +
  'sentence). Industry-standard cinematography loanwords such as 클로즈업, 풀 숏, 아이레벨, 하이앵글, 로우앵글, ' +
  '달리 인, 팬, 틸트, 핸드헬드 may be used naturally — do not force-translate them into pure Korean. The "angle" ' +
  'and "movement" fields are especially prone to slipping into English shorthand — write them ONLY as short ' +
  'Korean phrases, e.g. angle: "하이앵글", "로우앵글", "아이레벨" (never "high angle", "low angle", "eye level"); ' +
  'movement: "천천히 틸트 다운", "고정", "핸드헬드로 살짝 흔들림", "달리 인" (never "slow tilt down", "steady", ' +
  '"static", "handheld"). Two kinds ' +
  'of content are the exception and must always be written in English, regardless of the Korean fields above: ' +
  '(1) every shot\'s "imagePrompt" — a concise, visually descriptive sentence for an image-generation model ' +
  '(the scene\'s subject, action, and camera framing in one sentence); and (2) every field inside ' +
  '"visualBible" (characters, products, locations) — these are internal model-facing definitions, never shown ' +
  'to the end user. English and Korean fields must never influence each other\'s language.';

const SCENE_ROLE_INSTRUCTIONS =
  'Every scene must have a clear advertising purpose — assign each shot a "sceneRole" describing what job it ' +
  'does in the overall ad (e.g. grabbing attention, establishing the product, stating the problem, showing a ' +
  'benefit, proving a claim, showing usage, building desire, an emotional beat, a transition, brand recall, or ' +
  'a call to action — invent the right role for this specific ad rather than forcing a fixed list). Do not ' +
  'create filler scenes simply to reach a requested scene count — every scene needs a real "why does this shot ' +
  'need to exist" answer. Do not force the same fixed role sequence onto every ad regardless of its actual idea, ' +
  'product, and duration — compose the role sequence to fit this specific ad. "sceneRole.type" is a short ' +
  'camelCase English slug you invent (e.g. "attention", "productHero", "benefit"); "sceneRole.labelKo" is a ' +
  'short natural Korean label for a Korean production team (e.g. "시선 확보", "제품 등장", "효능 강조"); ' +
  '"sceneRole.reasonKo" is one short Korean sentence explaining why this specific shot plays that role in this ' +
  'specific ad (not a generic definition of the role).';

const DIRECTOR_OUTPUT_CONTRACT =
  'Always respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"concept": string, "creativeDirection": string, ' +
  '"visualBible": {"globalStyle": string, ' +
  '"characters": [{"id": string, "label": string, "ageRange": string, "genderPresentation": string, ' +
  '"ethnicity": string, "facialCharacteristics": string, "hairstyle": string, "outfit": string, ' +
  '"build": string, "distinctiveTraits": string}], ' +
  '"products": [{"id": string, "label": string, "type": string, "shape": string, "color": string, ' +
  '"material": string, "packaging": string, "labelDetails": string, "relativeSize": string, ' +
  '"distinctiveDetails": string}], ' +
  '"locations": [{"id": string, "label": string, "environmentType": string, "architectureInterior": string, ' +
  '"keyColors": string, "lighting": string, "recurringProps": string}]}, ' +
  '"shots": [{"shotNumber": number, "duration": number, ' +
  '"shotSize": string, "lens": string, "angle": string, "movement": string, "composition": string, ' +
  '"visual": string, "action": string, "lighting": string, "mood": string, "location": string, ' +
  '"props": string, "dialogue": string, "sfx": string, "transition": string, "purpose": string, ' +
  '"imagePrompt": string, "characterIds": string[], "productIds": string[], "locationId": (string or null), ' +
  '"sceneRole": {"type": string, "labelKo": string, "reasonKo": string}}]}. ' +
  'Every field inside "visualBible" (globalStyle, and every field of every character/product/location) must ' +
  'ALWAYS be written in English — never Korean — regardless of the language of any other field in this ' +
  'response; see language policy below. "visual" is the primary scene description, written for a Korean ' +
  'production team reading a shot list (see language policy below). Each shot\'s own "location" field is a ' +
  'short KOREAN phrase naming where this shot takes place for a human reading the shot list (e.g. ' +
  '"모던한 아파트 거실") — this is different from "visualBible.locations", which stays in English; do not ' +
  'copy an English visualBible location label into a shot\'s "location" field. "dialogue" is any spoken ' +
  'line, copy, or voice-over for that shot (leave "" if silent). "duration" is seconds as a number. ' +
  '"imagePrompt" is a separate English-only field for an image-generation model (see language policy below). ' +
  '"characterIds"/"productIds"/"locationId" must reference ids defined in "visualBible" — use [] / null when ' +
  'no persistent entity applies to that shot. See the scene role instructions below for "sceneRole". Keep ' +
  '"shots" in narrative order starting at shotNumber 1. Never wrap the JSON in markdown code fences.';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface DirectorShot {
  shotNumber: number;
  duration: number;
  shotSize: string;
  lens: string;
  angle: string;
  movement: string;
  composition: string;
  visual: string;
  action: string;
  lighting: string;
  mood: string;
  location: string;
  props: string;
  dialogue: string;
  sfx: string;
  transition: string;
  purpose: string;
  imagePrompt?: string;
  characterIds?: string[];
  productIds?: string[];
  locationId?: string | null;
  sceneRole?: unknown;
}

interface CharacterEntity {
  id: string;
  label: string;
  ageRange: string;
  genderPresentation: string;
  ethnicity: string;
  facialCharacteristics: string;
  hairstyle: string;
  outfit: string;
  build: string;
  distinctiveTraits: string;
}

interface ProductEntity {
  id: string;
  label: string;
  type: string;
  shape: string;
  color: string;
  material: string;
  packaging: string;
  labelDetails: string;
  relativeSize: string;
  distinctiveDetails: string;
  referenceImageUrl?: string | null;
}

interface LocationEntity {
  id: string;
  label: string;
  environmentType: string;
  architectureInterior: string;
  keyColors: string;
  lighting: string;
  recurringProps: string;
}

interface VisualBible {
  globalStyle: string;
  characters: CharacterEntity[];
  products: ProductEntity[];
  locations: LocationEntity[];
}

function isValidVisualBible(value: unknown): value is VisualBible {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.globalStyle !== 'string') return false;
  if (!Array.isArray(v.characters) || !Array.isArray(v.products) || !Array.isArray(v.locations)) return false;
  const hasId = (e: unknown) => !!e && typeof e === 'object' && typeof (e as Record<string, unknown>).id === 'string';
  return v.characters.every(hasId) && v.products.every(hasId) && v.locations.every(hasId);
}

interface DirectorOutput {
  concept: string;
  creativeDirection: string;
  visualBible: VisualBible;
  shots: DirectorShot[];
}

function isValidDirectorOutput(value: unknown): value is DirectorOutput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.concept !== 'string' || typeof v.creativeDirection !== 'string') return false;
  if (!isValidVisualBible(v.visualBible)) return false;
  if (!Array.isArray(v.shots) || v.shots.length < 2) return false;
  return v.shots.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const shot = s as Record<string, unknown>;
    return typeof shot.visual === 'string' && typeof shot.shotNumber === 'number';
  });
}

function isValidShotsOnly(value: unknown): value is { shots: DirectorShot[]; visualBible: VisualBible } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!isValidVisualBible(v.visualBible)) return false;
  if (!Array.isArray(v.shots) || v.shots.length < 2) return false;
  return v.shots.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const shot = s as Record<string, unknown>;
    return typeof shot.visual === 'string' && typeof shot.shotNumber === 'number';
  });
}

const SHOTS_ONLY_OUTPUT_CONTRACT =
  'Always respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"visualBible": {"globalStyle": string, ' +
  '"characters": [{"id": string, "label": string, "ageRange": string, "genderPresentation": string, ' +
  '"ethnicity": string, "facialCharacteristics": string, "hairstyle": string, "outfit": string, ' +
  '"build": string, "distinctiveTraits": string}], ' +
  '"products": [{"id": string, "label": string, "type": string, "shape": string, "color": string, ' +
  '"material": string, "packaging": string, "labelDetails": string, "relativeSize": string, ' +
  '"distinctiveDetails": string}], ' +
  '"locations": [{"id": string, "label": string, "environmentType": string, "architectureInterior": string, ' +
  '"keyColors": string, "lighting": string, "recurringProps": string}]}, ' +
  '"shots": [{"shotNumber": number, "duration": number, "shotSize": string, "lens": string, "angle": string, ' +
  '"movement": string, "composition": string, "visual": string, "action": string, "lighting": string, ' +
  '"mood": string, "location": string, "props": string, "dialogue": string, "sfx": string, "transition": ' +
  'string, "purpose": string, "imagePrompt": string, "characterIds": string[], "productIds": string[], ' +
  '"locationId": (string or null), "sceneRole": {"type": string, "labelKo": string, "reasonKo": string}}]}. ' +
  'Every field inside "visualBible" (globalStyle, and every field of ' +
  'every character/product/location) must ALWAYS be written in English — never Korean — regardless of the ' +
  'language of any other field in this response; see language policy below. "visual" is the primary scene ' +
  'description, written for a Korean production team reading a shot list (see language policy below). Each ' +
  'shot\'s own "location" field is a short KOREAN phrase naming where this shot takes place for a human ' +
  'reading the shot list (e.g. "모던한 아파트 거실") — this is different from "visualBible.locations", which ' +
  'stays in English; do not copy an English visualBible location label into a shot\'s "location" field. ' +
  '"dialogue" is any spoken line, copy, or voice-over for that shot (leave "" if silent). "duration" is ' +
  'seconds as a number. "imagePrompt" is a separate English-only field for an image-generation model (see ' +
  'language policy below). "characterIds"/"productIds"/"locationId" must reference ids defined in ' +
  '"visualBible" — use [] / null when no persistent entity applies. See the scene role instructions below for ' +
  '"sceneRole". Keep "shots" in narrative order starting at shotNumber 1. Never wrap the JSON in markdown code ' +
  'fences.';

interface Treatment {
  title: string;
  concept: string;
  creativeDirection: string;
  visualLanguage: string[];
  approach: {
    duration: number | null;
    estimatedShots: number | null;
    dialogueStyle: string;
    productReveal: string;
    cameraStyle: string;
  };
  creativePrinciples: string[];
}

function isValidTreatment(value: unknown): value is Treatment {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === 'string' && typeof v.concept === 'string' && typeof v.creativeDirection === 'string' &&
    Array.isArray(v.visualLanguage) && !!v.approach;
}

function buildCopySection(copyText: unknown): string {
  if (typeof copyText !== 'string' || !copyText.trim()) return '';
  return `\n\n다음은 사용자가 업로드한 광고 카피 원본입니다. 이 카피의 문구를 가능한 한 원문 그대로 보존해서 ` +
    `각 샷의 "dialogue" 필드에 흐름에 맞게 나누어 배치하세요. 카피에 없는 내용을 새로 지어내거나 임의로 크게 ` +
    `수정하지 마세요. 카피의 순서와 톤을 참고해서 장면 구성과 샷 순서를 자연스럽게 잡으세요. 카피 분량이 ` +
    `적절한 샷 수와 다르면 자연스럽게 나누거나 합쳐서 배치하세요.\n카피 원본:\n${copyText.trim()}`;
}

function buildSceneCountInstruction(
  sceneCountMode: unknown,
  requestedSceneCount: unknown,
  targetDurationSeconds: unknown,
  copyText: unknown,
): string {
  if (sceneCountMode === 'manual' && typeof requestedSceneCount === 'number' && requestedSceneCount >= 2) {
    return `\n\n중요: 이 스토리보드는 정확히 ${requestedSceneCount}개의 장면(scene)으로 구성되어야 합니다. Generate ` +
      `exactly ${requestedSceneCount} storyboard scenes — this is a hard requirement, not a suggestion. 단순히 ` +
      `장면을 쪼개거나 합쳐서 개수만 맞추지 말고, 전체 광고의 이야기 흐름을 처음부터 ${requestedSceneCount}개 장면에 ` +
      `맞게 재구성하세요. 각 장면은 의미 있는 역할을 가져야 합니다.`;
  }
  if (sceneCountMode === 'duration' && typeof targetDurationSeconds === 'number') {
    const copyNote = (typeof copyText === 'string' && copyText.trim())
      ? ' 사용자가 업로드한 카피 원본의 분량도 함께 고려해서, 핵심 카피를 우선 배치하고 대사가 부족하거나 넘치지 ' +
        '않도록 장면 수와 각 장면의 길이를 조정하세요.'
      : '';
    return `\n\n중요: 이 광고의 목표 길이는 ${targetDurationSeconds}초입니다. Create a storyboard whose number of ` +
      `scenes and pacing are appropriate for the requested duration. Do not simply maximize the number of ` +
      `scenes. Each scene should have enough screen time for the intended action, dialogue, copy, and visual ` +
      `communication. 정보 전달이 필요한 광고와 감성적인 브랜드 필름은 같은 길이라도 적절한 장면 수가 다를 수 ` +
      `있습니다 — 광고 유형과 아이디어 내용에 맞게 판단하세요. 각 샷의 "duration" 합이 대략 ${targetDurationSeconds}초 ` +
      `(오차 ±3초 이내)가 되도록 장면 수와 pacing을 결정하세요.${copyNote}`;
  }
  return '';
}

interface ShotsOnlyResult {
  shots: DirectorShot[];
  visualBible: VisualBible;
}

async function fetchShotsOnly(userPrompt: string): Promise<ShotsOnlyResult | { error: string }> {
  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: DIRECTOR_SYSTEM_ROLE },
        { role: 'system', content: LANGUAGE_POLICY },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    return { error: sanitizeUpstreamError(errText, 'ai-director-shots-only').error };
  }

  const openaiJson = await openaiRes.json();
  const content = openaiJson.choices?.[0]?.message?.content;
  if (!content) return { error: 'empty AI response' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error('shots-only JSON.parse failed', {
      finishReason: openaiJson.choices?.[0]?.finish_reason,
      contentLength: content.length,
      contentTail: content.slice(-300),
    });
    return { error: 'AI 응답을 해석할 수 없습니다. 다시 시도해주세요.' };
  }

  if (!isValidShotsOnly(parsed)) {
    const p = parsed as Record<string, unknown>;
    console.error('shots-only validation failed', {
      finishReason: openaiJson.choices?.[0]?.finish_reason,
      hasShots: Array.isArray(p.shots),
      shotsLength: Array.isArray(p.shots) ? p.shots.length : null,
      firstShot: Array.isArray(p.shots) ? p.shots[0] : null,
      keys: Object.keys(p),
    });
    return { error: 'AI가 올바른 형식의 샷 리스트를 반환하지 않았습니다. 다시 시도해주세요.' };
  }

  return parsed;
}

// Carries the "제품" tab's Brand Intelligence analysis (see brand-intelligence
// edge function) through to the initial storyboard, so the same grounded
// brand understanding used to pitch the concept also shapes the shots —
// instead of the storyboard AI starting from the brand name alone again.
function buildBrandContextSummary(brandContext: Record<string, unknown>): string {
  const bi = brandContext.brandIntelligence as Record<string, unknown> | undefined;
  const opportunities = brandContext.creativeOpportunities;
  const parts: string[] = [];
  if (bi) {
    const fields: [string, string][] = [
      ['category', 'Category'],
      ['purchaseSituation', 'Purchase situation'],
      ['usageContext', 'Usage context'],
      ['distributionChannels', 'Distribution channels'],
      ['brandTone', 'Brand tone'],
    ];
    for (const [key, label] of fields) {
      const value = bi[key];
      if (typeof value === 'string' && value.trim()) parts.push(`${label}: ${value.trim()}`);
    }
    if (Array.isArray(bi.distinctiveAssets) && bi.distinctiveAssets.length > 0) {
      parts.push(`Distinctive assets: ${bi.distinctiveAssets.join(', ')}`);
    }
  }
  if (Array.isArray(opportunities) && opportunities.length > 0) {
    parts.push(`Creative opportunities: ${opportunities.join('; ')}`);
  }
  return parts.length > 0
    ? `\n\nBrand context (from prior brand analysis — keep the storyboard grounded in this, not just the ` +
      `brand name):\n${parts.join('\n')}`
    : '';
}

// When the user uploaded a real product photo (see upload-product-reference), tell the model not
// to invent this product's packaging/color/logo — the real photo overrides visualBible's
// invented attributes at image-generation time (see generate-image's reference-image handling).
function buildProductReferenceNote(brief: Record<string, unknown>): string {
  const url = brief.productReferenceImageUrl;
  if (typeof url !== 'string' || !url.trim()) return '';
  return '\n\nIMPORTANT: A real photo of the actual product (packaging/appearance) has already been ' +
    'uploaded by the user and will be attached to relevant shots automatically after generation. Do NOT ' +
    'invent this product\'s packaging design, color, logo, or label text in "visualBible.products" — for ' +
    'the product this brief describes, leave "packaging", "color", "labelDetails" etc. as brief, neutral ' +
    'placeholders (e.g. "as shown in reference photo") rather than inventing specific visual details, since ' +
    'the real photo will override the model\'s interpretation of those fields for image generation. Still ' +
    'assign this product a normal entity id in "visualBible.products" and reference it via "productIds" in ' +
    'shots where the real product should visibly appear (e.g. packshot, product hero, usage, end-card) — ' +
    'do not force it into every shot.';
}

const CREATIVE_RISK_GUIDANCE: Record<string, string> = {
  safe:
    'Creative risk tier: SAFE. Prioritize a composition that is reliably shootable and brand-safe by ordinary ' +
    'commercial standards. Minimize experimental visual metaphor. Favor clear, easy-to-read visual storytelling.',
  balanced:
    'Creative risk tier: BALANCED. Balance production practicality with creativity — familiar advertising ' +
    'grammar with a small, deliberate distinguishing twist.',
  creative:
    'Creative risk tier: CREATIVE (default). Use noticeable framing, interesting transitions, and stronger ' +
    'visual storytelling, while remaining realistically shootable.',
  bold:
    'Creative risk tier: BOLD. Visual metaphor, unexpected framing, surreal transitions, and non-linear visual ' +
    'ideas with a strong visual hook are all fair game. Even at this tier, never lose the product/brand ' +
    'relevance — creative risk controls HOW boldly the idea is expressed, not whether product/brand relevance ' +
    'is preserved.',
};

interface DirectingOptionInput {
  titleKo?: unknown;
  summaryKo?: unknown;
  visualApproach?: unknown;
  cameraApproach?: unknown;
  editRhythm?: unknown;
  mood?: unknown;
  keyTechniques?: unknown;
}

// The user picked exactly one Director's Room option — its full directing
// context (not just its title) must shape the actual shots, so the shot list
// genuinely reflects the chosen approach rather than a generic interpretation
// of the treatment.
function buildDirectingDirectionBlock(direction: unknown, creativeRisk: unknown): string {
  if (!direction || typeof direction !== 'object') return '';
  const d = direction as DirectingOptionInput;
  if (typeof d.titleKo !== 'string') return '';
  const parts = [
    `Chosen directing approach: "${d.titleKo}" — ${typeof d.summaryKo === 'string' ? d.summaryKo : ''}`,
    typeof d.visualApproach === 'string' ? `Visual approach: ${d.visualApproach}` : null,
    typeof d.cameraApproach === 'string' ? `Camera approach: ${d.cameraApproach}` : null,
    typeof d.editRhythm === 'string' ? `Edit rhythm: ${d.editRhythm}` : null,
    typeof d.mood === 'string' ? `Mood: ${d.mood}` : null,
    Array.isArray(d.keyTechniques) && d.keyTechniques.length > 0
      ? `Key techniques: ${(d.keyTechniques as unknown[]).filter((k) => typeof k === 'string').join(', ')}`
      : null,
  ].filter((p): p is string => !!p);
  const riskLine = typeof creativeRisk === 'string' && CREATIVE_RISK_GUIDANCE[creativeRisk]
    ? `\n${CREATIVE_RISK_GUIDANCE[creativeRisk]}`
    : '';
  return `\n\n이 사용자는 Director's Room에서 아래 연출 방향을 선택했습니다. 이 방향을 실제 샷 리스트에 구체적으로 ` +
    `반영하세요 — 제목만 참고하지 말고 visual/camera/edit rhythm/mood/key techniques를 실제 샷 구성에 사용하세요:\n` +
    `${parts.join('\n')}${riskLine}`;
}

function buildBriefSummary(brief: Record<string, unknown>, freeformIdea: string): string {
  const lines: string[] = [];
  if (freeformIdea.trim()) lines.push(`Free-form idea: ${freeformIdea.trim()}`);
  const fieldLabels: [string, string][] = [
    ['product', 'Product / Brand'],
    ['objective', 'Campaign objective'],
    ['targetAudience', 'Target audience'],
    ['keyMessage', 'Key message'],
    ['platform', 'Platform'],
    ['duration', 'Duration'],
    ['mood', 'Mood / Tone'],
    ['visualKeywords', 'Visual keywords'],
    ['reference', 'Reference'],
    ['conceptDescription', 'Concept description'],
  ];
  for (const [key, label] of fieldLabels) {
    const value = brief[key];
    if (typeof value === 'string' && value.trim()) lines.push(`${label}: ${value.trim()}`);
  }
  const summary = lines.length > 0 ? lines.join('\n') : '(브리프 정보 없음 — 자유롭게 해석하세요)';
  const brandContext = brief.brandContext;
  const withBrand = (brandContext && typeof brandContext === 'object')
    ? summary + buildBrandContextSummary(brandContext as Record<string, unknown>)
    : summary;
  return withBrand + buildProductReferenceNote(brief);
}

interface SceneRole {
  type: string;
  labelKo: string;
  reasonKo: string;
}

// Drops a malformed/missing sceneRole rather than failing the whole shot —
// existing projects and any shot the model didn't tag simply show no role
// badge in the editor instead of erroring.
function sanitizeSceneRole(value: unknown): SceneRole | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string' || !v.type.trim()) return null;
  if (typeof v.labelKo !== 'string' || !v.labelKo.trim()) return null;
  if (typeof v.reasonKo !== 'string' || !v.reasonKo.trim()) return null;
  return { type: v.type, labelKo: v.labelKo, reasonKo: v.reasonKo };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const {
      title, style, brief, freeformIdea, creativeDirection, copyText, aspectRatio,
      sceneCountMode, requestedSceneCount, targetDurationSeconds,
      directingDirection, creativeRisk,
    } = await req.json();
    if (!title || typeof title !== 'string') return jsonResponse({ error: 'title required' }, 400);
    if (!style || !['sketch', 'animation', 'live_action'].includes(style)) {
      return jsonResponse({ error: 'valid style required' }, 400);
    }
    const resolvedAspectRatio = ['1:1', '9:16', '16:9'].includes(aspectRatio) ? aspectRatio : '1:1';
    if (creativeDirection !== undefined && !isValidTreatment(creativeDirection)) {
      return jsonResponse({ error: 'invalid creativeDirection' }, 400);
    }

    const titleErr = validateString(title, 'title', { maxLength: 200 });
    if (titleErr) return jsonResponse({ error: titleErr }, 400);
    const freeformErr = validateString(freeformIdea, 'freeformIdea', { maxLength: 10000 });
    if (freeformErr) return jsonResponse({ error: freeformErr }, 400);
    const copyTextErr = validateString(copyText, 'copyText', { maxLength: 20000 });
    if (copyTextErr) return jsonResponse({ error: copyTextErr }, 400);
    if (sceneCountMode !== undefined) {
      const modeErr = validateEnum(sceneCountMode, ['manual', 'duration'] as const, 'sceneCountMode');
      if (modeErr) return jsonResponse({ error: modeErr }, 400);
    }
    const sceneCountErr = validateNumber(requestedSceneCount, 'requestedSceneCount', { min: 2, max: 30, integer: true });
    if (sceneCountErr) return jsonResponse({ error: sceneCountErr }, 400);
    const durationErr = validateNumber(targetDurationSeconds, 'targetDurationSeconds', { min: 1, max: 600 });
    if (durationErr) return jsonResponse({ error: durationErr }, 400);
    if (creativeRisk !== undefined) {
      const riskErr = validateEnum(creativeRisk, ['safe', 'balanced', 'creative', 'bold'] as const, 'creativeRisk');
      if (riskErr) return jsonResponse({ error: riskErr }, 400);
    }
    if (brief && typeof brief === 'object' && (brief as Record<string, unknown>).productReferenceImageUrl !== undefined) {
      const refUrlErr = validateUrl((brief as Record<string, unknown>).productReferenceImageUrl, 'productReferenceImageUrl');
      if (refUrlErr) return jsonResponse({ error: refUrlErr }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: 'unauthorized' }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const rateLimit = await checkRateLimit(supabase, userId, 'expensive_ai');
    if (!rateLimit.allowed) {
      await logAiUsage(supabase, { userId, operation: 'ai_director', status: 'rate_limited' });
      return jsonResponse(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED', retryAfterSeconds: rateLimit.retryAfterSeconds },
        429,
      );
    }

    const treatment = creativeDirection as Treatment | undefined;

    let concept: string;
    let creativeDirectionText: string;
    let shots: DirectorShot[];
    let visualBible: VisualBible;

    if (treatment) {
      const briefSummary = buildBriefSummary(brief ?? {}, freeformIdea ?? '');
      const sceneCountInstruction = buildSceneCountInstruction(
        sceneCountMode, requestedSceneCount, targetDurationSeconds, copyText
      );
      const userPrompt = `${SHOTS_ONLY_OUTPUT_CONTRACT}\n\n${SCENE_ROLE_INSTRUCTIONS}\n\n${ENTITY_INSTRUCTIONS}\n\n다음은 광고 브리프입니다:\n${briefSummary}\n\n` +
        `다음은 클라이언트가 이미 승인한 Creative Direction입니다. 이 방향을 그대로 실행하는 샷 리스트를 ` +
        `만드세요(방향을 새로 해석하지 마세요):\n제목: ${treatment.title}\n컨셉: ${treatment.concept}\n` +
        `연출 방향: ${treatment.creativeDirection}\nVisual language: ${treatment.visualLanguage.join(', ')}\n` +
        `길이: ${treatment.approach.duration ?? '미지정'}초, 예상 샷 수: ${treatment.approach.estimatedShots ?? '미지정'}, ` +
        `대사 스타일: ${treatment.approach.dialogueStyle}, 제품 노출: ${treatment.approach.productReveal}, ` +
        `카메라 스타일: ${treatment.approach.cameraStyle}\n` +
        `각 샷은 실제 촬영에 바로 쓸 수 있을 만큼 구체적이어야 합니다.${sceneCountInstruction}${buildCopySection(copyText)}` +
        buildDirectingDirectionBlock(directingDirection, creativeRisk);

      let shotsResult = await fetchShotsOnly(userPrompt);
      if ('error' in shotsResult) return jsonResponse({ error: shotsResult.error }, 502);

      const manualCountRequired = sceneCountMode === 'manual' && typeof requestedSceneCount === 'number' &&
        requestedSceneCount >= 2;

      if (manualCountRequired && shotsResult.shots.length !== requestedSceneCount) {
        const retryPrompt = `${userPrompt}\n\n중요: 방금 생성한 응답은 ${shotsResult.shots.length}개의 장면이었지만, ` +
          `반드시 정확히 ${requestedSceneCount}개여야 합니다. 전체 이야기 구조를 ${requestedSceneCount}개 장면에 맞게 ` +
          `다시 설계해서 정확히 ${requestedSceneCount}개의 shots로 응답하세요.`;
        const retryResult = await fetchShotsOnly(retryPrompt);
        if (!('error' in retryResult)) shotsResult = retryResult;
      }

      if (manualCountRequired && shotsResult.shots.length !== requestedSceneCount) {
        return jsonResponse(
          { error: `AI가 요청한 ${requestedSceneCount}개의 컷을 정확히 생성하지 못했습니다. 다시 시도해주세요.` },
          502
        );
      }

      concept = treatment.concept;
      creativeDirectionText = treatment.creativeDirection;
      shots = shotsResult.shots;
      visualBible = shotsResult.visualBible;
    } else {
      const briefSummary = buildBriefSummary(brief ?? {}, freeformIdea ?? '');

      const userPrompt = `${DIRECTOR_OUTPUT_CONTRACT}\n\n${SCENE_ROLE_INSTRUCTIONS}\n\n${ENTITY_INSTRUCTIONS}\n\n다음은 광고 브리프입니다:\n${briefSummary}\n\n` +
        `이 브리프를 바탕으로 광고 감독으로서 전체 스토리보드를 연출하세요. 광고의 목적과 타깃, 플랫폼, ` +
        `길이에 맞는 샷 개수를 스스로 판단하세요(대략 3~8개 샷 권장). 각 샷은 실제 촬영에 바로 쓸 수 있을 만큼 ` +
        `구체적이어야 합니다.${buildCopySection(copyText)}`;

      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: DIRECTOR_SYSTEM_ROLE },
            { role: 'system', content: LANGUAGE_POLICY },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
        }),
      });

      if (!openaiRes.ok) {
        const errText = await openaiRes.text();
        return jsonResponse(sanitizeUpstreamError(errText, 'ai-director'), 502);
      }

      const openaiJson = await openaiRes.json();
      const content = openaiJson.choices?.[0]?.message?.content;
      if (!content) return jsonResponse({ error: 'empty AI response' }, 502);

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return jsonResponse({ error: 'AI 응답을 해석할 수 없습니다. 다시 시도해주세요.' }, 502);
      }

      if (!isValidDirectorOutput(parsed)) {
        return jsonResponse({ error: 'AI가 올바른 형식의 연출안을 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
      }

      concept = parsed.concept;
      creativeDirectionText = parsed.creativeDirection;
      shots = parsed.shots;
      visualBible = parsed.visualBible;
    }

    // Seed the user-uploaded product reference photo into the first-defined product entity —
    // the AI defines entities in brief-reading order, and brief.product is the singular
    // advertised product, so the first product entity is the reliable match. generate-image's
    // collectReferenceImageUrls/withLockedReferenceImages are origin-agnostic and already handle
    // a pre-seeded referenceImageUrl correctly (never overwritten by a later generated image).
    const productRefUrl = brief && typeof brief === 'object' ? (brief as Record<string, unknown>).productReferenceImageUrl : undefined;
    if (typeof productRefUrl === 'string' && productRefUrl.trim() && visualBible.products.length > 0) {
      visualBible = {
        ...visualBible,
        products: visualBible.products.map((p, i) =>
          i === 0 ? { ...p, referenceImageUrl: productRefUrl } : p
        ),
      };
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        user_id: userId,
        title,
        style,
        aspect_ratio: resolvedAspectRatio,
        overall_prompt: concept,
        creative_direction: creativeDirectionText,
        creative_treatment: treatment ?? null,
        selected_directing_direction: (directingDirection && typeof directingDirection === 'object') ? directingDirection : null,
        creative_risk: (typeof creativeRisk === 'string' && CREATIVE_RISK_GUIDANCE[creativeRisk]) ? creativeRisk : null,
        brief: brief ?? {},
        visual_bible: visualBible,
      })
      .select()
      .single();
    if (projectError) return jsonResponse(sanitizeUnexpectedError(projectError, 'ai-director-project-insert'), 500);

    const cutRows = shots
      .slice()
      .sort((a, b) => a.shotNumber - b.shotNumber)
      .map((shot, i) => ({
        project_id: project.id,
        order_index: i,
        scene_description: shot.visual ?? '',
        dialogue: shot.dialogue ?? '',
        camera_direction: [shot.angle, shot.movement].filter(Boolean).join(' · '),
        duration_seconds: typeof shot.duration === 'number' ? shot.duration : null,
        shot_size: shot.shotSize ?? '',
        lens: shot.lens ?? '',
        angle: shot.angle ?? '',
        movement: shot.movement ?? '',
        composition: shot.composition ?? '',
        action: shot.action ?? '',
        lighting: shot.lighting ?? '',
        mood: shot.mood ?? '',
        location: shot.location ?? '',
        props: shot.props ?? '',
        sfx: shot.sfx ?? '',
        transition: shot.transition ?? '',
        purpose: shot.purpose ?? '',
        image_prompt: shot.imagePrompt ?? '',
        entity_refs: {
          characters: Array.isArray(shot.characterIds) ? shot.characterIds : [],
          products: Array.isArray(shot.productIds) ? shot.productIds : [],
          location: typeof shot.locationId === 'string' ? shot.locationId : null,
        },
        scene_role: sanitizeSceneRole(shot.sceneRole),
      }));

    const { error: cutsError } = await supabase.from('cuts').insert(cutRows);
    if (cutsError) {
      await supabase.from('projects').delete().eq('id', project.id);
      await logAiUsage(supabase, { userId, operation: 'ai_director', status: 'failed', projectId: project.id });
      return jsonResponse(sanitizeUnexpectedError(cutsError, 'ai-director-cuts-insert'), 500);
    }

    await logAiUsage(supabase, { userId, operation: 'ai_director', status: 'success', projectId: project.id });
    return jsonResponse({ projectId: project.id }, 200);
  } catch (err) {
    return jsonResponse(sanitizeUnexpectedError(err, 'ai-director'), 500);
  }
});
