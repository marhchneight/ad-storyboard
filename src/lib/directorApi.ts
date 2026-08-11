import { supabase } from './supabaseClient';

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

export type DirectorPreset = 'more_cinematic' | 'more_commercial' | 'more_genz' | 'more_emotional' | 'more_minimal';

export const DIRECTOR_PRESETS: { id: DirectorPreset; label: string; description: string }[] = [
  { id: 'more_cinematic', label: '시네마틱하게', description: '느린 호흡, 강한 구도, 시네마틱 렌즈' },
  { id: 'more_commercial', label: '커머셜하게', description: '제품 노출 강화, 명확한 메시지' },
  { id: 'more_genz', label: 'Gen-Z 감성으로', description: '핸드헬드, 빠른 리듬, 소셜 감각' },
  { id: 'more_emotional', label: '감성적으로', description: '클로즈업, 감정적 여백' },
  { id: 'more_minimal', label: '미니멀하게', description: '컷 축소, 절제된 구성' },
];

/** Re-directs the whole storyboard toward a named preset direction. Returns a short changes summary. */
export async function applyDirectorPreset(projectId: string, preset: DirectorPreset): Promise<string[]> {
  const json = await postJson('storyboard-editor', { projectId, preset });
  return (json.changes as string[]) ?? [];
}

/** Re-directs the whole storyboard following a free-form natural-language instruction. */
export async function askTheDirector(projectId: string, instruction: string): Promise<string[]> {
  const json = await postJson('storyboard-editor', { projectId, instruction });
  return (json.changes as string[]) ?? [];
}

/** Pushes the storyboard toward a bolder, higher creative-risk reinterpretation (same product/message). */
export async function applyMakeItCrazy(projectId: string): Promise<string[]> {
  const json = await postJson('storyboard-editor', { projectId, preset: 'make_it_crazy' });
  return (json.changes as string[]) ?? [];
}

export type ShotQuickAction =
  | 'reframe' | 'change_lens' | 'change_angle' | 'more_cinematic'
  | 'more_product_focused' | 'simplify' | 'surprise_me' | 'rewrite';

export const SHOT_QUICK_ACTIONS: { id: ShotQuickAction; label: string }[] = [
  { id: 'reframe', label: '리프레임' },
  { id: 'change_lens', label: '렌즈 변경' },
  { id: 'change_angle', label: '카메라 앵글 변경' },
  { id: 'more_cinematic', label: '더 시네마틱하게' },
  { id: 'more_product_focused', label: '제품에 집중하게' },
  { id: 'simplify', label: '단순하게' },
  { id: 'surprise_me', label: '의외의 연출로' },
  { id: 'rewrite', label: '샷 다시쓰기' },
];

/** Revises a single shot in place, via a quick action or a free-form instruction. */
export async function editShot(cutId: string, opts: { action?: ShotQuickAction; instruction?: string }): Promise<void> {
  await postJson('shot-editor', { cutId, action: opts.action, instruction: opts.instruction });
}
