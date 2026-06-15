import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { PostgresEnumType } from '../src/core/postgres-enum-type';
import { PostgresEnumTypeSchema } from '../src/core/postgres-enum-type-schema';

describe('PostgresEnumType control field', () => {
  it('retains control when set', () => {
    const enumType = new PostgresEnumType({
      name: 'Role',
      values: ['admin', 'user'],
      control: 'external',
    });
    expect(enumType.control).toBe('external');
  });

  it('omits control when unset', () => {
    const enumType = new PostgresEnumType({ name: 'Role', values: ['admin', 'user'] });
    expect(Object.hasOwn(enumType, 'control')).toBe(false);
    expect('control' in JSON.parse(JSON.stringify(enumType))).toBe(false);
  });
});

describe('PostgresEnumTypeSchema control field', () => {
  it('accepts an enum entry carrying control', () => {
    const result = PostgresEnumTypeSchema({
      kind: 'postgres-enum',
      values: ['a', 'b'],
      control: 'external',
    });
    expect(result instanceof type.errors).toBe(false);
  });

  it('rejects an enum entry carrying a non-ControlPolicy string', () => {
    const result = PostgresEnumTypeSchema({
      kind: 'postgres-enum',
      values: ['a', 'b'],
      control: 'bogus',
    });
    expect(result instanceof type.errors).toBe(true);
  });
});
