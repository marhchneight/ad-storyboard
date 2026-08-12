import { createClient } from 'jsr:@supabase/supabase-js@2';

const DIRECTOR_SYSTEM_ROLE =
  'You are an award-winning commercial film director and creative director specializing in advertising, ' +
  'branded films, fashion films, social commercials, and visual storytelling. You are re-directing an ' +
  'existing storyboard, not starting over — you must preserve its product, message, narrative, and target ' +
  'audience, and change only the direction (framing, camera language, pacing, lighting, composition, mood).';

const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"creativeDirection": string, "changesSummary": string[], "shots": [{"shotNumber": number, ' +
  '"duration": number, "shotSize": string, "lens": string, "angle": string, "movement": string, ' +
  '"composition": string, "visual": string, "action": string, "lighting": string, "mood": string, ' +
  '"location": string, "props": string, "dialogue": string, "sfx": string, "transition": string, ' +
  '"purpose": string, "imagePrompt": string, "characterIds": string[], "productIds": string[], ' +
  '"locationId": (string or null), "appliedCreativeDNA": [{"category": "camera"|"lighting"|"composition"|' +
  '"editRhythm"|"colorMood"|"creativePrinciple", "key": string, "labelKo": string}], ' +
  '"creativeDNAApplicationNote": string}]}. Each shot\'s "location" field is a short KOREAN phrase naming where ' +
  'this shot takes place for a human reading the shot list (e.g. "모던한 아파트 거실") — do not confuse it ' +
  'with the persistent location entity (referenced only via "locationId"), which stays in English elsewhere. ' +
  '"changesSummary" is 2-5 short Korean bullet strings describing what ' +
  'changed, written for the person who commissioned this (e.g. "오프닝 샷을 더 역동적인 앵글로 교체"). ' +
  '"imagePrompt" is a separate English-only field per shot for an image-generation model (see language ' +
  'policy below). "characterIds"/"productIds"/"locationId" must reference the persistent entity ids listed ' +
  'below and must stay exactly the same as each shot\'s current ids unless the direction explicitly changes ' +
  'which entity appears in that shot (e.g. a costume change, a new location) — never invent a new entity id. ' +
  '"appliedCreativeDNA" and "creativeDNAApplicationNote" only apply when a Creative DNA profile is given below ' +
  '(see the Creative DNA section) — otherwise always return an empty array and empty string for them. ' +
  'Keep "shots" in narrative order starting at shotNumber 1. You may add, remove, or reorder shots if the ' +
  'instruction calls for it. Never wrap the JSON in markdown code fences.';

const PRODUCT_CONTEXT_INSTRUCTIONS =
  'Product-context priority: before writing or revising any shot\'s "visual", "action", "props", or ' +
  '"imagePrompt", first infer this ad\'s product context from "Product / concept" below — what is actually ' +
  'being advertised, its category, and what foods/objects/props would plausibly and naturally appear given ' +
  'that product, Korean consumer context, and this shot\'s narrative purpose. Apply this priority order, ' +
  'highest first, when deciding what appears in a shot: (1) an explicit instruction from the client — always ' +
  'honor it even if it produces an unusual combination (e.g. an explicit request to mix the product with an ' +
  'unrelated ingredient is valid content, not a mistake); (2) this product/brand context; (3) the scene\'s ' +
  'narrative and objects it strictly requires; (4) established character/product continuity; (5) Creative DNA ' +
  '(if a profile is given below) — Creative DNA controls HOW a shot is visualized (camera, lighting, ' +
  'composition, color, cut rhythm), never WHAT product-relevant objects exist in it; (6) secondary decorative ' +
  'props, only when they do not conflict with (1)-(4). Before finalizing each shot, silently check: does every ' +
  'prominent object you are about to describe have a plausible reason to exist given the advertised product ' +
  'and this shot\'s purpose? Never add an object merely to make a shot visually richer, and never carry an ' +
  'object into a shot only because a Creative DNA reference happened to be shot with it — Creative DNA is ' +
  'style guidance, never scene content.';

const CREATIVE_DNA_INSTRUCTIONS =
  'Creative DNA selection: you are given a Creative DNA profile below (extracted from a reference the client ' +
  'liked, already stripped of the reference\'s literal subject matter — treat everything in it as pure ' +
  'directing technique, never as objects to place in a shot). For every shot, explicitly decide which ' +
  'Creative DNA elements you actually drew on for that ' +
  'shot\'s camera, lighting, composition, color, rhythm, or creative-direction choices, and list them in that ' +
  'shot\'s "appliedCreativeDNA". Do NOT copy every Creative DNA element onto every shot — that defeats the ' +
  'purpose. Camera and composition elements should be selected per shot based on what genuinely fits that ' +
  'shot\'s specific purpose, and should vary between shots (e.g. a close-up element for a product-detail shot, ' +
  'a wide/top-down element for an establishing shot) — do not reuse the same camera/composition element on ' +
  'every shot out of laziness. colorMood and editRhythm elements are more often project-wide and MAY reasonably ' +
  'repeat across several shots when they genuinely apply throughout. If a shot doesn\'t meaningfully draw on ' +
  'the Creative DNA, return an empty "appliedCreativeDNA" array and empty "creativeDNAApplicationNote" for it ' +
  'rather than forcing one just to have something there. For each selected element: "key" is a short camelCase ' +
  'English slug you invent for it (e.g. "closeUp", "warmBacklight"); "labelKo" is a short natural Korean label ' +
  'for a Korean production team — reuse the matching Korean phrasing from the profile below when one is given, ' +
  'otherwise write a natural one yourself (industry loanwords like 클로즈업/와이드 숏/탑뷰/로우앵글/하이앵글/' +
  '트래킹 숏/핸드헬드/줌 인/줌 아웃/달리 인/달리 아웃/몽타주/백라이트/프레이밍 are fine, never forced literal ' +
  'translation). "creativeDNAApplicationNote" is one short natural Korean sentence explaining how the selected ' +
  'elements were applied to this specific shot (e.g. "제품의 질감과 색감을 강조하기 위해 클로즈업과 밝은 조명을 ' +
  '적용했습니다."). MECHANICAL RULE, not a matter of judgment: for ANY shot where "appliedCreativeDNA" is ' +
  'non-empty, the "imagePrompt" you return MUST be textually different from that shot\'s CURRENT imagePrompt ' +
  '(shown per shot in the current shot list below) — character-for-character identical is an automatic ' +
  'failure and that shot\'s applied DNA will be discarded. At minimum, rewrite the sentence to explicitly ' +
  'name the camera/lighting/composition language of every selected element (e.g. if you selected a top-down ' +
  'element, imagePrompt must contain a phrase like "aerial top-down view of..." even if the rest of the shot ' +
  'is otherwise similar). Do the same check for "shotSize"/"angle"/"movement"/"composition" — update whichever ' +
  'of those correspond to what you selected. If, after genuinely trying, a shot truly needs no change because ' +
  'you decided not to select any DNA element for it, that is fine — just make sure "appliedCreativeDNA" is ' +
  'empty for that shot too, matching the unchanged imagePrompt.';

const LANGUAGE_POLICY =
  'Language policy: "creativeDirection", "changesSummary", and every shot field except "imagePrompt" must be ' +
  'written in natural Korean, concise and appropriate for a professional commercial storyboard used on a ' +
  'Korean production set. Do not translate literally from English — write as a Korean production team ' +
  'actually would (e.g. "아이레벨 고정 숏" not "카메라는 눈 높이에 위치하고 정적입니다"). Industry-standard ' +
  'cinematography loanwords such as 클로즈업, 풀 숏, 아이레벨, 하이앵글, 로우앵글, 달리 인, 팬, 틸트, 핸드헬드 ' +
  'may be used naturally. The "angle" and "movement" fields are especially prone to slipping into English ' +
  'shorthand — write them ONLY as short Korean phrases, e.g. angle: "하이앵글", "로우앵글", "아이레벨" (never ' +
  '"high angle", "low angle", "eye level"); movement: "천천히 틸트 다운", "고정", "핸드헬드로 살짝 흔들림", ' +
  '"달리 인" (never "slow tilt down", "steady", "static", "handheld"). "imagePrompt" is the only exception — it must always be a concise English sentence ' +
  'describing exactly what the camera should see (subject, action, framing/angle), written for an ' +
  'image-generation model, and must never affect the language of any other field.';

interface VisualBibleSummaryEntity {
  id: string;
  label: string;
}

interface VisualBibleForSummary {
  characters?: VisualBibleSummaryEntity[];
  products?: VisualBibleSummaryEntity[];
  locations?: VisualBibleSummaryEntity[];
}

function summarizeVisualBible(bible: VisualBibleForSummary): string {
  const fmt = (items?: VisualBibleSummaryEntity[]) => (items ?? []).map((e) => `${e.id}: ${e.label}`).join('; ');
  const parts = [
    bible.characters?.length ? `Characters: ${fmt(bible.characters)}` : null,
    bible.products?.length ? `Products: ${fmt(bible.products)}` : null,
    bible.locations?.length ? `Locations: ${fmt(bible.locations)}` : null,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join('\n') : '(no persistent entities defined for this project)';
}

const PRESET_DIRECTIONS: Record<string, string> = {
  more_cinematic:
    'Make it more cinematic: slower pacing, stronger composition, wider visual storytelling, more ' +
    'considered lens choices, more atmospheric lighting.',
  more_commercial:
    'Make it more commercial: stronger product visibility, clearer message, more hero shots, faster ' +
    'communication, cleaner framing.',
  more_genz:
    'Make it more Gen-Z: unexpected framing, handheld feeling, faster rhythm, punchier compositions, ' +
    'social-first visual language.',
  more_emotional:
    'Make it more emotional: longer emotional beats, close-ups, reaction shots, softer lighting, visual ' +
    'breathing room.',
  more_minimal:
    'Make it more minimal: fewer shots, simplified composition, restrained movement, less visual noise.',
  make_it_crazy:
    'Push the idea further. Act like a creative director telling the team "let\'s go bolder." Take real ' +
    'creative risks: replace the opening shot with something unexpected, delay the product reveal, use ' +
    'asymmetrical or unconventional framing, add a visual metaphor, consider a match cut, turn an ordinary ' +
    'product shot into a conceptual one, or reorder part of the narrative. Do not simply make it weird for ' +
    'its own sake — every risk must still serve the brand message and purpose of the ad. Keep the product, ' +
    'the message, and the target audience intact.',
};

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

interface AppliedCreativeDnaTag {
  category: 'camera' | 'lighting' | 'composition' | 'editRhythm' | 'colorMood' | 'creativePrinciple';
  key: string;
  labelKo: string;
}

const DNA_CATEGORIES = new Set(['camera', 'lighting', 'composition', 'editRhythm', 'colorMood', 'creativePrinciple']);

function sanitizeAppliedDna(value: unknown): AppliedCreativeDnaTag[] {
  if (!Array.isArray(value)) return [];
  const out: AppliedCreativeDnaTag[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const i = item as Record<string, unknown>;
    if (typeof i.category !== 'string' || !DNA_CATEGORIES.has(i.category)) continue;
    if (typeof i.key !== 'string' || !i.key.trim()) continue;
    if (typeof i.labelKo !== 'string' || !i.labelKo.trim()) continue;
    out.push({ category: i.category as AppliedCreativeDnaTag['category'], key: i.key, labelKo: i.labelKo });
  }
  return out;
}

function camelToPhrase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

// The model is asked to rewrite imagePrompt so it reflects every selected
// DNA element, but LLMs are unreliable about consistently touching a
// secondary field like this. Rather than trust that (or silently drop the
// applied tags when it doesn't comply, losing real selections), guarantee
// the same source of truth deterministically: append any element whose
// descriptor isn't already present in the prompt text. This is what makes
// scene.appliedCreativeDNA and the actual image-generation prompt provably
// consistent, not just usually consistent.
function ensureImagePromptReflectsDna(imagePrompt: string, tags: AppliedCreativeDnaTag[]): string {
  const base = imagePrompt.trim();
  if (tags.length === 0) return base;
  const lowerBase = base.toLowerCase();
  const missingPhrases = tags
    .map((t) => camelToPhrase(t.key))
    .filter((phrase) => phrase.length > 0 && !lowerBase.includes(phrase));
  if (missingPhrases.length === 0) return base;
  return base ? `${base}, ${missingPhrases.join(', ')}` : missingPhrases.join(', ');
}

interface RevisedShot {
  shotNumber: number;
  duration: number;
  shotSize: string;
  lens: string;
  angle: string;
  movement: string;
  composition: string;
  visual: string;
  action: string;
  lighting: string;
  mood: string;
  location: string;
  props: string;
  dialogue: string;
  sfx: string;
  transition: string;
  purpose: string;
  imagePrompt?: string;
  characterIds?: string[];
  productIds?: string[];
  locationId?: string | null;
  appliedCreativeDNA?: unknown;
  creativeDNAApplicationNote?: string;
}

interface EditorOutput {
  creativeDirection: string;
  changesSummary: string[];
  shots: RevisedShot[];
}

function isValidEditorOutput(value: unknown): value is EditorOutput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.creativeDirection !== 'string') return false;
  if (!Array.isArray(v.changesSummary)) return false;
  if (!Array.isArray(v.shots) || v.shots.length < 2) return false;
  return v.shots.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const shot = s as Record<string, unknown>;
    return typeof shot.visual === 'string' && typeof shot.shotNumber === 'number';
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
    const { projectId, preset, instruction, creativeDna } = await req.json();
    if (!projectId) return jsonResponse({ error: 'projectId required' }, 400);
    if (!preset && !instruction) return jsonResponse({ error: 'preset or instruction required' }, 400);
    if (preset && !PRESET_DIRECTIONS[preset]) return jsonResponse({ error: 'unknown preset' }, 400);

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

    const { data: existingCuts, error: cutsError } = await supabase
      .from('cuts').select('*').eq('project_id', projectId).order('order_index');
    if (cutsError || !existingCuts || existingCuts.length === 0) {
      return jsonResponse({ error: 'no cuts found' }, 404);
    }

    const shotsContext = existingCuts.map((c: Record<string, unknown>, i: number) => {
      const refs = (c.entity_refs as { characters?: string[]; products?: string[]; location?: string | null }) ?? {};
      return {
        shotNumber: i + 1,
        duration: c.duration_seconds,
        shotSize: c.shot_size,
        lens: c.lens,
        angle: c.angle,
        movement: c.movement,
        composition: c.composition,
        visual: c.scene_description,
        imagePrompt: c.image_prompt,
        action: c.action,
        lighting: c.lighting,
        mood: c.mood,
        location: c.location,
        props: c.props,
        dialogue: c.dialogue,
        sfx: c.sfx,
        transition: c.transition,
        purpose: c.purpose,
        characterIds: refs.characters ?? [],
        productIds: refs.products ?? [],
        locationId: refs.location ?? null,
      };
    });

    const directionInstruction = preset
      ? PRESET_DIRECTIONS[preset]
      : `Follow this instruction from the client: "${instruction}"`;

    const visualBible = (project.visual_bible as VisualBibleForSummary) ?? {};

    const hasCreativeDna = creativeDna && typeof creativeDna === 'object';
    const creativeDnaBlock = hasCreativeDna
      ? `\n\n${CREATIVE_DNA_INSTRUCTIONS}\n\nCreative DNA profile:\n${JSON.stringify(creativeDna)}`
      : '';

    const userPrompt = `${OUTPUT_CONTRACT}\n\n${PRODUCT_CONTEXT_INSTRUCTIONS}\n\n` +
      `Product / concept (do not change): ${project.overall_prompt}\n\n` +
      `Persistent project entities (visual definitions live elsewhere and must not be altered unless the ` +
      `direction explicitly requires it):\n${summarizeVisualBible(visualBible)}\n\n` +
      `Current shot list:\n${JSON.stringify(shotsContext)}\n\n` +
      `Direction to apply: ${directionInstruction}` + creativeDnaBlock;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: DIRECTOR_SYSTEM_ROLE },
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

    if (!isValidEditorOutput(parsed)) {
      return jsonResponse({ error: 'AI가 올바른 형식의 연출안을 반환하지 않았습니다. 다시 시도해주세요.' }, 502);
    }
    const output = parsed;

    const newShots = output.shots.slice().sort((a, b) => a.shotNumber - b.shotNumber);
    const minLen = Math.min(newShots.length, existingCuts.length);

    for (let i = 0; i < minLen; i++) {
      const shot = newShots[i];
      const modelImagePrompt = (typeof shot.imagePrompt === 'string' && shot.imagePrompt.trim())
        ? shot.imagePrompt
        : (existingCuts[i].image_prompt ?? '');
      const shotAppliedDna = sanitizeAppliedDna(shot.appliedCreativeDNA);
      const resolvedImagePrompt = ensureImagePromptReflectsDna(modelImagePrompt, shotAppliedDna);
      const shotDnaNote = shotAppliedDna.length > 0 && typeof shot.creativeDNAApplicationNote === 'string'
        ? shot.creativeDNAApplicationNote
        : '';

      await supabase.from('cuts').update({
        order_index: i,
        scene_description: shot.visual ?? '',
        dialogue: shot.dialogue ?? '',
        camera_direction: [shot.angle, shot.movement].filter(Boolean).join(' · '),
        duration_seconds: typeof shot.duration === 'number' ? shot.duration : null,
        shot_size: shot.shotSize ?? '',
        lens: shot.lens ?? '',
        angle: shot.angle ?? '',
        movement: shot.movement ?? '',
        composition: shot.composition ?? '',
        action: shot.action ?? '',
        lighting: shot.lighting ?? '',
        mood: shot.mood ?? '',
        location: shot.location ?? '',
        props: shot.props ?? '',
        sfx: shot.sfx ?? '',
        transition: shot.transition ?? '',
        purpose: shot.purpose ?? '',
        image_prompt: resolvedImagePrompt,
        entity_refs: {
          characters: Array.isArray(shot.characterIds) ? shot.characterIds : [],
          products: Array.isArray(shot.productIds) ? shot.productIds : [],
          location: typeof shot.locationId === 'string' ? shot.locationId : null,
        },
        applied_creative_dna: shotAppliedDna,
        creative_dna_application_note: shotDnaNote,
        image_url: null,
        generation_status: 'idle',
      }).eq('id', existingCuts[i].id);
    }

    if (newShots.length > existingCuts.length) {
      const extraRows = newShots.slice(minLen).map((shot, i) => ({
        project_id: projectId,
        order_index: minLen + i,
        scene_description: shot.visual ?? '',
        dialogue: shot.dialogue ?? '',
        camera_direction: [shot.angle, shot.movement].filter(Boolean).join(' · '),
        duration_seconds: typeof shot.duration === 'number' ? shot.duration : null,
        shot_size: shot.shotSize ?? '',
        lens: shot.lens ?? '',
        angle: shot.angle ?? '',
        movement: shot.movement ?? '',
        composition: shot.composition ?? '',
        action: shot.action ?? '',
        lighting: shot.lighting ?? '',
        mood: shot.mood ?? '',
        location: shot.location ?? '',
        props: shot.props ?? '',
        sfx: shot.sfx ?? '',
        transition: shot.transition ?? '',
        purpose: shot.purpose ?? '',
        image_prompt: ensureImagePromptReflectsDna(shot.imagePrompt ?? '', sanitizeAppliedDna(shot.appliedCreativeDNA)),
        entity_refs: {
          characters: Array.isArray(shot.characterIds) ? shot.characterIds : [],
          products: Array.isArray(shot.productIds) ? shot.productIds : [],
          location: typeof shot.locationId === 'string' ? shot.locationId : null,
        },
        applied_creative_dna: sanitizeAppliedDna(shot.appliedCreativeDNA),
        creative_dna_application_note: typeof shot.creativeDNAApplicationNote === 'string'
          ? shot.creativeDNAApplicationNote
          : '',
      }));
      await supabase.from('cuts').insert(extraRows);
    } else if (existingCuts.length > newShots.length) {
      const removedIds = existingCuts.slice(minLen).map((c: { id: string }) => c.id);
      await supabase.from('cuts').delete().in('id', removedIds);
    }

    await supabase.from('projects').update({ creative_direction: output.creativeDirection }).eq('id', projectId);

    return jsonResponse({ success: true, changes: output.changesSummary }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
