import { describe, it, expect } from 'vitest';
import { normalizePhone, tenDigitSuffix, suffixesMatch, toDialFormat } from './phone.js';

describe('phone normalization', () => {
  it('normalizePhone strips non-digits', () => {
    expect(normalizePhone('+1 (972) 555-0199')).toBe('19725550199');
    expect(normalizePhone('  972.555.0199  ')).toBe('9725550199');
    expect(normalizePhone('')).toBe('');
  });

  it('tenDigitSuffix returns last 10 digits', () => {
    expect(tenDigitSuffix('+1 (972) 555-0199')).toBe('9725550199');
    expect(tenDigitSuffix('9725550199')).toBe('9725550199');
    expect(tenDigitSuffix('555-0199')).toBe('5550199');
  });

  it('suffixesMatch defuses formatting drift but requires real digits', () => {
    expect(suffixesMatch('+1 972 555 0199', '(972) 555-0199')).toBe(true);
    expect(suffixesMatch('972-555-0199', '972.555.0198')).toBe(false);
    expect(suffixesMatch('', '9725550199')).toBe(false);
    expect(suffixesMatch('!!!', '9725550199')).toBe(false);
  });

  it('toDialFormat coerces US 10-digit input to +1XXX form', () => {
    expect(toDialFormat('9725550199')).toBe('+19725550199');
    expect(toDialFormat('+19725550199')).toBe('+19725550199');
    expect(toDialFormat('(972) 555-0199')).toBe('+19725550199');
    expect(toDialFormat('+44 20 7946 0958')).toBe('+442079460958');
    expect(toDialFormat('')).toBe('');
  });
});
