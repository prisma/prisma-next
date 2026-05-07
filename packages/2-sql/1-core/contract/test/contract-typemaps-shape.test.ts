import { describe, it } from 'vitest';
import type { CodecTypesOf, FieldInputTypesOf, FieldOutputTypesOf, TypeMaps } from '../src/types';

describe('Contract and TypeMaps shape', () => {
  describe('TypeMaps shape', () => {
    it('TypeMaps has locked shape with codecTypes', () => {
      type TM = TypeMaps<{ 'pg/text@1': { output: string } }>;
      type HasCodecTypes = TM extends { readonly codecTypes: unknown } ? true : false;
      const _codec: HasCodecTypes = true;
    });

    it('CodecTypesOf extracts codecTypes from TypeMaps', () => {
      type TM = TypeMaps<{ foo: { output: number } }>;
      type CT = CodecTypesOf<TM>;
      const _ct: CT = { foo: { output: 0 } };
    });

    it('TypeMaps accepts 4th TFieldInputTypes parameter', () => {
      type TM = TypeMaps<
        Record<string, never>,
        Record<string, never>,
        Record<string, never>,
        { User: { name: string } }
      >;
      type HasFieldInputTypes = TM extends { readonly fieldInputTypes: unknown } ? true : false;
      const _fit: HasFieldInputTypes = true;
    });

    it('TypeMaps defaults TFieldInputTypes to Record<string, never>', () => {
      type TM = TypeMaps;
      type FIT = FieldInputTypesOf<TM>;
      const _fit: FIT = {};
    });

    it('FieldOutputTypesOf extracts fieldOutputTypes from TypeMaps', () => {
      type TM = TypeMaps<Record<string, never>, Record<string, never>, { User: { name: string } }>;
      type FOT = FieldOutputTypesOf<TM>;
      const _fot: FOT = { User: { name: 'test' } };
    });

    it('FieldInputTypesOf extracts fieldInputTypes from TypeMaps', () => {
      type TM = TypeMaps<
        Record<string, never>,
        Record<string, never>,
        Record<string, never>,
        { User: { name: string } }
      >;
      type FIT = FieldInputTypesOf<TM>;
      const _fit: FIT = { User: { name: 'test' } };
    });
  });
});
