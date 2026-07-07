import { describe, expect, it } from 'vitest';
import { isSqlEntityRefResolution } from '../src/entity-ref-resolution';

describe('isSqlEntityRefResolution', () => {
  it('true for a payload carrying string codecId and nativeType', () => {
    const payload = { codecId: 'pg/enum@1', nativeType: 'auth.aal_level' };
    expect(isSqlEntityRefResolution(payload)).toBe(true);
  });

  it('true with the optional typeParams/valueSetEntityName fields present', () => {
    const payload = {
      codecId: 'pg/enum@1',
      nativeType: 'auth.aal_level',
      typeParams: { typeName: 'auth.aal_level' },
      valueSetEntityName: 'AalLevel',
    };
    expect(isSqlEntityRefResolution(payload)).toBe(true);
  });

  it('false when codecId is missing', () => {
    expect(isSqlEntityRefResolution({ nativeType: 'auth.aal_level' })).toBe(false);
  });

  it('false when nativeType is missing', () => {
    expect(isSqlEntityRefResolution({ codecId: 'pg/enum@1' })).toBe(false);
  });

  it('false when codecId is not a string', () => {
    expect(isSqlEntityRefResolution({ codecId: 1, nativeType: 'auth.aal_level' })).toBe(false);
  });

  it('false when nativeType is not a string', () => {
    expect(isSqlEntityRefResolution({ codecId: 'pg/enum@1', nativeType: 1 })).toBe(false);
  });

  it('false for an unrelated object', () => {
    expect(isSqlEntityRefResolution({ foo: 'bar' })).toBe(false);
  });
});
