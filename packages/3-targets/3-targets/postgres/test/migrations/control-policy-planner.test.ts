import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type {
  MigrationOperationPolicy,
  SchemaIssue,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlStorage, type StorageTableInput } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { planIssues } from '../../src/core/migrations/issue-planner';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';

function makeContract(
  tables: Record<string, StorageTableInput>,
  defaultControlPolicy?: Contract<SqlStorage>['defaultControlPolicy'],
): Contract<SqlStorage> {
  const unboundNs = postgresCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    tables,
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

const plannerCtx = {
  schemaName: 'public',
  codecHooks: new Map(),
  storageTypes: {},
  fromContract: null,
};

function plan(
  issues: readonly SchemaIssue[],
  toContract: Contract<SqlStorage>,
): {
  calls: readonly { factoryName: string }[];
} {
  const result = planIssues({
    ...plannerCtx,
    issues,
    toContract,
    storageTypes: toContract.storage.types ?? {},
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok');
  return result.value;
}

describe('planIssues control policy', () => {
  describe('managed table', () => {
    const toContract = makeContract({
      users: {
        columns: { id: baseColumn, email: baseColumn },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    it('emits create for missing_table', () => {
      const { calls } = plan(
        [{ kind: 'missing_table', table: 'users', namespaceId: UNBOUND_NAMESPACE_ID, message: '' }],
        toContract,
      );
      expect(calls.some((c) => c.factoryName === 'createTable')).toBe(true);
    });

    it('emits drop for extra_table', () => {
      const { calls } = plan([{ kind: 'extra_table', table: 'users', message: '' }], toContract);
      expect(calls.some((c) => c.factoryName === 'dropTable')).toBe(true);
    });

    it('emits alter for type_mismatch on existing column', () => {
      const { calls } = plan(
        [
          {
            kind: 'type_mismatch',
            table: 'users',
            column: 'email',
            namespaceId: UNBOUND_NAMESPACE_ID,
            message: '',
          },
        ],
        toContract,
      );
      expect(calls.some((c) => c.factoryName === 'alterColumnType')).toBe(true);
    });
  });

  describe('tolerated table', () => {
    const toContract = makeContract({
      users: {
        control: 'tolerated',
        columns: { id: baseColumn },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    it('emits create for an entirely-absent table', () => {
      const { calls } = plan(
        [{ kind: 'missing_table', table: 'users', namespaceId: UNBOUND_NAMESPACE_ID, message: '' }],
        toContract,
      );
      expect(calls.some((c) => c.factoryName === 'createTable')).toBe(true);
    });

    it('suppresses add column for an existing table missing a column', () => {
      const nullableColumn = { nativeType: 'text', codecId: 'pg/text@1', nullable: true };
      const withEmail = makeContract({
        users: {
          control: 'tolerated',
          columns: { id: baseColumn, email: nullableColumn },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      });
      const { calls } = plan(
        [
          {
            kind: 'missing_column',
            table: 'users',
            column: 'email',
            namespaceId: UNBOUND_NAMESPACE_ID,
            message: '',
          },
        ],
        withEmail,
      );
      expect(calls).toHaveLength(0);
    });

    it('suppresses drop for extra_table', () => {
      const { calls } = plan([{ kind: 'extra_table', table: 'users', message: '' }], toContract);
      expect(calls).toHaveLength(0);
    });

    it('suppresses alter for type_mismatch', () => {
      const { calls } = plan(
        [
          {
            kind: 'type_mismatch',
            table: 'users',
            column: 'id',
            namespaceId: UNBOUND_NAMESPACE_ID,
            message: '',
          },
        ],
        toContract,
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe('external table', () => {
    const toContract = makeContract({
      users: {
        control: 'external',
        columns: { id: baseColumn },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    it('emits no DDL', () => {
      const { calls } = plan(
        [
          { kind: 'missing_table', table: 'users', namespaceId: UNBOUND_NAMESPACE_ID, message: '' },
          { kind: 'extra_table', table: 'users', message: '' },
        ],
        toContract,
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe('observed table', () => {
    const toContract = makeContract({
      users: {
        control: 'observed',
        columns: { id: baseColumn },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    });

    it('emits no DDL', () => {
      const { calls } = plan(
        [{ kind: 'missing_table', table: 'users', namespaceId: UNBOUND_NAMESPACE_ID, message: '' }],
        toContract,
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe('external defaultControlPolicy floor', () => {
    it('suppresses managed-override object DDL (the floor wins)', () => {
      const toContract = makeContract(
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
      const { calls } = plan(
        [{ kind: 'missing_table', table: 'users', namespaceId: UNBOUND_NAMESPACE_ID, message: '' }],
        toContract,
      );
      expect(calls).toHaveLength(0);
    });

    it('proceeds without hard failure when floor suppresses DDL', () => {
      const toContract = makeContract(
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
      const result = planIssues({
        ...plannerCtx,
        issues: [
          { kind: 'missing_table', table: 'users', namespaceId: UNBOUND_NAMESPACE_ID, message: '' },
        ],
        toContract,
        storageTypes: {},
      });
      expect(result.ok).toBe(true);
    });
  });
});

// Exercises the gating through `PostgresMigrationPlanner.plan(...)`: the live
// schema → verify → plan path the planner wires end-to-end, rather than the
// `planIssues(...)` entry point the suite above calls directly. A `tolerated`
// table that already exists in the database may grow new objects but never
// be modified in place, so an add-column for a missing column is non-create
// DDL and must be suppressed; the same diff under `managed` emits it.
describe('PostgresMigrationPlanner.plan control-policy gating', () => {
  const RECONCILIATION_POLICY: MigrationOperationPolicy = {
    allowedOperationClasses: ['additive', 'widening', 'destructive'],
  };
  const nullableColumn = { nativeType: 'text', codecId: 'pg/text@1', nullable: true };
  const planner = createPostgresMigrationPlanner();

  // The live database already has `users` with only `id`; the contract adds a
  // nullable `email`, so verify emits a single additive add-column issue.
  const liveSchemaWithUsersIdOnly: SqlSchemaIR = {
    tables: {
      users: {
        name: 'users',
        columns: { id: { name: 'id', nativeType: 'text', nullable: false } },
        primaryKey: { columns: ['id'] },
        uniques: [],
        foreignKeys: [],
        indexes: [],
      },
    },
  };

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
