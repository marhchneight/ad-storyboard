import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Cut } from '../types';

export function useCuts(projectId: string) {
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('cuts').select('*').eq('project_id', projectId).order('order_index');
    if (!error) setCuts(data as Cut[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function updateCut(id: string, patch: Partial<Cut>) {
    const { error } = await supabase.from('cuts').update(patch).eq('id', id);
    if (error) throw error;
    await refresh();
  }

  async function generateImage(cutId: string) {
    setCuts((prev) => prev.map((c) => c.id === cutId ? { ...c, generation_status: 'generating' } : c));
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutId }),
      }
    );
    if (!res.ok) {
      setCuts((prev) => prev.map((c) => c.id === cutId ? { ...c, generation_status: 'failed' } : c));
      const body = await res.json().catch(() => ({ error: 'unknown error' }));
      throw new Error(body.error ?? 'image generation failed');
    }
    await refresh();
  }

  const MIN_CUTS = 2;

  async function addCut() {
    const nextIndex = cuts.length;
    const { error } = await supabase.from('cuts').insert({ project_id: projectId, order_index: nextIndex });
    if (error) throw error;
    await refresh();
  }

  async function removeCut(id: string) {
    if (cuts.length <= MIN_CUTS) {
      throw new Error(`컷은 최소 ${MIN_CUTS}개 이상이어야 합니다.`);
    }
    const { error } = await supabase.from('cuts').delete().eq('id', id);
    if (error) throw error;
    const remaining = cuts.filter((c) => c.id !== id).sort((a, b) => a.order_index - b.order_index);
    await Promise.all(remaining.map((c, i) => supabase.from('cuts').update({ order_index: i }).eq('id', c.id)));
    await refresh();
  }

  async function reorderCuts(orderedIds: string[]) {
    await Promise.all(orderedIds.map((id, i) => supabase.from('cuts').update({ order_index: i }).eq('id', id)));
    await refresh();
  }

  /**
   * Restores the storyboard to a previously captured snapshot (used for Undo after an
   * AI-driven whole-storyboard edit). Reconciles by id: existing rows are updated in place,
   * rows present in the snapshot but missing now are re-inserted with their original id,
   * and rows present now but absent from the snapshot are deleted.
   */
  async function restoreSnapshot(snapshot: Cut[]) {
    const currentIds = new Set(cuts.map((c) => c.id));
    const snapshotIds = new Set(snapshot.map((c) => c.id));

    for (const cut of snapshot) {
      const fields = {
        order_index: cut.order_index,
        scene_description: cut.scene_description,
        dialogue: cut.dialogue,
        camera_direction: cut.camera_direction,
        image_url: cut.image_url,
        generation_status: cut.generation_status,
        duration_seconds: cut.duration_seconds,
        shot_size: cut.shot_size,
        lens: cut.lens,
        angle: cut.angle,
        movement: cut.movement,
        composition: cut.composition,
        action: cut.action,
        lighting: cut.lighting,
        mood: cut.mood,
        location: cut.location,
        props: cut.props,
        sfx: cut.sfx,
        transition: cut.transition,
        purpose: cut.purpose,
        image_prompt: cut.image_prompt,
        entity_refs: cut.entity_refs,
        applied_creative_dna: cut.applied_creative_dna,
        creative_dna_application_note: cut.creative_dna_application_note,
        scene_role: cut.scene_role,
      };
      if (currentIds.has(cut.id)) {
        await supabase.from('cuts').update(fields).eq('id', cut.id);
      } else {
        await supabase.from('cuts').insert({ id: cut.id, project_id: projectId, ...fields });
      }
    }

    const toDelete = cuts.filter((c) => !snapshotIds.has(c.id)).map((c) => c.id);
    if (toDelete.length > 0) {
      await supabase.from('cuts').delete().in('id', toDelete);
    }

    await refresh();
  }

  return { cuts, loading, updateCut, generateImage, refresh, addCut, removeCut, reorderCuts, restoreSnapshot };
}
