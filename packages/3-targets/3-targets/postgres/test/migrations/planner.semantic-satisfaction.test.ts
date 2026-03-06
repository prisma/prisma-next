/**
 * Tests for planner semantic satisfaction behavior.
 *
 * These tests verify that the planner correctly handles semantic satisfaction:
 * - Unique indexes can satisfy unique constraint requirements
 * - Unique indexes/constraints can satisfy non-unique index requirements
 * - Name differences do not cause operations to be emitted
 */
import { coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

describe('PostgresMigrationPlanner - semantic satisfaction', () => {
  const planner = createPostgresMigrationPlanner();

  describe('unique constraint requirements', () => {
    it('does not emit unique operation when satisfied by unique index', () => {
      const contract = createTestContract({
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [{ columns: ['email'] }], // Requires unique constraint
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      // Schema has a unique INDEX instead of unique CONSTRAINT
      const schema: SqlSchemaIR = {
        tables: {
          user: {
            name: 'user',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [], // No unique constraint
            foreignKeys: [],
            indexes: [{ columns: ['email'], unique: true, name: 'user_email_idx' }], // Has unique index
          },
        },
        dependencies: [],
      };

      const result = planner.plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents: [],
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') {
        throw new Error('expected planner success');
      }
      // No operations should be emitted since unique index satisfies the requirement
      expect(result.plan.operations).toHaveLength(0);
    });
  });

  describe('index requirements', () => {
    it('does not emit index operation when satisfied by unique index', () => {
      const contract = createTestContract({
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [{ columns: ['email'] }], // Requires index (non-unique)
              foreignKeys: [],
            },
          },
        },
      });

      // Schema has a unique index on the same columns
      const schema: SqlSchemaIR = {
        tables: {
          user: {
            name: 'user',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [{ columns: ['email'], unique: true, name: 'user_email_idx' }], // Has unique index
          },
        },
        dependencies: [],
      };

      const result = planner.plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents: [],
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') {
        throw new Error('expected planner success');
      }
      // No operations should be emitted since unique index satisfies the non-unique index requirement
      expect(result.plan.operations).toHaveLength(0);
    });

    it('does not emit index operation when satisfied by unique constraint', () => {
      const contract = createTestContract({
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [{ columns: ['email'] }], // Requires index (non-unique)
              foreignKeys: [],
            },
          },
        },
      });

      // Schema has a unique constraint on the same columns
      const schema: SqlSchemaIR = {
        tables: {
          user: {
            name: 'user',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'], name: 'user_email_key' }], // Has unique constraint
            foreignKeys: [],
            indexes: [], // No indexes
          },
        },
        dependencies: [],
      };

      const result = planner.plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents: [],
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') {
        throw new Error('expected planner success');
      }
      // No operations should be emitted since unique constraint satisfies the non-unique index requirement
      expect(result.plan.operations).toHaveLength(0);
    });
  });

  describe('name mismatches', () => {
    it('succeeds with no operations when only constraint/index names differ', () => {
      const contract = createTestContract({
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'], name: 'user_pk' },
              uniques: [{ columns: ['email'], name: 'user_email_unique' }],
              indexes: [{ columns: ['email'], name: 'user_email_index' }],
              foreignKeys: [],
            },
          },
        },
      });

      // Schema has different names for the same constraints/indexes
      const schema: SqlSchemaIR = {
        tables: {
          user: {
            name: 'user',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'], name: 'user_pkey' }, // Different name
            uniques: [{ columns: ['email'], name: 'user_email_key' }], // Different name
            foreignKeys: [],
            indexes: [{ columns: ['email'], unique: false, name: 'user_email_idx' }], // Different name
          },
        },
        dependencies: [],
      };

      const result = planner.plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents: [],
      });

      // Should succeed (no conflicts) and emit no operations (semantic match)
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') {
        throw new Error('expected planner success');
      }
      expect(result.plan.operations).toHaveLength(0);
    });
  });
});

function createTestContract(overrides?: Partial<SqlContract<SqlStorage>>): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash('sha256:contract'),
    profileHash: profileHash('sha256:profile'),
    storage: {
      tables: {},
    },
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}
