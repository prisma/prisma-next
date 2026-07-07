/**
 * Unit tests for the SQLite planner's sibling-space scoping: the aggregate
 * orchestration hands `plan()` the bare entity names another contract space
 * declares (`siblingOwnedEntityNames`), and the planner must never emit a
 * destructive op against one of those tables — while still dropping a truly
 * unclaimed table under a destructive policy. Replaces the retired
 * `keepDiffIssue` predicate mechanism.
 */

import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => {
    throw new Error('lower() called on stubLowerer — planner must use lowerToExecuteRequest()');
  },
  lowerToExecuteRequest: async () => ({ sql: '', params: [] }),
};

function buildContract(): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:sibling-scoping-test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:sibling-scoping-test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              app_user: {
                columns: {
                  id: { nativeType: 'integer', codecId: 'sqlite/integer@1', nullable: false },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function buildLiveSchema(): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: {
      app_user: {
        name: 'app_user',
        columns: { id: { name: 'id', nativeType: 'integer', nullable: false } },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
      cipher_state: {
        name: 'cipher_state',
        columns: { id: { name: 'id', nativeType: 'integer', nullable: false } },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
      orphan_table: {
        name: 'orphan_table',
        columns: { id: { name: 'id', nativeType: 'integer', nullable: false } },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    },
  });
}

describe('SQLite planner sibling-space scoping', () => {
  it('drops every unclaimed table under a destructive policy when no ownership is supplied', async () => {
    const planner = createSqliteMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
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

  it('never drops a table declared by a sibling contract space, but still drops a truly unclaimed one', async () => {
    const planner = createSqliteMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      siblingOwnedEntityNames: new Set(['cipher_state']),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropIds = ops.filter((op) => op.id.startsWith('dropTable.')).map((op) => op.id);
    expect(dropIds).toEqual(['dropTable.orphan_table']);
  });

  it('never drops anything additive-only, regardless of sibling ownership', async () => {
    const planner = createSqliteMigrationPlanner(stubLowerer);

    const result = planner.plan({
      contract: buildContract(),
      schema: buildLiveSchema(),
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.some((op) => op.id.startsWith('dropTable.'))).toBe(false);
  });
});
