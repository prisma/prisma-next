import { describe, expect, it } from 'vitest';
import { hashIdentity } from '../src/hash-identity';

describe('hashIdentity', () => {
  describe('output format', () => {
    it('produces a string prefixed with the algorithm tag', async () => {
      const digest = await hashIdentity('hello');
      expect(digest.startsWith('sha512:')).toBe(true);
    });

    it('produces a hex digest of exactly 128 characters after the prefix', async () => {
      const digest = await hashIdentity('hello');
      const hex = digest.slice('sha512:'.length);
      expect(hex).toMatch(/^[0-9a-f]{128}$/);
    });

    it('always produces a fixed total length regardless of input size', async () => {
      const small = await hashIdentity('x');
      const large = await hashIdentity('x'.repeat(10_000_000));
      expect(small.length).toBe(large.length);
      expect(small.length).toBe('sha512:'.length + 128);
    });
  });

  describe('determinism', () => {
    it('returns the same digest for identical input across repeated calls', async () => {
      const input = 'sha256:abc|select 1|[42]';
      const first = await hashIdentity(input);
      const second = await hashIdentity(input);
      const third = await hashIdentity(input);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('handles empty input deterministically', async () => {
      const a = await hashIdentity('');
      const b = await hashIdentity('');
      expect(a).toBe(b);
      expect(a).toMatch(/^sha512:[0-9a-f]{128}$/);
    });
  });

  describe('discrimination', () => {
    it('produces different digests for different inputs', async () => {
      expect(await hashIdentity('a')).not.toBe(await hashIdentity('b'));
      expect(await hashIdentity('select 1')).not.toBe(await hashIdentity('select 2'));
    });

    it('discriminates inputs that differ only in a trailing character', async () => {
      expect(await hashIdentity('hello')).not.toBe(await hashIdentity('hello!'));
    });

    it('discriminates inputs that differ only in case', async () => {
      expect(await hashIdentity('Hello')).not.toBe(await hashIdentity('hello'));
    });

    it('discriminates inputs that differ in separator placement', async () => {
      // The canonical-string composition uses '|' as a separator. Make sure
      // shifting a separator boundary produces a distinct digest, so a
      // pathological input cannot collide with a different decomposition.
      expect(await hashIdentity('a|bc')).not.toBe(await hashIdentity('ab|c'));
    });
  });

  describe('opacity', () => {
    it('does not embed the original input in its output', async () => {
      const secret = 'super-secret-token-1234567890';
      const digest = await hashIdentity(secret);
      expect(digest).not.toContain(secret);
    });

    it('does not leak large payload contents in its output', async () => {
      const payload = 'x'.repeat(1024);
      const digest = await hashIdentity(payload);
      expect(digest).not.toContain(payload);
      expect(digest.length).toBeLessThan(payload.length);
    });
  });

  describe('input handling', () => {
    it('handles UTF-8 multi-byte input', async () => {
      const digest = await hashIdentity('café — 日本語 — 🚀');
      expect(digest).toMatch(/^sha512:[0-9a-f]{128}$/);
    });

    it('discriminates between equivalent strings with different normalization', async () => {
      // U+00E9 (single composed code point) vs. U+0065 U+0301 (e + combining
      // acute accent). They render the same but are distinct byte sequences,
      // and hashIdentity hashes bytes — not normalized text.
      const composed = 'caf\u00e9';
      const decomposed = 'cafe\u0301';
      expect(await hashIdentity(composed)).not.toBe(await hashIdentity(decomposed));
    });
  });
});
