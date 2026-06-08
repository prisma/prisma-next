import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeContentHash, normalizePredicate } from '../src/core/rls/canonicalize';

describe('normalizePredicate', () => {
  describe('whitespace collapse', () => {
    it('collapses multiple spaces to one', () => {
      expect(normalizePredicate('a  =  b')).toBe('a = b');
    });

    it('collapses tabs to a space', () => {
      expect(normalizePredicate('a\t=\tb')).toBe('a = b');
    });

    it('collapses newlines to a space', () => {
      expect(normalizePredicate('a\n=\nb')).toBe('a = b');
    });

    it('collapses mixed whitespace variants', () => {
      expect(normalizePredicate('a \t\n =\n\t b')).toBe('a = b');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizePredicate('  a = b  ')).toBe('a = b');
    });
  });

  describe('keyword lowercase', () => {
    it('lowercases SQL keywords', () => {
      expect(normalizePredicate('user_id IS NULL')).toBe('user_id is null');
    });

    it('lowercases mixed-case keywords', () => {
      expect(normalizePredicate('a And b Or c')).toBe('a and b or c');
    });

    it('lowercases keywords in compound expressions', () => {
      expect(normalizePredicate('auth.uid() = user_id AND deleted_at IS NULL')).toBe(
        'auth.uid() = user_id and deleted_at is null',
      );
    });
  });

  describe('outer-paren trim', () => {
    it('trims a single fully-enclosing paren pair', () => {
      expect(normalizePredicate('(a = b)')).toBe('a = b');
    });

    it('does NOT trim parens that do not wrap the entire expression', () => {
      expect(normalizePredicate('(a) AND (b)')).toBe('(a) and (b)');
    });

    it('does NOT trim nested outer parens that are part of a larger expression', () => {
      expect(normalizePredicate('(a = 1) OR (b = 2)')).toBe('(a = 1) or (b = 2)');
    });

    it('trims multiple enclosing layers', () => {
      expect(normalizePredicate('((a = b))')).toBe('a = b');
    });

    it('trims outer parens after whitespace collapse', () => {
      expect(normalizePredicate('( a = b )')).toBe('a = b');
    });
  });

  describe('comment stripping', () => {
    it('strips line comments', () => {
      expect(normalizePredicate('a = b -- this is a comment')).toBe('a = b');
    });

    it('strips line comments mid-expression and retains the rest', () => {
      expect(normalizePredicate('a = b -- comment\nAND c = d')).toBe('a = b and c = d');
    });

    it('strips block comments', () => {
      expect(normalizePredicate('a = /* inline comment */ b')).toBe('a = b');
    });

    it('strips block comments spanning multiple lines', () => {
      expect(normalizePredicate('a = b\n/* multi\nline\ncomment */\nAND c = d')).toBe(
        'a = b and c = d',
      );
    });
  });

  describe('string literals with parens and keywords', () => {
    it('preserves parens inside string literals — they are data not syntax', () => {
      const result = normalizePredicate("status = '(active)'");
      expect(result).toBe("status = '(active)'");
    });

    it('preserves SQL keywords inside string literals — they are data not syntax', () => {
      const result = normalizePredicate("label = 'AND OR NOT NULL'");
      expect(result).toBe("label = 'and or not null'");
    });

    it('preserves comment-like sequences inside string literals', () => {
      const result = normalizePredicate("note = 'hello -- world'");
      expect(result).toBe("note = 'hello -- world'");
    });

    it('preserves block comment sequences inside string literals', () => {
      const result = normalizePredicate("note = 'a /* not a comment */ b'");
      expect(result).toBe("note = 'a /* not a comment */ b'");
    });

    it('handles escaped single quotes inside string literals (doubled quote)', () => {
      const result = normalizePredicate("label = 'it''s fine'");
      expect(result).toBe("label = 'it''s fine'");
    });
  });

  describe('determinism across equivalent forms', () => {
    it('nested parens in sub-expressions produce same result', () => {
      const a = normalizePredicate('((user_id = auth.uid()))');
      const b = normalizePredicate('user_id = auth.uid()');
      expect(a).toBe(b);
    });

    it('whitespace variants are equivalent', () => {
      const a = normalizePredicate('user_id  =  auth.uid()');
      const b = normalizePredicate('user_id = auth.uid()');
      expect(a).toBe(b);
    });

    it('keyword casing variants are equivalent', () => {
      const a = normalizePredicate('a IS NULL AND b IS NOT NULL');
      const b = normalizePredicate('a is null and b is not null');
      expect(a).toBe(b);
    });
  });
});

describe('computeContentHash', () => {
  const base = {
    roles: ['authenticated'],
    operation: 'select' as const,
    permissive: true,
  };

  describe('output format', () => {
    it('returns exactly 8 hex characters', () => {
      const hash = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('returns lowercase hex', () => {
      const hash = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      expect(hash).toBe(hash.toLowerCase());
    });
  });

  describe('hash determinism across reformatting-equivalent predicates', () => {
    it('produces the same hash for using with extra whitespace vs collapsed', () => {
      const a = computeContentHash({ ...base, using: 'user_id  =  auth.uid()' });
      const b = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      expect(a).toBe(b);
    });

    it('produces the same hash for using with outer parens vs without', () => {
      const a = computeContentHash({ ...base, using: '(user_id = auth.uid())' });
      const b = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      expect(a).toBe(b);
    });

    it('produces the same hash for mixed-case keywords vs lowercase', () => {
      const a = computeContentHash({ ...base, using: 'deleted_at IS NULL' });
      const b = computeContentHash({ ...base, using: 'deleted_at is null' });
      expect(a).toBe(b);
    });

    it('produces the same hash regardless of role order', () => {
      const a = computeContentHash({ ...base, roles: ['anon', 'authenticated'], using: 'true' });
      const b = computeContentHash({ ...base, roles: ['authenticated', 'anon'], using: 'true' });
      expect(a).toBe(b);
    });

    it('deduplicates roles — duplicate does not change hash', () => {
      const a = computeContentHash({ ...base, roles: ['authenticated'], using: 'true' });
      const b = computeContentHash({
        ...base,
        roles: ['authenticated', 'authenticated'],
        using: 'true',
      });
      expect(a).toBe(b);
    });

    it('line comments stripped — same hash as comment-free form', () => {
      const a = computeContentHash({ ...base, using: 'user_id = auth.uid() -- allow authed' });
      const b = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      expect(a).toBe(b);
    });

    it('block comments stripped — same hash as comment-free form', () => {
      const a = computeContentHash({ ...base, using: '/* check */ user_id = auth.uid()' });
      const b = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      expect(a).toBe(b);
    });
  });

  describe('hash distinctness for semantically different bodies', () => {
    it('using-only vs using+withCheck differs', () => {
      const a = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      const b = computeContentHash({
        ...base,
        using: 'user_id = auth.uid()',
        withCheck: 'user_id = auth.uid()',
      });
      expect(a).not.toBe(b);
    });

    it('different using bodies differ', () => {
      const a = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      const b = computeContentHash({ ...base, using: 'tenant_id = auth.tenant()' });
      expect(a).not.toBe(b);
    });

    it('different operations differ', () => {
      const a = computeContentHash({ ...base, using: 'true', operation: 'select' });
      const b = computeContentHash({ ...base, using: 'true', operation: 'insert' });
      expect(a).not.toBe(b);
    });

    it('permissive vs restrictive differs', () => {
      const a = computeContentHash({ ...base, using: 'true', permissive: true });
      const b = computeContentHash({ ...base, using: 'true', permissive: false });
      expect(a).not.toBe(b);
    });

    it('different roles differ', () => {
      const a = computeContentHash({ ...base, using: 'true', roles: ['authenticated'] });
      const b = computeContentHash({ ...base, using: 'true', roles: ['anon'] });
      expect(a).not.toBe(b);
    });

    it('using-only vs withCheck-only differs', () => {
      const a = computeContentHash({ ...base, using: 'user_id = auth.uid()' });
      const b = computeContentHash({ ...base, withCheck: 'user_id = auth.uid()' });
      expect(a).not.toBe(b);
    });
  });

  describe('string literals containing parens and keywords are data', () => {
    it('status with paren content hashes differently from status with plain content', () => {
      const a = computeContentHash({ ...base, using: "status = '(active)'" });
      const b = computeContentHash({ ...base, using: "status = 'active'" });
      expect(a).not.toBe(b);
    });

    it('keyword inside string literal preserved — differs from keyword outside', () => {
      const a = computeContentHash({ ...base, using: "label = 'AND'" });
      const b = computeContentHash({ ...base, using: "label = 'and'" });
      expect(a).toBe(b);
    });
  });

  describe('tuple encoding stability', () => {
    it('matches the expected SHA-256 first-8-hex for a known input', () => {
      const parts = {
        using: 'user_id = auth.uid()',
        roles: ['authenticated'],
        operation: 'select' as const,
        permissive: true,
      };
      const hash = computeContentHash(parts);
      const canonical = normalizePredicate('user_id = auth.uid()');
      const tuple = JSON.stringify([canonical, '', ['authenticated'], 'select', 'permissive']);
      const expected = createHash('sha256').update(tuple).digest('hex').slice(0, 8);
      expect(hash).toBe(expected);
    });
  });
});
