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

  describe('table column enum type references', () => {
    it('uses schema-qualified quoted enum type in CREATE TABLE column definitions', () => {
      // This test verifies the fix for: PostgreSQL lowercases unquoted identifiers,
      // so "Role" must be quoted as "public"."Role" in column definitions to match
      // how the enum was created with CREATE TYPE "public"."Role"
      const contract = createTestContractWithEnumColumn({
        enums: {
          Role: { values: ['USER', 'ADMIN'] },
        },
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          role: { nativeType: 'Role', codecId: 'pg/enum@1', nullable: false },
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

      const tableOp = result.plan.operations.find((op) => op.id === 'table.user');
      expect(tableOp).toBeDefined();
      // Column type must be schema-qualified and quoted to match enum creation
      expect(tableOp!.execute[0]!.sql).toContain('"role" "public"."Role"');
    });

    it('uses schema-qualified quoted enum type in ADD COLUMN statements', () => {
      const contract = createTestContractWithEnumColumn({
        enums: {
          Status: { values: ['ACTIVE', 'INACTIVE'] },
        },
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          status: { nativeType: 'Status', codecId: 'pg/enum@1', nullable: true },
        },
      });

      const schema: SqlSchemaIR = {
        tables: {
          user: {
            name: 'user',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
              // status column is missing - will be added
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
          },
        },
        extensions: [],
        enums: {
          Status: { name: 'Status', values: ['ACTIVE', 'INACTIVE'] },
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

      const addColumnOp = result.plan.operations.find((op) => op.id === 'column.user.status');
      expect(addColumnOp).toBeDefined();
      // Column type must be schema-qualified and quoted to match enum creation
      expect(addColumnOp!.execute[0]!.sql).toContain('"public"."Status"');
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

function createTestContractWithEnumColumn(options: {
  enums: Record<string, StorageEnum>;
  columns: Record<string, { nativeType: string; codecId: string; nullable?: boolean }>;
}): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:contract',
    profileHash: 'sha256:profile',
    storage: {
      tables: {
        user: {
          columns: Object.fromEntries(
            Object.entries(options.columns).map(([name, col]) => [
              name,
              { nativeType: col.nativeType, codecId: col.codecId, nullable: col.nullable ?? false },
            ]),
          ),
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      enums: options.enums,
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
