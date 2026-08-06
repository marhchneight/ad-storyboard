import { createClient } from 'jsr:@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { projectId, copyText } = await req.json();
    if (!projectId) return jsonResponse({ error: 'projectId required' }, 400);
    if (!copyText || typeof copyText !== 'string' || copyText.trim().length === 0) {
      return jsonResponse({ error: 'copyText required' }, 400);
    }

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

    const { data: cuts, error: cutsError } = await supabase
      .from('cuts').select('*').eq('project_id', projectId).order('order_index');
    if (cutsError || !cuts || cuts.length === 0) return jsonResponse({ error: 'no cuts found' }, 404);

    const cutList = cuts.map((c: { order_index: number; scene_description: string }, i: number) =>
      `${i + 1}. ${c.scene_description || '(장면 설명 없음)'}`
    ).join('\n');

    const systemPrompt = '당신은 광고 카피라이터 어시스턴트입니다. 주어진 광고 카피 원본 텍스트를 스토리보드의 각 컷 순서와 장면 설명에 맞게 자연스러운 카피/멘트로 나누어 배정하세요. 반드시 컷 개수와 정확히 동일한 개수의 문자열 배열을 담은 JSON 객체 {"dialogues": ["...", "..."]} 형식으로만 응답하세요.';
    const userPrompt = `전체 콘셉트: ${project.overall_prompt || '(없음)'}\n\n컷 목록 (${cuts.length}개):\n${cutList}\n\n광고 카피 원본:\n${copyText}`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
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

    let dialogues: unknown;
    try {
      dialogues = JSON.parse(content).dialogues;
    } catch {
      return jsonResponse({ error: 'AI 응답을 해석할 수 없습니다.' }, 502);
    }

    if (!Array.isArray(dialogues) || dialogues.length !== cuts.length) {
      return jsonResponse({ error: `AI가 컷 개수(${cuts.length}개)와 다른 개수의 카피/멘트를 반환했습니다.` }, 502);
    }

    for (let i = 0; i < cuts.length; i++) {
      await supabase.from('cuts').update({ dialogue: String(dialogues[i]) }).eq('id', cuts[i].id);
    }

    return jsonResponse({ success: true, count: cuts.length }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
