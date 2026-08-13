import { createClient } from 'jsr:@supabase/supabase-js@2';
import { validateString, validateUrl, validateUuid } from '../_shared/validation.ts';
import { sanitizeUpstreamError, sanitizeUnexpectedError } from '../_shared/errors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { logAiUsage } from '../_shared/usageLog.ts';

const SYSTEM_ROLE =
  'You are an award-winning commercial film director and cinematographer with a trained eye for visual ' +
  'language. Given a reference (an image or a written description), extract its directing DNA — the ' +
  'reusable stylistic choices a director could apply to an unrelated shoot — in real depth, the way a ' +
  'director would actually brief a crew. Do not describe the literal subject matter of the reference; ' +
  'describe the craft behind it.';

const STYLE_CONTENT_SEPARATION_NOTE =
  'Critical rule — separate STYLE from CONTENT: this reference was shot for an unrelated subject, and ' +
  'whatever you extract will be reused on a completely different product/story. Extract only transferable ' +
  'visual/directing attributes — camera angle, shot size, framing, composition, lighting, color treatment, ' +
  'depth of field, camera movement, editing rhythm, visual energy, general styling principles. Never mention ' +
  'the reference\'s literal content — specific foods, ingredients, people, products, brands, logos, packaging, ' +
  'clothing, props, or background objects — anywhere in your output, even as an example. Imitate HOW the ' +
  'reference is shot, never WHAT happens to be inside it. For instance, a top-down shot of pasta ingredients ' +
  'should yield notes like "top-down composition" and "evenly distributed arrangement of foreground elements" ' +
  '— never "pasta", "noodles", or any other literal ingredient name. ' +
  'Exception — "productTreatment" ONLY: here you may describe HOW a product-like subject (if one is visible) ' +
  'is framed, sized, and positioned — hero vs. supporting element, packshot vs. lifestyle/usage, frequency of ' +
  'appearance, integration into the scene — but still never name the specific brand, product, food, or object; ' +
  'describe only its generic treatment (e.g. "product held at chest height, softly lit, not the focal point" ' +
  'is fine; "a bottle of X shampoo" is not). If no product-like subject is visible in the reference, return ' +
  'empty arrays for productTreatment and productTreatmentApplication — never invent one.';

const DETAIL_DEPTH_NOTE =
  'Depth requirement: this analysis feeds real ad-storyboard directing, not just a mood board, so go beyond ' +
  'generic single-word notes. For "camera", cover shot size, angle (eye-level/high/low), the felt camera ' +
  'movement, subject framing, apparent depth of field, and lens feel where observable. For "lighting", cover ' +
  'natural vs. artificial, soft vs. hard, key light direction, backlight use, contrast, shadow character, ' +
  'exposure, and color temperature. For "composition", cover subject placement, symmetry/asymmetry, negative ' +
  'space, foreground/background relationship, visual hierarchy, depth, and frame density. For "editRhythm", ' +
  'infer pacing, transition feel, apparent shot-duration tendency, rhythmic density, repetition, and visual ' +
  'continuity that would suit this visual language — a single still image or text description never shows ' +
  'real cuts, so phrase these as suggestions/implications, never as if you observed actual footage (set ' +
  '"editRhythmInferred" accordingly in your own judgment, though the server also enforces this). For ' +
  '"colorMood", cover dominant colors, saturation, contrast, warmth, palette relationship, and emotional mood. ' +
  'Only describe what is actually observable or reasonably inferable — never invent specifics you cannot ' +
  'support from the reference.';

const STORYBOARD_APPLICATION_NOTE =
  'Every section besides "visualLanguage" also needs a "...Application" array (plus its "...ApplicationKo" ' +
  'mirror, same language policy as the other DNA arrays below): NOT a restatement of the observation, but ' +
  'the answer to "if a director used this reference\'s visual language on an unrelated ad storyboard, what ' +
  'concrete directing choices would they actually make?" Concrete and actionable — e.g. "use hand/expression ' +
  'close-ups at the product-usage moment" not "use close-ups." 2-4 items per section. Leave an application ' +
  'array empty only if its matching observation array is also empty.';

const KOREAN_STYLE_NOTE =
  'Every Korean field must read naturally to a Korean advertising/film-production professional — never a ' +
  'literal, word-for-word translation. Keep common film-industry loanwords the way the Korean industry ' +
  'actually uses them (e.g. 클로즈업, 와이드 숏, 탑뷰, 로우앵글, 하이앵글, 트래킹 숏, 핸드헬드, 줌 인/줌 아웃, ' +
  '달리 인/달리 아웃, 몽타주, 백라이트, 프레이밍) instead of forcing native-Korean substitutes for those terms.';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"visualLanguage": [{"label": string, "labelKo": string, "score": number}], ' +
  '"cameraDna": string[], "cameraDnaKo": string[], "cameraApplication": string[], "cameraApplicationKo": string[], ' +
  '"lightingDna": string[], "lightingDnaKo": string[], "lightingApplication": string[], "lightingApplicationKo": string[], ' +
  '"compositionDna": string[], "compositionDnaKo": string[], "compositionApplication": string[], "compositionApplicationKo": string[], ' +
  '"editRhythmDna": string[], "editRhythmDnaKo": string[], "editRhythmApplication": string[], "editRhythmApplicationKo": string[], ' +
  '"editRhythmInferred": boolean, ' +
  '"colorMood": string[], "colorMoodKo": string[], "colorMoodApplication": string[], "colorMoodApplicationKo": string[], ' +
  '"dominantColors": string[], ' +
  '"productTreatment": string[], "productTreatmentKo": string[], "productTreatmentApplication": string[], "productTreatmentApplicationKo": string[], ' +
  '"creativePrinciples": string[], "creativePrinciplesKo": string[], "creativePrinciplesApplication": string[], "creativePrinciplesApplicationKo": string[]}. ' +
  '"visualLanguage" is 3-5 style axes (e.g. "Cinematic", "Minimal", "Surreal", "Commercial") each with a 0-100 ' +
  'integer score reflecting how strongly the reference expresses that quality, based on your actual visual ' +
  'analysis — not decorative random numbers. The "...Dna"/"colorMood"/"creativePrinciples" arrays are each ' +
  '2-5 short, concrete, reusable directing notes — see the depth requirement and style/content separation ' +
  'rules below for what belongs in these arrays. See the storyboard-application note below for the ' +
  '"...Application" arrays. "editRhythmInferred" is true unless you were given genuine multi-frame/sequence ' +
  'footage to observe (in practice, always true today). "dominantColors" is 3-5 approximate hex color strings ' +
  '(e.g. "#F1D7B5") when analyzing an actual image — an honest approximation, not a falsely precise pixel ' +
  'sample; return an empty array when analyzing a text description instead of an image. "productTreatment"/ ' +
  '"productTreatmentApplication" follow the exception in the style/content separation rule below — empty ' +
  'arrays when no product-like subject is visible. Every "...Ko" field (and "labelKo") is the Korean ' +
  'equivalent of its English counterpart, in the exact same order and same length as that counterpart — ' +
  'labelKo matches label, cameraDnaKo[i] matches cameraDna[i], and so on. ' + KOREAN_STYLE_NOTE +
  ' Never wrap the JSON in markdown code fences.';

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
  cameraApplication?: string[];
  cameraApplicationKo?: string[];
  lightingApplication?: string[];
  lightingApplicationKo?: string[];
  compositionApplication?: string[];
  compositionApplicationKo?: string[];
  editRhythmApplication?: string[];
  editRhythmApplicationKo?: string[];
  colorMoodApplication?: string[];
  colorMoodApplicationKo?: string[];
  creativePrinciplesApplication?: string[];
  creativePrinciplesApplicationKo?: string[];
  editRhythmInferred?: boolean;
  dominantColors?: string[];
  productTreatment?: string[];
  productTreatmentKo?: string[];
  productTreatmentApplication?: string[];
  productTreatmentApplicationKo?: string[];
}

const DNA_ARRAY_KEYS = [
  'cameraDna', 'lightingDna', 'compositionDna', 'editRhythmDna', 'colorMood', 'creativePrinciples',
] as const;

// Maps each required observation array to its optional storyboard-application array — both sides
// of the pair are sanitized the same lenient way (present-and-valid or omitted, never a hard fail).
const APPLICATION_FIELD_MAP: Record<(typeof DNA_ARRAY_KEYS)[number], string> = {
  cameraDna: 'cameraApplication',
  lightingDna: 'lightingApplication',
  compositionDna: 'compositionApplication',
  editRhythmDna: 'editRhythmApplication',
  colorMood: 'colorMoodApplication',
  creativePrinciples: 'creativePrinciplesApplication',
};

const MAX_DOMINANT_COLORS = 5;
const MAX_PRODUCT_TREATMENT_ITEMS = 6;

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

// Every "...Ko"/"...Application"/"...ApplicationKo" sibling, plus dominantColors/productTreatment,
// is sanitized leniently: present-and-well-formed → included; anything malformed, mismatched-length,
// or missing → silently omitted (optional field), never blocking the already-validated core result.
// This is also exactly what makes older, simpler stored records safe to re-process here (localizeOnly
// path) — fields that were never analyzed for those records just stay absent.
function withSanitizedKo(parsed: Record<string, unknown>, base: DnaOutput): DnaOutput {
  const out: DnaOutput = { ...base };
  for (const key of DNA_ARRAY_KEYS) {
    const koKey = `${key}Ko`;
    const koValue = parsed[koKey];
    if (isStringArray(koValue) && koValue.length === base[key].length) {
      (out as Record<string, unknown>)[koKey] = koValue;
    }

    const applicationKey = APPLICATION_FIELD_MAP[key];
    const applicationValue = parsed[applicationKey];
    if (isStringArray(applicationValue)) {
      (out as Record<string, unknown>)[applicationKey] = applicationValue;
      const applicationKoValue = parsed[`${applicationKey}Ko`];
      if (isStringArray(applicationKoValue) && applicationKoValue.length === applicationValue.length) {
        (out as Record<string, unknown>)[`${applicationKey}Ko`] = applicationKoValue;
      }
    }
  }

  const rawVisualLanguage = parsed.visualLanguage as { labelKo?: unknown }[];
  out.visualLanguage = base.visualLanguage.map((item, i) => {
    const labelKo = rawVisualLanguage[i]?.labelKo;
    return typeof labelKo === 'string' ? { ...item, labelKo } : item;
  });

  if (typeof parsed.editRhythmInferred === 'boolean') out.editRhythmInferred = parsed.editRhythmInferred;

  if (isStringArray(parsed.dominantColors)) {
    out.dominantColors = parsed.dominantColors.slice(0, MAX_DOMINANT_COLORS);
  }

  if (isStringArray(parsed.productTreatment)) {
    out.productTreatment = parsed.productTreatment.slice(0, MAX_PRODUCT_TREATMENT_ITEMS);
    const productTreatmentKo = parsed.productTreatmentKo;
    if (isStringArray(productTreatmentKo) && productTreatmentKo.length === out.productTreatment.length) {
      out.productTreatmentKo = productTreatmentKo;
    }
  }
  if (isStringArray(parsed.productTreatmentApplication)) {
    out.productTreatmentApplication = parsed.productTreatmentApplication.slice(0, MAX_PRODUCT_TREATMENT_ITEMS);
    const productTreatmentApplicationKo = parsed.productTreatmentApplicationKo;
    if (isStringArray(productTreatmentApplicationKo) &&
      productTreatmentApplicationKo.length === out.productTreatmentApplication.length) {
      out.productTreatmentApplicationKo = productTreatmentApplicationKo;
    }
  }

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
    const userId = userData.user.id;

    const rateLimit = await checkRateLimit(supabase, userId, 'expensive_ai');
    if (!rateLimit.allowed) {
      await logAiUsage(supabase, { userId, operation: 'creative_dna', status: 'rate_limited', projectId: typeof projectId === 'string' ? projectId : undefined });
      return jsonResponse(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED', retryAfterSeconds: rateLimit.retryAfterSeconds },
        429,
      );
    }

    if (projectId !== undefined) {
      const projectIdErr = validateUuid(projectId, 'projectId');
      if (projectIdErr) return jsonResponse({ error: projectIdErr }, 400);
    }
    // imageUrl carries either a short remote URL OR a base64 data: URL from the "이미지 업로드"
    // tab (fileToDataUrl in creativeDnaApi.ts) — the latter is routinely hundreds of KB to a few
    // MB of text for an ordinary photo, so the cap must accommodate that, not just a normal URL.
    const imageUrlErr = validateUrl(imageUrl, 'imageUrl', { maxLength: 15_000_000 });
    if (imageUrlErr) return jsonResponse({ error: imageUrlErr }, 400);
    const textDescriptionErr = validateString(textDescription, 'textDescription', { maxLength: 10000 });
    if (textDescriptionErr) return jsonResponse({ error: textDescriptionErr }, 400);

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

      // Only ask for Ko mirrors of fields that actually have English content — an older simple
      // record has no cameraApplication/productTreatment etc. to translate, and asking for those
      // anyway would just invite the model to invent Korean text with nothing behind it.
      const localizeInput: Record<string, unknown> = {
        visualLanguage: dna.visualLanguage.map((v) => v.label),
        cameraDna: dna.cameraDna,
        lightingDna: dna.lightingDna,
        compositionDna: dna.compositionDna,
        editRhythmDna: dna.editRhythmDna,
        colorMood: dna.colorMood,
        creativePrinciples: dna.creativePrinciples,
      };
      const optionalLocalizeKeys: (keyof DnaOutput)[] = [
        'cameraApplication', 'lightingApplication', 'compositionApplication',
        'editRhythmApplication', 'colorMoodApplication', 'creativePrinciplesApplication', 'productTreatment',
      ];
      for (const key of optionalLocalizeKeys) {
        const value = dna[key];
        if (isStringArray(value) && value.length > 0) localizeInput[key] = value;
      }
      // productTreatmentApplication is only meaningful alongside productTreatment itself.
      if (isStringArray(dna.productTreatmentApplication) && dna.productTreatmentApplication.length > 0) {
        localizeInput.productTreatmentApplication = dna.productTreatmentApplication;
      }

      let localizeContent: string;
      try {
        localizeContent = await callOpenAiContent(
          LOCALIZE_SYSTEM_ROLE,
          [
            {
              type: 'text',
              text:
                'Respond with a single JSON object containing a "...Ko" key for EVERY key present in the ' +
                'input JSON below (e.g. input "cameraDna" → output "cameraDnaKo"; input "visualLanguage" → ' +
                'output "visualLanguageKo"), and nothing else. Each output array must have exactly the same ' +
                'length and order as its corresponding input array (visualLanguageKo mirrors visualLanguage\'s ' +
                'labels). ' + KOREAN_STYLE_NOTE + ' Never wrap the JSON in markdown code fences.\n\n' +
                JSON.stringify(localizeInput),
            },
          ],
        );
      } catch (err) {
        return jsonResponse(sanitizeUpstreamError(err, 'creative-dna-localize'), 502);
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
      for (const key of optionalLocalizeKeys) {
        const englishValue = dna[key];
        if (!isStringArray(englishValue) || englishValue.length === 0) continue;
        const koValue = p[`${key}Ko`];
        if (isStringArray(koValue) && koValue.length === englishValue.length) {
          (merged as Record<string, unknown>)[`${key}Ko`] = koValue;
        }
      }
      if (isStringArray(dna.productTreatmentApplication) && dna.productTreatmentApplication.length > 0) {
        const koValue = p.productTreatmentApplicationKo;
        if (isStringArray(koValue) && koValue.length === dna.productTreatmentApplication.length) {
          merged.productTreatmentApplicationKo = koValue;
        }
      }
      const visualLanguageKo = p.visualLanguageKo;
      if (isStringArray(visualLanguageKo) && visualLanguageKo.length === dna.visualLanguage.length) {
        merged.visualLanguage = dna.visualLanguage.map((v, i) => ({ ...v, labelKo: visualLanguageKo[i] }));
      }

      await supabase.from('projects').update({ creative_dna: merged }).eq('id', projectId);
      await logAiUsage(supabase, { userId, operation: 'creative_dna', status: 'success', projectId });
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
      content = await callOpenAiContent(
        `${SYSTEM_ROLE} ${STYLE_CONTENT_SEPARATION_NOTE} ${DETAIL_DEPTH_NOTE} ${STORYBOARD_APPLICATION_NOTE}`,
        userContent,
      );
    } catch (err) {
      return jsonResponse(sanitizeUpstreamError(err, 'creative-dna'), 502);
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
    // The analysis pipeline only ever sees a single still image or a text description — never real
    // multi-frame footage — so editRhythmDna can never be a genuine observation. Enforced server-side
    // rather than trusting the model's own self-report, since this is a factual property of the input
    // the server itself knows, not something that benefits from the model's judgment.
    dna.editRhythmInferred = true;

    if (projectId) {
      await supabase.from('projects').update({ creative_dna: dna }).eq('id', projectId);
    }

    await logAiUsage(supabase, { userId, operation: 'creative_dna', status: 'success', projectId: typeof projectId === 'string' ? projectId : undefined });
    return jsonResponse({ dna }, 200);
  } catch (err) {
    return jsonResponse(sanitizeUnexpectedError(err, 'creative-dna'), 500);
  }
});
