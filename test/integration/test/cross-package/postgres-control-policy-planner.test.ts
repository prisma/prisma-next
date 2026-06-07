import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { MigrationOperationPolicy } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, type StorageTableInput } from '@prisma-next/sql-contract/types';
import type { AnyQueryAst, DdlNode, LowererContext } from '@prisma-next/sql-relational-core/ast';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { PostgresDdlNode } from '@prisma-next/target-postgres/ddl';
import { createPostgresMigrationPlanner } from '@prisma-next/target-postgres/planner';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';

function makeContract(
  tables: Record<string, StorageTableInput>,
  defaultControlPolicy?: Contract<SqlStorage>['defaultControlPolicy'],
): Contract<SqlStorage> {
  const unboundNs = postgresCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: tables },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:contract'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: unboundNs },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
    ...(defaultControlPolicy !== undefined ? { defaultControlPolicy } : {}),
  };
}

const baseColumn = { nativeType: 'text', codecId: 'pg/text@1', nullable: false };
const nullableColumn = { nativeType: 'text', codecId: 'pg/text@1', nullable: true };

const RECONCILIATION_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const testAdapter = createPostgresAdapter();
const planner = createPostgresMigrationPlanner({
  lower(ast: AnyQueryAst | DdlNode, ctx: LowererContext<unknown>) {
    return testAdapter.lower(
      ast as AnyQueryAst | PostgresDdlNode,
      ctx as Parameters<typeof testAdapter.lower>[1],
    );
  },
});

const emptySchema: SqlSchemaIR = { tables: {} };

function liveSchemaWithUsers(
  columns: Record<string, { name: string; nativeType: string; nullable: boolean }>,
): SqlSchemaIR {
  return {
    tables: {
      users: {
        name: 'users',
        columns,
        primaryKey: { columns: ['id'] },
        uniques: [],
        foreignKeys: [],
        indexes: [],
      },
    },
  };
}

function planAgainst(contract: Contract<SqlStorage>, schema: SqlSchemaIR) {
  const result = planner.plan({
    contract,
    schema,
    policy: RECONCILIATION_POLICY,
    fromContract: null,
    frameworkComponents: [],
    spaceId: 'app',
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error('expected planner success');
  return { operations: result.plan.operations, warnings: result.warnings };
}

// Exercises the input-side partition that gates the planner: the live
// schema → verify → partition → plan path. Control-policy filtering is no
// longer a post-pass on generated DDL; subjects governed by `external` /
// `observed`, and non-creation issues for `tolerated` subjects, never enter
// `planIssues`. The tests pin "this subject's diff never ran" by asserting
// zero operations and the corresponding suppressed-subject warning.
describe('PostgresMigrationPlanner.plan control-policy partitioning', () => {
  describe('managed', () => {
    const contract = makeContract({
      users: {
        columns: { id: baseColumn, email: baseColumn },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    it('emits createTable when the live schema is empty', () => {
      const { operations } = planAgainst(contract, emptySchema);
      expect(operations.some((o) => o.id.startsWith('table.users'))).toBe(true);
    });
  });

  describe('tolerated', () => {
    function toleratedContract(extraColumns: Record<string, typeof baseColumn> = {}) {
      return makeContract({
        users: {
          control: 'tolerated',
          columns: { id: baseColumn, ...extraColumns },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      });
    }

    it('emits createTable for an entirely-absent tolerated table', () => {
      const { operations } = planAgainst(toleratedContract(), emptySchema);
      expect(operations.some((o) => o.id.startsWith('table.users'))).toBe(true);
    });

    it('skips diffing an existing tolerated table — no DDL even when contract adds a column', () => {
      // Live DB has `users(id)`; contract adds nullable `email`. Under
      // tolerated semantics, the missing-column issue is suppressed at the
      // input partition.
      const contract = toleratedContract({ email: nullableColumn });
      const live = liveSchemaWithUsers({ id: { name: 'id', nativeType: 'text', nullable: false } });
      const result = planAgainst(contract, live);
      expect(result.operations).toHaveLength(0);
      expect(result.warnings ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'controlPolicySuppressedCall',
            summary: expect.stringContaining(
              "namespace '__unbound__' has effective control 'tolerated'",
            ),
          }),
        ]),
      );
    });

    it('emits createTable for a tolerated table whose live shape is absent (diff engine is short-circuited)', () => {
      // The diff engine never sees an existing tolerated table — it only
      // ever sees the create path. This pins the create-if-absent semantic.
      const contract = toleratedContract({ email: nullableColumn });
      const { operations } = planAgainst(contract, emptySchema);
      expect(operations.some((o) => o.id.startsWith('table.users'))).toBe(true);
    });
  });

  describe('external', () => {
    const contract = makeContract({
      users: {
        control: 'external',
        columns: { id: baseColumn },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    it('emits zero DDL and one suppressed-subject warning, regardless of live state', () => {
      const result = planAgainst(contract, emptySchema);
      expect(result.operations).toHaveLength(0);
      expect(result.warnings ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'controlPolicySuppressedCall',
            summary: expect.stringContaining(
              "namespace '__unbound__' has effective control 'external'",
            ),
          }),
        ]),
      );
    });
  });

  describe('observed', () => {
    const contract = makeContract({
      users: {
        control: 'observed',
        columns: { id: baseColumn },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    it('emits zero DDL and one suppressed-subject warning', () => {
      const result = planAgainst(contract, emptySchema);
      expect(result.operations).toHaveLength(0);
      expect(result.warnings ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'controlPolicySuppressedCall',
            summary: expect.stringContaining(
              "namespace '__unbound__' has effective control 'observed'",
            ),
          }),
        ]),
      );
    });
  });

  describe('external defaultControlPolicy floor', () => {
    it('suppresses managed-override object DDL (the floor wins) and emits the floor warning', () => {
      const contract = makeContract(
        {
          users: {
            control: 'managed',
            columns: { id: baseColumn },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        'external',
      );
      const result = planAgainst(contract, emptySchema);
      expect(result.operations).toHaveLength(0);
      expect(result.warnings ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'controlPolicySuppressedCall',
            summary: expect.stringContaining(
              "has effective control 'external' but table declared 'managed'",
            ),
          }),
        ]),
      );
    });
  });
});

// Mirror of the planner-level gating tests from before the input-side
// refactor: control policy partitions at the planner's entry point, so a
// `tolerated` table that already exists in the database may grow new objects
// but never be modified in place. The same diff under `managed` emits the
// add-column.
describe('PostgresMigrationPlanner.plan tolerated vs managed add-column', () => {
  const liveSchemaWithUsersIdOnly: SqlSchemaIR = liveSchemaWithUsers({
    id: { name: 'id', nativeType: 'text', nullable: false },
  });

  function planAddColumn(control: 'managed' | 'tolerated') {
    const contract = makeContract({
      users: {
        control,
        columns: { id: baseColumn, email: nullableColumn },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });
    const result = planner.plan({
      contract,
      schema: liveSchemaWithUsersIdOnly,
      policy: RECONCILIATION_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: 'app',
    });
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected planner success');
    return result.plan;
  }

  it('suppresses a tolerated table add-column', () => {
    const plan = planAddColumn('tolerated');
    expect(plan.operations).toHaveLength(0);
  });

  it('emits the add-column when the same table is managed', () => {
    const plan = planAddColumn('managed');
    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'column.users.email', operationClass: 'additive' }),
      ]),
    );
  });
});
