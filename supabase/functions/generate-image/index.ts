import { createClient } from 'jsr:@supabase/supabase-js@2';

const STYLE_MODIFIERS: Record<string, string> = {
  sketch: 'black and white pencil sketch storyboard style, rough hand-drawn line art',
  animation: 'flat 2D animation illustration style, vibrant colors, cartoon character design',
  live_action: 'photorealistic cinematic film still, realistic lighting, live action',
};

function composePrompt(style: string, overallPrompt: string, sceneDescription: string, cameraDirection: string) {
  return [STYLE_MODIFIERS[style], overallPrompt.trim(), sceneDescription.trim(), cameraDirection.trim()]
    .filter((p) => p.length > 0)
    .join(', ');
}

Deno.serve(async (req) => {
  try {
    const { cutId } = await req.json();
    if (!cutId) return new Response(JSON.stringify({ error: 'cutId required' }), { status: 400 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: cut, error: cutError } = await supabase.from('cuts').select('*').eq('id', cutId).single();
    if (cutError || !cut) return new Response(JSON.stringify({ error: 'cut not found' }), { status: 404 });

    const { data: project, error: projectError } = await supabase
      .from('projects').select('*').eq('id', cut.project_id).single();
    if (projectError || !project) return new Response(JSON.stringify({ error: 'project not found' }), { status: 404 });

    await supabase.from('cuts').update({ generation_status: 'generating' }).eq('id', cutId);

    const prompt = composePrompt(project.style, project.overall_prompt, cut.scene_description, cut.camera_direction);

    const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', n: 1 }),
    });

    if (!openaiRes.ok) {
      await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
      const errText = await openaiRes.text();
      return new Response(JSON.stringify({ error: `openai error: ${errText}` }), { status: 502 });
    }

    const openaiJson = await openaiRes.json();
    const b64 = openaiJson.data[0].b64_json;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `${cut.project_id}/${cut.id}-${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from('storyboard-images')
      .upload(path, bytes, { contentType: 'image/png', upsert: true });
    if (uploadError) {
      await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
      return new Response(JSON.stringify({ error: uploadError.message }), { status: 500 });
    }

    const { data: publicUrlData } = supabase.storage.from('storyboard-images').getPublicUrl(path);
    const imageUrl = publicUrlData.publicUrl;

    await supabase.from('cuts').update({ image_url: imageUrl, generation_status: 'done' }).eq('id', cutId);

    return new Response(JSON.stringify({ imageUrl }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
