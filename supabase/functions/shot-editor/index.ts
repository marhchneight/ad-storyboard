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
  '"purpose": string}}. Never wrap the JSON in markdown code fences.';

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

    const userPrompt = `${OUTPUT_CONTRACT}\n\n` +
      `Product / concept (do not change): ${project.overall_prompt}\n\n` +
      `Current shot:\n${JSON.stringify(currentShot)}\n\n` +
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
      camera_direction: [shot.angle, shot.movement].filter(Boolean).join(', '),
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
      image_url: null,
      generation_status: 'idle',
    }).eq('id', cutId);

    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    return jsonResponse({ success: true }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
