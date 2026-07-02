import { describe, expect, it } from 'vitest';
import { endsInsideString, isSubmittable, scanSource } from '../../src/repl/scan';

describe('scanSource', () => {
  it('tracks unterminated strings', () => {
    expect(scanSource("select('em").inString).toEqual({ contentStart: 8 });
    expect(scanSource("select('email')").inString).toBeNull();
  });

  it('masks string contents including escapes', () => {
    const scan = scanSource("a('x\\'y')b");
    expect(scan.mask[0]).toBe(false);
    expect(scan.mask[3]).toBe(true);
    expect(scan.mask[5]).toBe(true);
  });

  it('masks line comments', () => {
    const scan = scanSource('a // (unbalanced\nb');
    expect(scan.bracketDepth).toBe(0);
    expect(scan.mask[5]).toBe(true);
    expect(scan.mask[scan.mask.length - 1]).toBe(false);
  });

  it('masks block comments and reports unterminated ones', () => {
    expect(scanSource('a /* ( */ b').bracketDepth).toBe(0);
    expect(scanSource('a /* open').inBlockComment).toBe(true);
  });

  it('tracks open call frames outside strings and comments', () => {
    const scan = scanSource("f(g('(' ");
    expect(scan.openFrames.map((f) => f.openIndex)).toEqual([1, 3]);
  });
});

describe('isSubmittable', () => {
  it('accepts balanced input', () => {
    expect(isSubmittable("db.sql.public.user.select('id')")).toBe(true);
  });

  it('rejects unbalanced brackets and open strings', () => {
    expect(isSubmittable('const x = {')).toBe(false);
    expect(isSubmittable("const s = 'open")).toBe(false);
  });

  it('ignores brackets inside comments', () => {
    expect(isSubmittable("db.sql.public.user.select('id') // :-(")).toBe(true);
    expect(isSubmittable('x /* ( */ + 1')).toBe(true);
  });

  it('rejects input ending inside a block comment', () => {
    expect(isSubmittable('x /* pending')).toBe(false);
  });
});

describe('endsInsideString', () => {
  it('detects an open quote', () => {
    expect(endsInsideString("select('")).toBe(true);
    expect(endsInsideString("select('id'")).toBe(false);
  });
});
