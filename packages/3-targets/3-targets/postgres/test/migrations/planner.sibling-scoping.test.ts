/**
 * Unit tests for the Postgres planner's ownership consultation: the aggregate
 * orchestration hands `plan()` an ownership oracle (the passive aggregate,
 * satisfying `SchemaOwnership`). For each live extra node the planner asks the
 * oracle whether any contract space owns it — a sibling-owned table is left
 * untouched, a truly-unclaimed table is dropped under a destructive policy.
 * No sibling-name list, no keep-predicate: ownership lives in the aggregate.
 */

import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import type { SchemaOwnership } from '@prisma-next/framework-components/control';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

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

function buildContract(): Contract<SqlStorage> {
  const schema = postgresCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      table: {
        app_user: new StorageTable({
          columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      policy: {},
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:sibling-scoping-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:sibling-scoping-test'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function buildLiveSchema(): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          app_user: new PostgresTableSchemaNode({
            name: 'app_user',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
          }),
          cipher_state: new PostgresTableSchemaNode({
            name: 'cipher_state',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
          }),
          orphan_table: new PostgresTableSchemaNode({
            name: 'orphan_table',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
          }),
        },
        nativeEnumTypeNames: [],
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

// An ownership oracle in which every named entity is owned by some contract
// space — as if the aggregate declared `cipher_state` (a sibling's table).
const ownsOnly = (...names: string[]): SchemaOwnership => {
  const owned = new Set(names);
  return { declaresEntity: (name) => owned.has(name) };
};

describe('Postgres planner ownership consultation', () => {
  it('drops every unclaimed table under a destructive policy when no ownership oracle is supplied', async () => {
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropIds = ops.filter((op) => op.id.startsWith('dropTable.')).map((op) => op.id);
    expect(dropIds.sort()).toEqual(['dropTable.cipher_state', 'dropTable.orphan_table']);
  });

  it('never drops a table another space owns, but still drops a truly unclaimed one', async () => {
    const planner = createPostgresMigrationPlanner(stubLowerer);

    // The aggregate declares `app_user` (this space) and `cipher_state` (a
    // sibling); `orphan_table` is owned by nobody.
    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      ownership: ownsOnly('app_user', 'cipher_state'),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropIds = ops.filter((op) => op.id.startsWith('dropTable.')).map((op) => op.id);
    expect(dropIds).toEqual(['dropTable.orphan_table']);
  });

  it('never drops anything additive-only, regardless of ownership', async () => {
    const planner = createPostgresMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.some((op) => op.id.startsWith('dropTable.'))).toBe(false);
  });

  it('drops an extra column on a table this space owns even when the oracle declares that table', async () => {
    // Ownership is consulted only for whole extra TABLES. A drifted column on
    // `app_user` (a table this space owns and the oracle declares) is this
    // space's own drift and must still be dropped — the oracle's positive
    // answer on the owning table must not suppress it.
    const liveWithDriftColumn = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            app_user: new PostgresTableSchemaNode({
              name: 'app_user',
              columns: {
                id: { name: 'id', nativeType: 'int4', nullable: false },
                legacy_col: { name: 'legacy_col', nativeType: 'text', nullable: true },
              },
              foreignKeys: [],
              uniques: [],
              indexes: [],
              policies: [],
            }),
          },
          nativeEnumTypeNames: [],
        }),
      },
      roles: [],
      existingSchemas: ['public'],
      pgVersion: 'unknown',
    });

    const planner = createPostgresMigrationPlanner(stubLowerer);
    const result = planner.plan({
      contract: buildContract(),
      schema: liveWithDriftColumn,
      policy: DB_UPDATE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      ownership: ownsOnly('app_user'),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropColumnIds = ops.filter((op) => op.id.startsWith('dropColumn.')).map((op) => op.id);
    expect(dropColumnIds).toEqual(['dropColumn.app_user.legacy_col']);
    expect(ops.some((op) => op.id.startsWith('dropTable.'))).toBe(false);
  });
});
