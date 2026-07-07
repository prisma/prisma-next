import { describe, expect, it } from 'vitest';
import { isSqlColumnBinding } from '../src/entity-ref-resolution';

describe('isSqlColumnBinding', () => {
  it('true for a payload carrying a string codecId', () => {
    const payload = { codecId: 'pg/enum@1' };
    expect(isSqlColumnBinding(payload)).toBe(true);
  });

  it('true with the optional typeParams/valueSetEntityName fields present', () => {
    const payload = {
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'auth.aal_level' },
      valueSetEntityName: 'AalLevel',
    };
    expect(isSqlColumnBinding(payload)).toBe(true);
  });

  it('false when codecId is missing', () => {
    expect(isSqlColumnBinding({ typeParams: {} })).toBe(false);
  });

  it('false when codecId is not a string', () => {
    expect(isSqlColumnBinding({ codecId: 1 })).toBe(false);
  });

  it('false for an unrelated object', () => {
    expect(isSqlColumnBinding({ foo: 'bar' })).toBe(false);
  });
});
