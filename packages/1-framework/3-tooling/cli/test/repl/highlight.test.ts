import { describe, expect, it } from 'vitest';
import { highlightCode } from '../../src/repl/highlight';

describe('highlightCode', () => {
  it('returns input unchanged when color is disabled', () => {
    const code = "db.sql.public.user.select('id')";
    expect(highlightCode(code, false)).toBe(code);
  });

  it('wraps strings and keywords in ANSI codes when color is enabled', () => {
    const out = highlightCode("const x = 'hi'", true);
    expect(out).toContain('[');
    expect(out.replaceAll(/\[[0-9;]*m/g, '')).toBe("const x = 'hi'");
  });

  it('preserves the plain text of complex chains', () => {
    const code = "db.sql.public.user.select('id', 'email').where((f, fns) => fns.eq(f.id, 1))";
    const out = highlightCode(code, true);
    expect(out.replaceAll(/\[[0-9;]*m/g, '')).toBe(code);
  });
});
