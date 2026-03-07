import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import { coreHash } from '@prisma-next/contract/types';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { expectNarrowedType } from '@prisma-next/test-utils/typed-expectations';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

const emptySchema: SqlSchemaIR = {
  tables: {},
  extensions: [],
};

describe('PostgresMigrationPlanner - storage types', () => {
  it('plans type operations before table operations', () => {
    const planner = createPostgresMigrationPlanner();
    const hooks: CodecControlHooks = {
      planTypeOperations: (_options) => ({
        operations: [
          {
            id: 'type.Role',
            label: 'Create type Role',
            operationClass: 'additive',
            target: { id: 'postgres' },
            precheck: [],
            execute: [{ description: 'create type', sql: "CREATE TYPE role AS ENUM ('USER')" }],
            postcheck: [],
          },
        ],
      }),
    };

    const frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>> = [
      {
        kind: 'adapter',
        id: 'test',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.0-test',
        types: {
          codecTypes: {
            controlPlaneHooks: {
              'pg/enum@1': hooks,
            },
          },
        },
      },
    ];

    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: coreHash('sha256:contract'),
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              role: {
                nativeType: 'role',
                codecId: 'pg/enum@1',
                nullable: false,
                typeRef: 'Role',
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        types: {
          Role: {
            codecId: 'pg/enum@1',
            nativeType: 'role',
            typeParams: { values: ['USER'] },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
      sources: {},
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expectNarrowedType(result.kind === 'success');
    expect(result.plan.operations.map((op) => op.id)).toEqual(['type.Role', 'table.user']);
  });

  it('fails when storage type operations are non-additive under init policy', () => {
    const planner = createPostgresMigrationPlanner();
    const hooks: CodecControlHooks = {
      planTypeOperations: (_options) => ({
        operations: [
          {
            id: 'type.Role.drop',
            label: 'Drop type Role',
            operationClass: 'destructive',
            target: { id: 'postgres' },
            precheck: [],
            execute: [{ description: 'drop type', sql: 'DROP TYPE role' }],
            postcheck: [],
          },
        ],
      }),
    };

    const frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>> = [
      {
        kind: 'adapter',
        id: 'test',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.0-test',
        types: {
          codecTypes: {
            controlPlaneHooks: {
              'pg/enum@1': hooks,
            },
          },
        },
      },
    ];

    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: coreHash('sha256:contract'),
      storage: {
        tables: {},
        types: {
          Role: {
            codecId: 'pg/enum@1',
            nativeType: 'role',
            typeParams: { values: ['USER'] },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
      sources: {},
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [
        expect.objectContaining({
          kind: 'missingButNonAdditive',
        }),
      ],
    });
  });

  it('quotes custom type names in CREATE TABLE to preserve case', () => {
    const planner = createPostgresMigrationPlanner();
    const hooks: CodecControlHooks = {
      planTypeOperations: (_options) => ({
        operations: [
          {
            id: 'type.UserKind',
            label: 'Create type UserKind',
            operationClass: 'additive',
            target: { id: 'postgres' },
            precheck: [],
            execute: [
              { description: 'create type', sql: 'CREATE TYPE "UserKind" AS ENUM (\'ADMIN\')' },
            ],
            postcheck: [],
          },
        ],
      }),
    };

    const frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>> = [
      {
        kind: 'adapter',
        id: 'test',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.0-test',
        types: {
          codecTypes: {
            controlPlaneHooks: {
              'pg/enum@1': hooks,
            },
          },
        },
      },
    ];

    const contract: SqlContract<SqlStorage> = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: coreHash('sha256:contract'),
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              kind: {
                nativeType: 'UserKind',
                codecId: 'pg/enum@1',
                nullable: false,
                typeRef: 'UserKind',
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        types: {
          UserKind: {
            codecId: 'pg/enum@1',
            nativeType: 'UserKind',
            typeParams: { values: ['ADMIN', 'USER'] },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
      sources: {},
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents,
    });

    expectNarrowedType(result.kind === 'success');

    const tableOp = result.plan.operations.find((op) => op.id === 'table.user');
    expect(tableOp).toBeDefined();

    const createTableSql = tableOp!.execute[0]?.sql;

    // Custom type names must be quoted to preserve case in PostgreSQL
    // Without quotes, PostgreSQL lowercases "UserKind" to "userkind"
    expect(createTableSql).toContain('"UserKind"');
  });
});
