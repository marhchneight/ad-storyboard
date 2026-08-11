import { createClient } from 'jsr:@supabase/supabase-js@2';

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
  'definitions, not shown to the end user.';

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
  '"imagePrompt": string, "characterIds": string[], "productIds": string[], "locationId": (string or null)}]}. ' +
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
  'no persistent entity applies to that shot. Keep "shots" in narrative order starting at shotNumber 1. Never ' +
  'wrap the JSON in markdown code fences.';

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
  '"locationId": (string or null)}]}. Every field inside "visualBible" (globalStyle, and every field of ' +
  'every character/product/location) must ALWAYS be written in English — never Korean — regardless of the ' +
  'language of any other field in this response; see language policy below. "visual" is the primary scene ' +
  'description, written for a Korean production team reading a shot list (see language policy below). Each ' +
  'shot\'s own "location" field is a short KOREAN phrase naming where this shot takes place for a human ' +
  'reading the shot list (e.g. "모던한 아파트 거실") — this is different from "visualBible.locations", which ' +
  'stays in English; do not copy an English visualBible location label into a shot\'s "location" field. ' +
  '"dialogue" is any spoken line, copy, or voice-over for that shot (leave "" if silent). "duration" is ' +
  'seconds as a number. "imagePrompt" is a separate English-only field for an image-generation model (see ' +
  'language policy below). "characterIds"/"productIds"/"locationId" must reference ids defined in ' +
  '"visualBible" — use [] / null when no persistent entity applies. Keep "shots" in narrative order starting ' +
  'at shotNumber 1. Never wrap the JSON in markdown code fences.';

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
    return { error: `openai error: ${errText}` };
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
  return lines.length > 0 ? lines.join('\n') : '(브리프 정보 없음 — 자유롭게 해석하세요)';
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
    } = await req.json();
    if (!title || typeof title !== 'string') return jsonResponse({ error: 'title required' }, 400);
    if (!style || !['sketch', 'animation', 'live_action'].includes(style)) {
      return jsonResponse({ error: 'valid style required' }, 400);
    }
    const resolvedAspectRatio = ['1:1', '9:16', '16:9'].includes(aspectRatio) ? aspectRatio : '1:1';
    if (creativeDirection !== undefined && !isValidTreatment(creativeDirection)) {
      return jsonResponse({ error: 'invalid creativeDirection' }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: 'unauthorized' }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

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
      const userPrompt = `${SHOTS_ONLY_OUTPUT_CONTRACT}\n\n${ENTITY_INSTRUCTIONS}\n\n다음은 광고 브리프입니다:\n${briefSummary}\n\n` +
        `다음은 클라이언트가 이미 승인한 Creative Direction입니다. 이 방향을 그대로 실행하는 샷 리스트를 ` +
        `만드세요(방향을 새로 해석하지 마세요):\n제목: ${treatment.title}\n컨셉: ${treatment.concept}\n` +
        `연출 방향: ${treatment.creativeDirection}\nVisual language: ${treatment.visualLanguage.join(', ')}\n` +
        `길이: ${treatment.approach.duration ?? '미지정'}초, 예상 샷 수: ${treatment.approach.estimatedShots ?? '미지정'}, ` +
        `대사 스타일: ${treatment.approach.dialogueStyle}, 제품 노출: ${treatment.approach.productReveal}, ` +
        `카메라 스타일: ${treatment.approach.cameraStyle}\n` +
        `각 샷은 실제 촬영에 바로 쓸 수 있을 만큼 구체적이어야 합니다.${sceneCountInstruction}${buildCopySection(copyText)}`;

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

      const userPrompt = `${DIRECTOR_OUTPUT_CONTRACT}\n\n${ENTITY_INSTRUCTIONS}\n\n다음은 광고 브리프입니다:\n${briefSummary}\n\n` +
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
        return jsonResponse({ error: `openai error: ${errText}` }, 502);
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
        brief: brief ?? {},
        visual_bible: visualBible,
      })
      .select()
      .single();
    if (projectError) return jsonResponse({ error: projectError.message }, 500);

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
      }));

    const { error: cutsError } = await supabase.from('cuts').insert(cutRows);
    if (cutsError) {
      await supabase.from('projects').delete().eq('id', project.id);
      return jsonResponse({ error: cutsError.message }, 500);
    }

    return jsonResponse({ projectId: project.id }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
