import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage, StorageEnum } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

describe('PostgresMigrationPlanner - enum support', () => {
  const planner = createPostgresMigrationPlanner();

  describe('missing enum - additive', () => {
    it('emits CREATE TYPE ... AS ENUM for missing enums', () => {
      const contract = createTestContract({
        enums: {
          role: { values: ['USER', 'ADMIN', 'MODERATOR'] },
        },
      });

      const schema: SqlSchemaIR = {
        tables: {
          user: buildUserTableSchema(),
        },
        extensions: [],
        enums: {},
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

      const enumOp = result.plan.operations.find((op) => op.id === 'enum.role');
      expect(enumOp).toMatchObject({
        label: 'Create enum type role',
        execute: [{ sql: `CREATE TYPE "public"."role" AS ENUM ('USER', 'ADMIN', 'MODERATOR')` }],
      });
    });

    it('orders enum operations before table operations', () => {
      const contract = createTestContract({
        enums: {
          role: { values: ['USER', 'ADMIN'] },
          status: { values: ['ACTIVE', 'INACTIVE'] },
        },
      });

      const schema: SqlSchemaIR = {
        tables: {},
        extensions: [],
        enums: {},
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

      const opIds = result.plan.operations.map((op) => op.id);

      // Enum operations should come before table operations
      const roleEnumIndex = opIds.indexOf('enum.role');
      const statusEnumIndex = opIds.indexOf('enum.status');
      const tableIndex = opIds.findIndex((id) => id.startsWith('table.'));

      expect(roleEnumIndex).toBeGreaterThanOrEqual(0);
      expect(statusEnumIndex).toBeGreaterThanOrEqual(0);

      if (tableIndex >= 0) {
        expect(roleEnumIndex).toBeLessThan(tableIndex);
        expect(statusEnumIndex).toBeLessThan(tableIndex);
      }

      // Enum operations should be in deterministic order (sorted by name)
      // 'role' comes before 'status' alphabetically
      expect(roleEnumIndex).toBeLessThan(statusEnumIndex);
    });

    it('skips existing enums that match exactly', () => {
      const contract = createTestContract({
        enums: {
          role: { values: ['USER', 'ADMIN'] },
        },
      });

      const schema: SqlSchemaIR = {
        tables: {
          user: buildUserTableSchema(),
        },
        extensions: [],
        enums: {
          role: { name: 'role', values: ['USER', 'ADMIN'] },
        },
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

      const enumOp = result.plan.operations.find((op) => op.id === 'enum.role');
      expect(enumOp).toBeUndefined();
    });
  });

  describe('enum values mismatch - conflict', () => {
    it('fails with conflict when enum values differ (different values)', () => {
      const contract = createTestContract({
        enums: {
          role: { values: ['USER', 'ADMIN', 'MODERATOR'] },
        },
      });

      const schema: SqlSchemaIR = {
        tables: {
          user: buildUserTableSchema(),
        },
        extensions: [],
        enums: {
          role: { name: 'role', values: ['USER', 'ADMIN'] }, // missing MODERATOR
        },
      };

      const result = planner.plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents: [],
      });

      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') {
        throw new Error('expected planner failure');
      }

      expect(result.conflicts).toContainEqual(
        expect.objectContaining({
          kind: 'enumValuesMismatch',
        }),
      );
    });

    it('fails with conflict when enum values are in different order', () => {
      const contract = createTestContract({
        enums: {
          role: { values: ['USER', 'ADMIN'] },
        },
      });

      const schema: SqlSchemaIR = {
        tables: {
          user: buildUserTableSchema(),
        },
        extensions: [],
        enums: {
          role: { name: 'role', values: ['ADMIN', 'USER'] }, // different order
        },
      };

      const result = planner.plan({
        contract,
        schema,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents: [],
      });

      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') {
        throw new Error('expected planner failure');
      }

      expect(result.conflicts).toContainEqual(
        expect.objectContaining({
          kind: 'enumValuesMismatch',
        }),
      );
    });
  });

  describe('multiple enums', () => {
    it('creates multiple enum types in sorted order', () => {
      const contract = createTestContract({
        enums: {
          status: { values: ['ACTIVE', 'INACTIVE'] },
          role: { values: ['USER', 'ADMIN'] },
          priority: { values: ['LOW', 'MEDIUM', 'HIGH'] },
        },
      });

      const schema: SqlSchemaIR = {
        tables: {
          user: buildUserTableSchema(),
        },
        extensions: [],
        enums: {},
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

      const enumOpIds = result.plan.operations
        .filter((op) => op.id.startsWith('enum.'))
        .map((op) => op.id);

      // Should be sorted alphabetically: priority, role, status
      expect(enumOpIds).toEqual(['enum.priority', 'enum.role', 'enum.status']);
    });
  });
});

function createTestContract(
  options: { enums?: Record<string, StorageEnum> } = {},
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:contract',
    profileHash: 'sha256:profile',
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      enums: options.enums ?? {},
    },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    },
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };
}

function buildUserTableSchema(): SqlSchemaIR['tables'][string] {
  return {
    name: 'user',
    columns: {
      id: { name: 'id', nativeType: 'uuid', nullable: false },
      email: { name: 'email', nativeType: 'text', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    foreignKeys: [],
    indexes: [],
  };
}
