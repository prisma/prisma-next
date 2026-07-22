import { isStructuredError } from '@prisma-next/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { enumType, member } from '../src/enum-type';

const textCodec = { codecId: 'pg/text@1', nativeType: 'text' };

describe('enumType validation errors', () => {
  it('rejects an enum with no members', () => {
    expect(() => enumType('Status', textCodec)).toThrow(
      'enumType("Status"): must have at least one member.',
    );
  });

  it('rejects a duplicate member name with CONTRACT.ENUM_INVALID', () => {
    let thrown: unknown;
    try {
      enumType('Status', textCodec, member('active'), member('active', 'other'));
    } catch (error) {
      thrown = error;
    }
    expect(isStructuredError(thrown)).toBe(true);
    if (!isStructuredError(thrown)) {
      throw new Error('expected a structured error');
    }
    expect(thrown.code).toBe('CONTRACT.ENUM_INVALID');
    expect(thrown.message).toBe(
      'enumType("Status"): duplicate member name "active". Member names must be unique.',
    );
    expect(thrown.meta).toEqual({
      enumName: 'Status',
      member: 'active',
      reason: 'duplicate-member-name',
    });
  });

  it('rejects a duplicate member value', () => {
    expect(() =>
      enumType('Status', textCodec, member('active', 'x'), member('inactive', 'x')),
    ).toThrow('enumType("Status"): duplicate member value "x". Member values must be unique.');
  });
});
