import { coreHash, profileHash } from '@prisma-next/contract/types';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

function createTestContract(
  storage: SqlStorage,
  overrides?: Partial<SqlContract<SqlStorage>>,
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash('sha256:test'),
    profileHash: profileHash('sha256:profile'),
    storage,
    models: {},
    relations: {},
    mappings: { codecTypes: {}, operationTypes: {} },
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

describe('contractToSchemaIR → planner round-trip', () => {
  it('produces no ops when contract and schemaIR represent the same state', () => {
    const storage: SqlStorage = {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
          indexes: [{ columns: ['name'] }],
          foreignKeys: [],
        },
      },
    };

    const contract = createTestContract(storage);
    const schemaIR = contractToSchemaIR(storage);
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract,
      schema: schemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations).toHaveLength(0);
    }
  });

  it('detects additive changes from empty state', () => {
    const storage: SqlStorage = {
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
    };

    const contract = createTestContract(storage);
    const emptySchemaIR = contractToSchemaIR({ tables: {} });
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract,
      schema: emptySchemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations.length).toBeGreaterThan(0);
      const tableOp = result.plan.operations.find((op) => op.id.includes('user'));
      expect(tableOp).toBeDefined();
    }
  });

  it('detects incremental table addition', () => {
    const fromStorage: SqlStorage = {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    };

    const toStorage: SqlStorage = {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    };

    const contract = createTestContract(toStorage);
    const fromSchemaIR = contractToSchemaIR(fromStorage);
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract,
      schema: fromSchemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      const postOp = result.plan.operations.find((op) => op.id.includes('post'));
      expect(postOp).toBeDefined();
      const userOp = result.plan.operations.find(
        (op) => op.id.startsWith('table.') && op.id.includes('user'),
      );
      expect(userOp).toBeUndefined();
    }
  });

  it('handles default values in round-trip', () => {
    const storage: SqlStorage = {
      tables: {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            status: {
              nativeType: 'text',
              codecId: 'pg/text@1',
              nullable: false,
              default: { kind: 'literal', expression: "'active'" },
            },
            createdAt: {
              nativeType: 'timestamptz',
              codecId: 'pg/timestamptz@1',
              nullable: false,
              default: { kind: 'function', expression: 'now()' },
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    };

    const contract = createTestContract(storage);
    const schemaIR = contractToSchemaIR(storage);
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract,
      schema: schemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations).toHaveLength(0);
    }
  });
});
