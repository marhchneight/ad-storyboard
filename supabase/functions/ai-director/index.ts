import { createClient } from 'jsr:@supabase/supabase-js@2';

const DIRECTOR_SYSTEM_ROLE =
  'You are an award-winning commercial film director and creative director specializing in advertising, ' +
  'branded films, fashion films, social commercials, and visual storytelling. You direct real shoots, not ' +
  'mood boards — every instruction you give must be usable by a cinematographer on set.';

const DIRECTOR_OUTPUT_CONTRACT =
  'Always respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"concept": string, "creativeDirection": string, "shots": [{"shotNumber": number, "duration": number, ' +
  '"shotSize": string, "lens": string, "angle": string, "movement": string, "composition": string, ' +
  '"visual": string, "action": string, "lighting": string, "mood": string, "location": string, ' +
  '"props": string, "dialogue": string, "sfx": string, "transition": string, "purpose": string}]}. ' +
  '"visual" is the primary visual description of the shot (what the camera sees). "dialogue" is any spoken ' +
  'line, copy, or voice-over for that shot (leave "" if silent). "duration" is seconds as a number. Keep ' +
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
}

interface DirectorOutput {
  concept: string;
  creativeDirection: string;
  shots: DirectorShot[];
}

function isValidDirectorOutput(value: unknown): value is DirectorOutput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.concept !== 'string' || typeof v.creativeDirection !== 'string') return false;
  if (!Array.isArray(v.shots) || v.shots.length < 2) return false;
  return v.shots.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const shot = s as Record<string, unknown>;
    return typeof shot.visual === 'string' && typeof shot.shotNumber === 'number';
  });
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
    const { title, style, brief, freeformIdea } = await req.json();
    if (!title || typeof title !== 'string') return jsonResponse({ error: 'title required' }, 400);
    if (!style || !['sketch', 'animation', 'live_action'].includes(style)) {
      return jsonResponse({ error: 'valid style required' }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: 'unauthorized' }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const briefSummary = buildBriefSummary(brief ?? {}, freeformIdea ?? '');

    const userPrompt = `${DIRECTOR_OUTPUT_CONTRACT}\n\n다음은 광고 브리프입니다:\n${briefSummary}\n\n` +
      `이 브리프를 바탕으로 광고 감독으로서 전체 스토리보드를 연출하세요. 광고의 목적과 타깃, 플랫폼, ` +
      `길이에 맞는 샷 개수를 스스로 판단하세요(대략 3~8개 샷 권장). 각 샷은 실제 촬영에 바로 쓸 수 있을 만큼 ` +
      `구체적이어야 합니다.`;

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

    if (!isValidDirectorOutput(parsed)) {
      return jsonResponse({ error: 'AI가 올바른 형식의 연출안을 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
    }
    const output = parsed;

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        user_id: userId,
        title,
        style,
        overall_prompt: output.concept,
        creative_direction: output.creativeDirection,
        brief: brief ?? {},
      })
      .select()
      .single();
    if (projectError) return jsonResponse({ error: projectError.message }, 500);

    const shots = output.shots
      .slice()
      .sort((a, b) => a.shotNumber - b.shotNumber)
      .map((shot, i) => ({
        project_id: project.id,
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
      }));

    const { error: cutsError } = await supabase.from('cuts').insert(shots);
    if (cutsError) {
      await supabase.from('projects').delete().eq('id', project.id);
      return jsonResponse({ error: cutsError.message }, 500);
    }

    return jsonResponse({ projectId: project.id }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
