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

  describe('metaFor', () => {
    it('returns meta carrying the typeName from the codec-instance typeParams', () => {
      expect(pgEnumDescriptor.metaFor?.({ typeName: 'aal_level' })).toEqual({
        db: { sql: { postgres: { nativeType: 'aal_level' } } },
      });
      expect(pgEnumDescriptor.metaFor?.({ typeName: 'auth.aal_level' })).toEqual({
        db: { sql: { postgres: { nativeType: 'auth.aal_level' } } },
      });
    });

    it('falls back to the codec static meta for absent or malformed typeParams', () => {
      expect(pgEnumDescriptor.metaFor?.(undefined)).toBe(pgEnumDescriptor.meta);
      expect(pgEnumDescriptor.metaFor?.(null)).toBe(pgEnumDescriptor.meta);
      expect(pgEnumDescriptor.metaFor?.('aal_level')).toBe(pgEnumDescriptor.meta);
      expect(pgEnumDescriptor.metaFor?.(['aal_level'])).toBe(pgEnumDescriptor.meta);
      expect(pgEnumDescriptor.metaFor?.({ typeName: 42 })).toBe(pgEnumDescriptor.meta);
      expect(pgEnumDescriptor.metaFor?.({})).toBe(pgEnumDescriptor.meta);
    });
  });
});
