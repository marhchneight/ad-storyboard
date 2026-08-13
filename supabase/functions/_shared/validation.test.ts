import { describe, it, expect } from 'vitest';
import {
  validateUuid,
  validateEnum,
  validateString,
  validateStringArray,
  validateNumber,
  validateUrl,
} from './validation';

describe('validateUuid', () => {
  it('accepts a well-formed UUID', () => {
    expect(validateUuid('550e8400-e29b-41d4-a716-446655440000', 'cutId')).toBeNull();
  });

  it('rejects a malformed UUID', () => {
    expect(validateUuid('not-a-uuid', 'cutId')).not.toBeNull();
  });

  it('rejects a non-string value', () => {
    expect(validateUuid(123, 'cutId')).not.toBeNull();
  });
});

describe('validateEnum', () => {
  it('accepts an allowed value', () => {
    expect(validateEnum('sketch', ['sketch', 'animation'] as const, 'style')).toBeNull();
  });

  it('rejects a disallowed value', () => {
    expect(validateEnum('oil_painting', ['sketch', 'animation'] as const, 'style')).not.toBeNull();
  });
});

describe('validateString', () => {
  it('allows a value under the max length', () => {
    expect(validateString('hello', 'title', { maxLength: 200 })).toBeNull();
  });

  it('rejects a value over the max length (oversized instruction)', () => {
    const oversized = 'a'.repeat(4001);
    expect(validateString(oversized, 'instruction', { maxLength: 4000 })).not.toBeNull();
  });

  it('rejects a value over the max length (oversized copyText)', () => {
    const oversized = 'a'.repeat(20001);
    expect(validateString(oversized, 'copyText', { maxLength: 20000 })).not.toBeNull();
  });

  it('allows undefined when not required', () => {
    expect(validateString(undefined, 'instruction', { maxLength: 4000 })).toBeNull();
  });

  it('rejects missing value when required', () => {
    expect(validateString(undefined, 'title', { maxLength: 200, required: true })).not.toBeNull();
  });

  it('rejects a non-string value', () => {
    expect(validateString(42, 'title', { maxLength: 200 })).not.toBeNull();
  });
});

describe('validateStringArray', () => {
  it('allows an array within limits', () => {
    expect(validateStringArray(['a', 'b'], 'avoid', { maxItems: 10, maxItemLength: 300 })).toBeNull();
  });

  it('rejects an array exceeding maxItems', () => {
    const arr = Array.from({ length: 11 }, (_, i) => `item-${i}`);
    expect(validateStringArray(arr, 'avoid', { maxItems: 10, maxItemLength: 300 })).not.toBeNull();
  });

  it('rejects an item exceeding maxItemLength', () => {
    expect(
      validateStringArray(['a'.repeat(301)], 'avoid', { maxItems: 10, maxItemLength: 300 })
    ).not.toBeNull();
  });

  it('rejects a non-array value', () => {
    expect(validateStringArray('not-an-array', 'avoid', { maxItems: 10, maxItemLength: 300 })).not.toBeNull();
  });
});

describe('validateNumber', () => {
  it('allows a number within range', () => {
    expect(validateNumber(15, 'requestedSceneCount', { min: 1, max: 30, integer: true })).toBeNull();
  });

  it('rejects a number below min', () => {
    expect(validateNumber(0, 'requestedSceneCount', { min: 1, max: 30 })).not.toBeNull();
  });

  it('rejects a non-integer when integer required', () => {
    expect(validateNumber(1.5, 'requestedSceneCount', { integer: true })).not.toBeNull();
  });
});

describe('validateUrl', () => {
  it('accepts a well-formed URL', () => {
    expect(validateUrl('https://example.com/image.png', 'imageUrl')).toBeNull();
  });

  it('rejects a malformed URL', () => {
    expect(validateUrl('not a url', 'imageUrl')).not.toBeNull();
  });

  it('rejects a URL over the max length', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2048);
    expect(validateUrl(longUrl, 'imageUrl', { maxLength: 2048 })).not.toBeNull();
  });
});
