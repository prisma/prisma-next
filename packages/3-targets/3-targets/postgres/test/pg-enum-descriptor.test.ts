import { describe, expect, it } from 'vitest';
import { pgEnumDescriptor } from '../src/core/codecs';

describe('PgEnumDescriptor (pg/enum@1) as a parameterized codec', () => {
  it('is parameterized with a { typeName: string } params schema', async () => {
    expect(pgEnumDescriptor.isParameterized).toBe(true);

    const valid = await pgEnumDescriptor.paramsSchema['~standard'].validate({
      typeName: 'auth.aal_level',
    });
    expect(valid).toMatchObject({ value: { typeName: 'auth.aal_level' } });

    const invalid = await pgEnumDescriptor.paramsSchema['~standard'].validate({ typeName: 42 });
    expect(invalid).toHaveProperty('issues');
  });

  describe('nativeTypeFor', () => {
    it('returns the typeName from the codec-instance typeParams', () => {
      expect(pgEnumDescriptor.nativeTypeFor({ typeName: 'aal_level' })).toBe('aal_level');
      expect(pgEnumDescriptor.nativeTypeFor({ typeName: 'auth.aal_level' })).toBe('auth.aal_level');
    });

    it('returns undefined for absent or malformed typeParams', () => {
      expect(pgEnumDescriptor.nativeTypeFor(undefined)).toBeUndefined();
      expect(pgEnumDescriptor.nativeTypeFor(null)).toBeUndefined();
      expect(pgEnumDescriptor.nativeTypeFor('aal_level')).toBeUndefined();
      expect(pgEnumDescriptor.nativeTypeFor(['aal_level'])).toBeUndefined();
      expect(pgEnumDescriptor.nativeTypeFor({ typeName: 42 })).toBeUndefined();
      expect(pgEnumDescriptor.nativeTypeFor({})).toBeUndefined();
    });
  });
});
