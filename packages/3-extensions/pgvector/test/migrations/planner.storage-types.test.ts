import { type Contract, coreHash, domainPlaneOf, profileHash } from '@prisma-next/contract/types';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  buildSqlNamespace,
  SqlStorage,
  SqlUnboundNamespace,
} from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { createPostgresMigrationPlanner } from '@prisma-next/target-postgres/planner';
import { expectNarrowedType } from '@prisma-next/test-utils/typed-expectations';
import { describe, expect, it } from 'vitest';
import pgvectorDescriptor from '../../src/exports/control';

const emptySchema: SqlSchemaIR = {
  tables: {},
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

    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:test'),
        types: {
          Role: {
            kind: 'codec-instance',
            codecId: 'pg/enum@1',
            nativeType: 'role',
            typeParams: { values: ['USER'] },
          },
        },
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({
            id: UNBOUND_NAMESPACE_ID,
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
          }),
        },
      }),
      roots: {},
      domain: domainPlaneOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
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

    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:test'),
        types: {
          Role: {
            kind: 'codec-instance',
            codecId: 'pg/enum@1',
            nativeType: 'role',
            typeParams: { values: ['USER'] },
          },
        },
        namespaces: { [UNBOUND_NAMESPACE_ID]: SqlUnboundNamespace.instance },
      }),
      roots: {},
      domain: domainPlaneOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
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

    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:test'),
        types: {
          UserKind: {
            kind: 'codec-instance',
            codecId: 'pg/enum@1',
            nativeType: 'UserKind',
            typeParams: { values: ['ADMIN', 'USER'] },
          },
        },
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({
            id: UNBOUND_NAMESPACE_ID,
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
          }),
        },
      }),
      roots: {},
      domain: domainPlaneOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });

    expectNarrowedType(result.kind === 'success');

    const tableOp = result.plan.operations.find((op) => op.id === 'table.user');
    expect(tableOp).toBeDefined();

    const createTableSql = tableOp!.execute[0]?.sql;

    // Custom type names must be quoted to preserve case in PostgreSQL
    // Without quotes, PostgreSQL lowercases "UserKind" to "userkind"
    expect(createTableSql).toContain('"UserKind"');
  });

  it('expands parameterized storage type refs when creating tables', () => {
    const planner = createPostgresMigrationPlanner();
    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:test'),
        types: {
          Embedding1536: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({
            id: UNBOUND_NAMESPACE_ID,
            tables: {
              document: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  embedding: {
                    nativeType: 'vector',
                    codecId: 'pg/vector@1',
                    nullable: false,
                    typeRef: 'Embedding1536',
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          }),
        },
      }),
      roots: {},
      domain: domainPlaneOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [pgvectorDescriptor],
      spaceId: APP_SPACE_ID,
    });

    expectNarrowedType(result.kind === 'success');

    const tableOp = result.plan.operations.find((op) => op.id === 'table.document');
    expect(tableOp).toBeDefined();

    const createTableSql = tableOp?.execute[0]?.sql ?? '';
    expect(createTableSql).toContain('"embedding" vector(1536) NOT NULL');
    expect(createTableSql).not.toContain('"embedding" "vector(1536)"');
  });

  it('fails when parameterized storage type refs cannot expand without codec hooks', () => {
    const planner = createPostgresMigrationPlanner();
    const contract: Contract<SqlStorage> = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage: new SqlStorage({
        storageHash: coreHash('sha256:test'),
        types: {
          Embedding1536: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({
            id: UNBOUND_NAMESPACE_ID,
            tables: {
              document: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  embedding: {
                    nativeType: 'vector',
                    codecId: 'pg/vector@1',
                    nullable: false,
                    typeRef: 'Embedding1536',
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          }),
        },
      }),
      roots: {},
      domain: domainPlaneOf({ models: {} }),
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };

    expect(() =>
      planner.plan({
        contract,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
      }),
    ).toThrow(
      'Column declares typeParams for nativeType "vector" but no expandNativeType hook is registered for codecId "pg/vector@1".',
    );
  });
});
