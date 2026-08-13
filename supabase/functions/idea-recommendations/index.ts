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
  'You study current Korean and global advertising/content trends and turn them into original, concrete, ' +
  'storyboard-ready ad concepts a director could immediately start boarding. ' +
  'Use current advertising trends as signals, not templates to copy. ' +
  'Generate original creative directions inspired by market shifts while avoiding direct imitation of ' +
  'identifiable campaigns — never name a real brand, campaign, or influencer, and never describe a specific ' +
  'existing ad closely enough that it reads as a copy of it. ' +
  'Prioritize creative diversity, visual specificity, cultural relevance, and storyboard potential. ' +
  'Internally think in three steps for each idea — (1) which trend signal(s) it draws on, (2) your own creative ' +
  'interpretation of that signal, not a literal restatement of it, (3) a concrete storyboard-ready starting ' +
  'point — but only the final result belongs in your output, never the intermediate reasoning.';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object, and nothing else: {"examples": [{"text": string, "category": string, ' +
  '"trendSignals": string[], "market": "KR"|"GLOBAL"|"MIXED"}]}. "examples" must have exactly 5 items. ' +
  'Each "text" is natural, concise Korean (1-2 sentences, a real creative brief a director could act on — never ' +
  'a bare genre label like "UGC 광고" or "TikTok 광고" on its own) that includes at least 3 of: product/category, ' +
  'situation, visual hook, tone/mood, format, target audience, unusual creative device. "category" is your own ' +
  'short label for that idea\'s creative direction (e.g. emotional brand film, short-form/social, product-led, ' +
  'humor/twist, visual-experimental — invent your own wording, freely). "trendSignals" is 1-3 short tags naming ' +
  'the signal(s) that idea draws on. "market" reflects whether the idea leans Korean-market-specific, globally ' +
  'generic, or a blend. Never wrap the JSON in markdown code fences.\n\n' +
  'Before finalizing, check the 5 ideas against each other and make sure they differ across as many of these as ' +
  'possible: duration, camera language, storytelling structure, emotional tone, product category, target ' +
  'audience, platform, and visual hook. No two ideas may share the same combination of format + tone + platform. ' +
  'If two ideas are too similar, silently replace one before responding — never show your revision process.';

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
  { text: '퇴근 후 냉장고를 열어보는 순간부터 시작하는 15초 야식 브랜드 광고. 휴대폰으로 우연히 찍은 듯한 자연스러운 시점.', category: '숏폼/SNS형', market: 'KR' },
  { text: '제품을 마지막 3초에만 등장시키는 60초 향수 브랜드 필름. 새벽 도시의 정적인 롱테이크.', category: '감성/브랜드 필름형', market: 'GLOBAL' },
  { text: '운동화 끈을 묶는 손만 클로즈업으로 보여주다가 급격히 속도를 올리는 30초 러닝화 광고. Gen-Z 타깃.', category: '제품 중심형', market: 'MIXED' },
  { text: '배달 음식이 도착하기 전, 기다리는 사람의 표정 변화만으로 스토리를 만드는 유머러스한 15초 커머스 광고.', category: '유머/반전형', market: 'KR' },
  { text: '제품이 화면에 단 한 번도 정면으로 등장하지 않는 실험적인 뷰티 브랜드 필름. 거울과 반사면만으로 형태를 암시.', category: '비주얼 실험형', market: 'GLOBAL' },
  { text: '카페 창가 자리에 앉은 사람의 하루를 타임랩스로 압축한 20초 커피 브랜드 광고. 계절이 한 컷 안에서 바뀐다.', category: '감성/브랜드 필름형', market: 'KR' },
  { text: '언박싱 영상처럼 시작하지만 실제로는 아무것도 꺼내지 않는 반전형 15초 테크 제품 광고.', category: '유머/반전형', market: 'GLOBAL' },
  { text: '친구에게 추천하듯 말하는 셀프캠 톤의 30초 스킨케어 리뷰형 광고. 편집 없이 이어지는 롱컷.', category: '숏폼/SNS형', market: 'KR' },
  { text: '제품의 소재(질감)만 극단적으로 클로즈업해서 추상화처럼 보여주는 10초 버티컬 광고. 사운드 디자인이 핵심.', category: '비주얼 실험형', market: 'GLOBAL' },
  { text: '두 사람이 같은 제품을 정반대 방식으로 사용하는 모습을 스플릿 스크린으로 대비시키는 20초 라이프스타일 광고.', category: '비주얼 실험형', market: 'MIXED' },
  { text: '출근길 지하철에서 이어폰을 꽂는 순간부터 시작하는 15초 오디오 브랜드 광고. 도시 소음이 서서히 음악으로 바뀐다.', category: '감성/브랜드 필름형', market: 'KR' },
  { text: '반려동물의 시점(POV)으로 촬영한 30초 펫푸드 광고. 사람의 얼굴은 한 번도 정면으로 나오지 않는다.', category: '비주얼 실험형', market: 'GLOBAL' },
  { text: '실패한 시도들을 빠르게 몽타주로 보여준 뒤 마지막에 성공하는 6초 초단편 스포츠 브랜드 광고.', category: '유머/반전형', market: 'MIXED' },
  { text: '제품 리뷰를 남기는 실제 사용자처럼 보이는 세로형 15초 커머스 광고. 자막과 손글씨 스타일 텍스트 사용.', category: '숏폼/SNS형', market: 'KR' },
  { text: '한 가지 색만으로 구성된 미니멀한 30초 향수 브랜드 필름. 향의 느낌을 색과 질감으로만 은유한다.', category: '비주얼 실험형', market: 'GLOBAL' },
  { text: '가족 식사 준비 과정을 담담하게 따라가는 60초 브랜드 다큐형 광고. 내레이션 없이 소리만으로 구성.', category: '감성/브랜드 필름형', market: 'KR' },
  { text: '제품을 극한 상황에서 테스트하는 코믹한 15초 내구성 광고. 진지한 톤으로 시작해 과장되게 무너진다.', category: '유머/반전형', market: 'GLOBAL' },
  { text: '한 사람의 아침 루틴을 초 단위로 쪼개 빠른 컷으로 보여주는 20초 뷰티 브랜드 광고. 리듬감 있는 편집이 핵심.', category: '숏폼/SNS형', market: 'MIXED' },
  { text: '제품 없이 그 제품이 남긴 흔적(자국, 그림자, 얼룩)만으로 서사를 완성하는 실험적인 30초 캠페인 필름.', category: '비주얼 실험형', market: 'GLOBAL' },
  { text: '동네 편의점 사장님의 하루 속에 자연스럽게 스며든 제품을 보여주는 다큐멘터리 톤의 30초 커머스 광고.', category: '감성/브랜드 필름형', market: 'KR' },
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

    const body = await req.json().catch(() => ({}));
    const avoid = Array.isArray(body.avoid) ? body.avoid.filter((a: unknown) => typeof a === 'string').slice(0, 10) : [];

    let source: 'ai' | 'fallback' = 'ai';
    let examples: CreativeExample[];
    try {
      const trend = await getCachedTrendSignals(supabase);
      examples = await callOpenAiExamples(trend, avoid);
    } catch {
      source = 'fallback';
      examples = pickFallback(avoid);
    }

    return jsonResponse({ examples, source }, 200);
  } catch (err) {
    // Even a totally unexpected failure (e.g. malformed request body) still
    // returns usable examples rather than an error the UI has to special-case.
    return jsonResponse({ examples: pickFallback([]), source: 'fallback', warning: String(err) }, 200);
  }
});
