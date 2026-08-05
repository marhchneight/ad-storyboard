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

  return { cuts, loading, updateCut, generateImage, refresh, addCut, removeCut, reorderCuts };
}
