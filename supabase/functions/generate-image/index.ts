import { createClient } from 'jsr:@supabase/supabase-js@2';

const IMAGE_SIZE_BY_ASPECT_RATIO: Record<string, string> = {
  '1:1': '1024x1024',
  '9:16': '1024x1536',
  '16:9': '1536x1024',
};

const STYLE_MODIFIERS: Record<string, string> = {
  sketch: 'black and white pencil sketch storyboard style, rough hand-drawn line art',
  animation: 'flat 2D animation illustration style, vibrant colors, cartoon character design',
  live_action: 'photorealistic cinematic film still, realistic lighting, live action',
};

interface CharacterEntity {
  id: string;
  label: string;
  ageRange?: string;
  genderPresentation?: string;
  ethnicity?: string;
  facialCharacteristics?: string;
  hairstyle?: string;
  outfit?: string;
  build?: string;
  distinctiveTraits?: string;
  referenceImageUrl?: string | null;
}

interface ProductEntity {
  id: string;
  label: string;
  type?: string;
  shape?: string;
  color?: string;
  material?: string;
  packaging?: string;
  labelDetails?: string;
  relativeSize?: string;
  distinctiveDetails?: string;
  referenceImageUrl?: string | null;
}

interface LocationEntity {
  id: string;
  label: string;
  environmentType?: string;
  architectureInterior?: string;
  keyColors?: string;
  lighting?: string;
  recurringProps?: string;
  referenceImageUrl?: string | null;
}

interface VisualBible {
  globalStyle?: string;
  characters?: CharacterEntity[];
  products?: ProductEntity[];
  locations?: LocationEntity[];
}

interface EntityRefs {
  characters?: string[];
  products?: string[];
  location?: string | null;
}

function describeCharacter(e: CharacterEntity): string {
  return `${e.label}: ${[
    e.ageRange && `age ${e.ageRange}`,
    e.genderPresentation,
    e.ethnicity,
    e.facialCharacteristics,
    e.hairstyle && `hair: ${e.hairstyle}`,
    e.outfit && `wearing: ${e.outfit}`,
    e.build,
    e.distinctiveTraits,
  ].filter(Boolean).join(', ')}`;
}

function describeProduct(e: ProductEntity): string {
  return `${e.label}: ${[
    e.type,
    e.shape,
    e.color,
    e.material,
    e.packaging && `packaging: ${e.packaging}`,
    e.labelDetails && `label: ${e.labelDetails}`,
    e.relativeSize,
    e.distinctiveDetails,
  ].filter(Boolean).join(', ')}`;
}

function describeLocation(e: LocationEntity): string {
  return `${e.label}: ${[
    e.environmentType,
    e.architectureInterior,
    e.keyColors && `colors: ${e.keyColors}`,
    e.lighting && `lighting: ${e.lighting}`,
    e.recurringProps && `recurring props: ${e.recurringProps}`,
  ].filter(Boolean).join(', ')}`;
}

function composeEntityAwarePrompt(
  style: string,
  visualBible: VisualBible,
  entityRefs: EntityRefs,
  imagePrompt: string,
  sceneDescriptionFallback: string,
  cameraDirectionFallback: string,
  usingReference: boolean,
): string {
  const characters = (visualBible.characters ?? []).filter((c) => (entityRefs.characters ?? []).includes(c.id));
  const products = (visualBible.products ?? []).filter((p) => (entityRefs.products ?? []).includes(p.id));
  const location = (visualBible.locations ?? []).find((l) => l.id === entityRefs.location);

  // imagePrompt is the English, model-facing field (see ai-director's language policy). Older cuts created
  // before this field existed fall back to the (possibly Korean) display fields rather than sending nothing.
  const sceneVisual = imagePrompt.trim().length > 0
    ? imagePrompt.trim()
    : [sceneDescriptionFallback.trim(), cameraDirectionFallback.trim()].filter((p) => p.length > 0).join(', ');

  const parts = [
    STYLE_MODIFIERS[style],
    visualBible.globalStyle,
    ...characters.map(describeCharacter),
    ...products.map(describeProduct),
    location ? describeLocation(location) : null,
    sceneVisual,
    (entityRefs.characters?.length || entityRefs.products?.length)
      ? 'Preserve the exact identity, face, hairstyle, outfit, and packaging described above; only pose, ' +
        'action, framing, and camera angle should follow the scene description.'
      : null,
    usingReference
      ? `IMPORTANT — art style override: render this image strictly in the following visual style: ` +
        `${STYLE_MODIFIERS[style]}. The reference images are provided ONLY to preserve character/product/` +
        `location identity (face, hairstyle, outfit, packaging, background layout) — do not copy their ` +
        `medium, color palette, rendering technique, or level of realism. If the reference images and this ` +
        `style instruction conflict on anything other than identity, this style instruction wins.`
      : null,
  ];
  return parts.filter((p): p is string => !!p && p.length > 0).join(', ');
}

function collectReferenceImageUrls(visualBible: VisualBible, entityRefs: EntityRefs): string[] {
  const urls: string[] = [];
  for (const id of entityRefs.characters ?? []) {
    const url = visualBible.characters?.find((c) => c.id === id)?.referenceImageUrl;
    if (url) urls.push(url);
  }
  for (const id of entityRefs.products ?? []) {
    const url = visualBible.products?.find((p) => p.id === id)?.referenceImageUrl;
    if (url) urls.push(url);
  }
  if (entityRefs.location) {
    const url = visualBible.locations?.find((l) => l.id === entityRefs.location)?.referenceImageUrl;
    if (url) urls.push(url);
  }
  return [...new Set(urls)].slice(0, 4);
}

function withLockedReferenceImages(visualBible: VisualBible, entityRefs: EntityRefs, imageUrl: string): VisualBible {
  const characterIds = new Set(entityRefs.characters ?? []);
  const productIds = new Set(entityRefs.products ?? []);
  return {
    ...visualBible,
    characters: (visualBible.characters ?? []).map((c) =>
      characterIds.has(c.id) && !c.referenceImageUrl ? { ...c, referenceImageUrl: imageUrl } : c
    ),
    products: (visualBible.products ?? []).map((p) =>
      productIds.has(p.id) && !p.referenceImageUrl ? { ...p, referenceImageUrl: imageUrl } : p
    ),
    locations: (visualBible.locations ?? []).map((l) =>
      l.id === entityRefs.location && !l.referenceImageUrl ? { ...l, referenceImageUrl: imageUrl } : l
    ),
  };
}

async function generateViaText(prompt: string, size: string): Promise<string> {
  const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 }),
  });
  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    throw new Error(`openai error: ${errText}`);
  }
  const openaiJson = await openaiRes.json();
  const b64 = openaiJson.data?.[0]?.b64_json;
  if (!b64) throw new Error('openai: no image returned');
  return b64;
}

async function generateViaReference(prompt: string, size: string, referenceUrls: string[]): Promise<string> {
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', size);
  for (let i = 0; i < referenceUrls.length; i++) {
    const imgRes = await fetch(referenceUrls[i]);
    if (!imgRes.ok) throw new Error(`failed to fetch reference image ${referenceUrls[i]}`);
    const blob = await imgRes.blob();
    form.append('image[]', blob, `reference-${i}.png`);
  }
  const openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
    body: form,
  });
  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    throw new Error(`openai edits error: ${errText}`);
  }
  const openaiJson = await openaiRes.json();
  const b64 = openaiJson.data?.[0]?.b64_json;
  if (!b64) throw new Error('openai edits: no image returned');
  return b64;
}

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

  let cutId: string | undefined;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    ({ cutId } = await req.json());
    if (!cutId) return jsonResponse({ error: 'cutId required' }, 400);

    const { data: cut, error: cutError } = await supabase.from('cuts').select('*').eq('id', cutId).single();
    if (cutError || !cut) return jsonResponse({ error: 'cut not found' }, 404);

    const { data: project, error: projectError } = await supabase
      .from('projects').select('*').eq('id', cut.project_id).single();
    if (projectError || !project) return jsonResponse({ error: 'project not found' }, 404);

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: 'unauthorized' }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user || userData.user.id !== project.user_id) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }

    await supabase.from('cuts').update({ generation_status: 'generating' }).eq('id', cutId);

    const visualBible: VisualBible = (project.visual_bible as VisualBible) ?? {};
    const entityRefs: EntityRefs = (cut.entity_refs as EntityRefs) ?? {};

    const size = IMAGE_SIZE_BY_ASPECT_RATIO[project.aspect_ratio as string] ?? '1024x1024';
    const referenceUrls = collectReferenceImageUrls(visualBible, entityRefs);
    const prompt = composeEntityAwarePrompt(
      project.style, visualBible, entityRefs, (cut.image_prompt as string) ?? '', cut.scene_description,
      cut.camera_direction, referenceUrls.length > 0,
    );

    let b64: string;
    try {
      b64 = referenceUrls.length > 0
        ? await generateViaReference(prompt, size, referenceUrls)
        : await generateViaText(prompt, size);
    } catch (primaryErr) {
      if (referenceUrls.length === 0) {
        await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
        return jsonResponse({ error: String(primaryErr) }, 502);
      }
      console.error('reference-based generation failed, falling back to text-only', String(primaryErr));
      try {
        b64 = await generateViaText(prompt, size);
      } catch (fallbackErr) {
        await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
        return jsonResponse({ error: String(fallbackErr) }, 502);
      }
    }

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `${cut.project_id}/${cut.id}-${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from('storyboard-images')
      .upload(path, bytes, { contentType: 'image/png', upsert: true });
    if (uploadError) {
      await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
      return jsonResponse({ error: uploadError.message }, 500);
    }

    const { data: publicUrlData } = supabase.storage.from('storyboard-images').getPublicUrl(path);
    const imageUrl = publicUrlData.publicUrl;

    await supabase.from('cuts').update({ image_url: imageUrl, generation_status: 'done' }).eq('id', cutId);

    const hasEntities = (entityRefs.characters?.length ?? 0) > 0 || (entityRefs.products?.length ?? 0) > 0 || !!entityRefs.location;
    if (hasEntities) {
      const updatedBible = withLockedReferenceImages(visualBible, entityRefs, imageUrl);
      await supabase.from('projects').update({ visual_bible: updatedBible }).eq('id', project.id);
    }

    return jsonResponse({ imageUrl }, 200);
  } catch (err) {
    if (cutId) {
      try {
        await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
      } catch {
        // Swallow cleanup errors — reporting the original error takes priority.
      }
    }
    return jsonResponse({ error: String(err) }, 500);
  }
});
