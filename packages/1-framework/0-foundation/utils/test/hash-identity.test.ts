import { describe, expect, it } from 'vitest';
import { hashIdentity } from '../src/hash-identity';

describe('hashIdentity', () => {
  describe('output format', () => {
    it('produces a string prefixed with the algorithm tag', () => {
      const digest = hashIdentity('hello');
      expect(digest.startsWith('blake2b512:')).toBe(true);
    });

    it('produces a hex digest of exactly 128 characters after the prefix', () => {
      const digest = hashIdentity('hello');
      const hex = digest.slice('blake2b512:'.length);
      expect(hex).toMatch(/^[0-9a-f]{128}$/);
    });

    it('always produces a fixed total length regardless of input size', () => {
      const small = hashIdentity('x');
      const large = hashIdentity('x'.repeat(10_000_000));
      expect(small.length).toBe(large.length);
      expect(small.length).toBe('blake2b512:'.length + 128);
    });
  });

  describe('determinism', () => {
    it('returns the same digest for identical input across repeated calls', () => {
      const input = 'sha256:abc|select 1|[42]';
      const first = hashIdentity(input);
      const second = hashIdentity(input);
      const third = hashIdentity(input);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('handles empty input deterministically', () => {
      const a = hashIdentity('');
      const b = hashIdentity('');
      expect(a).toBe(b);
      expect(a).toMatch(/^blake2b512:[0-9a-f]{128}$/);
    });
  });

  describe('discrimination', () => {
    it('produces different digests for different inputs', () => {
      expect(hashIdentity('a')).not.toBe(hashIdentity('b'));
      expect(hashIdentity('select 1')).not.toBe(hashIdentity('select 2'));
    });

    it('discriminates inputs that differ only in a trailing character', () => {
      expect(hashIdentity('hello')).not.toBe(hashIdentity('hello!'));
    });

    it('discriminates inputs that differ only in case', () => {
      expect(hashIdentity('Hello')).not.toBe(hashIdentity('hello'));
    });

    it('discriminates inputs that differ in separator placement', () => {
      // The canonical-string composition uses '|' as a separator. Make sure
      // shifting a separator boundary produces a distinct digest, so a
      // pathological input cannot collide with a different decomposition.
      expect(hashIdentity('a|bc')).not.toBe(hashIdentity('ab|c'));
    });
  });

  describe('opacity', () => {
    it('does not embed the original input in its output', () => {
      const secret = 'super-secret-token-1234567890';
      const digest = hashIdentity(secret);
      expect(digest).not.toContain(secret);
    });

    it('does not leak large payload contents in its output', () => {
      const payload = 'x'.repeat(1024);
      const digest = hashIdentity(payload);
      expect(digest).not.toContain(payload);
      expect(digest.length).toBeLessThan(payload.length);
    });
  });

  describe('input handling', () => {
    it('handles UTF-8 multi-byte input', () => {
      const digest = hashIdentity('café — 日本語 — 🚀');
      expect(digest).toMatch(/^blake2b512:[0-9a-f]{128}$/);
    });

    it('discriminates between equivalent strings with different normalization', () => {
      // U+00E9 (single composed code point) vs. U+0065 U+0301 (e + combining
      // acute accent). They render the same but are distinct byte sequences,
      // and hashIdentity hashes bytes — not normalized text.
      const composed = 'caf\u00e9';
      const decomposed = 'cafe\u0301';
      expect(hashIdentity(composed)).not.toBe(hashIdentity(decomposed));
    });
  });
});
