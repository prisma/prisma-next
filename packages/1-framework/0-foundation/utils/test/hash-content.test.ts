import { describe, expect, it } from 'vitest';
import { hashContent } from '../src/hash-content';

describe('hashContent', () => {
  describe('output format', () => {
    it('produces a string prefixed with the algorithm tag', () => {
      const digest = hashContent('hello');
      expect(digest.startsWith('blake2b512:')).toBe(true);
    });

    it('produces a hex digest of exactly 128 characters after the prefix', () => {
      const digest = hashContent('hello');
      const hex = digest.slice('blake2b512:'.length);
      expect(hex).toMatch(/^[0-9a-f]{128}$/);
    });

    it('always produces a fixed total length regardless of input size', () => {
      const small = hashContent('x');
      const large = hashContent('x'.repeat(10_000_000));
      expect(small.length).toBe(large.length);
      expect(small.length).toBe('blake2b512:'.length + 128);
    });
  });

  describe('determinism', () => {
    it('returns the same digest for identical input across repeated calls', () => {
      const input = 'sha256:abc|select 1|[42]';
      const first = hashContent(input);
      const second = hashContent(input);
      const third = hashContent(input);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('handles empty input deterministically', () => {
      const a = hashContent('');
      const b = hashContent('');
      expect(a).toBe(b);
      expect(a).toMatch(/^blake2b512:[0-9a-f]{128}$/);
    });
  });

  describe('discrimination', () => {
    it('produces different digests for different inputs', () => {
      expect(hashContent('a')).not.toBe(hashContent('b'));
      expect(hashContent('select 1')).not.toBe(hashContent('select 2'));
    });

    it('discriminates inputs that differ only in a trailing character', () => {
      expect(hashContent('hello')).not.toBe(hashContent('hello!'));
    });

    it('discriminates inputs that differ only in case', () => {
      expect(hashContent('Hello')).not.toBe(hashContent('hello'));
    });

    it('discriminates inputs that differ in separator placement', () => {
      // The canonical-string composition uses '|' as a separator. Make sure
      // shifting a separator boundary produces a distinct digest, so a
      // pathological input cannot collide with a different decomposition.
      expect(hashContent('a|bc')).not.toBe(hashContent('ab|c'));
    });
  });

  describe('opacity', () => {
    it('does not embed the original input in its output', () => {
      const secret = 'super-secret-token-1234567890';
      const digest = hashContent(secret);
      expect(digest).not.toContain(secret);
    });

    it('does not leak large payload contents in its output', () => {
      const payload = 'x'.repeat(1024);
      const digest = hashContent(payload);
      expect(digest).not.toContain(payload);
      expect(digest.length).toBeLessThan(payload.length);
    });
  });

  describe('input handling', () => {
    it('handles UTF-8 multi-byte input', () => {
      const digest = hashContent('café — 日本語 — 🚀');
      expect(digest).toMatch(/^blake2b512:[0-9a-f]{128}$/);
    });

    it('discriminates between equivalent strings with different normalization', () => {
      // U+00E9 (single composed code point) vs. U+0065 U+0301 (e + combining
      // acute accent). They render the same but are distinct byte sequences,
      // and hashContent hashes bytes — not normalized text.
      const composed = 'caf\u00e9';
      const decomposed = 'cafe\u0301';
      expect(hashContent(composed)).not.toBe(hashContent(decomposed));
    });
  });
});
