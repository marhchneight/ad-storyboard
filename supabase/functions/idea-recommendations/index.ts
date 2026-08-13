import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { logAiUsage } from '../_shared/usageLog.ts';

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

// ---------------------------------------------------------------------------
// CreativeExample — the shape shown to (and clicked by) the user. `category`/
// `trendSignals`/`market` aren't rendered today but are kept for a future
// "why this idea" explanation surface, so they're generated now rather than
// bolted on later.
// ---------------------------------------------------------------------------
interface CreativeExample {
  id: string;
  text: string;
  category?: string;
  trendSignals?: string[];
  market?: 'KR' | 'GLOBAL' | 'MIXED';
}

const TREND_CACHE_KEY = 'ad_creative_trends_kr_global';
const TREND_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ---------------------------------------------------------------------------
// TrendProvider — the only place that knows how (or whether) live trend data
// gets fetched. Everything downstream only ever sees {available, snippets},
// so a missing/failed search degrades to "no live data" instead of throwing,
// and nothing downstream has to know Tavily specifics.
// ---------------------------------------------------------------------------
interface TrendResult {
  available: boolean;
  snippets: string[];
}

interface TavilyResult {
  title?: string;
  content?: string;
}

async function searchTavily(apiKey: string, query: string, maxResults: number): Promise<string[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: false,
    }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  const results: TavilyResult[] = Array.isArray(json.results) ? json.results : [];
  return results
    .map((r) => (typeof r.title === 'string' && typeof r.content === 'string') ? `${r.title}: ${r.content}` : null)
    .filter((s): s is string => !!s && s.trim().length > 0);
}

async function fetchLiveTrendSignals(): Promise<TrendResult> {
  const searchApiKey = Deno.env.get('SEARCH_API_KEY');
  if (!searchApiKey) return { available: false, snippets: [] };
  try {
    const [kr, global] = await Promise.all([
      searchTavily(searchApiKey, '2025 한국 광고 트렌드 숏폼 틱톡 인스타그램 릴스 커머스 콘텐츠', 5),
      searchTavily(searchApiKey, '2025 global advertising creative trends short-form video social-first UGC AI-native', 5),
    ]);
    const snippets = [...kr, ...global].slice(0, 10);
    return snippets.length > 0 ? { available: true, snippets } : { available: false, snippets: [] };
  } catch {
    return { available: false, snippets: [] };
  }
}

// ---------------------------------------------------------------------------
// TrendCache — a thin table-backed cache in front of TrendProvider so a
// "새로 추천" click (or any other request within the TTL window) reuses the
// same researched signals instead of re-querying the search API every time.
// ---------------------------------------------------------------------------
async function getCachedTrendSignals(
  supabase: ReturnType<typeof createClient>
): Promise<TrendResult> {
  const { data } = await supabase
    .from('trend_cache')
    .select('payload, fetched_at')
    .eq('id', TREND_CACHE_KEY)
    .maybeSingle();

  const row = data as { payload: TrendResult; fetched_at: string } | null;
  if (row && Date.now() - new Date(row.fetched_at).getTime() < TREND_CACHE_TTL_MS) {
    return row.payload;
  }

  const fresh = await fetchLiveTrendSignals();
  // Cache even an "unavailable" result — no point re-hitting a missing/broken
  // search API on every request within the same TTL window.
  await supabase.from('trend_cache').upsert({
    id: TREND_CACHE_KEY,
    payload: fresh,
    fetched_at: new Date().toISOString(),
  });
  return fresh;
}

// ---------------------------------------------------------------------------
// ExampleIdeaGenerator
// ---------------------------------------------------------------------------
const SYSTEM_ROLE =
  'You are a bilingual (Korean/English) advertising creative strategist for a professional ad-storyboard tool. ' +
  'You study current Korean and global advertising/content trends and turn them into original, short, ' +
  'tone-and-manner-first creative direction prompts a director could immediately start boarding from. ' +
  'Use current advertising trends as signals, not templates to copy. ' +
  'Generate original creative directions inspired by market shifts while avoiding direct imitation of ' +
  'identifiable campaigns — never name a real brand, campaign, or influencer, and never describe a specific ' +
  'existing ad closely enough that it reads as a copy of it. ' +
  'Prioritize creative diversity, visual specificity, cultural relevance, and storyboard potential — but keep ' +
  'every idea SHORT: a tone/mood/rhythm-first phrase, not a written-out scene or mini-script. ' +
  'Internally think in three steps for each idea — (1) which trend signal(s) it draws on, (2) your own creative ' +
  'interpretation of that signal, not a literal restatement of it, (3) a short tone-and-manner phrase capturing ' +
  'that direction — but only the final short phrase belongs in your output, never the intermediate reasoning.';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object, and nothing else: {"examples": [{"text": string, "category": string, ' +
  '"trendSignals": string[], "market": "KR"|"GLOBAL"|"MIXED"}]}. "examples" must have exactly 5 items. ' +
  'Each "text" is a SHORT Korean tone-and-manner phrase — roughly 10-25 Korean characters, at most one short ' +
  'clause (never a full multi-clause sentence or a written-out scene/script). Describe the mood/tone, pacing or ' +
  'rhythm, visual texture, or one distinctive creative device — pick at most 1-2 of these, optionally with a ' +
  'format/duration hint. Do NOT describe a specific scene, situation, or product-usage moment in detail — this ' +
  'is a creative-direction starting point, not a scripted brief. Never a bare genre label alone either (e.g. ' +
  'just "TikTok 광고" with nothing else) — it must carry some tone/mood content. Good length/style examples ' +
  '(invent new ones, never reuse these): "차갑고 몽환적인 새벽 감성, 정적인 롱테이크", "빠른 컷의 리드미컬한 ' +
  '숏폼, 발랄한 텐션", "미니멀한 원컬러 비주얼, 절제된 무드". "category" is your own short label for that idea\'s ' +
  'creative direction (e.g. emotional brand film, short-form/social, product-led, humor/twist, ' +
  'visual-experimental — invent your own wording, freely). "trendSignals" is 1-3 short tags naming the signal(s) ' +
  'that idea draws on. "market" reflects whether the idea leans Korean-market-specific, globally generic, or a ' +
  'blend. Never wrap the JSON in markdown code fences.\n\n' +
  'Before finalizing, check the 5 ideas against each other and make sure they differ across as many of these as ' +
  'possible: pacing/rhythm, camera language, emotional tone, visual texture, and platform/format hint. No two ' +
  'ideas may share the same combination of tone + pacing. If two ideas are too similar, silently replace one ' +
  'before responding — never show your revision process.';

function buildUserContent(trend: TrendResult, avoid: string[]): string {
  const parts: string[] = [OUTPUT_CONTRACT];

  if (trend.available) {
    parts.push(
      '다음은 최근 수집된 한국/글로벌 광고·콘텐츠 트렌드 관련 리서치 스니펫입니다 (실제 라이브 검색 결과 — ' +
      '이 내용을 하나의 신호로 참고하되, 그대로 베끼거나 아이디어 문장에 노출하지 마세요):\n' +
      trend.snippets.map((s, i) => `${i + 1}. ${s}`).join('\n')
    );
  } else {
    parts.push(
      '지금은 실시간 트렌드 검색 데이터를 사용할 수 없습니다. 당신이 알고 있는 일반적인 광고/콘텐츠 크리에이티브 ' +
      '트렌드 지식을 바탕으로 하되, 이것이 실시간 시장 리서치 결과인 것처럼 표현하지 마세요.'
    );
  }

  if (avoid.length > 0) {
    parts.push(
      '다음 문장들과 컨셉/톤/형식이 지나치게 비슷한 아이디어는 만들지 마세요 (같은 방향을 새로운 5개에 그대로 ' +
      '재사용하지 말 것):\n' + avoid.map((a) => `- ${a}`).join('\n')
    );
  }

  return parts.join('\n\n');
}

function isValidExamplesPayload(value: unknown): value is { examples: CreativeExample[] } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.examples) || v.examples.length !== 5) return false;
  return v.examples.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const e = item as Record<string, unknown>;
    return typeof e.text === 'string' && e.text.trim().length > 0;
  });
}

async function callOpenAiExamples(trend: TrendResult, avoid: string[]): Promise<CreativeExample[]> {
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
        { role: 'user', content: buildUserContent(trend, avoid) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.95,
    }),
  });
  if (!openaiRes.ok) throw new Error(`openai error: ${await openaiRes.text()}`);

  const openaiJson = await openaiRes.json();
  const content = openaiJson.choices?.[0]?.message?.content;
  if (!content) throw new Error('empty AI response');

  const parsed = JSON.parse(content);
  if (!isValidExamplesPayload(parsed)) throw new Error('malformed examples payload');

  return parsed.examples.map((e) => ({
    id: crypto.randomUUID(),
    text: e.text.trim(),
    category: typeof e.category === 'string' ? e.category : undefined,
    trendSignals: Array.isArray(e.trendSignals) ? e.trendSignals.filter((s): s is string => typeof s === 'string') : undefined,
    market: e.market === 'KR' || e.market === 'GLOBAL' || e.market === 'MIXED' ? e.market : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Fallback pool — used only when the AI call fails outright (network error,
// malformed response, etc.) so the UI never ends up with an empty section.
// This is a fixed, hand-written, quality-checked set, not live trend data —
// never presented to the user as a real-time market analysis.
// ---------------------------------------------------------------------------
const FALLBACK_EXAMPLES: Omit<CreativeExample, 'id'>[] = [
  { text: '차갑고 몽환적인 새벽 감성, 정적인 롱테이크', category: '감성/브랜드 필름형', market: 'GLOBAL' },
  { text: '빠른 컷의 리드미컬한 숏폼, 발랄한 텐션', category: '숏폼/SNS형', market: 'KR' },
  { text: '미니멀한 원컬러 비주얼, 절제된 무드', category: '비주얼 실험형', market: 'GLOBAL' },
  { text: '다큐멘터리 톤, 내레이션 없이 소리로만', category: '감성/브랜드 필름형', market: 'KR' },
  { text: '유쾌한 반전이 있는 코믹한 15초 톤', category: '유머/반전형', market: 'MIXED' },
  { text: '따뜻하고 노스탤직한 감성 필름', category: '감성/브랜드 필름형', market: 'KR' },
  { text: '거칠고 로우파이한 핸드헬드 무드', category: '숏폼/SNS형', market: 'GLOBAL' },
  { text: '고요하고 사색적인 클로즈업 중심 톤', category: '제품 중심형', market: 'MIXED' },
  { text: '발랄한 컬러감, 경쾌한 팝 리듬', category: '숏폼/SNS형', market: 'KR' },
  { text: '잔잔한 슬로우 모션, 감성적인 여운', category: '감성/브랜드 필름형', market: 'GLOBAL' },
  { text: '실험적인 흑백 대비, 그래픽적인 구도', category: '비주얼 실험형', market: 'GLOBAL' },
  { text: '친근한 셀프캠 톤, 편집 없는 롱컷', category: '숏폼/SNS형', market: 'KR' },
  { text: '긴장감 있는 서스펜스풍 카운트다운', category: '유머/반전형', market: 'MIXED' },
  { text: '따스한 가족 다큐 톤, 담담한 시선', category: '감성/브랜드 필름형', market: 'KR' },
  { text: '미래지향적인 네온톤, 테크 무드', category: '비주얼 실험형', market: 'GLOBAL' },
  { text: '소박하고 정직한 로컬 브랜드 톤', category: '제품 중심형', market: 'KR' },
  { text: '몽타주로 빠르게 전개되는 에너제틱한 톤', category: '숏폼/SNS형', market: 'MIXED' },
  { text: '절제된 럭셔리 톤, 느린 카메라 무브', category: '감성/브랜드 필름형', market: 'GLOBAL' },
  { text: '장난스러운 애니메이션풍 그래픽 무드', category: '비주얼 실험형', market: 'MIXED' },
  { text: '진지하게 시작해 유쾌하게 반전되는 톤', category: '유머/반전형', market: 'KR' },
];

function pickFallback(avoid: string[], count = 5): CreativeExample[] {
  const avoidSet = new Set(avoid);
  const pool = FALLBACK_EXAMPLES.filter((e) => !avoidSet.has(e.text));
  const source = pool.length >= count ? pool : FALLBACK_EXAMPLES;
  const shuffled = [...source].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((e) => ({ ...e, id: crypto.randomUUID() }));
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
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: 'unauthorized' }, 401);
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const rateLimit = await checkRateLimit(supabase, userId, 'lightweight_ai');
    if (!rateLimit.allowed) {
      await logAiUsage(supabase, { userId, operation: 'idea_recommendations', status: 'rate_limited' });
      return jsonResponse(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED', retryAfterSeconds: rateLimit.retryAfterSeconds },
        429,
      );
    }

    const body = await req.json().catch(() => ({}));
    const avoid = Array.isArray(body.avoid)
      ? body.avoid.filter((a: unknown) => typeof a === 'string' && a.length <= 300).slice(0, 10)
      : [];

    let source: 'ai' | 'fallback' = 'ai';
    let examples: CreativeExample[];
    try {
      const trend = await getCachedTrendSignals(supabase);
      examples = await callOpenAiExamples(trend, avoid);
    } catch {
      source = 'fallback';
      examples = pickFallback(avoid);
    }

    await logAiUsage(supabase, { userId, operation: 'idea_recommendations', status: source === 'ai' ? 'success' : 'failed' });
    return jsonResponse({ examples, source }, 200);
  } catch (err) {
    // Even a totally unexpected failure (e.g. malformed request body) still
    // returns usable examples rather than an error the UI has to special-case.
    return jsonResponse({ examples: pickFallback([]), source: 'fallback', warning: String(err) }, 200);
  }
});
