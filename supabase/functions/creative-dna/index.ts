import { createClient } from 'jsr:@supabase/supabase-js@2';

const SYSTEM_ROLE =
  'You are an award-winning commercial film director and cinematographer with a trained eye for visual ' +
  'language. Given a reference (an image or a written description), extract its directing DNA — the ' +
  'reusable stylistic choices a director could apply to an unrelated shoot. Do not describe the literal ' +
  'subject matter of the reference; describe the craft behind it.';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"visualLanguage": [{"label": string, "score": number}], "cameraDna": string[], "lightingDna": string[], ' +
  '"compositionDna": string[], "editRhythmDna": string[], "colorMood": string[], "creativePrinciples": ' +
  'string[]}. "visualLanguage" is 3-5 style axes (e.g. "Cinematic", "Minimal", "Surreal", "Commercial") each ' +
  'with a 0-100 integer score reflecting how strongly the reference expresses that quality, based on your ' +
  'actual visual analysis — not decorative random numbers. The DNA arrays are each 2-5 short, concrete, ' +
  'reusable directing notes (camera/lens/angle choices, lighting qualities, composition habits, pacing and ' +
  'cut rhythm, color and mood, and underlying creative principles). Never wrap the JSON in markdown code fences.';

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

interface DnaOutput {
  visualLanguage: { label: string; score: number }[];
  cameraDna: string[];
  lightingDna: string[];
  compositionDna: string[];
  editRhythmDna: string[];
  colorMood: string[];
  creativePrinciples: string[];
}

function isValidDna(value: unknown): value is DnaOutput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const arrayKeys = ['cameraDna', 'lightingDna', 'compositionDna', 'editRhythmDna', 'colorMood', 'creativePrinciples'];
  if (!Array.isArray(v.visualLanguage) || v.visualLanguage.length === 0) return false;
  const validVisualLanguage = v.visualLanguage.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const i = item as Record<string, unknown>;
    return typeof i.label === 'string' && typeof i.score === 'number';
  });
  if (!validVisualLanguage) return false;
  return arrayKeys.every((key) => Array.isArray(v[key]));
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
    const { projectId, imageUrl, textDescription } = await req.json();
    if (!imageUrl && !textDescription) {
      return jsonResponse({ error: 'imageUrl or textDescription required' }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: 'unauthorized' }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);

    if (projectId) {
      const { data: project, error: projectError } = await supabase
        .from('projects').select('*').eq('id', projectId).single();
      if (projectError || !project) return jsonResponse({ error: 'project not found' }, 404);
      if (userData.user.id !== project.user_id) return jsonResponse({ error: 'forbidden' }, 403);
    }

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: OUTPUT_CONTRACT },
    ];
    if (imageUrl) {
      userContent.push({ type: 'text', text: '이 이미지의 연출 DNA를 분석하세요.' });
      userContent.push({ type: 'image_url', image_url: { url: imageUrl } });
    } else {
      userContent.push({ type: 'text', text: `다음 텍스트로 묘사된 레퍼런스의 연출 DNA를 분석하세요:\n${textDescription}` });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_ROLE },
          { role: 'user', content: userContent },
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

    if (!isValidDna(parsed)) {
      return jsonResponse({ error: 'AI가 올바른 형식의 분석 결과를 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
    }

    if (projectId) {
      await supabase.from('projects').update({ creative_dna: parsed }).eq('id', projectId);
    }

    return jsonResponse({ dna: parsed }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
