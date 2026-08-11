import { createClient } from 'jsr:@supabase/supabase-js@2';

const DIRECTOR_SYSTEM_ROLE =
  'You are an award-winning commercial film director. You are revising exactly one shot of an existing ' +
  'storyboard based on a note from the client or your own creative instinct. Do not reference or imply ' +
  'changes to any other shot — you only see and control this one.';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"shot": {"duration": number, "shotSize": string, "lens": string, "angle": string, "movement": string, ' +
  '"composition": string, "visual": string, "action": string, "lighting": string, "mood": string, ' +
  '"location": string, "props": string, "dialogue": string, "sfx": string, "transition": string, ' +
  '"purpose": string, "imagePrompt": string, "characterIds": string[], "productIds": string[], ' +
  '"locationId": (string or null)}}. "imagePrompt" is a separate English-only field for an image-generation ' +
  'model (see language policy below). "characterIds"/"productIds"/"locationId" must reference the persistent ' +
  'entity ids listed below and must stay exactly the same as the current shot\'s ids unless the edit ' +
  'instruction explicitly changes which entity appears in this shot. Never invent a new entity id. Never ' +
  'wrap the JSON in markdown code fences.';

const LANGUAGE_POLICY =
  'Language policy: every field you return except "imagePrompt" must be written in natural Korean, concise ' +
  'and appropriate for a professional commercial storyboard used on a Korean production set. Do not ' +
  'translate literally from English — write as a Korean production team actually would (e.g. "아이레벨 고정 ' +
  '숏" not "카메라는 눈 높이에 위치하고 정적입니다"). Industry-standard cinematography loanwords such as 클로즈업, ' +
  '풀 숏, 아이레벨, 하이앵글, 로우앵글, 달리 인, 팬, 틸트, 핸드헬드 may be used naturally. "imagePrompt" is the ' +
  'only exception — it must always be a concise English sentence describing exactly what the camera should ' +
  'see (subject, action, framing/angle), written for an image-generation model, and must never affect the ' +
  'language of any other field.';

interface VisualBibleSummaryEntity {
  id: string;
  label: string;
}

interface VisualBibleForSummary {
  characters?: VisualBibleSummaryEntity[];
  products?: VisualBibleSummaryEntity[];
  locations?: VisualBibleSummaryEntity[];
}

function summarizeVisualBible(bible: VisualBibleForSummary): string {
  const fmt = (items?: VisualBibleSummaryEntity[]) => (items ?? []).map((e) => `${e.id}: ${e.label}`).join('; ');
  const parts = [
    bible.characters?.length ? `Characters: ${fmt(bible.characters)}` : null,
    bible.products?.length ? `Products: ${fmt(bible.products)}` : null,
    bible.locations?.length ? `Locations: ${fmt(bible.locations)}` : null,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join('\n') : '(no persistent entities defined for this project)';
}

const QUICK_ACTION_INSTRUCTIONS: Record<string, string> = {
  reframe: 'Reframe this shot with a different, more interesting composition.',
  change_lens: 'Change the lens choice to something that better suits the mood of this shot.',
  change_angle: 'Change the camera angle to something more distinctive.',
  more_cinematic: 'Make this one shot more cinematic: better composition, more atmospheric lighting.',
  more_product_focused: 'Make this one shot more product-focused: increase product visibility and clarity.',
  simplify: 'Simplify this shot: remove visual clutter, restrain movement.',
  surprise_me: 'Surprise the client with a bold, unexpected reinterpretation of this shot.',
  rewrite: 'Rewrite this shot from scratch while keeping its narrative purpose.',
};

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

interface RevisedShot {
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

function isValidShot(value: unknown): value is { shot: RevisedShot } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!v.shot || typeof v.shot !== 'object') return false;
  const shot = v.shot as Record<string, unknown>;
  return typeof shot.visual === 'string';
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
    const { cutId, action, instruction } = await req.json();
    if (!cutId) return jsonResponse({ error: 'cutId required' }, 400);
    if (!action && !instruction) return jsonResponse({ error: 'action or instruction required' }, 400);
    if (action && !QUICK_ACTION_INSTRUCTIONS[action]) return jsonResponse({ error: 'unknown action' }, 400);

    const { data: cut, error: cutError } = await supabase.from('cuts').select('*').eq('id', cutId).single();
    if (cutError || !cut) return jsonResponse({ error: 'cut not found' }, 404);

    const { data: project, error: projectError } = await supabase
      .from('projects').select('*').eq('id', cut.project_id).single();
    if (projectError || !project) return jsonResponse({ error: 'project not found' }, 404);

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: 'unauthorized' }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user || userData.user.id !== project.user_id) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }

    const editInstruction = action ? QUICK_ACTION_INSTRUCTIONS[action] : `Client note: "${instruction}"`;

    const currentShot = {
      duration: cut.duration_seconds,
      shotSize: cut.shot_size,
      lens: cut.lens,
      angle: cut.angle,
      movement: cut.movement,
      composition: cut.composition,
      visual: cut.scene_description,
      action: cut.action,
      lighting: cut.lighting,
      mood: cut.mood,
      location: cut.location,
      props: cut.props,
      dialogue: cut.dialogue,
      sfx: cut.sfx,
      transition: cut.transition,
      purpose: cut.purpose,
    };

    const visualBible = (project.visual_bible as VisualBibleForSummary) ?? {};
    const currentEntityRefs = (cut.entity_refs as { characters?: string[]; products?: string[]; location?: string | null }) ?? {};

    const userPrompt = `${OUTPUT_CONTRACT}\n\n` +
      `Product / concept (do not change): ${project.overall_prompt}\n\n` +
      `Persistent project entities (visual definitions live elsewhere and must not be altered by this edit):\n` +
      `${summarizeVisualBible(visualBible)}\n\n` +
      `Current shot (currently references characterIds=${JSON.stringify(currentEntityRefs.characters ?? [])}, ` +
      `productIds=${JSON.stringify(currentEntityRefs.products ?? [])}, ` +
      `locationId=${JSON.stringify(currentEntityRefs.location ?? null)}):\n${JSON.stringify(currentShot)}\n\n` +
      `Edit instruction: ${editInstruction}`;

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

    if (!isValidShot(parsed)) {
      return jsonResponse({ error: 'AI가 올바른 형식을 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
    }
    const shot = parsed.shot;

    const { error: updateError } = await supabase.from('cuts').update({
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
      image_prompt: (typeof shot.imagePrompt === 'string' && shot.imagePrompt.trim())
        ? shot.imagePrompt
        : (cut.image_prompt ?? ''),
      entity_refs: {
        characters: Array.isArray(shot.characterIds) ? shot.characterIds : (currentEntityRefs.characters ?? []),
        products: Array.isArray(shot.productIds) ? shot.productIds : (currentEntityRefs.products ?? []),
        location: (typeof shot.locationId === 'string' || shot.locationId === null)
          ? shot.locationId
          : (currentEntityRefs.location ?? null),
      },
      image_url: null,
      generation_status: 'idle',
    }).eq('id', cutId);

    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    return jsonResponse({ success: true }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
