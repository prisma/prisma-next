import { describe, expect, it } from 'vitest';
import { col, fn, lit } from '../../src/exports/contract-free';

describe('contract-free column helpers', () => {
  it('lit produces a frozen literal default', () => {
    const value = lit('app');
    expect(value).toEqual({ kind: 'literal', value: 'app' });
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('fn produces a frozen function default', () => {
    const value = fn("datetime('now')");
    expect(value).toEqual({ kind: 'function', expression: "datetime('now')" });
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('col builds a frozen DdlColumn with optional flags', () => {
    const column = col('id', 'bigserial', {
      primaryKey: true,
      default: fn('now()'),
    });
    expect(column).toEqual({
      name: 'id',
      type: 'bigserial',
      primaryKey: true,
      default: { kind: 'function', expression: 'now()' },
    });
    expect(Object.isFrozen(column)).toBe(true);
  });

  it('rejects invalid literal input', () => {
    expect(() => lit(Symbol('x') as unknown as string)).toThrow(/Invalid column default literal/);
  });
});
