import { describe, expect, it } from 'vitest';
import type { SqlContract, SqlStorage } from '../src/types';
import { validateContract } from '../src/validate';

const baseContract = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: 'sha256:test-storage',
  models: {
    User: {
      storage: {
        table: 'User',
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
      },
      fields: {
        id: {},
        email: {},
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

  describe('constructContract via validateContract', () => {
    it('returns contract suitable for traversal without mutating storage shape', () => {
      const result = validateContract<SqlContract<SqlStorage>>(baseContract);

      const tableNames = Object.keys(result.storage.tables);
      expect(tableNames).toContain('User');

      const modelNames = Object.keys(result.models);
      expect(modelNames).toContain('User');

      for (const tableName of tableNames) {
        const table = result.storage.tables[tableName];
        expect(table).toBeDefined();
        const columnNames = Object.keys(table!.columns);
        expect(columnNames.length).toBeGreaterThan(0);
      }
    });
  });
});
