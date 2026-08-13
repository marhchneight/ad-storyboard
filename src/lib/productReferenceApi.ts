import { supabase } from './supabaseClient';

export interface ProductReferenceUploadResult {
  url: string;
  path: string;
}

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Client-side check only — a UX nicety, not a security boundary. The edge function's magic-byte check is the real gate. */
export function isAcceptableProductReferenceFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) return 'PNG, JPEG, WEBP 형식의 이미지만 업로드할 수 있어요.';
  if (file.size > MAX_UPLOAD_BYTES) return '이미지 파일은 최대 5MB까지 업로드할 수 있어요.';
  return null;
}

export async function uploadProductReference(file: File): Promise<ProductReferenceUploadResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');

  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-product-reference`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: '이미지 업로드에 실패했습니다.' }));
    throw new Error(body.error ?? '이미지 업로드에 실패했습니다.');
  }

  return (await res.json()) as ProductReferenceUploadResult;
}

/**
 * Recovers the storage path from a product-references public URL, for callers (like the
 * post-creation replace/delete UI) that only have the stored referenceImageUrl, not the path
 * returned at upload time. Returns null for anything that isn't a recognizable
 * product-references public URL, so callers can skip cleanup rather than guess.
 */
export function pathFromProductReferenceUrl(url: string): string | null {
  const marker = '/product-references/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

/** Best-effort cleanup — callers should not block the user's flow on this failing. */
export async function deleteProductReference(path: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return;

  await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-product-reference`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }).catch(() => {});
}
