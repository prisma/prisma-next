import { describe, it } from 'vitest';
import type { CodecTypesOf, OperationTypesOf, TypeMaps } from '../src/types';

describe('Contract and TypeMaps shape', () => {
  describe('TypeMaps shape', () => {
    it('TypeMaps has locked shape with codecTypes and operationTypes', () => {
      type TM = TypeMaps<{ 'pg/text@1': { output: string } }, Record<string, never>>;
      type HasCodecTypes = TM extends { readonly codecTypes: unknown } ? true : false;
      type HasOperationTypes = TM extends { readonly operationTypes: unknown } ? true : false;
      const _codec: HasCodecTypes = true;
      const _op: HasOperationTypes = true;
    });

    it('CodecTypesOf extracts codecTypes from TypeMaps', () => {
      type TM = TypeMaps<{ foo: { output: number } }, Record<string, never>>;
      type CT = CodecTypesOf<TM>;
      const _ct: CT = { foo: { output: 0 } };
    });

    it('OperationTypesOf extracts operationTypes from TypeMaps', () => {
      type TM = TypeMaps<Record<string, never>, { bar: Record<string, unknown> }>;
      type OT = OperationTypesOf<TM>;
      const _ot: OT = { bar: {} };
    });
  });
});
