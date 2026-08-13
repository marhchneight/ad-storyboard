// Server-side request-body validation shared by every Edge Function.
// Plain, portable TypeScript (no Deno-specific globals) so it can be
// unit-tested with Vitest and imported unmodified from Deno at runtime.
//
// Every validator returns a Korean error message string on failure, or
// `null` when the value is valid — this matches the existing
// `jsonResponse({ error: '...' }, 400)` convention used across all
// functions, so callers just do:
//   const err = validateString(idea, '아이디어', { maxLength: 10_000 });
//   if (err) return jsonResponse({ error: err }, 400);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUuid(value: unknown, fieldName: string): string | null {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    return `${fieldName}이(가) 올바른 형식이 아닙니다.`;
  }
  return null;
}

export function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string
): string | null {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return `${fieldName} 값이 올바르지 않습니다.`;
  }
  return null;
}

export interface StringOptions {
  maxLength: number;
  required?: boolean;
  minLength?: number;
}

export function validateString(
  value: unknown,
  fieldName: string,
  { maxLength, required = false, minLength = 0 }: StringOptions
): string | null {
  if (value === undefined || value === null || value === '') {
    return required ? `${fieldName}이(가) 필요합니다.` : null;
  }
  if (typeof value !== 'string') {
    return `${fieldName}은(는) 문자열이어야 합니다.`;
  }
  if (value.length < minLength) {
    return `${fieldName}이(가) 너무 짧습니다.`;
  }
  if (value.length > maxLength) {
    return `${fieldName}은(는) 최대 ${maxLength}자까지 입력할 수 있습니다.`;
  }
  return null;
}

export interface StringArrayOptions {
  maxItems: number;
  maxItemLength: number;
  required?: boolean;
}

export function validateStringArray(
  value: unknown,
  fieldName: string,
  { maxItems, maxItemLength, required = false }: StringArrayOptions
): string | null {
  if (value === undefined || value === null) {
    return required ? `${fieldName}이(가) 필요합니다.` : null;
  }
  if (!Array.isArray(value)) {
    return `${fieldName}은(는) 배열이어야 합니다.`;
  }
  if (value.length > maxItems) {
    return `${fieldName}은(는) 최대 ${maxItems}개까지 가능합니다.`;
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.length > maxItemLength) {
      return `${fieldName}의 각 항목은 최대 ${maxItemLength}자의 문자열이어야 합니다.`;
    }
  }
  return null;
}

export interface NumberOptions {
  min?: number;
  max?: number;
  integer?: boolean;
  required?: boolean;
}

export function validateNumber(
  value: unknown,
  fieldName: string,
  { min, max, integer = false, required = false }: NumberOptions
): string | null {
  if (value === undefined || value === null) {
    return required ? `${fieldName}이(가) 필요합니다.` : null;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return `${fieldName}은(는) 숫자여야 합니다.`;
  }
  if (integer && !Number.isInteger(value)) {
    return `${fieldName}은(는) 정수여야 합니다.`;
  }
  if (min !== undefined && value < min) {
    return `${fieldName}은(는) ${min} 이상이어야 합니다.`;
  }
  if (max !== undefined && value > max) {
    return `${fieldName}은(는) ${max} 이하여야 합니다.`;
  }
  return null;
}

export interface UrlOptions {
  maxLength?: number;
  required?: boolean;
}

/**
 * Format/length validation only — this does NOT check whether the URL is
 * safe to fetch server-side. Use `_shared/urlGuard.ts` for any URL the
 * server itself will `fetch()`.
 */
export function validateUrl(
  value: unknown,
  fieldName: string,
  { maxLength = 2048, required = false }: UrlOptions = {}
): string | null {
  if (value === undefined || value === null || value === '') {
    return required ? `${fieldName}이(가) 필요합니다.` : null;
  }
  if (typeof value !== 'string' || value.length > maxLength) {
    return `${fieldName}은(는) 최대 ${maxLength}자의 URL 문자열이어야 합니다.`;
  }
  try {
    new URL(value);
  } catch {
    return `${fieldName}이(가) 올바른 URL 형식이 아닙니다.`;
  }
  return null;
}
