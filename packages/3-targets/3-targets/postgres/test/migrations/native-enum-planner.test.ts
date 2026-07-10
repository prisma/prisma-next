/**
 * Managed native-enum create/delete at the planner level (Phase 2 Slice A):
 * a missing managed enum lowers to `CREATE TYPE … AS ENUM` ordered before the
 * dependent table DDL; an unclaimed live enum lowers to `DROP TYPE` ordered
 * after dependent-table removal; a member-value mismatch is a NAMED
 * unsupported diagnostic (never silent, never drop-and-recreate); rendering
 * is schema-qualified, quoted, declaration-ordered, and literal-escaped; a
 * sibling-space-owned live enum is never dropped.
 */
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import {
  INIT_ADDITIVE_POLICY,
  type MigrationOperationPolicy,
} from '@prisma-next/family-sql/control';
import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import type {
  SchemaEntityCoordinate,
  SchemaOwnership,
} from '@prisma-next/framework-components/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { coordinateKey } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { buildPostgresPlanDiff } from '../../src/core/migrations/diff-database-schema';
import { coalesceSubtreeIssues, planIssues } from '../../src/core/migrations/issue-planner';
import {
  CreateNativeEnumTypeCall,
  DropNativeEnumTypeCall,
} from '../../src/core/migrations/op-factory-call';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import type { PostgresNativeEnumIntrospection } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

const MEMBERS = ['draft', 'review', 'done'] as const;

const stubLowerer: ExecuteRequestLowerer = {
  lower(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
  async lowerToExecuteRequest(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
};

const DB_UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

function makeContract(options: { readonly withEnum: boolean }): Contract<SqlStorage> {
  const schema = new PostgresSchema({
    id: 'sales',
    entries: {
      table: {
        orders: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            ...(options.withEnum
              ? { status: { nativeType: 'order_status', codecId: 'pg/enum@1', nullable: false } }
              : {}),
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      ...(options.withEnum
        ? {
            native_enum: {
              OrderStatus: {
                kind: 'postgres-enum',
                typeName: 'order_status',
                members: [...MEMBERS],
              },
            },
          }
        : {}),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:native-enum-planner'),
    defaultControlPolicy: 'managed',
    storage: new SqlStorage({
      storageHash: coreHash('sha256:native-enum-planner'),
      namespaces: { sales: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function ordersTableNode(options: { readonly withStatusColumn: boolean }) {
  return new PostgresTableSchemaNode({
    name: 'orders',
    columns: {
      id: { name: 'id', nativeType: 'int4', nullable: false, resolvedNativeType: 'int4' },
      ...(options.withStatusColumn
        ? {
            status: {
              name: 'status',
              nativeType: 'order_status',
              nullable: false,
              resolvedNativeType: 'order_status',
            },
          }
        : {}),
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
  });
}

function liveTree(options: {
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  readonly nativeEnums?: readonly PostgresNativeEnumIntrospection[];
}): PostgresDatabaseSchemaNode {
  const nativeEnums = options.nativeEnums ?? [];
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      sales: new PostgresNamespaceSchemaNode({
        schemaName: 'sales',
        tables: options.tables,
        nativeEnumTypeNames: nativeEnums.map((e) => e.typeName),
        nativeEnums,
      }),
    },
    roles: [],
    existingSchemas: ['sales'],
    pgVersion: 'unknown',
  });
}

function planResultFor(contract: Contract<SqlStorage>, actual: PostgresDatabaseSchemaNode) {
  const { issues } = buildPostgresPlanDiff({
    contract,
    actualSchema: actual,
    frameworkComponents: [],
  });
  return planIssues({
    issues: coalesceSubtreeIssues(issues),
    toContract: contract,
    fromContract: null,
    schemaName: 'sales',
    codecHooks: new Map(),
    storageTypes: contract.storage.types ?? {},
    strategies: [],
  });
}

function callsFor(contract: Contract<SqlStorage>, actual: PostgresDatabaseSchemaNode) {
  const result = planResultFor(contract, actual);
  if (!result.ok) throw new Error(`expected ok, got conflicts: ${JSON.stringify(result.failure)}`);
  return result.value.calls;
}

describe('managed enum create lowering + ordering', () => {
  it('a missing managed enum lowers to createNativeEnumType ordered BEFORE the dependent createTable', () => {
    const contract = makeContract({ withEnum: true });
    const actual = liveTree({ tables: {} });

    const factoryNames = callsFor(contract, actual).map((c) => c.factoryName);
    expect(factoryNames).toContain('createNativeEnumType');
    expect(factoryNames).toContain('createTable');
    expect(factoryNames.indexOf('createNativeEnumType')).toBeLessThan(
      factoryNames.indexOf('createTable'),
    );
  });

  it('the create call carries the schema, type name, and declaration-ordered members', () => {
    const contract = makeContract({ withEnum: true });
    const calls = callsFor(contract, liveTree({ tables: {} }));
    const create = calls.find((c) => c.factoryName === 'createNativeEnumType');
    expect(create).toMatchObject({
      schemaName: 'sales',
      typeName: 'order_status',
      members: [...MEMBERS],
    });
  });
});

describe('unclaimed enum drop lowering + ordering', () => {
  it('a live enum with no contract entity lowers to dropNativeEnumType ordered AFTER the dependent dropTable', () => {
    const contract = makeContract({ withEnum: false });
    const actual = liveTree({
      tables: { orders: ordersTableNode({ withStatusColumn: false }), legacy: legacyTable() },
      nativeEnums: [{ typeName: 'order_status', values: [...MEMBERS] }],
    });

    const factoryNames = callsFor(contract, actual).map((c) => c.factoryName);
    expect(factoryNames).toContain('dropNativeEnumType');
    expect(factoryNames).toContain('dropTable');
    expect(factoryNames.indexOf('dropTable')).toBeLessThan(
      factoryNames.indexOf('dropNativeEnumType'),
    );
  });
});

function legacyTable() {
  return new PostgresTableSchemaNode({
    name: 'legacy',
    columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
  });
}

describe('member-value mismatch is a named unsupported diagnostic', () => {
  it('a managed enum with drifted members fails planning with the named diagnostic — never a silent plan', () => {
    const contract = makeContract({ withEnum: true });
    const actual = liveTree({
      tables: { orders: ordersTableNode({ withStatusColumn: true }) },
      nativeEnums: [{ typeName: 'order_status', values: ['review', 'draft', 'done'] }],
    });

    const result = planResultFor(contract, actual);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      expect.objectContaining({
        kind: 'unsupportedOperation',
        summary: expect.stringMatching(/enum value changes are not auto-migrated yet/),
      }),
    ]);
    expect(result.failure[0]?.summary).toContain('order_status');
  });

  it('the mismatch diagnostic never plans a DROP TYPE + CREATE TYPE pair (no drop-recreate)', () => {
    const contract = makeContract({ withEnum: true });
    const actual = liveTree({
      tables: { orders: ordersTableNode({ withStatusColumn: true }) },
      nativeEnums: [{ typeName: 'order_status', values: ['review', 'draft', 'done'] }],
    });

    const result = planResultFor(contract, actual);
    expect(result.ok).toBe(false);
  });
});

describe('op rendering (SQL)', () => {
  it('CREATE TYPE is schema-qualified, quoted, declaration-ordered, and single-quote-escaped', () => {
    const call = new CreateNativeEnumTypeCall('sales', 'order status', [
      'draft',
      "it's reviewed",
      'done',
    ]);
    const op = call.toOp();
    expect(op.execute[0]?.sql).toBe(
      `CREATE TYPE "sales"."order status" AS ENUM ('draft', 'it''s reviewed', 'done')`,
    );
    expect(op.operationClass).toBe('additive');
  });

  it('DROP TYPE is schema-qualified and quoted', () => {
    const op = new DropNativeEnumTypeCall('sales', 'order_status').toOp();
    expect(op.execute[0]?.sql).toBe(`DROP TYPE "sales"."order_status"`);
    expect(op.operationClass).toBe('destructive');
  });

  it('an unbound-namespace create renders unqualified so search_path resolves it', () => {
    const op = new CreateNativeEnumTypeCall('__unbound__', 'mood', ['happy']).toOp();
    expect(op.execute[0]?.sql).toBe(`CREATE TYPE "mood" AS ENUM ('happy')`);
  });
});

describe('planner ownership + policy for enum extras', () => {
  const ownsOnly = (...coordinates: readonly SchemaEntityCoordinate[]): SchemaOwnership => {
    const owned = new Set(coordinates.map(coordinateKey));
    return { declaresEntity: (coordinate) => owned.has(coordinateKey(coordinate)) };
  };

  function planLive(
    ownership?: SchemaOwnership,
    policy: MigrationOperationPolicy = DB_UPDATE_POLICY,
  ) {
    const planner = createPostgresMigrationPlanner(stubLowerer);
    return planner.plan({
      contract: makeContract({ withEnum: false }),
      schema: liveTree({
        tables: { orders: ordersTableNode({ withStatusColumn: false }) },
        nativeEnums: [{ typeName: 'order_status', values: [...MEMBERS] }],
      }),
      policy,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      ...(ownership !== undefined ? { ownership } : {}),
    });
  }

  it('never drops a live enum a sibling space declares at its type-name coordinate', async () => {
    const result = planLive(
      ownsOnly({ namespaceId: 'sales', entityKind: 'native_enum', entityName: 'order_status' }),
    );
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.some((op) => op.id.startsWith('dropNativeEnumType.'))).toBe(false);
  });

  it('drops a truly unclaimed live enum under a destructive policy', async () => {
    const result = planLive(ownsOnly());
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.some((op) => op.id.startsWith('dropNativeEnumType.'))).toBe(true);
  });

  it('never drops an enum additive-only, regardless of ownership', async () => {
    const result = planLive(undefined, INIT_ADDITIVE_POLICY);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.some((op) => op.id.startsWith('dropNativeEnumType.'))).toBe(false);
  });
});
