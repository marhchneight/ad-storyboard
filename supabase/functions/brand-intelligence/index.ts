import { createClient } from 'jsr:@supabase/supabase-js@2';
import { validateString } from '../_shared/validation.ts';
import { sanitizeUpstreamError, sanitizeUnexpectedError } from '../_shared/errors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { logAiUsage } from '../_shared/usageLog.ts';

const SYSTEM_ROLE =
  'You are a senior brand strategist and category analyst preparing a grounded creative brief for an ' +
  'advertising team. Before anyone writes an ad idea, you build an honest, specific understanding of the ' +
  'brand, its product category, and its consumers — not a generic industry description.';

const FACT_INFERENCE_POLICY =
  'Fact vs. inference: never state an unverified brand slogan, campaign, target audience, or positioning as if ' +
  'it were confirmed. Put only things that are widely known, stable, and safe to state (e.g. "메가커피는 한국의 ' +
  '저가 프랜차이즈 카페 브랜드다") into "confirmedFacts". Put plausible but unverified characterizations (e.g. ' +
  '"매장 체류보다 테이크아웃 비중이 높을 가능성이 크다") into "reasonableInferences", phrased with appropriate ' +
  'hedging ("~것으로 보인다", "~일 가능성이 크다") rather than flat assertions. If you are not familiar with the ' +
  'brand at all, say so honestly in "confirmedFacts" (e.g. "이 브랜드에 대한 구체적 정보를 확인할 수 없음") rather ' +
  'than inventing plausible-sounding details.';

const RECENT_DATA_POLICY =
  'Recent/live information: "trendContext" covers things that change over time — recent campaigns, recent ' +
  'product launches, current brand messaging, recent official content style, recent repositioning, and current ' +
  'category ad trends. You have NOT been given any live search results for this request, so you must NOT ' +
  'pretend to know current, time-sensitive brand activity. Set "recentDataAvailable" to false and leave every ' +
  'other field in "trendContext" as an empty string / empty array. Do not fill them with your best guess dressed ' +
  'up as current fact — a wrong "recent campaign" is worse than an honest blank.';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"brandIntelligence": {"brandName": string, "category": string, "primaryProducts": string[], ' +
  '"purchaseSituation": string, "usageContext": string, "consumerContext": string, ' +
  '"valuePropositions": string[], "positioning": string, "distributionChannels": string, ' +
  '"distinctiveAssets": string[], "brandTone": string, "confirmedFacts": string[], ' +
  '"reasonableInferences": string[]}, ' +
  '"categoryContext": {"categoryTrends": string[], "overusedPatterns": string[], "opportunityAreas": string[]}, ' +
  '"trendContext": {"recentDataAvailable": boolean, "recentCampaigns": string[], "recentProducts": string[], ' +
  '"currentBrandMessage": string, "recentContentStyle": string, "recentRepositioning": string, ' +
  '"categoryAdTrends": string[]}, ' +
  '"creativeOpportunities": string[]}. ' +
  '"purchaseSituation" describes the real-world moment a consumer buys/orders this (e.g. 출근길에 테이크아웃으로, ' +
  '온라인 구독으로, 매장에서 시식 후). "usageContext" describes how/when it is actually consumed or used. ' +
  '"consumerContext" is who typically buys it and why, grounded in the category, not a generic demographic ' +
  'blurb. "distributionChannels" is how customers actually get it (매장, 온라인, 구독, 딜러 등). ' +
  '"distinctiveAssets" are concrete, ownable visual/product assets (packaging shape, signature color, a specific ' +
  'menu item, a store format) — not vague brand values. "categoryTrends"/"overusedPatterns"/"opportunityAreas" ' +
  'describe the product/service category in general (not time-sensitive news). "creativeOpportunities" is 2-4 ' +
  'short Korean bullet strings, each naming a concrete advertising opportunity grounded in the brand/category ' +
  'analysis above (not a generic "일상 속 순간을 담는다" platitude) — this is the bridge used to generate ideas ' +
  'next, so make each one specific enough that two different writers would still land on recognizably similar ' +
  'ad ideas from it. Every string field must be written in natural, concise Korean. Never wrap the JSON in ' +
  'markdown code fences.';

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

interface TavilyResult {
  title?: unknown;
  content?: unknown;
}

// Search layer, deliberately isolated: everything downstream only ever reads
// { available, snippets } and branches on `available` — swapping providers,
// or falling back to "no live data" on any failure, never leaks past this
// function. Requires a SEARCH_API_KEY secret (a Tavily API key); with none
// set, or on any request failure, this returns unavailable rather than
// throwing, so the brand analysis still succeeds without pretending to know
// current brand activity.
async function fetchExternalBrandSignals(brandName: string): Promise<{ available: boolean; snippets: string[] }> {
  const searchApiKey = Deno.env.get('SEARCH_API_KEY');
  if (!searchApiKey) return { available: false, snippets: [] };

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: searchApiKey,
        query: `${brandName} 최근 광고 캠페인 신제품 브랜드 메시지`,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
      }),
    });
    if (!res.ok) return { available: false, snippets: [] };

    const json = await res.json();
    const results: TavilyResult[] = Array.isArray(json.results) ? json.results : [];
    const snippets = results
      .map((r) => (typeof r.title === 'string' && typeof r.content === 'string') ? `${r.title}: ${r.content}` : null)
      .filter((s): s is string => !!s && s.trim().length > 0)
      .slice(0, 5);

    return snippets.length > 0 ? { available: true, snippets } : { available: false, snippets: [] };
  } catch {
    return { available: false, snippets: [] };
  }
}

interface BrandAnalysisOutput {
  brandIntelligence: {
    brandName: string;
    category: string;
    primaryProducts: string[];
    purchaseSituation: string;
    usageContext: string;
    consumerContext: string;
    valuePropositions: string[];
    positioning: string;
    distributionChannels: string;
    distinctiveAssets: string[];
    brandTone: string;
    confirmedFacts: string[];
    reasonableInferences: string[];
  };
  categoryContext: {
    categoryTrends: string[];
    overusedPatterns: string[];
    opportunityAreas: string[];
  };
  trendContext: {
    recentDataAvailable: boolean;
    recentCampaigns: string[];
    recentProducts: string[];
    currentBrandMessage: string;
    recentContentStyle: string;
    recentRepositioning: string;
    categoryAdTrends: string[];
  };
  creativeOpportunities: string[];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isValidAnalysis(value: unknown): value is BrandAnalysisOutput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const bi = v.brandIntelligence as Record<string, unknown> | undefined;
  if (!bi || typeof bi !== 'object') return false;
  if (typeof bi.brandName !== 'string' || typeof bi.category !== 'string') return false;
  if (!isStringArray(bi.primaryProducts) || !isStringArray(bi.valuePropositions)) return false;
  if (!isStringArray(bi.distinctiveAssets) || !isStringArray(bi.confirmedFacts) || !isStringArray(bi.reasonableInferences)) return false;

  const cc = v.categoryContext as Record<string, unknown> | undefined;
  if (!cc || typeof cc !== 'object') return false;
  if (!isStringArray(cc.categoryTrends) || !isStringArray(cc.overusedPatterns) || !isStringArray(cc.opportunityAreas)) return false;

  const tc = v.trendContext as Record<string, unknown> | undefined;
  if (!tc || typeof tc !== 'object') return false;
  if (typeof tc.recentDataAvailable !== 'boolean') return false;

  return isStringArray(v.creativeOpportunities);
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

    const rateLimit = await checkRateLimit(supabase, userId, 'lightweight_ai');
    if (!rateLimit.allowed) {
      await logAiUsage(supabase, { userId, operation: 'brand_intelligence', status: 'rate_limited' });
      return jsonResponse(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED', retryAfterSeconds: rateLimit.retryAfterSeconds },
        429,
      );
    }

    const { product, mood, platform, targetAudience } = await req.json();
    if (!product || typeof product !== 'string' || !product.trim()) {
      return jsonResponse({ error: 'product required' }, 400);
    }
    const productErr = validateString(product, 'product', { maxLength: 500 });
    if (productErr) return jsonResponse({ error: productErr }, 400);
    const moodErr = validateString(mood, 'mood', { maxLength: 500 });
    if (moodErr) return jsonResponse({ error: moodErr }, 400);
    const platformErr = validateString(platform, 'platform', { maxLength: 500 });
    if (platformErr) return jsonResponse({ error: platformErr }, 400);
    const targetAudienceErr = validateString(targetAudience, 'targetAudience', { maxLength: 500 });
    if (targetAudienceErr) return jsonResponse({ error: targetAudienceErr }, 400);

    const signals = await fetchExternalBrandSignals(product.trim());
    const searchNote = signals.available
      ? `Live search snippets about this brand (use these, and only these, for "trendContext"):\n${signals.snippets.join('\n')}`
      : 'No live search was available for this request — treat "trendContext" as entirely unavailable per the ' +
        'recent-data policy above.';

    const userInputLines = [`Brand / product: ${product.trim()}`];
    if (typeof targetAudience === 'string' && targetAudience.trim()) userInputLines.push(`User-specified target audience (honor this over your own inference): ${targetAudience.trim()}`);
    if (typeof mood === 'string' && mood.trim()) userInputLines.push(`User-specified mood (honor this over your own inference): ${mood.trim()}`);
    if (typeof platform === 'string' && platform.trim()) userInputLines.push(`User-specified platform: ${platform.trim()}`);

    const userPrompt = `${OUTPUT_CONTRACT}\n\n${FACT_INFERENCE_POLICY}\n\n${RECENT_DATA_POLICY}\n\n` +
      `${userInputLines.join('\n')}\n\n${searchNote}\n\n` +
      `이 브랜드/제품을 분석하세요. 실제 구매/소비 상황, 유통 채널, 브랜드 고유 자산 등 이 브랜드에만 해당하는 ` +
      `구체적 사실을 우선하고, 어느 브랜드에나 적용 가능한 뻔한 설명은 피하세요.`;

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
      return jsonResponse(sanitizeUpstreamError(errText, 'brand-intelligence'), 502);
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

    if (!isValidAnalysis(parsed)) {
      return jsonResponse({ error: 'AI가 올바른 형식의 브랜드 분석을 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
    }

    await logAiUsage(supabase, { userId, operation: 'brand_intelligence', status: 'success' });
    return jsonResponse({ analysis: parsed }, 200);
  } catch (err) {
    return jsonResponse(sanitizeUnexpectedError(err, 'brand-intelligence'), 500);
  }
});
