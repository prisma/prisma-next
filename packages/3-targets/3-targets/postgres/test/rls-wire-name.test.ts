import { describe, expect, it } from 'vitest';
import { formatRlsPolicyWireName, parseRlsPolicyWireName } from '../src/core/rls/wire-name';

describe('formatRlsPolicyWireName', () => {
  it('joins prefix and hash with an underscore', () => {
    expect(formatRlsPolicyWireName('p_read', 'ab12cd34')).toBe('p_read_ab12cd34');
  });

  it('parse ∘ format round-trips (one module owns the format)', () => {
    for (const [prefix, hash] of [
      ['p_read', 'ab12cd34'],
      ['read_own_profiles', 'deadbeef'],
    ] as const) {
      expect(parseRlsPolicyWireName(formatRlsPolicyWireName(prefix, hash))).toEqual({
        prefix,
        hash,
      });
    }
  });
});

describe('parseRlsPolicyWireName', () => {
  it('splits a wire name into prefix and hash', () => {
    expect(parseRlsPolicyWireName('p_read_ab12cd34')).toEqual({
      prefix: 'p_read',
      hash: 'ab12cd34',
    });
  });

  it('keeps underscores inside the prefix (only the final segment is the hash)', () => {
    expect(parseRlsPolicyWireName('read_own_profiles_deadbeef')).toEqual({
      prefix: 'read_own_profiles',
      hash: 'deadbeef',
    });
  });

  it('returns undefined for a name without a hash suffix', () => {
    expect(parseRlsPolicyWireName('handwritten_policy')).toBeUndefined();
  });

  it('returns undefined when the suffix is not exactly 8 hex characters', () => {
    expect(parseRlsPolicyWireName('p_read_abc')).toBeUndefined();
    expect(parseRlsPolicyWireName('p_read_ab12cd345')).toBeUndefined();
    expect(parseRlsPolicyWireName('p_read_ab12cdZZ')).toBeUndefined();
  });

  it('returns undefined for uppercase hex (wire hashes are lowercase)', () => {
    expect(parseRlsPolicyWireName('p_read_AB12CD34')).toBeUndefined();
  });

  it('returns undefined for a bare hash with no prefix', () => {
    expect(parseRlsPolicyWireName('_ab12cd34')).toBeUndefined();
    expect(parseRlsPolicyWireName('ab12cd34')).toBeUndefined();
  });
});
