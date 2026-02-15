import { describe, expect, it } from 'vitest';
import type {
  CodecTypesOf,
  OperationTypesOf,
  SqlContract,
  SqlMappings,
  SqlStorage,
  TypeMaps,
} from '../src/types';

const RUNTIME_MAPPING_KEYS: (keyof SqlMappings)[] = [
  'modelToTable',
  'tableToModel',
  'fieldToColumn',
  'columnToField',
];

describe('Contract and TypeMaps shape (Task 1.1)', () => {
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

  describe('runtime Contract mappings', () => {
    it('mappings includes only runtime-real structural keys', () => {
      const baseContract = {
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'sha256:test',
        models: {
          User: {
            storage: { table: 'user' },
            fields: { id: { column: 'id' }, email: { column: 'email' } },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      } as const;

      type Contract = SqlContract<SqlStorage>;
      const result = {
        ...baseContract,
        mappings: { modelToTable: {}, tableToModel: {}, fieldToColumn: {}, columnToField: {} },
      } as Contract;

      const mappingKeys = Object.keys(result.mappings) as (keyof SqlMappings)[];
      for (const key of mappingKeys) {
        expect(RUNTIME_MAPPING_KEYS).toContain(key);
      }
    });

    it('mappings does not include codecTypes or operationTypes', () => {
      const mappingKeys = ['modelToTable', 'tableToModel', 'fieldToColumn', 'columnToField'];
      expect(mappingKeys).not.toContain('codecTypes');
      expect(mappingKeys).not.toContain('operationTypes');
    });
  });
});
