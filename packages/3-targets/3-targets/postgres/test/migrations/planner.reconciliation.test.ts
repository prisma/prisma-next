import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { MigrationOperationPolicy } from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

const RECONCILIATION_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const WIDENING_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

describe('PostgresMigrationPlanner - reconciliation planning', () => {
  const planner = createPostgresMigrationPlanner();

  it('plans destructive drop for extra column when policy allows destructive', () => {
    const contract = createContract({
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
    });

    const schema: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false },
            email: { name: 'email', nativeType: 'text', nullable: false },
            legacyEmail: { name: 'legacyEmail', nativeType: 'text', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
        },
      },
      dependencies: [],
    };

    const result = planner.plan({
      contract,
      schema,
      policy: RECONCILIATION_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`expected planner success, got: ${JSON.stringify(result)}`);
    }
    expect(result.plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dropColumn.user.legacyEmail',
          operationClass: 'destructive',
        }),
      ]),
    );
  });

  it('plans widening operation for nullability relaxation when policy allows widening', () => {
    const contract = createContract({
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

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
          indexes: [],
        },
      },
      dependencies: [],
    };

    const result = planner.plan({
      contract,
      schema,
      policy: WIDENING_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`expected planner success, got: ${JSON.stringify(result)}`);
    }
    expect(result.plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'alterNullability.user.email',
          operationClass: 'widening',
        }),
      ]),
    );
  });

  it('returns conflict when destructive operation is required but policy forbids it', () => {
    const contract = createContract({
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    const schema: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false },
            legacyEmail: { name: 'legacyEmail', nativeType: 'text', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          foreignKeys: [],
          indexes: [],
        },
      },
      dependencies: [],
    };

    const result = planner.plan({
      contract,
      schema,
      policy: WIDENING_POLICY,
      frameworkComponents: [],
    });

    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [expect.objectContaining({ kind: 'missingButNonAdditive' })],
    });
  });
});

function createContract(
  tables: SqlContract<SqlStorage>['storage']['tables'],
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash('sha256:reconciliation-contract'),
    profileHash: profileHash('sha256:reconciliation-profile'),
    storage: { tables },
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };
}
