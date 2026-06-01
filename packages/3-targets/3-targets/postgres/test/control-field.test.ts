import { describe, expect, it } from 'vitest';
import { PostgresEnumType } from '../src/core/postgres-enum-type';

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
