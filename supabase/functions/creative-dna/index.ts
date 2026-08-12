import { createClient } from 'jsr:@supabase/supabase-js@2';

const SYSTEM_ROLE =
  'You are an award-winning commercial film director and cinematographer with a trained eye for visual ' +
  'language. Given a reference (an image or a written description), extract its directing DNA — the ' +
  'reusable stylistic choices a director could apply to an unrelated shoot. Do not describe the literal ' +
  'subject matter of the reference; describe the craft behind it.';

const STYLE_CONTENT_SEPARATION_NOTE =
  'Critical rule — separate STYLE from CONTENT: this reference was shot for an unrelated subject, and ' +
  'whatever you extract will be reused on a completely different product/story. Extract only transferable ' +
  'visual/directing attributes — camera angle, shot size, framing, composition, lighting, color treatment, ' +
  'depth of field, camera movement, editing rhythm, visual energy, general styling principles. Never mention ' +
  'the reference\'s literal content — specific foods, ingredients, people, products, brands, logos, packaging, ' +
  'clothing, props, or background objects — anywhere in your output, even as an example. Imitate HOW the ' +
  'reference is shot, never WHAT happens to be inside it. For instance, a top-down shot of pasta ingredients ' +
  'should yield notes like "top-down composition" and "evenly distributed arrangement of foreground elements" ' +
  '— never "pasta", "noodles", or any other literal ingredient name.';

const KOREAN_STYLE_NOTE =
  'Every Korean field must read naturally to a Korean advertising/film-production professional — never a ' +
  'literal, word-for-word translation. Keep common film-industry loanwords the way the Korean industry ' +
  'actually uses them (e.g. 클로즈업, 와이드 숏, 탑뷰, 로우앵글, 하이앵글, 트래킹 숏, 핸드헬드, 줌 인/줌 아웃, ' +
  '달리 인/달리 아웃, 몽타주, 백라이트, 프레이밍) instead of forcing native-Korean substitutes for those terms.';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"visualLanguage": [{"label": string, "labelKo": string, "score": number}], ' +
  '"cameraDna": string[], "cameraDnaKo": string[], ' +
  '"lightingDna": string[], "lightingDnaKo": string[], ' +
  '"compositionDna": string[], "compositionDnaKo": string[], ' +
  '"editRhythmDna": string[], "editRhythmDnaKo": string[], ' +
  '"colorMood": string[], "colorMoodKo": string[], ' +
  '"creativePrinciples": string[], "creativePrinciplesKo": string[]}. ' +
  '"visualLanguage" is 3-5 style axes (e.g. "Cinematic", "Minimal", "Surreal", "Commercial") each with a 0-100 ' +
  'integer score reflecting how strongly the reference expresses that quality, based on your actual visual ' +
  'analysis — not decorative random numbers. The DNA arrays are each 2-5 short, concrete, reusable directing ' +
  'notes (camera/lens/angle choices, lighting qualities, composition habits, pacing and cut rhythm, color and ' +
  'mood, and underlying creative principles) — see the style/content separation rule below for what belongs ' +
  'in these arrays. Every "...Ko" field (and "labelKo") is the Korean equivalent of ' +
  'its English counterpart, in the exact same order and same length as that counterpart — labelKo matches ' +
  'label, cameraDnaKo[i] matches cameraDna[i], and so on. ' + KOREAN_STYLE_NOTE + ' Never wrap the JSON in ' +
  'markdown code fences.';

const LOCALIZE_SYSTEM_ROLE =
  'You are a Korean advertising/film-production localization specialist. Given a set of English Creative DNA ' +
  'directing notes, provide the natural Korean equivalent a Korean ad/film production team would actually ' +
  'use — never a literal translation.';

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
  visualLanguage: { label: string; score: number; labelKo?: string }[];
  cameraDna: string[];
  lightingDna: string[];
  compositionDna: string[];
  editRhythmDna: string[];
  colorMood: string[];
  creativePrinciples: string[];
  cameraDnaKo?: string[];
  lightingDnaKo?: string[];
  compositionDnaKo?: string[];
  editRhythmDnaKo?: string[];
  colorMoodKo?: string[];
  creativePrinciplesKo?: string[];
}

const DNA_ARRAY_KEYS = [
  'cameraDna', 'lightingDna', 'compositionDna', 'editRhythmDna', 'colorMood', 'creativePrinciples',
] as const;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isValidDna(value: unknown): value is DnaOutput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.visualLanguage) || v.visualLanguage.length === 0) return false;
  const validVisualLanguage = v.visualLanguage.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const i = item as Record<string, unknown>;
    return typeof i.label === 'string' && typeof i.score === 'number';
  });
  if (!validVisualLanguage) return false;
  return DNA_ARRAY_KEYS.every((key) => isStringArray(v[key]));
}

// A malformed/missing "...Ko" sibling (wrong type, or a length mismatch with
// its English counterpart) never blocks the validated English result — the
// UI just falls back to English for that field until it's localized later.
function withSanitizedKo(parsed: Record<string, unknown>, base: DnaOutput): DnaOutput {
  const out: DnaOutput = { ...base };
  for (const key of DNA_ARRAY_KEYS) {
    const koKey = `${key}Ko`;
    const koValue = parsed[koKey];
    if (isStringArray(koValue) && koValue.length === base[key].length) {
      (out as Record<string, unknown>)[koKey] = koValue;
    }
  }
  const rawVisualLanguage = parsed.visualLanguage as { labelKo?: unknown }[];
  out.visualLanguage = base.visualLanguage.map((item, i) => {
    const labelKo = rawVisualLanguage[i]?.labelKo;
    return typeof labelKo === 'string' ? { ...item, labelKo } : item;
  });
  return out;
}

async function callOpenAiContent(systemRole: string, userContent: unknown): Promise<string> {
  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemRole },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    throw new Error(`openai error: ${errText}`);
  }
  const openaiJson = await openaiRes.json();
  const content = openaiJson.choices?.[0]?.message?.content;
  if (!content) throw new Error('empty AI response');
  return content;
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
    const { projectId, imageUrl, textDescription, localizeOnly } = await req.json();

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: 'unauthorized' }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);

    let project: { id: string; user_id: string; creative_dna: DnaOutput | null } | null = null;
    if (projectId) {
      const { data, error: projectError } = await supabase
        .from('projects').select('*').eq('id', projectId).single();
      if (projectError || !data) return jsonResponse({ error: 'project not found' }, 404);
      if (userData.user.id !== data.user_id) return jsonResponse({ error: 'forbidden' }, 403);
      project = data;
    }

    // Backfill mode: an existing project's creative_dna was saved before
    // Korean mirrors existed. Ask for the Korean fields only, from the
    // already-stored English content — the English fields (and therefore
    // storyboard generation quality) are never touched.
    if (localizeOnly) {
      if (!project?.creative_dna) return jsonResponse({ error: 'no creative_dna to localize' }, 400);
      const dna = project.creative_dna;

      let localizeContent: string;
      try {
        localizeContent = await callOpenAiContent(
          LOCALIZE_SYSTEM_ROLE,
          [
            {
              type: 'text',
              text:
                'Respond with a single JSON object, and nothing else: ' +
                '{"visualLanguageKo": string[], "cameraDnaKo": string[], "lightingDnaKo": string[], ' +
                '"compositionDnaKo": string[], "editRhythmDnaKo": string[], "colorMoodKo": string[], ' +
                '"creativePrinciplesKo": string[]}. Each array must have exactly the same length and same ' +
                'order as the corresponding array in the input below (visualLanguageKo mirrors ' +
                'visualLanguage\'s labels). ' + KOREAN_STYLE_NOTE + ' Never wrap the JSON in markdown code fences.\n\n' +
                JSON.stringify({
                  visualLanguage: dna.visualLanguage.map((v) => v.label),
                  cameraDna: dna.cameraDna,
                  lightingDna: dna.lightingDna,
                  compositionDna: dna.compositionDna,
                  editRhythmDna: dna.editRhythmDna,
                  colorMood: dna.colorMood,
                  creativePrinciples: dna.creativePrinciples,
                }),
            },
          ],
        );
      } catch (err) {
        return jsonResponse({ error: String(err) }, 502);
      }

      let parsedLocalize: unknown;
      try {
        parsedLocalize = JSON.parse(localizeContent);
      } catch {
        return jsonResponse({ error: 'AI 응답을 해석할 수 없습니다. 다시 시도해주세요.' }, 502);
      }

      const p = parsedLocalize as Record<string, unknown>;
      const merged: DnaOutput = { ...dna };
      for (const key of DNA_ARRAY_KEYS) {
        const koValue = p[`${key}Ko`];
        if (isStringArray(koValue) && koValue.length === dna[key].length) {
          (merged as Record<string, unknown>)[`${key}Ko`] = koValue;
        }
      }
      const visualLanguageKo = p.visualLanguageKo;
      if (isStringArray(visualLanguageKo) && visualLanguageKo.length === dna.visualLanguage.length) {
        merged.visualLanguage = dna.visualLanguage.map((v, i) => ({ ...v, labelKo: visualLanguageKo[i] }));
      }

      await supabase.from('projects').update({ creative_dna: merged }).eq('id', projectId);
      return jsonResponse({ dna: merged }, 200);
    }

    if (!imageUrl && !textDescription) {
      return jsonResponse({ error: 'imageUrl or textDescription required' }, 400);
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

    let content: string;
    try {
      content = await callOpenAiContent(`${SYSTEM_ROLE} ${STYLE_CONTENT_SEPARATION_NOTE}`, userContent);
    } catch (err) {
      return jsonResponse({ error: String(err) }, 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return jsonResponse({ error: 'AI 응답을 해석할 수 없습니다. 다시 시도해주세요.' }, 502);
    }

    if (!isValidDna(parsed)) {
      return jsonResponse({ error: 'AI가 올바른 형식의 분석 결과를 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
    }

    const dna = withSanitizedKo(parsed as Record<string, unknown>, parsed);

    if (projectId) {
      await supabase.from('projects').update({ creative_dna: dna }).eq('id', projectId);
    }

    return jsonResponse({ dna }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
