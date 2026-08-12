import { describe, expect, it } from 'vitest';
import { DdlColumn, FunctionColumnDefault, LiteralColumnDefault } from '../../src/exports/ast';
import { col, fn, lit } from '../../src/exports/contract-free';

describe('contract-free column helpers', () => {
  it('lit produces a frozen LiteralColumnDefault', () => {
    const value = lit('app');
    expect(value).toBeInstanceOf(LiteralColumnDefault);
    expect(value.kind).toBe('literal');
    expect(value.value).toBe('app');
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('fn produces a frozen FunctionColumnDefault', () => {
    const value = fn("datetime('now')");
    expect(value).toBeInstanceOf(FunctionColumnDefault);
    expect(value.kind).toBe('function');
    expect(value.expression).toBe("datetime('now')");
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('col builds a frozen DdlColumn with optional flags', () => {
    const column = col('id', 'bigserial', {
      primaryKey: true,
      default: fn('now()'),
    });
    expect(column).toBeInstanceOf(DdlColumn);
    expect(column.name).toBe('id');
    expect(column.type).toBe('bigserial');
    expect(column.primaryKey).toBe(true);
    expect(column.default).toBeInstanceOf(FunctionColumnDefault);
    expect(Object.isFrozen(column)).toBe(true);
  });

  it('default dispatches through the visitor', () => {
    const kind = lit('app').accept(
      {
        literal: (node) => node.kind,
        function: (node) => node.kind,
      },
      { nativeType: 'text' },
    );
    expect(kind).toBe('literal');
  });

  it('rejects invalid literal input', () => {
    expect(() => lit(Symbol('x') as unknown as string)).toThrow(/Invalid column default literal/);
  });
});
