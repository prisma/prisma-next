import type {
  ControlAdapterInstance,
  ControlFamilyInstance,
  MigrationOperationPolicy,
  MigrationPlanner,
  MigrationPlanWithAuthoringSurface,
  TargetMigrationsCapability,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { createSqlContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { planFromDiff } from '../../../src/aggregate/strategies/plan-from-diff';
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

describe('planFromDiff', () => {
  it('passes the full schema and the sibling-owned entity names straight through to the planner', async () => {
    let observedSchema: unknown;
    let observedSiblingOwnedEntityNames: ReadonlySet<string> | undefined;
    const stubPlanner: MigrationPlanner<'sql', 'postgres'> = {
      plan: ({ schema, siblingOwnedEntityNames }) => {
        observedSchema = schema;
        observedSiblingOwnedEntityNames = siblingOwnedEntityNames;
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

    const outcome = await planFromDiff({
      aggregateTargetId: 'postgres',
      currentMarker: null,
      space: appSpace,
      siblingOwnedEntityNames: new Set(['cipher_state']),
      schemaIntrospection: liveSchema,
      adapter: STUB_ADAPTER,
      migrations: stubMigrations,
      frameworkComponents: [],
      operationPolicy: POLICY,
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    // The strategy stamps the aggregate's targetId, not the planner's.
    expect(outcome.result.plan.targetId).toBe('postgres');
    expect(outcome.result.strategy).toBe('plan-from-diff');
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

    // … and the aggregate's ownership set verbatim. The planner itself
    // decides how to scope its diff by it; this strategy holds no
    // ownership logic.
    expect(observedSiblingOwnedEntityNames).toEqual(new Set(['cipher_state']));
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

    const outcome = await planFromDiff({
      aggregateTargetId: 'postgres',
      currentMarker: null,
      space: makeSpace('app', {}),
      siblingOwnedEntityNames: new Set(),
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
