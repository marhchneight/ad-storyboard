import { createClient } from 'jsr:@supabase/supabase-js@2';
import { validateString } from '../_shared/validation.ts';
import { sanitizeUpstreamError, sanitizeUnexpectedError } from '../_shared/errors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { logAiUsage } from '../_shared/usageLog.ts';

const SYSTEM_ROLE =
  'You are an award-winning commercial film director running a "Director\'s Room" pitch session. You are NOT ' +
  'generating three different campaign ideas — the core advertising idea is already decided (see the treatment ' +
  'below). Your job is to propose three meaningfully different DIRECTING approaches for how that same idea can ' +
  'be visualized, shot, paced, and emotionally expressed. Avoid generic directing concepts that could apply to ' +
  'any brand or any idea — each approach must be grounded in the current product, brand context, intended ' +
  'audience, Creative DNA (if given), and realistic production constraints.';

const DIFFERENTIATION_POLICY =
  'The three options must genuinely differ in what they foreground, not just in adjectives. BAD (rejected): ' +
  '"A. 감성적인 광고 / B. 조금 더 감성적인 광고 / C. 따뜻하고 감성적인 광고" — these are the same approach with different ' +
  'wording. GOOD: "A. 제품 디테일 중심 / B. 실제 소비 상황 중심 / C. 비주얼 메타포 중심" — each has a different structural ' +
  'focus (what the camera spends its time on, what the edit rhythm serves, what the mood is built around). A ' +
  'reader should be able to tell the three apart from "visualApproach" and "cameraApproach" alone, without ' +
  'reading "titleKo".';

const CREATIVE_RISK_GUIDANCE: Record<string, string> = {
  safe:
    'Creative risk tier: SAFE. All three options must prioritize a composition that is reliably shootable and ' +
    'brand-safe by ordinary commercial standards. Minimize experimental visual metaphor. Favor clear, ' +
    'easy-to-read visual storytelling that any brand could confidently greenlight without hesitation.',
  balanced:
    'Creative risk tier: BALANCED. All three options should balance production practicality with creativity — ' +
    'familiar advertising grammar with one small, deliberate distinguishing twist per option.',
  creative:
    'Creative risk tier: CREATIVE (default). All three options should use noticeable framing, interesting ' +
    'transitions, and stronger visual storytelling, while remaining realistically shootable and clearly ' +
    'differentiated from generic ads in the category.',
  bold:
    'Creative risk tier: BOLD. All three options may use visual metaphor, unexpected framing, surreal ' +
    'transitions, and non-linear visual ideas with a strong visual hook. Even at this tier, never lose the ' +
    'product/brand relevance — creative risk controls HOW boldly the idea is expressed, not whether ' +
    'product/brand relevance is preserved. A bold option that no longer reads as an ad for this product is a ' +
    'failure, not a success.',
};

const DNA_USAGE_POLICY =
  'Creative DNA usage: a Creative DNA profile (extracted from a reference the client liked, already stripped of ' +
  'the reference\'s literal subject matter — pure directing technique) is given below. Decide, per option, how ' +
  'much this option genuinely draws on it, and report it honestly in "referenceDnaUsage": "active" (this option ' +
  'is built around the DNA), "partial" (uses some elements, not the core structure), or "reinterpreted" (takes ' +
  'the DNA as a loose starting point and reinterprets it). Do NOT mark all three options the same level — vary ' +
  'them honestly based on how each option actually uses it. Never invent a fabricated percentage or score.';

const BRAND_FIT_POLICY =
  'Brand Intelligence: real brand/category analysis is given below. Each option\'s "brandFitReason" must be one ' +
  'short Korean sentence naming a SPECIFIC fact from that analysis (a real purchase situation, usage context, ' +
  'distribution channel, or distinctive asset) that this particular option leans on — never a generic ' +
  'compliment, and never a brand characteristic that isn\'t actually in the analysis below. Make sure no option ' +
  'contradicts the brand\'s actual consumption context, positioning, or recent direction described below.';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"options": [{"titleKo": string, "summaryKo": string, "visualApproach": string, "cameraApproach": string, ' +
  '"editRhythm": string, "mood": string, "keyTechniques": string[], "referenceDnaUsage": ' +
  '{"level": "active"|"partial"|"reinterpreted", "summaryKo": string} | null, "brandFitReason": string | null}, ' +
  '... exactly 3 items]}. "titleKo" is a short Korean directing-approach name (한국어, 4~12자, e.g. "제품 디테일 ' +
  '중심") — a directing focus, not a campaign slogan. "summaryKo" is 2-3 Korean sentences describing how this ' +
  'option would actually be shot, paced, and felt — concrete enough to picture on set. "visualApproach" / ' +
  '"cameraApproach" / "editRhythm" / "mood" are each one short Korean phrase (특히 서로 다른 옵션 간에 뚜렷이 달라야 ' +
  '함). "keyTechniques" is 3-5 short Korean directing keywords (e.g. "매크로 클로즈업", "핸드헬드", "점프컷"). ' +
  '"referenceDnaUsage" is null unless a Creative DNA profile is given below (see the DNA usage policy). ' +
  '"brandFitReason" is null unless Brand Intelligence is given below (see the brand fit policy). Never wrap the ' +
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

const RISK_LEVELS = new Set(['safe', 'balanced', 'creative', 'bold']);
const DNA_USAGE_LEVELS = new Set(['active', 'partial', 'reinterpreted']);

interface RawOption {
  titleKo?: unknown;
  summaryKo?: unknown;
  visualApproach?: unknown;
  cameraApproach?: unknown;
  editRhythm?: unknown;
  mood?: unknown;
  keyTechniques?: unknown;
  referenceDnaUsage?: unknown;
  brandFitReason?: unknown;
}

function isValidRawOptions(value: unknown): value is { options: RawOption[] } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.options) || v.options.length < 3) return false;
  return v.options.every((o) => {
    if (!o || typeof o !== 'object') return false;
    const opt = o as Record<string, unknown>;
    return typeof opt.titleKo === 'string' && typeof opt.summaryKo === 'string' &&
      typeof opt.visualApproach === 'string' && typeof opt.cameraApproach === 'string' &&
      typeof opt.editRhythm === 'string' && typeof opt.mood === 'string' &&
      Array.isArray(opt.keyTechniques);
  });
}

function summarizeDna(dna: Record<string, unknown> | undefined): string {
  if (!dna) return '';
  const parts: string[] = [];
  const listKeys: [string, string][] = [
    ['cameraDna', '카메라'], ['lightingDna', '조명'], ['compositionDna', '구도'],
    ['editRhythmDna', '편집 리듬'], ['colorMood', '색감/무드'], ['creativePrinciples', '연출 원칙'],
  ];
  for (const [key, label] of listKeys) {
    const value = dna[key];
    if (Array.isArray(value) && value.length > 0) parts.push(`${label}: ${value.join('; ')}`);
  }
  return parts.length > 0 ? `\n\n${DNA_USAGE_POLICY}\n\nCreative DNA profile:\n${parts.join('\n')}` : '';
}

function summarizeBrandContext(brandContext: Record<string, unknown>): string {
  const bi = brandContext.brandIntelligence as Record<string, unknown> | undefined;
  const opportunities = brandContext.creativeOpportunities;
  const parts: string[] = [];
  if (bi) {
    const fields: [string, string][] = [
      ['category', 'Category'], ['purchaseSituation', 'Purchase situation'], ['usageContext', 'Usage context'],
      ['distributionChannels', 'Distribution channels'], ['brandTone', 'Brand tone'],
    ];
    for (const [key, label] of fields) {
      const value = bi[key];
      if (typeof value === 'string' && value.trim()) parts.push(`${label}: ${value.trim()}`);
    }
    if (Array.isArray(bi.distinctiveAssets) && bi.distinctiveAssets.length > 0) {
      parts.push(`Distinctive assets: ${bi.distinctiveAssets.join(', ')}`);
    }
  }
  const trend = brandContext.trendContext as Record<string, unknown> | undefined;
  if (trend?.recentDataAvailable === true) {
    if (typeof trend.currentBrandMessage === 'string' && trend.currentBrandMessage.trim()) {
      parts.push(`Current brand message: ${trend.currentBrandMessage.trim()}`);
    }
  }
  if (Array.isArray(opportunities) && opportunities.length > 0) {
    parts.push(`Creative opportunities: ${opportunities.join('; ')}`);
  }
  return parts.length > 0 ? `\n\n${BRAND_FIT_POLICY}\n\nBrand Intelligence:\n${parts.join('\n')}` : '';
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
    const userId = userData.user.id;

    const rateLimit = await checkRateLimit(supabase, userId, 'expensive_ai');
    if (!rateLimit.allowed) {
      await logAiUsage(supabase, { userId, operation: 'directors_room', status: 'rate_limited' });
      return jsonResponse(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED', retryAfterSeconds: rateLimit.retryAfterSeconds },
        429,
      );
    }

    const { freeformIdea, brief, dna, treatment, creativeRisk } = await req.json();
    if (!treatment || typeof treatment !== 'object') {
      return jsonResponse({ error: 'treatment required' }, 400);
    }
    const freeformErr = validateString(freeformIdea, 'freeformIdea', { maxLength: 10000 });
    if (freeformErr) return jsonResponse({ error: freeformErr }, 400);
    const resolvedRisk = RISK_LEVELS.has(creativeRisk) ? creativeRisk : 'creative';

    const hasDna = dna && typeof dna === 'object';
    const briefObj = (brief && typeof brief === 'object') ? brief as Record<string, unknown> : {};
    const brandContext = briefObj.brandContext;
    const hasBrandContext = brandContext && typeof brandContext === 'object';

    const t = treatment as Record<string, unknown>;
    const approach = (t.approach && typeof t.approach === 'object') ? t.approach as Record<string, unknown> : {};
    const treatmentSummary =
      `제목: ${t.title ?? ''}\n컨셉: ${t.concept ?? ''}\n연출 방향: ${t.creativeDirection ?? ''}\n` +
      `Visual language: ${Array.isArray(t.visualLanguage) ? (t.visualLanguage as string[]).join(', ') : ''}\n` +
      `길이: ${approach.duration ?? '미지정'}초, 예상 샷 수: ${approach.estimatedShots ?? '미지정'}`;

    const ideaLine = (typeof freeformIdea === 'string' && freeformIdea.trim())
      ? `Original idea (already decided, do not reinterpret the idea itself): ${freeformIdea.trim()}\n\n`
      : '';

    const userPrompt = `${OUTPUT_CONTRACT}\n\n${DIFFERENTIATION_POLICY}\n\n${CREATIVE_RISK_GUIDANCE[resolvedRisk]}\n\n` +
      ideaLine +
      `Decided creative treatment (this idea is locked — direct it, don't replace it):\n${treatmentSummary}` +
      summarizeDna(hasDna ? dna as Record<string, unknown> : undefined) +
      summarizeBrandContext(hasBrandContext ? brandContext as Record<string, unknown> : {}) +
      `\n\n이 아이디어를 어떻게 연출할지 서로 뚜렷이 다른 3개의 연출안을 제안하세요. 사용자 화면에 노출되는 모든 텍스트는 ` +
      `자연스러운 한국어로 작성하세요.`;

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
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return jsonResponse(sanitizeUpstreamError(errText, 'directors-room'), 502);
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

    if (!isValidRawOptions(parsed)) {
      return jsonResponse({ error: 'AI가 올바른 형식의 연출안을 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
    }

    // Server-assigns id and creativeRiskLevel deterministically (don't trust the
    // model for these), and forces referenceDnaUsage/brandFitReason to null when
    // no DNA/brand context was actually given — the model must never fabricate
    // either just because the schema allows it.
    const options = parsed.options.slice(0, 3).map((opt) => {
      const rawUsage = opt.referenceDnaUsage as Record<string, unknown> | null | undefined;
      const validUsage = hasDna && rawUsage && typeof rawUsage === 'object' &&
        typeof rawUsage.level === 'string' && DNA_USAGE_LEVELS.has(rawUsage.level) &&
        typeof rawUsage.summaryKo === 'string' && rawUsage.summaryKo.trim();

      return {
        id: crypto.randomUUID(),
        titleKo: opt.titleKo,
        summaryKo: opt.summaryKo,
        visualApproach: opt.visualApproach,
        cameraApproach: opt.cameraApproach,
        editRhythm: opt.editRhythm,
        mood: opt.mood,
        keyTechniques: Array.isArray(opt.keyTechniques)
          ? (opt.keyTechniques as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 5)
          : [],
        creativeRiskLevel: resolvedRisk,
        referenceDnaUsage: validUsage
          ? { level: rawUsage.level, summaryKo: rawUsage.summaryKo }
          : null,
        brandFitReason: (hasBrandContext && typeof opt.brandFitReason === 'string' && opt.brandFitReason.trim())
          ? opt.brandFitReason
          : null,
      };
    });

    await logAiUsage(supabase, { userId, operation: 'directors_room', status: 'success' });
    return jsonResponse({ options }, 200);
  } catch (err) {
    return jsonResponse(sanitizeUnexpectedError(err, 'directors-room'), 500);
  }
});
