import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sanitizeUnexpectedError } from '../_shared/errors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { sniffImageType, IMAGE_TYPE_EXTENSION, IMAGE_TYPE_MIME } from '../_shared/imageSniff.ts';

const BUCKET = 'product-references';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse({ error: '로그인이 필요합니다.' }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return jsonResponse({ error: '로그인이 필요합니다.' }, 401);
    const userId = userData.user.id;

    if (req.method === 'DELETE') {
      const { path } = await req.json();
      if (typeof path !== 'string' || !path) return jsonResponse({ error: 'path가 필요합니다.' }, 400);
      if (!path.startsWith(`${userId}/`)) return jsonResponse({ error: 'forbidden' }, 403);

      const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
      if (removeError) return jsonResponse(sanitizeUnexpectedError(removeError, 'upload-product-reference-delete'), 500);
      return jsonResponse({ success: true }, 200);
    }

    if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);

    const rateLimit = await checkRateLimit(supabase, userId, 'lightweight_ai');
    if (!rateLimit.allowed) {
      return jsonResponse(
        { error: '업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED', retryAfterSeconds: rateLimit.retryAfterSeconds },
        429,
      );
    }

    const contentLength = Number(req.headers.get('Content-Length') ?? '0');
    if (contentLength > 0 && contentLength > MAX_UPLOAD_BYTES) {
      return jsonResponse({ error: '이미지 파일은 최대 5MB까지 업로드할 수 있습니다.' }, 400);
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return jsonResponse({ error: '파일이 필요합니다.' }, 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonResponse({ error: '이미지 파일은 최대 5MB까지 업로드할 수 있습니다.' }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffImageType(bytes);
    if (!sniffed) {
      return jsonResponse({ error: 'PNG, JPEG, WEBP 형식의 이미지만 업로드할 수 있습니다.' }, 400);
    }

    const path = `${userId}/${crypto.randomUUID()}.${IMAGE_TYPE_EXTENSION[sniffed]}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: IMAGE_TYPE_MIME[sniffed], upsert: false });
    if (uploadError) {
      return jsonResponse(sanitizeUnexpectedError(uploadError, 'upload-product-reference-upload'), 500);
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return jsonResponse({ url: publicUrlData.publicUrl, path }, 200);
  } catch (err) {
    return jsonResponse(sanitizeUnexpectedError(err, 'upload-product-reference'), 500);
  }
});
