import { supabase } from './supabaseClient';
import type { CreativeExample } from '../types';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/**
 * Fetches 5 trend-aware, storyboard-ready ad idea examples. `avoid` (the
 * text of the currently-shown batch) steers the server toward a genuinely
 * different set of creative directions on refresh, rather than reshuffling
 * the same pool. The edge function always returns 5 usable examples — even
 * on an AI/trend-research failure it falls back to a curated pool — so this
 * only throws on a network-level failure or an auth problem.
 */
export async function fetchCreativeExamples(avoid: string[] = []): Promise<CreativeExample[]> {
  const headers = await authHeader();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/idea-recommendations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ avoid }),
  });
  const json = await res.json().catch(() => ({ error: '아이디어 예시를 가져오지 못했습니다.' }));
  if (!res.ok) throw new Error(json.error ?? '아이디어 예시를 가져오지 못했습니다.');
  return json.examples as CreativeExample[];
}
