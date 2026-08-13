// Sanitizes error responses so raw upstream (OpenAI, etc.) error text and
// unexpected exception details never reach the client, while still logging
// the full detail server-side (visible in Supabase function logs) for
// debugging.
//
// `error` is kept as a plain string on every returned shape so existing
// frontend wrappers (`json.error ?? fallback` -> `throw new Error(...)`)
// keep working unchanged. `code`/`message` are additive.

export interface SafeErrorBody {
  error: string;
  code: string;
  message: string;
}

const GENERIC_AI_MESSAGE = 'AI 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
const GENERIC_UNEXPECTED_MESSAGE = '요청을 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';

/**
 * Use for upstream AI/API provider failures (e.g. a non-OK OpenAI response).
 * Pass the raw error text for server-side logging only — it is never
 * included in the returned body.
 */
export function sanitizeUpstreamError(rawDetail: unknown, context: string): SafeErrorBody {
  console.error(`[${context}] upstream error:`, rawDetail);
  return { error: GENERIC_AI_MESSAGE, code: 'AI_PROVIDER_ERROR', message: GENERIC_AI_MESSAGE };
}

/**
 * Use for the generic outer-catch(err) path — an exception whose message
 * might contain internal detail (stack fragments, DB error text, etc.).
 */
export function sanitizeUnexpectedError(err: unknown, context: string): SafeErrorBody {
  console.error(`[${context}] unexpected error:`, err);
  return { error: GENERIC_UNEXPECTED_MESSAGE, code: 'INTERNAL_ERROR', message: GENERIC_UNEXPECTED_MESSAGE };
}
