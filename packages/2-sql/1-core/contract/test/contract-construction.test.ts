import type { Contract } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import type { SqlStorage } from '../src/types';
import { validateContract } from '../src/validate';

const baseContract = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:test',
  storageHash: 'sha256:test-storage',
  roots: { User: 'User' },
  capabilities: {},
  extensionPacks: {},
  meta: {},
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
    storageHash: 'sha256:test-storage',
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

      const result = validateContract<Contract<SqlStorage>>(contractWithGenerated);

      expect(result).not.toHaveProperty('_generated');
      expect(Object.hasOwn(result, '_generated')).toBe(false);
    });

    it('omits _generated when input has no _generated', () => {
      const result = validateContract<Contract<SqlStorage>>(baseContract);

      expect(result).not.toHaveProperty('_generated');
    });
  });

  describe('constructContract via validateContract', () => {
    it('returns contract suitable for traversal without mutating storage shape', () => {
      const result = validateContract<Contract<SqlStorage>>(baseContract);

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
