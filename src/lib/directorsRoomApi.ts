import { supabase } from './supabaseClient';
import type { CreativeBrief, CreativeDna, CreativeRisk, CreativeTreatment, DirectingOption } from '../types';

/** Director's Room: proposes 3 distinct directing approaches for an already-decided idea/treatment. */
export async function generateDirectingOptions(input: {
  freeformIdea?: string;
  brief?: CreativeBrief;
  dna?: CreativeDna;
  treatment: CreativeTreatment;
  creativeRisk: CreativeRisk;
}): Promise<DirectingOption[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/directors-room`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const json = await res.json().catch(() => ({ error: '연출 방향을 만드는 데 실패했습니다.' }));
  if (!res.ok) throw new Error((json.error as string) ?? '연출 방향을 만드는 데 실패했습니다.');
  return json.options as DirectingOption[];
}
