import { createClient } from 'jsr:@supabase/supabase-js@2';

const DIRECTOR_SYSTEM_ROLE =
  'You are an award-winning commercial film director and creative director specializing in advertising, ' +
  'branded films, fashion films, social commercials, and visual storytelling. You are re-directing an ' +
  'existing storyboard, not starting over — you must preserve its product, message, narrative, and target ' +
  'audience, and change only the direction (framing, camera language, pacing, lighting, composition, mood).';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"creativeDirection": string, "changesSummary": string[], "shots": [{"shotNumber": number, ' +
  '"duration": number, "shotSize": string, "lens": string, "angle": string, "movement": string, ' +
  '"composition": string, "visual": string, "action": string, "lighting": string, "mood": string, ' +
  '"location": string, "props": string, "dialogue": string, "sfx": string, "transition": string, ' +
  '"purpose": string}]}. "changesSummary" is 2-5 short bullet strings describing what changed, written for ' +
  'the person who commissioned this (e.g. "Opening shot replaced with a more dynamic angle"). Keep "shots" ' +
  'in narrative order starting at shotNumber 1. You may add, remove, or reorder shots if the instruction ' +
  'calls for it. Never wrap the JSON in markdown code fences.';

const PRESET_DIRECTIONS: Record<string, string> = {
  more_cinematic:
    'Make it more cinematic: slower pacing, stronger composition, wider visual storytelling, more ' +
    'considered lens choices, more atmospheric lighting.',
  more_commercial:
    'Make it more commercial: stronger product visibility, clearer message, more hero shots, faster ' +
    'communication, cleaner framing.',
  more_genz:
    'Make it more Gen-Z: unexpected framing, handheld feeling, faster rhythm, punchier compositions, ' +
    'social-first visual language.',
  more_emotional:
    'Make it more emotional: longer emotional beats, close-ups, reaction shots, softer lighting, visual ' +
    'breathing room.',
  more_minimal:
    'Make it more minimal: fewer shots, simplified composition, restrained movement, less visual noise.',
  make_it_crazy:
    'Push the idea further. Act like a creative director telling the team "let\'s go bolder." Take real ' +
    'creative risks: replace the opening shot with something unexpected, delay the product reveal, use ' +
    'asymmetrical or unconventional framing, add a visual metaphor, consider a match cut, turn an ordinary ' +
    'product shot into a conceptual one, or reorder part of the narrative. Do not simply make it weird for ' +
    'its own sake — every risk must still serve the brand message and purpose of the ad. Keep the product, ' +
    'the message, and the target audience intact.',
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
}

interface EditorOutput {
  creativeDirection: string;
  changesSummary: string[];
  shots: RevisedShot[];
}

function isValidEditorOutput(value: unknown): value is EditorOutput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.creativeDirection !== 'string') return false;
  if (!Array.isArray(v.changesSummary)) return false;
  if (!Array.isArray(v.shots) || v.shots.length < 2) return false;
  return v.shots.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const shot = s as Record<string, unknown>;
    return typeof shot.visual === 'string' && typeof shot.shotNumber === 'number';
  });
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
    const { projectId, preset, instruction } = await req.json();
    if (!projectId) return jsonResponse({ error: 'projectId required' }, 400);
    if (!preset && !instruction) return jsonResponse({ error: 'preset or instruction required' }, 400);
    if (preset && !PRESET_DIRECTIONS[preset]) return jsonResponse({ error: 'unknown preset' }, 400);

    const { data: project, error: projectError } = await supabase
      .from('projects').select('*').eq('id', projectId).single();
    if (projectError || !project) return jsonResponse({ error: 'project not found' }, 404);

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: 'unauthorized' }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user || userData.user.id !== project.user_id) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }

    const { data: existingCuts, error: cutsError } = await supabase
      .from('cuts').select('*').eq('project_id', projectId).order('order_index');
    if (cutsError || !existingCuts || existingCuts.length === 0) {
      return jsonResponse({ error: 'no cuts found' }, 404);
    }

    const shotsContext = existingCuts.map((c: Record<string, unknown>, i: number) => ({
      shotNumber: i + 1,
      duration: c.duration_seconds,
      shotSize: c.shot_size,
      lens: c.lens,
      angle: c.angle,
      movement: c.movement,
      composition: c.composition,
      visual: c.scene_description,
      action: c.action,
      lighting: c.lighting,
      mood: c.mood,
      location: c.location,
      props: c.props,
      dialogue: c.dialogue,
      sfx: c.sfx,
      transition: c.transition,
      purpose: c.purpose,
    }));

    const directionInstruction = preset
      ? PRESET_DIRECTIONS[preset]
      : `Follow this instruction from the client: "${instruction}"`;

    const userPrompt = `${OUTPUT_CONTRACT}\n\n` +
      `Product / concept (do not change): ${project.overall_prompt}\n\n` +
      `Current shot list:\n${JSON.stringify(shotsContext)}\n\n` +
      `Direction to apply: ${directionInstruction}`;

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

    if (!isValidEditorOutput(parsed)) {
      return jsonResponse({ error: 'AI가 올바른 형식의 연출안을 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
    }
    const output = parsed;

    const newShots = output.shots.slice().sort((a, b) => a.shotNumber - b.shotNumber);
    const minLen = Math.min(newShots.length, existingCuts.length);

    for (let i = 0; i < minLen; i++) {
      const shot = newShots[i];
      await supabase.from('cuts').update({
        order_index: i,
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
      }).eq('id', existingCuts[i].id);
    }

    if (newShots.length > existingCuts.length) {
      const extraRows = newShots.slice(minLen).map((shot, i) => ({
        project_id: projectId,
        order_index: minLen + i,
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
      }));
      await supabase.from('cuts').insert(extraRows);
    } else if (existingCuts.length > newShots.length) {
      const removedIds = existingCuts.slice(minLen).map((c: { id: string }) => c.id);
      await supabase.from('cuts').delete().in('id', removedIds);
    }

    await supabase.from('projects').update({ creative_direction: output.creativeDirection }).eq('id', projectId);

    return jsonResponse({ success: true, changes: output.changesSummary }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
