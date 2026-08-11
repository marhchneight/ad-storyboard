import { supabase } from './supabaseClient';
import { askTheDirector } from './directorApi';
import type { CreativeDna } from '../types';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Analyzes a reference (image data URL / remote image URL, or a text description) into a Creative DNA profile. */
export async function analyzeCreativeDna(
  projectId: string | undefined,
  input: { imageUrl?: string; textDescription?: string }
): Promise<CreativeDna> {
  const headers = await authHeader();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/creative-dna`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ projectId, ...input }),
  });
  const json = await res.json().catch(() => ({ error: '분석에 실패했습니다.' }));
  if (!res.ok) throw new Error(json.error ?? '분석에 실패했습니다.');
  return json.dna as CreativeDna;
}

function summarizeDna(dna: CreativeDna): string {
  const parts = [
    dna.cameraDna.length > 0 ? `카메라: ${dna.cameraDna.join('; ')}` : null,
    dna.lightingDna.length > 0 ? `조명: ${dna.lightingDna.join('; ')}` : null,
    dna.compositionDna.length > 0 ? `구도: ${dna.compositionDna.join('; ')}` : null,
    dna.editRhythmDna.length > 0 ? `편집 리듬: ${dna.editRhythmDna.join('; ')}` : null,
    dna.colorMood.length > 0 ? `색감/무드: ${dna.colorMood.join('; ')}` : null,
    dna.creativePrinciples.length > 0 ? `연출 원칙: ${dna.creativePrinciples.join('; ')}` : null,
  ].filter((p): p is string => p !== null);
  return parts.join('\n');
}

/**
 * Applies a previously analyzed Creative DNA to the current storyboard: framing, camera language,
 * pacing, lighting, composition, and mood only — product, message, and narrative stay unchanged.
 */
export async function applyCreativeDna(projectId: string, dna: CreativeDna): Promise<string[]> {
  const instruction =
    `아래 Creative DNA를 참고해서 이 스토리보드를 재연출하세요. Do not imitate or recreate the reference ` +
    `literally — 제품, 메시지, 내러티브, 타깃은 그대로 유지하고 framing/camera language/pacing/lighting/` +
    `composition/mood/visual storytelling만 이 DNA에 맞게 바꾸세요.\n\n${summarizeDna(dna)}`;
  return askTheDirector(projectId, instruction);
}
