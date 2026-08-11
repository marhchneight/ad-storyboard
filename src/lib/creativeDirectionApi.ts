import { supabase } from './supabaseClient';
import type { CreativeBrief, CreativeConcept, CreativeDna, CreativeTreatment, SceneCountMode } from '../types';

export interface SceneCountParams {
  sceneCountMode: SceneCountMode;
  requestedSceneCount?: number;
  targetDurationSeconds?: number;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function postJson(fn: string, body: unknown): Promise<{ [key: string]: unknown }> {
  const headers = await authHeader();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: '요청 처리에 실패했습니다.' }));
  if (!res.ok) throw new Error((json.error as string) ?? '요청 처리에 실패했습니다.');
  return json;
}

/** Generates a first Creative Direction treatment from a rough idea / brief (optionally informed by a Creative DNA reference). */
export async function generateCreativeDirection(input: {
  freeformIdea?: string;
  brief?: CreativeBrief;
  dna?: CreativeDna;
} & Partial<SceneCountParams>): Promise<CreativeTreatment> {
  const json = await postJson('creative-direction', { mode: 'generate', ...input });
  return json.treatment as CreativeTreatment;
}

/** Proposes a fresh, distinctly different Creative Direction for the same brief. */
export async function regenerateCreativeDirection(input: {
  freeformIdea?: string;
  brief?: CreativeBrief;
  dna?: CreativeDna;
  previousTreatment: CreativeTreatment;
} & Partial<SceneCountParams>): Promise<CreativeTreatment> {
  const json = await postJson('creative-direction', { mode: 'regenerate', ...input });
  return json.treatment as CreativeTreatment;
}

/** Revises the current Creative Direction per a free-form instruction ("Tell the Director what to change"). */
export async function reviseCreativeDirection(input: {
  previousTreatment: CreativeTreatment;
  instruction: string;
}): Promise<CreativeTreatment> {
  const json = await postJson('creative-direction', { mode: 'revise', ...input });
  return json.treatment as CreativeTreatment;
}

/** "Inspire Me": proposes 3 distinct creative concepts for a product with no idea yet. */
export async function suggestConcepts(input: {
  product: string;
  mood?: string;
  platform?: string;
  targetAudience?: string;
}): Promise<CreativeConcept[]> {
  const json = await postJson('creative-concepts', input);
  return json.concepts as CreativeConcept[];
}
