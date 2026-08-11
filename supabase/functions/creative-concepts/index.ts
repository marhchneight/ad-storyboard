import { createClient } from 'jsr:@supabase/supabase-js@2';

const SYSTEM_ROLE =
  'You are an award-winning commercial creative director. A client has a product but no ad idea yet. Propose ' +
  'three distinct, bold creative concepts they could choose between. Each must be a genuinely different ' +
  'creative angle — not variations of the same idea.';

const LANGUAGE_POLICY =
  'Language policy: every field you return must be written in natural Korean, concise and appropriate for a ' +
  'professional commercial pitch to a Korean team. Do not translate literally from English. Industry-standard ' +
  'loanwords (e.g. 미니멀, 프리미엄) may be used naturally where appropriate.';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"concepts": [{"title": string, "concept": string}, {"title": string, "concept": string}, ' +
  '{"title": string, "concept": string}]}. Always return exactly 3 concepts. "title" is a short, natural ' +
  'Korean working title (한국어, 4~14자 내외) — not English, not all caps. "concept" is 2-4 Korean sentences ' +
  'pitching the creative idea vividly — concrete enough to picture, not a generic tagline. Never wrap the ' +
  'JSON in markdown code fences.';

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

interface Concept {
  title: string;
  concept: string;
}

function isValidConcepts(value: unknown): value is { concepts: Concept[] } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.concepts) || v.concepts.length < 1) return false;
  return v.concepts.every((c) => {
    if (!c || typeof c !== 'object') return false;
    const item = c as Record<string, unknown>;
    return typeof item.title === 'string' && typeof item.concept === 'string';
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
    const authHeaderValue = req.headers.get('Authorization') ?? '';
    const token = authHeaderValue.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: 'unauthorized' }, 401);
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);

    const { product, mood, platform, targetAudience } = await req.json();
    if (!product || typeof product !== 'string' || !product.trim()) {
      return jsonResponse({ error: 'product required' }, 400);
    }

    const lines = [`Product / Brand: ${product.trim()}`];
    if (typeof mood === 'string' && mood.trim()) lines.push(`Mood: ${mood.trim()}`);
    if (typeof platform === 'string' && platform.trim()) lines.push(`Platform: ${platform.trim()}`);
    if (typeof targetAudience === 'string' && targetAudience.trim()) lines.push(`Target audience: ${targetAudience.trim()}`);

    const userPrompt = `${OUTPUT_CONTRACT}\n\n${lines.join('\n')}\n\n이 제품을 위한 광고 컨셉 3개를 제안하세요.`;

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

    if (!isValidConcepts(parsed)) {
      return jsonResponse({ error: 'AI가 올바른 형식의 컨셉을 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
    }

    return jsonResponse({ concepts: parsed.concepts }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
