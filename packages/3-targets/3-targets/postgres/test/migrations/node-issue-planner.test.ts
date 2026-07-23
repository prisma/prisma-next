import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { buildPostgresPlanDiff } from '../../src/core/migrations/diff-database-schema';
import {
  coalesceSubtreeIssues,
  mapNodeIssueToCall,
  nodeIssueOrder,
  planIssues as planNodeIssues,
} from '../../src/core/migrations/issue-planner';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

/**
 * Direct coverage for the node-based Postgres planner (the one-differ path):
 * `buildPostgresPlanDiff` (tree diff) → `mapNodeIssueToCall` / `planIssues`
 * (node → op), now wired into `PostgresMigrationPlanner`. This suite passes
 * `strategies: []` deliberately, so it drives the default per-issue mapper
 * directly — the real `postgresPlannerStrategies` list (NOT-NULL backfill,
 * type-change, nullable-tightening, check constraints, codec storage types,
 * shared-temp-default add-column) is covered by the cross-package planner /
 * control-policy suites and `rls-planner.test.ts`.
 */

type TableSpec = ConstructorParameters<typeof StorageTable>[0];

function makeContract(tables: Record<string, TableSpec>): Contract<SqlStorage> {
  const publicSchema = new PostgresSchema({
    id: 'public',
    entries: {
      table: Object.fromEntries(
        Object.entries(tables).map(([name, spec]) => [name, new StorageTable(spec)]),
      ),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('node-planner'),
    storage: new SqlStorage({
      storageHash: coreHash('node-planner'),
      namespaces: { public: publicSchema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function emptyRoot(): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {},
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

function rootOf(tables: Record<string, PostgresTableSchemaNode>): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables,
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

const userTable: TableSpec = {
  columns: {
    id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
    email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
  },
  primaryKey: { columns: ['id'] },
  foreignKeys: [],
  uniques: [],
  indexes: [],
};

function planFor(contract: Contract<SqlStorage>, actual: PostgresDatabaseSchemaNode) {
  const { issues } = buildPostgresPlanDiff({
    contract,
    actualSchema: actual,
    frameworkComponents: [],
  });
  // Subtree coalescing is the planner's responsibility (per the differ's
  // contract) — the total differ emits an issue for every node in a
  // missing/extra subtree, redundant once the table-level call accounts for it.
  const coalesced = coalesceSubtreeIssues(issues);
  const result = planNodeIssues({
    issues: coalesced,
    toContract: contract,
    fromContract: null,
    schemaName: 'public',
    codecHooks: new Map(),
    storageTypes: contract.storage.types ?? {},
    // The default per-issue mapper is what this suite pins — the real
    // strategy list is covered elsewhere (see module docstring).
    strategies: [],
  });
  if (!result.ok) throw new Error(`expected ok, got conflicts: ${JSON.stringify(result.failure)}`);
  return result.value.calls;
}

describe('buildPostgresPlanDiff + planNodeIssues (one-differ path)', () => {
  it('a fresh table becomes CreateTable (+ PK inline)', () => {
    const contract = makeContract({ user: userTable });
    const calls = planFor(contract, emptyRoot());
    expect(calls.map((c) => c.factoryName)).toEqual(['createTable']);
    expect(calls[0]).toMatchObject({
      factoryName: 'createTable',
      tableName: 'user',
      schemaName: 'public',
    });
  });

  it('a fresh table with an index / FK / unique emits the child constraint calls', () => {
    const contract = makeContract({
      user: userTable,
      post: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          userId: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          slug: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          {
            source: { namespaceId: 'public', tableName: 'post', columns: ['userId'] },
            target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
            constraint: true,
            index: true,
          },
        ],
        uniques: [{ columns: ['slug'] }],
        indexes: [{ columns: ['slug'] }],
      },
    });
    const factoryNames = planFor(contract, emptyRoot()).map((c) => c.factoryName);
    // Emission buckets: table → unique → index → foreignKey.
    expect(factoryNames).toContain('createTable');
    expect(factoryNames).toContain('addUnique');
    expect(factoryNames).toContain('createIndex');
    expect(factoryNames).toContain('addForeignKey');
    expect(factoryNames.indexOf('addUnique')).toBeLessThan(factoryNames.indexOf('createIndex'));
    expect(factoryNames.indexOf('createIndex')).toBeLessThan(factoryNames.indexOf('addForeignKey'));
  });

  it('a missing column on an existing table becomes AddColumn', () => {
    const contract = makeContract({ user: userTable });
    const actual = rootOf({
      user: new PostgresTableSchemaNode({
        name: 'user',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const calls = planFor(contract, actual);
    expect(calls.map((c) => c.factoryName)).toEqual(['addColumn']);
    expect(calls[0]).toMatchObject({
      factoryName: 'addColumn',
      tableName: 'user',
      column: { name: 'email' },
    });
  });

  it('an extra live column becomes DropColumn (strict)', () => {
    const contract = makeContract({ user: userTable });
    const actual = rootOf({
      user: new PostgresTableSchemaNode({
        name: 'user',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
          email: { name: 'email', nativeType: 'text', nullable: false, resolvedNativeType: 'text' },
          legacy: {
            name: 'legacy',
            nativeType: 'text',
            nullable: true,
            resolvedNativeType: 'text',
          },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const calls = planFor(contract, actual);
    expect(calls.map((c) => c.factoryName)).toEqual(['dropColumn']);
    expect(calls[0]).toMatchObject({ factoryName: 'dropColumn', columnName: 'legacy' });
  });

  it('a type + nullability drift on one column emits AlterColumnType then the nullability op', () => {
    const contract = makeContract({
      user: {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          age: { nativeType: 'int8', codecId: 'pg/int8@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    });
    const actual = rootOf({
      user: new PostgresTableSchemaNode({
        name: 'user',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
          age: { name: 'age', nativeType: 'int4', nullable: true, resolvedNativeType: 'int4' },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const calls = planFor(contract, actual);
    expect(calls.map((c) => c.factoryName)).toEqual(['alterColumnType', 'setNotNull']);
  });

  it('an extra live table becomes DropTable (strict)', () => {
    const contract = makeContract({ user: userTable });
    const actual = rootOf({
      user: new PostgresTableSchemaNode({
        name: 'user',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
          email: { name: 'email', nativeType: 'text', nullable: false, resolvedNativeType: 'text' },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
      orphan: new PostgresTableSchemaNode({
        name: 'orphan',
        columns: {
          id: { name: 'id', nativeType: 'uuid', nullable: false, resolvedNativeType: 'uuid' },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
        rlsEnabled: false,
      }),
    });
    const calls = planFor(contract, actual);
    expect(calls.map((c) => c.factoryName)).toEqual(['dropTable']);
    expect(calls[0]).toMatchObject({ factoryName: 'dropTable', tableName: 'orphan' });
  });
});

describe('mapNodeIssueToCall — synthesized namespace issue', () => {
  it('a postgres-namespace not-found becomes CreateSchema', () => {
    const namespace = new PostgresNamespaceSchemaNode({
      schemaName: 'auth',
      tables: {},
    });
    const issue: SchemaDiffIssue = {
      path: ['database', 'auth'],
      reason: 'not-found',
      expected: namespace,
    };
    const ctx = {
      toContract: makeContract({ user: userTable }),
      fromContract: null,
      schemaName: 'public',
      codecHooks: new Map(),
      storageTypes: {},
      schema: undefined as never,
      policy: { allowedOperationClasses: ['additive'] as const },
      frameworkComponents: [],
    };
    const result = mapNodeIssueToCall(issue, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.map((c) => c.factoryName)).toEqual(['createSchema']);
    expect(result.value[0]).toMatchObject({ factoryName: 'createSchema', schemaName: 'auth' });
    expect(nodeIssueOrder(issue)).toBe(1);
  });
});

describe('mapNodeIssueToCall — table rlsEnabled drift', () => {
  const ctx = {
    toContract: makeContract({ user: userTable }),
    fromContract: null,
    schemaName: 'public',
    codecHooks: new Map(),
    storageTypes: {},
    schema: undefined as never,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const },
    frameworkComponents: [],
  };

  function tableNode(rlsEnabled: boolean): PostgresTableSchemaNode {
    return new PostgresTableSchemaNode({
      name: 'user',
      columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
      primaryKey: { columns: ['id'] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
      policies: [],
      rlsEnabled,
    });
  }

  function notEqualIssue(
    expected: PostgresTableSchemaNode,
    actual: PostgresTableSchemaNode,
  ): SchemaDiffIssue {
    return {
      path: ['database', 'public', 'user'],
      reason: 'not-equal',
      expected,
      actual,
    };
  }

  it('maps expected-on / actual-off to enableRowLevelSecurity', () => {
    const result = mapNodeIssueToCall(notEqualIssue(tableNode(true), tableNode(false)), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.map((c) => c.factoryName)).toEqual(['enableRowLevelSecurity']);
  });

  it('maps expected-off / actual-on to disableRowLevelSecurity', () => {
    const result = mapNodeIssueToCall(notEqualIssue(tableNode(false), tableNode(true)), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.map((c) => c.factoryName)).toEqual(['disableRowLevelSecurity']);
  });

  it('fails loud on a table not-equal where rlsEnabled matches on both sides (a second attribute drifted)', () => {
    // The differ pairs table nodes by name and `isEqualTo` compares name +
    // rlsEnabled, so this state cannot arise today — the guard makes the
    // "rlsEnabled is the only attribute" coupling explicit: a not-equal with
    // no rlsEnabled delta means an unhandled second attribute drifted, and we
    // fail rather than silently emit a bogus enable/disable.
    const result = mapNodeIssueToCall(notEqualIssue(tableNode(true), tableNode(true)), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected notOk');
    expect(result.failure.summary).toMatch(/unhandled table-attribute drift/i);
  });
});

describe('coalesceSubtreeIssues', () => {
  it('drops issues whose path is a strict descendant of a not-found ancestor', () => {
    const contract = makeContract({ user: userTable });
    const { issues } = buildPostgresPlanDiff({
      contract,
      actualSchema: emptyRoot(),
      frameworkComponents: [],
    });
    // The total differ emits the table not-found plus every column/PK under it.
    expect(issues.length).toBeGreaterThan(1);
    const coalesced = coalesceSubtreeIssues(issues);
    // Only the table-level not-found survives.
    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]?.path).toEqual(['database', 'public', 'user']);
  });
});
