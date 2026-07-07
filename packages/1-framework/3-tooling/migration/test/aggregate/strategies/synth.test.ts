import type {
  ControlAdapterInstance,
  ControlFamilyInstance,
  DiffIssue,
  MigrationOperationPolicy,
  MigrationPlanner,
  MigrationPlanWithAuthoringSurface,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { synthStrategy } from '../../../src/aggregate/strategies/synth';
import type { AggregateContractSpace } from '../../../src/aggregate/types';
import { makeAggregateContractSpace } from '../../fixtures';

const POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

const STUB_ADAPTER: ControlAdapterInstance<'sql', 'postgres'> =
  {} as unknown as ControlAdapterInstance<'sql', 'postgres'>;

function makeSpace(spaceId: string, tables: Record<string, unknown>): AggregateContractSpace {
  return makeAggregateContractSpace({
    spaceId,
    contract: createSqlContract({
      target: 'postgres',
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: tables } },
        },
      },
    }),
  });
}

function makeStubPlan(targetId: string): MigrationPlanWithAuthoringSurface {
  return {
    targetId,
    origin: null,
    destination: { storageHash: 'sha256:synth' },
    operations: [{ id: 'synth.op', label: 'Synthesised op', operationClass: 'additive' }],
    renderTypeScript: () => 'export {};',
  };
}

describe('synthStrategy', () => {
  it('passes the full schema and a diff filter that drops only other spaces’ extras', async () => {
    let observedSchema: unknown;
    let observedKeep: ((issue: DiffIssue) => boolean) | undefined;
    const stubPlanner: MigrationPlanner<'sql', 'postgres'> = {
      plan: ({ schema, keepDiffIssue }) => {
        observedSchema = schema;
        observedKeep = keepDiffIssue;
        return { kind: 'success', plan: makeStubPlan('placeholder') };
      },
      emptyMigration: () => {
        throw new Error('not used');
      },
    };
    const stubMigrations: TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    > = {
      createPlanner: () => stubPlanner,
      createRunner: () => {
        throw new Error('runner not used');
      },
      contractToSchema: () => ({ tables: {} }),
    };

    const appSpace = makeSpace('app', { app_user: {} });

    const liveSchema = {
      tables: {
        app_user: { columns: { id: {} } },
        cipher_state: { columns: { id: {} } },
        orphan_table: { columns: {} },
      },
    };

    const outcome = await synthStrategy({
      aggregateTargetId: 'postgres',
      currentMarker: null,
      space: appSpace,
      declaredByAnotherSpace: (name) => name === 'cipher_state',
      schemaIntrospection: liveSchema,
      adapter: STUB_ADAPTER,
      migrations: stubMigrations,
      frameworkComponents: [],
      operationPolicy: POLICY,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    // Synth strategy stamps the aggregate's targetId, not the planner's.
    expect(outcome.result.plan.targetId).toBe('postgres');
    expect(outcome.result.strategy).toBe('synth');
    expect(outcome.result.migrationEdges).toEqual([
      {
        dirName: '',
        migrationHash: 'sha256:synth',
        from: '',
        to: 'sha256:synth',
        operationCount: 1,
      },
    ]);

    // Critical: the planner saw the FULL schema (no pre-pruning) …
    const observed = observedSchema as { tables: Record<string, unknown> };
    expect(Object.keys(observed.tables).sort()).toEqual([
      'app_user',
      'cipher_state',
      'orphan_table',
    ]);

    // … and a keep-predicate it applies to its diff. The planner holds no
    // ownership logic: the predicate drops exactly the extras a sibling
    // contract space declares, keeps every non-extra finding, and keeps
    // extras no space declares (the planner may DROP those under policy).
    const keep = observedKeep;
    expect(keep).toBeDefined();
    if (keep === undefined) return;
    const missingIssue: DiffIssue = {
      kind: 'missing_table',
      table: 'cipher_state',
      reason: 'not-found',
      message: 'missing',
    };
    const siblingExtraIssue: DiffIssue = {
      kind: 'extra_table',
      table: 'cipher_state',
      reason: 'not-expected',
      message: 'extra',
    };
    const undeclaredExtraIssue: DiffIssue = {
      kind: 'extra_table',
      table: 'orphan_table',
      reason: 'not-expected',
      message: 'extra',
    };
    // An auxiliary/structural node (e.g. a Postgres RLS policy) references
    // its owning table via `tableName` — the entity name a sibling space
    // declares is the table, not the policy itself.
    const siblingExtraDiffIssue: DiffIssue = {
      path: ['public', 'cipher_state'],
      outcome: 'extra',
      reason: 'not-expected',
      message: 'extra',
      actual: { tableName: 'cipher_state' } as never,
    };
    // A relational table node's own identity is `name` (`SqlTableIR` /
    // `PostgresTableSchemaNode`), gated on `diffRole: 'table'` so an
    // unrelated node's own `name` (a column, index, or constraint) is never
    // mistaken for an entity to scope by.
    const siblingExtraTableNodeIssue: DiffIssue = {
      path: ['public', 'cipher_state'],
      outcome: 'extra',
      reason: 'not-expected',
      message: 'extra',
      actual: { name: 'cipher_state', diffRole: 'table' } as never,
    };
    // A column node also carries `name`, but no `diffRole: 'table'` — its
    // own name must never be read as an entity to scope by.
    const undeclaredExtraColumnNodeIssue: DiffIssue = {
      path: ['public', 'app_user', 'column:cipher_state'],
      outcome: 'extra',
      reason: 'not-expected',
      message: 'extra',
      actual: { name: 'cipher_state', diffRole: 'column' } as never,
    };
    const missingDiffIssue: DiffIssue = {
      path: ['public', 'app_user', 'policy_x'],
      outcome: 'missing',
      reason: 'not-found',
      message: 'missing',
    };
    expect(keep(missingIssue)).toBe(true);
    expect(keep(siblingExtraIssue)).toBe(false);
    expect(keep(undeclaredExtraIssue)).toBe(true);
    expect(keep(siblingExtraDiffIssue)).toBe(false);
    expect(keep(siblingExtraTableNodeIssue)).toBe(false);
    expect(keep(undeclaredExtraColumnNodeIssue)).toBe(true);
    expect(keep(missingDiffIssue)).toBe(true);
  });

  it('forwards planner failures verbatim', async () => {
    const stubPlanner: MigrationPlanner<'sql', 'postgres'> = {
      plan: () => ({
        kind: 'failure',
        conflicts: [{ kind: 'typeMismatch', summary: 'incompatible' }],
      }),
      emptyMigration: () => {
        throw new Error('not used');
      },
    };
    const stubMigrations: TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    > = {
      createPlanner: () => stubPlanner,
      createRunner: () => {
        throw new Error('runner not used');
      },
      contractToSchema: () => ({ tables: {} }),
    };

    const outcome = await synthStrategy({
      aggregateTargetId: 'postgres',
      currentMarker: null,
      space: makeSpace('app', {}),
      declaredByAnotherSpace: () => false,
      schemaIntrospection: { tables: {} },
      adapter: STUB_ADAPTER,
      migrations: stubMigrations,
      frameworkComponents: [],
      operationPolicy: POLICY,
    });

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(outcome.conflicts).toEqual([{ kind: 'typeMismatch', summary: 'incompatible' }]);
  });
});
