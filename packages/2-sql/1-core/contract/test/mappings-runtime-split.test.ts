import { describe, expect, it } from 'vitest';
import type { SqlContract, SqlMappings, SqlStorage } from '../src/types';
import { validateContract } from '../src/validate';

const RUNTIME_MAPPING_KEYS: (keyof SqlMappings)[] = [
  'modelToTable',
  'tableToModel',
  'fieldToColumn',
  'columnToField',
];

const baseContract = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  coreHash: 'sha256:test',
  storageHash: 'sha256:test-storage',
  models: {
    User: {
      storage: { table: 'User' },
      fields: {
        id: { column: 'id' },
        email: { column: 'email' },
      },
      relations: {},
    },
  },
  storage: {
    tables: {
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
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

describe('mappings runtime/type split', () => {
  it('runtime contract mappings include only runtime-real mapping keys', () => {
    const result = validateContract<SqlContract<SqlStorage>>(baseContract);

    const mappingKeys = Object.keys(result.mappings) as (keyof SqlMappings)[];
    for (const key of mappingKeys) {
      expect(RUNTIME_MAPPING_KEYS).toContain(key);
    }
    expect(result.mappings).not.toHaveProperty('codecTypes');
    expect(result.mappings).not.toHaveProperty('operationTypes');
  });

  it('ignores codecTypes and operationTypes when provided in input mappings', () => {
    const contractWithTypeMaps = {
      ...baseContract,
      mappings: {
        modelToTable: { User: 'User' },
        tableToModel: { User: 'User' },
        fieldToColumn: { User: { id: 'id', email: 'email' } },
        columnToField: { User: { id: 'id', email: 'email' } },
        codecTypes: { custom: { output: 'x' } as unknown },
        operationTypes: { customOp: { output: 'y' } as unknown },
      },
    };

    const result = validateContract<SqlContract<SqlStorage>>(contractWithTypeMaps);

    expect(result.mappings).not.toHaveProperty('codecTypes');
    expect(result.mappings).not.toHaveProperty('operationTypes');
    expect(result.mappings).toMatchObject({
      modelToTable: { User: 'User' },
      tableToModel: { User: 'User' },
    });
  });
});
