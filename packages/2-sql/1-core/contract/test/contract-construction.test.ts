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

describe('contract construction', () => {
  describe('_generated stripping', () => {
    it('strips _generated from returned runtime contract', () => {
      const contractWithGenerated = {
        ...baseContract,
        _generated: {
          emittedAt: '2026-02-15T12:00:00Z',
          emitterVersion: '1.0.0',
        },
      };

      const result = validateContract<SqlContract<SqlStorage>>(contractWithGenerated);

      expect(result).not.toHaveProperty('_generated');
      expect(Object.hasOwn(result, '_generated')).toBe(false);
    });

    it('omits _generated when input has no _generated', () => {
      const result = validateContract<SqlContract<SqlStorage>>(baseContract);

      expect(result).not.toHaveProperty('_generated');
    });
  });

  describe('runtime-real mappings', () => {
    it('returns contract with runtime-real mappings populated', () => {
      const result = validateContract<SqlContract<SqlStorage>>(baseContract);

      expect(result.mappings).toBeDefined();
      const mappingKeys = Object.keys(result.mappings) as (keyof SqlMappings)[];
      for (const key of mappingKeys) {
        expect(RUNTIME_MAPPING_KEYS).toContain(key);
      }
      expect(result.mappings.modelToTable).toEqual({ User: 'User' });
      expect(result.mappings.tableToModel).toEqual({ User: 'User' });
      expect(result.mappings.fieldToColumn).toBeDefined();
      expect(result.mappings.columnToField).toBeDefined();
    });
  });

  describe('visualization and traversal', () => {
    it('returned contract is traversable for visualization use-cases', () => {
      const result = validateContract<SqlContract<SqlStorage>>(baseContract);

      const tableNames = Object.keys(result.storage.tables);
      expect(tableNames).toContain('User');

      const modelNames = Object.keys(result.models);
      expect(modelNames).toContain('User');

      const mappingKeys = Object.keys(result.mappings);
      expect(mappingKeys).toEqual(
        expect.arrayContaining(['modelToTable', 'tableToModel', 'fieldToColumn', 'columnToField']),
      );

      for (const tableName of tableNames) {
        const table = result.storage.tables[tableName];
        expect(table).toBeDefined();
        const columnNames = Object.keys(table!.columns);
        expect(columnNames.length).toBeGreaterThan(0);
      }
    });

    it('model-to-table lookup works via mappings', () => {
      const result = validateContract<SqlContract<SqlStorage>>(baseContract);

      const modelToTable = result.mappings.modelToTable;
      expect(modelToTable).toBeDefined();
      expect(modelToTable!['User']).toBe('User');
    });

    it('table-to-model reverse lookup works via mappings', () => {
      const result = validateContract<SqlContract<SqlStorage>>(baseContract);

      const tableToModel = result.mappings.tableToModel;
      expect(tableToModel).toBeDefined();
      expect(tableToModel!['User']).toBe('User');
    });
  });
});
