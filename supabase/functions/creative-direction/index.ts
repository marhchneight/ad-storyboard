import { createClient } from 'jsr:@supabase/supabase-js@2';
import { validateString, validateNumber, validateEnum } from '../_shared/validation.ts';
import { sanitizeUpstreamError, sanitizeUnexpectedError } from '../_shared/errors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { logAiUsage } from '../_shared/usageLog.ts';

const SYSTEM_ROLE =
  'You are an award-winning commercial film director. A client brings you a rough idea for an ad. Your job ' +
  'is not to storyboard it yet — it is to propose a Creative Direction: a short, opinionated treatment that ' +
  'gives the idea a specific creative point of view, the way a director pitches a treatment before a shoot ' +
  'is ever planned. Be decisive and specific, not generic. Preserve whatever product, brand, or message the ' +
  'brief specifies — you are interpreting it creatively, not replacing it.';

const LANGUAGE_POLICY =
  'Language policy: every field you return must be written in natural Korean, concise and appropriate for a ' +
  'professional commercial production treatment used by a Korean team. Do not translate literally from ' +
  'English — write as a Korean creative director actually would. Industry-standard cinematography loanwords ' +
  '(e.g. 클로즈업, 미니멀, 네온) may be used naturally where appropriate.';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"title": string, "concept": string, "creativeDirection": string, "visualLanguage": string[], ' +
  '"approach": {"duration": number|null, "estimatedShots": number|null, "dialogueStyle": string, ' +
  '"productReveal": string, "cameraStyle": string}, "creativePrinciples": string[]}. ' +
  '"title" is a short, natural Korean project name (한국어, 4~14자 내외) that clearly conveys what the ad is ' +
  'about at a glance, the way a Korean production team would name the project internally — e.g. ' +
  '"30대 남성 영양제 인포머셜", "겨울 향수 필름". Do not use English, all caps, or an abstract poetic film title. ' +
  '"concept" is one Korean sentence summarizing the core idea. "creativeDirection" is a short Korean treatment ' +
  'paragraph (3-6 sentences) written the way a director pitches a concept to a Korean production team. ' +
  '"visualLanguage" is 4-6 short Korean style tags (e.g. "차분함", "친밀감", "미니멀", "프리미엄"; industry ' +
  'loanwords like "네온" are fine). "approach.duration" is the target length in seconds if inferable, else ' +
  'null. "approach.estimatedShots" is a realistic shot count for that duration. "approach.dialogueStyle" / ' +
  '"productReveal" / "cameraStyle" are short Korean phrases (e.g. "절제된 대사", "후반부 공개", "느린 시네마틱"). ' +
  '"creativePrinciples" is 2-4 short Korean rules this treatment follows. Never wrap the JSON in markdown ' +
  'code fences.';

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

interface Approach {
  duration: number | null;
  estimatedShots: number | null;
  dialogueStyle: string;
  productReveal: string;
  cameraStyle: string;
}

interface Treatment {
  title: string;
  concept: string;
  creativeDirection: string;
  visualLanguage: string[];
  approach: Approach;
  creativePrinciples: string[];
}

function isValidTreatment(value: unknown): value is Treatment {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== 'string' || typeof v.concept !== 'string' || typeof v.creativeDirection !== 'string') {
    return false;
  }
  if (!Array.isArray(v.visualLanguage) || !v.visualLanguage.every((x) => typeof x === 'string')) return false;
  if (!Array.isArray(v.creativePrinciples) || !v.creativePrinciples.every((x) => typeof x === 'string')) return false;
  if (!v.approach || typeof v.approach !== 'object') return false;
  const a = v.approach as Record<string, unknown>;
  if (typeof a.dialogueStyle !== 'string' || typeof a.productReveal !== 'string' || typeof a.cameraStyle !== 'string') {
    return false;
  }
  if (a.duration !== null && typeof a.duration !== 'number') return false;
  if (a.estimatedShots !== null && typeof a.estimatedShots !== 'number') return false;
  return true;
}

function buildBriefSummary(brief: Record<string, unknown>, freeformIdea: string): string {
  const lines: string[] = [];
  if (freeformIdea && freeformIdea.trim()) lines.push(`Free-form idea: ${freeformIdea.trim()}`);
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

function buildSceneCountNote(
  sceneCountMode: unknown,
  requestedSceneCount: unknown,
  targetDurationSeconds: unknown,
): string {
  if (sceneCountMode === 'manual' && typeof requestedSceneCount === 'number' && requestedSceneCount >= 2) {
    return `\n\n이 광고는 정확히 ${requestedSceneCount}개의 샷(장면)으로 구성되어야 합니다. "approach.estimatedShots"는 ` +
      `반드시 ${requestedSceneCount}로 설정하고, 컨셉과 트리트먼트 전체를 이 장면 수에 맞게 설계하세요.`;
  }
  if (sceneCountMode === 'duration' && typeof targetDurationSeconds === 'number') {
    return `\n\n이 광고의 목표 길이는 ${targetDurationSeconds}초입니다. "approach.duration"은 ${targetDurationSeconds}로 ` +
      `설정하고, "approach.estimatedShots"는 이 길이와 광고 유형(정보 전달이 필요한 광고인지, 감성적인 브랜드 필름인지 등)에 ` +
      `맞는 현실적인 샷 수로 스스로 판단하세요. 무조건 샷 수를 최대화하지 마세요.`;
  }
  return '';
}

function applySceneCountOverride(
  treatment: Treatment,
  sceneCountMode: unknown,
  requestedSceneCount: unknown,
  targetDurationSeconds: unknown,
): Treatment {
  if (sceneCountMode === 'manual' && typeof requestedSceneCount === 'number' && requestedSceneCount >= 2) {
    return { ...treatment, approach: { ...treatment.approach, estimatedShots: requestedSceneCount } };
  }
  if (sceneCountMode === 'duration' && typeof targetDurationSeconds === 'number') {
    return { ...treatment, approach: { ...treatment.approach, duration: targetDurationSeconds } };
  }
  return treatment;
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
  return parts.length > 0 ? `\n\n다음 Creative DNA(레퍼런스의 연출 언어)를 이 트리트먼트에 반영하세요:\n${parts.join('\n')}` : '';
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
      await logAiUsage(supabase, { userId, operation: 'creative_direction', status: 'rate_limited' });
      return jsonResponse(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED', retryAfterSeconds: rateLimit.retryAfterSeconds },
        429,
      );
    }

    const {
      mode, freeformIdea, brief, dna, previousTreatment, instruction,
      sceneCountMode, requestedSceneCount, targetDurationSeconds,
    } = await req.json();
    const resolvedMode = mode === 'revise' || mode === 'regenerate' ? mode : 'generate';

    if (mode !== undefined) {
      const modeErr = validateEnum(mode, ['generate', 'regenerate', 'revise'] as const, 'mode');
      if (modeErr) return jsonResponse({ error: modeErr }, 400);
    }
    const freeformErr = validateString(freeformIdea, 'freeformIdea', { maxLength: 10000 });
    if (freeformErr) return jsonResponse({ error: freeformErr }, 400);
    const instructionErr = validateString(instruction, 'instruction', { maxLength: 4000 });
    if (instructionErr) return jsonResponse({ error: instructionErr }, 400);
    if (sceneCountMode !== undefined) {
      const modeErr = validateEnum(sceneCountMode, ['manual', 'duration'] as const, 'sceneCountMode');
      if (modeErr) return jsonResponse({ error: modeErr }, 400);
    }
    const sceneCountErr = validateNumber(requestedSceneCount, 'requestedSceneCount', { min: 2, max: 30, integer: true });
    if (sceneCountErr) return jsonResponse({ error: sceneCountErr }, 400);
    const durationErr = validateNumber(targetDurationSeconds, 'targetDurationSeconds', { min: 1, max: 600 });
    if (durationErr) return jsonResponse({ error: durationErr }, 400);

    const sceneCountNote = buildSceneCountNote(sceneCountMode, requestedSceneCount, targetDurationSeconds);

    let userPrompt: string;

    if (resolvedMode === 'generate') {
      const briefSummary = buildBriefSummary(brief ?? {}, freeformIdea ?? '');
      userPrompt = `${OUTPUT_CONTRACT}\n\n다음은 광고 브리프입니다:\n${briefSummary}${summarizeDna(dna)}\n\n` +
        `이 브리프에 대한 Creative Direction(연출 트리트먼트) 하나를 제안하세요.${sceneCountNote}`;
    } else if (resolvedMode === 'regenerate') {
      const briefSummary = buildBriefSummary(brief ?? {}, freeformIdea ?? '');
      const prevTitle = typeof previousTreatment?.title === 'string' ? previousTreatment.title : '';
      const prevConcept = typeof previousTreatment?.concept === 'string' ? previousTreatment.concept : '';
      userPrompt = `${OUTPUT_CONTRACT}\n\n다음은 광고 브리프입니다:\n${briefSummary}${summarizeDna(dna)}\n\n` +
        `이전에 다음과 같은 방향을 제안했습니다: "${prevTitle}" — ${prevConcept}\n` +
        `이번에는 완전히 다른 창의적 해석의 Creative Direction을 새로 제안하세요. 같은 제품/메시지는 유지하되 ` +
        `톤, 배경, 접근 방식은 이전과 뚜렷하게 달라야 합니다.${sceneCountNote}`;
    } else {
      if (!previousTreatment || typeof previousTreatment !== 'object') {
        return jsonResponse({ error: 'previousTreatment required for revise' }, 400);
      }
      if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
        return jsonResponse({ error: 'instruction required for revise' }, 400);
      }
      userPrompt = `${OUTPUT_CONTRACT}\n\n다음은 현재 Creative Direction입니다:\n${JSON.stringify(previousTreatment)}\n\n` +
        `클라이언트의 수정 지시: "${instruction.trim()}"\n` +
        `이 지시를 반영해서 트리트먼트를 다시 작성하세요. 지시와 관련 없는 부분은 최대한 유지하세요.`;
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
          { role: 'system', content: LANGUAGE_POLICY },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return jsonResponse(sanitizeUpstreamError(errText, 'creative-direction'), 502);
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

    if (!isValidTreatment(parsed)) {
      return jsonResponse({ error: 'AI가 올바른 형식의 연출 방향을 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
    }

    const treatment = applySceneCountOverride(parsed, sceneCountMode, requestedSceneCount, targetDurationSeconds);

    await logAiUsage(supabase, { userId, operation: 'creative_direction', status: 'success' });
    return jsonResponse({ treatment }, 200);
  } catch (err) {
    return jsonResponse(sanitizeUnexpectedError(err, 'creative-direction'), 500);
  }
});
